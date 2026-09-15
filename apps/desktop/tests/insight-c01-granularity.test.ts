import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildC01GranularityCases,
  narrowSupportRequest,
  validateAndScoreC01Output,
} from '../qa/insight-engine/c01-granularity.mjs';
import { reviewOpenAI } from '../server/insights/support-provider.mjs';
import { buildInsightBundle } from '../server/insights/evidence.mjs';
import { makeInsightComparisonWithoutChecks } from './fixtures/insight-comparisons.mjs';

function publicFixture() {
  const pair=makeInsightComparisonWithoutChecks();
  pair.id='public-granularity-fixture';
  pair.title='Review selected units';
  pair.taskPrompt='Compare the supplied public fixture evidence accurately.';
  for(const attempt of pair.attempts){
    attempt.run.events=[{id:`${attempt.key}-event`,sequence:1,kind:'message.agent',status:'completed',provenance:'reported',receivedAt:1001,summary:'Public fixture report',command:'',output:'',outputState:'unavailable',exitCode:null,message:`${attempt.key} reported a bounded result.`,files:[],testOutcome:null,testAttribution:null,artifactId:null,relationships:[]}];
    attempt.run.git.files=[];attempt.run.eventCount=1;attempt.eventCount=1;
  }
  const bundle=buildInsightBundle(pair);
  const sourceIds=key=>bundle.sources.filter(source=>source.attemptKey===key).map(source=>source.id);
  const finding=(index:number)=>({
    id:`public-finding-${index}`,category:`Public category ${index}`,title:`Public title ${index}`,
    summary:`Public summary ${index} preserves every character.`,
    interpretation:`Public interpretation ${index} remains part of the 21-unit draft.`,
    limitations:`Public limitation ${index} states that this is a synthetic contract fixture.`,
    sides:bundle.attempts.map(attempt=>({attemptKey:attempt.key,observation:`Public ${attempt.key} observation ${index} preserves exact text.`,sourceIds:sourceIds(attempt.key)})),
  });
  return {bundle,draft:{findings:[finding(0),finding(1),finding(2)],abstentionReason:''}};
}

test('granularity cases preserve exact selected units and the complete public input by identity', () => {
  const {bundle,draft}=publicFixture();
  const cases = buildC01GranularityCases(bundle,draft);
  assert.deepEqual(cases.map(c => c.unitId), ['f0:observation:1', 'f1:title', 'f2:summary']);
  assert.equal(cases[0].text,draft.findings[0].sides[1].observation);
  assert.equal(cases[1].text,draft.findings[1].title);
  assert.equal(cases[2].text,draft.findings[2].summary);
  for (const c of cases) {
    assert.strictEqual(c.bundle,bundle);
    assert.strictEqual(c.draft,draft);
    assert.deepEqual(c.bundle.task,bundle.task);
    assert.deepEqual(c.bundle.coverage,bundle.coverage);
  }
});

test('request narrowing sends one exact unit while retaining every original passage and context field', async () => {
  const {bundle,draft}=publicFixture();
  const c = buildC01GranularityCases(bundle,draft)[0];
  let narrowed;
  await reviewOpenAI({bundle:c.bundle,draft:c.draft,model:'offline',baseUrl:'https://example.test/v1',apiKey:'offline',apiFormat:'responses',outputFormat:'json_schema',fetchImpl:async (_url, options) => {
    narrowed = narrowSupportRequest(options, c);
    const body = JSON.parse(narrowed.body);
    const input = JSON.parse(body.input[0].content);
    assert.deepEqual(input.units, [{...c.originalUnit, originalCitationRefs:c.originalCitationRefs}]);
    assert.deepEqual(input.coverage, c.bundle.coverage);
    assert.equal(input.passages.length, c.passageCount);
    assert.deepEqual(body.text.format.schema.properties.assessments.items.properties.unitId.enum, [c.unitId]);
    return new Response(JSON.stringify({id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({assessments:[{unitId:c.unitId,claims:[{text:c.text,verdict:'needs_review',reason:'The relationship needs inspection.',passages:['S1:t1']}]}]})}]}]}),{status:200});
  }});
  assert.ok(narrowed);
});

test('request narrowing rejects selected-text and coverage drift', async () => {
  const {bundle,draft}=publicFixture();
  const c=buildC01GranularityCases(bundle,draft)[0];
  let originalOptions;
  await reviewOpenAI({bundle,draft,model:'offline',baseUrl:'https://example.test/v1',apiKey:'offline',apiFormat:'responses',outputFormat:'json_schema',fetchImpl:async (_url,options)=>{
    originalOptions=options;
    return new Response(JSON.stringify({id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({assessments:[]})}]}]}),{status:200});
  }});
  assert.ok(originalOptions);
  assert.throws(()=>narrowSupportRequest(originalOptions,{...c,text:`${c.text} changed`}),/source_guard_failed/);
  assert.throws(()=>narrowSupportRequest(originalOptions,{...c,bundle:{...c.bundle,coverage:{...c.bundle.coverage,omittedSources:c.bundle.coverage.omittedSources+1}}}),/source_guard_failed/);
});

test('selected-unit scoring validates exact coverage and keeps rubric ambiguity explicit', () => {
  const {bundle,draft}=publicFixture();
  const cases = buildC01GranularityCases(bundle,draft);
  for (const c of cases) {
    const output={assessments:[{unitId:c.unitId,claims:[{text:c.text,verdict:'needs_review',reason:'Narrow offline fixture.',passages:['S1:t1']}]}]};
    const scored=validateAndScoreC01Output(c,output);
    assert.equal(scored.coverageValid,true);
    assert.equal(scored.detected,true);
    assert.equal(scored.exactAgreement,c.expectedVerdict==='needs_review');
  }
  assert.equal(cases[1].scoringNote.includes('ambiguous'),true);
  const invalid={assessments:[{unitId:cases[0].unitId,claims:[{text:cases[0].text.slice(1),verdict:'unsupported',reason:'Bad slice.',passages:['S1:t1']}]}]};
  assert.throws(()=>validateAndScoreC01Output(cases[0],invalid),/Claims must cover/);
});
