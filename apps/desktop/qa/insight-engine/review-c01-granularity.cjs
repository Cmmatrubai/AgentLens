// Offline by default. --run authorizes exactly three sequential paid requests, one per original C01 unit, with no retries.
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash,randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {validatePlan,matchesEntryFile}=require('./review-models.cjs');
const desktop=path.resolve(__dirname,'../..');
const privateRoot=path.join(desktop,'.local/insight-engine');
const jobName='job-be0406bf-b8b8-40f5-89a1-c467757e33de.json';
const supportName='support-aa58e3de-caa7-445f-b459-d158f812dadd.json';
const expected={jobFile:'4640cd3da1680fddc723dc8856b86c77e620b0cab618dc781b46fc8035caf740',draft:'5ba6d09f32af9e6de48468407481af99d979740860db873cedcd0d59819867dc',inputHash:'798eb07284607e207f07baa3cbced134a0d622d292279b112ee7d72adcf74aba'};
const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const safe=new Set(['invalid_arguments','source_guard_failed','catalog_stale','invalid_plan','version_guard_failed','native_electron_required','credential_unavailable','analysis_timeout','provider_authentication','provider_rate_limit','provider_unsupported_request','provider_error','provider_unreachable','provider_invalid_response','provider_refused','provider_incomplete','analysis_input_too_large','support_validation_failed']);

async function topLevelHashes(){
 const names=(await fs.readdir(privateRoot)).filter(name=>name.endsWith('.json')).sort();
 return Object.fromEntries(await Promise.all(names.map(async name=>[name,sha(await fs.readFile(path.join(privateRoot,name)))])));
}

async function main(){
 let electron;let code=1;
 try{
  if(process.versions.electron){electron=require('electron');require(path.join(desktop,'electron/identity.cjs')).applyDesktopIdentity(electron.app);}
  const args=process.argv.slice(2);if(args.length>1||(args.length&&!['--check','--run'].includes(args[0])))throw Error('invalid_arguments');
  const live=args[0]==='--run';
  const [jobRaw,supportRaw,planRaw,granularity,provider,schema,files]=await Promise.all([
   fs.readFile(path.join(privateRoot,jobName)),fs.readFile(path.join(privateRoot,supportName)),fs.readFile(path.join(__dirname,'semantic-plan.json'),'utf8'),
   import(pathToFileURL(path.join(__dirname,'c01-granularity.mjs')).href),import(pathToFileURL(path.join(desktop,'server/insights/support-provider.mjs')).href),import(pathToFileURL(path.join(desktop,'server/insights/support-schema.mjs')).href),import(pathToFileURL(path.join(desktop,'server/insights/private-files.mjs')).href),
  ]);
  const job=JSON.parse(jobRaw),support=JSON.parse(supportRaw),plan=JSON.parse(planRaw);
  if(sha(jobRaw)!==expected.jobFile||sha(job.output)!==expected.draft||job.inputHash!==expected.inputHash||support.evidence?.inputHash!==expected.inputHash||sha(support.draft)!==expected.draft)throw Error('source_guard_failed');
  if(provider.SUPPORT_PROMPT_VERSION!=='evidence-support-v5'||schema.SUPPORT_VERSION!=='support-v5')throw Error('version_guard_failed');
  const cases=granularity.buildC01GranularityCases(support.evidence,job.output);
  if(cases.length!==3)throw Error('source_guard_failed');
  const catalog=live?JSON.parse(await fs.readFile('/tmp/agentlens-model-catalog.json','utf8')):{data:plan.candidates.map(c=>({id:c.model,supported_endpoint_types:['openai-response']}))};
  if(live&&(!Number.isFinite(Date.parse(catalog.checkedAt))||Date.now()-Date.parse(catalog.checkedAt)>3600000||Date.parse(catalog.checkedAt)>Date.now()+60000))throw Error('catalog_stale');
  validatePlan(plan,catalog);if(plan.candidates.length!==1||plan.candidates[0].maxOutputTokens>3000)throw Error('invalid_plan');
  const snapshot={suiteVersion:'c01-granularity-v1',version:schema.SUPPORT_VERSION,promptVersion:provider.SUPPORT_PROMPT_VERSION,plan,units:cases.map(c=>({unitId:c.unitId,text:c.text,expectedVerdict:c.expectedVerdict,scoringNote:c.scoringNote})),draftSha256:sha(job.output),evidenceSha256:sha(support.evidence),taskSha256:sha(support.evidence.task),coverageSha256:sha(support.evidence.coverage),passagesSha256:sha(schema.buildSupportPassages(support.evidence)),topLevelBefore:await topLevelHashes()};
  if(!live){console.log(JSON.stringify({state:'validated_offline',units:cases.map(c=>c.unitId),draftSha256:snapshot.draftSha256,evidenceSha256:snapshot.evidenceSha256,passagesSha256:snapshot.passagesSha256}));code=0;return;}
  if(!electron)throw Error('native_electron_required');await electron.app.whenReady();
  const store=require(path.join(desktop,'electron/insight-credentials.cjs')).createCredentialStore({safeStorage:electron.safeStorage,root:privateRoot});
  let apiKey=await store.get(plan.endpoint);if(!apiKey)throw Error('credential_unavailable');
  const runId=randomUUID(),directory=path.join(privateRoot,'c01-granularity-evaluation',runId);await fs.mkdir(directory,{recursive:true,mode:0o700});
  const sources={};for(const name of ['qa/insight-engine/c01-granularity.mjs','qa/insight-engine/review-c01-granularity.cjs','server/insights/support-provider.mjs','server/insights/support-schema.mjs','server/insights/provider.mjs'])sources[name]=await fs.readFile(path.join(desktop,name),'utf8');
  await files.privateWrite(directory,'snapshot.json',{...snapshot,sourceHashes:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,sha(v)])),sources});
  const run={id:runId,state:'running',createdAt:new Date().toISOString(),endedAt:null,completed:[]};await files.privateWrite(directory,'run.json',run);
  const candidate=plan.candidates[0];
  for(const fixture of cases){
   const started=performance.now();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),candidate.timeoutSeconds*1000);let record;
   try{
    const response=await provider.reviewOpenAI({bundle:fixture.bundle,draft:fixture.draft,apiKey,baseUrl:plan.endpoint,...candidate,signal:controller.signal,fetchImpl:(url,options)=>fetch(url,granularity.narrowSupportRequest(options,fixture))});
    const score=granularity.validateAndScoreC01Output(fixture,response.output);
    record={unitId:fixture.unitId,state:'complete',elapsedMs:Math.round(performance.now()-started),outputSha256:sha(response.output),output:response.output,diagnostics:response.diagnostics,usage:response.usage,providerResponseId:response.providerResponseId,score};
   }catch(error){record={unitId:fixture.unitId,state:'failed',elapsedMs:Math.round(performance.now()-started),error:safe.has(error?.message)?error.message:'evaluation_failed',diagnostics:error?.diagnostics??null};}
   finally{clearTimeout(timer);}
   await files.privateWrite(directory,`${fixture.unitId.replaceAll(':','-')}.json`,record);run.completed.push({unitId:fixture.unitId,state:record.state,score:record.score??null});await files.privateWrite(directory,'run.json',run);console.log(JSON.stringify({...run.completed.at(-1),elapsedMs:record.elapsedMs,usage:record.usage??null,outputSha256:record.outputSha256??null}));
  }
  apiKey=null;run.state=run.completed.every(x=>x.state==='complete')?'complete':'failed';run.endedAt=new Date().toISOString();run.topLevelAfter=await topLevelHashes();run.originalTopLevelUnchanged=JSON.stringify(run.topLevelAfter)===JSON.stringify(snapshot.topLevelBefore);await files.privateWrite(directory,'run.json',run);console.log(JSON.stringify({state:run.state,resultPath:path.join(directory,'run.json'),originalTopLevelUnchanged:run.originalTopLevelUnchanged}));code=run.state==='complete'&&run.originalTopLevelUnchanged?0:1;
 }catch(error){console.log(JSON.stringify({state:'failed',error:safe.has(error?.message)?error.message:'evaluation_failed'}));}
 finally{process.exitCode=code;if(electron)electron.app.exit(code);}
}
if(require.main===module||(process.versions.electron&&matchesEntryFile(process.argv[1],__filename)))void main();
