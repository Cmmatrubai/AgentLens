// Defaults to offline checks. Only --run performs the six explicit paid calls.
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createHash,randomUUID} = require('node:crypto');
const {validatePlan,matchesEntryFile} = require('./review-models.cjs');
const desktop = path.resolve(__dirname,'../..');
const privateRoot = path.join(desktop,'.local/insight-engine');
const sha = value => createHash('sha256').update(typeof value==='string' ? value : JSON.stringify(value)).digest('hex');
async function main({ suite = "baseline" } = {}) {
  let electron; let code=1;
  try {
    if(process.versions.electron) {
      electron=require('electron');
      require(path.join(desktop,'electron/identity.cjs')).applyDesktopIdentity(electron.app);
    }
    const args=process.argv.slice(2);
    if(args.length>1 || (args.length && !['--check','--run'].includes(args[0]))) throw Error('invalid_arguments');
    if(!["baseline","context","compound","ownership"].includes(suite)) throw Error("invalid_arguments");
    const live=args[0]==='--run';
    const load=relative=>import(pathToFileURL(path.join(desktop,relative)).href);
    const [{buildSemanticCases,SEMANTIC_SUITE_VERSION},{runSemanticSuite},{privateWrite},schema,provider] = await Promise.all([
      load(suite === 'baseline' ? 'qa/insight-engine/semantic-cases.mjs' : `qa/insight-engine/semantic-${suite}-cases.mjs`),load('qa/insight-engine/semantic-runner.mjs'),load('server/insights/private-files.mjs'),load('server/insights/support-schema.mjs'),load('server/insights/support-provider.mjs'),
    ]);
    if(schema.SUPPORT_VERSION!=='support-v5' || provider.SUPPORT_PROMPT_VERSION!=='evidence-support-v5') throw Error('version_guard_failed');
    const cases=buildSemanticCases();
    const plan=JSON.parse(await fs.readFile(path.join(__dirname,'semantic-plan.json'),'utf8'));
    // Offline validation uses a synthetic catalog and never needs keys or network.
    const catalog=live ? JSON.parse(await fs.readFile('/tmp/agentlens-model-catalog.json','utf8')) : {data:plan.candidates.map(c=>({id:c.model,supported_endpoint_types:['openai-response']}))};
    if(live && (!Number.isFinite(Date.parse(catalog.checkedAt)) || Date.now()-Date.parse(catalog.checkedAt)>3600000 || Date.parse(catalog.checkedAt)>Date.now()+60000)) throw Error('catalog_stale');
    validatePlan(plan,catalog);
    if(plan.candidates.length!==1 || plan.candidates[0].maxOutputTokens>3000) throw Error('invalid_plan');
    for(const c of cases) {
      if(!c.bundle.eligible) throw Error('fixture_ineligible');
      const passage=schema.buildSupportPassages(c.bundle)[0].id;
      schema.validateSupportOutput(c.bundle,c.draft,{assessments:schema.buildSupportUnits(c.draft).map(unit=>({unitId:unit.id,claims:[{text:unit.text,verdict:'supported',reason:'Offline contract check only.',passages:[passage]}]}))});
    }
    const sourcePaths=['qa/insight-engine/semantic-cases.mjs','qa/insight-engine/semantic-runner.mjs','qa/insight-engine/review-semantics.cjs','tests/fixtures/insight-comparisons.mjs','server/insights/evidence.mjs','server/insights/support-schema.mjs','server/insights/support-provider.mjs','server/insights/provider.mjs','server/insights/schema.mjs'];
    if(suite !== 'baseline') sourcePaths.push(`qa/insight-engine/semantic-${suite}-cases.mjs`,`qa/insight-engine/review-semantic-${suite}.cjs`);
    const sources={}; for(const file of sourcePaths) sources[file]=await fs.readFile(path.join(desktop,file),'utf8');
    const frozen={suiteVersion:SEMANTIC_SUITE_VERSION,version:schema.SUPPORT_VERSION,promptVersion:provider.SUPPORT_PROMPT_VERSION,plan,cases,sourceHashes:Object.fromEntries(Object.entries(sources).map(([file,text])=>[file,sha(text)])),casesHash:sha(cases)};
    if(!live) { console.log(JSON.stringify({state:'validated_offline',cases:cases.length,casesHash:frozen.casesHash})); code=0; return; }
    if(!electron) throw Error('native_electron_required');
    await electron.app.whenReady();
    const store=require(path.join(desktop,'electron/insight-credentials.cjs')).createCredentialStore({safeStorage:electron.safeStorage,root:privateRoot});
    const key=await store.get(plan.endpoint); if(!key) throw Error('credential_unavailable');
    const runId=randomUUID();
    const directory=path.join(privateRoot,suite === 'baseline' ? 'semantic-evaluation' : `semantic-${suite}-evaluation`,runId);
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    await privateWrite(directory,'snapshot.json',{...frozen,sources});
    const run={id:runId,state:'running',createdAt:new Date().toISOString(),endedAt:null,suiteVersion:SEMANTIC_SUITE_VERSION,casesHash:frozen.casesHash,completed:[]};
    await privateWrite(directory,'run.json',run);
    const controller=new AbortController(); const abort=()=>controller.abort();
    process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try {
      const records=await runSemanticSuite({cases,options:{...plan.candidates[0],apiKey:key,baseUrl:plan.endpoint,authMode:'bearer'},signal:controller.signal,save:async record=>{
        await privateWrite(directory,`${record.caseId}.json`,record);
        run.completed.push({caseId:record.caseId,state:record.state,score:record.score});
        await privateWrite(directory,'run.json',run);
        console.log(JSON.stringify({caseId:record.caseId,state:record.state,elapsedMs:record.elapsedMs,score:record.score,diagnostics:record.diagnostics}));
      }});
      run.state=controller.signal.aborted ? 'interrupted' : 'complete';
      run.endedAt=new Date().toISOString();
      run.summary={total:records.length,outcomes:records.reduce((counts,r)=>{counts[r.score.outcome]=(counts[r.score.outcome]??0)+1;return counts;},{}),exactAgreement:records.filter(r=>r.score.exactAgreement).length};
      await privateWrite(directory,'run.json',run);
      console.log(JSON.stringify({state:run.state,summary:run.summary,resultPath:path.join(directory,'run.json')}));
      code=controller.signal.aborted ? 130 : records.some(r=>r.state!=='complete') ? 1 : 0;
    } finally { process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort); }
  } catch(error) {
    const safe=['invalid_arguments','invalid_plan','catalog_stale','version_guard_failed','fixture_ineligible','native_electron_required','credential_unavailable'];
    console.log(JSON.stringify({state:'failed',error:safe.includes(error?.message)?error.message:'evaluation_failed'}));
  } finally { process.exitCode=code; if(electron) electron.app.exit(code); }
}
if(require.main===module || (process.versions.electron && matchesEntryFile(process.argv[1],__filename))) void main();
module.exports={main};
