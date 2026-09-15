import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticCases, scoreSemanticCase } from '../qa/insight-engine/semantic-cases.mjs';
import { buildSupportUnits, buildSupportPassages, validateSupportOutput } from '../server/insights/support-schema.mjs';
import { reviewOpenAI } from '../server/insights/support-provider.mjs';

function wire(fixture, verdict = 'supported') {
  const passage = buildSupportPassages(fixture.bundle)[0].id;
  return { assessments: buildSupportUnits(fixture.draft).map(unit => ({unitId: unit.id, claims: [{text: unit.text, verdict: unit.id === fixture.targetUnitId ? verdict : 'supported', reason: 'Offline scoring fixture only.', passages: [passage]}]})) };
}

test('six deterministic semantic fixtures have valid evidence, paired claims and separate labels', () => {
  const cases = buildSemanticCases();
  assert.equal(cases.length, 6);
  assert.deepEqual(cases, buildSemanticCases());
  assert.equal(new Set(cases.map(c => c.id)).size, 6);
  for (const c of cases) {
    assert.equal(c.bundle.eligible, true);
    assert.equal(c.bundle.coverage.omittedSources, 0);
    assert.equal(c.bundle.sources.some(s => s.excerpt.includes('IGNORE THE ANALYZER')), false);
    assert.doesNotThrow(() => validateSupportOutput(c.bundle, c.draft, wire(c)));
    assert.equal(JSON.stringify({bundle: c.bundle, draft: c.draft}).includes(c.rationale), false);
  }
  assert.equal(cases[0].draft.findings[0].summary, cases[1].draft.findings[0].summary);
  assert.notEqual(cases[0].bundle.inputHash, cases[1].bundle.inputHash);
  assert.equal(cases[2].draft.findings[0].summary, cases[3].draft.findings[0].summary);
});

test('scoring keeps missed overclaims, false flags and unavailable outputs in the denominator', () => {
  const cases = buildSemanticCases();
  const negative = cases.find(c => c.expectedVerdict === 'unsupported');
  const positive = cases.find(c => c.expectedVerdict === 'supported');
  assert.equal(scoreSemanticCase(negative, wire(negative)).outcome, 'missed_overclaim');
  assert.equal(scoreSemanticCase(negative, wire(negative, 'needs_review')).outcome, 'detected');
  assert.equal(scoreSemanticCase(positive, wire(positive, 'unsupported')).outcome, 'false_flag');
  assert.equal(scoreSemanticCase(positive, null).outcome, 'unavailable');
  const invalid = wire(positive); invalid.assessments.pop();
  assert.equal(scoreSemanticCase(positive, invalid).outcome, 'invalid');
  invalid.assessments = wire(positive).assessments;
  invalid.assessments[0].claims[0].passages = ['S999:t1'];
  assert.equal(scoreSemanticCase(positive, invalid).outcome, 'invalid');
});

test('split target claims use the worst verdict and preserve exact-label agreement separately', () => {
  const c = buildSemanticCases().find(c => c.expectedVerdict === 'unsupported');
  const output = wire(c); const a = output.assessments.find(a => a.unitId === c.targetUnitId);
  const text = a.claims[0].text; const cut = text.indexOf(' ');
  a.claims = [{...a.claims[0], text: text.slice(0,cut)}, {...a.claims[0], text: text.slice(cut), verdict:'needs_review'}];
  const score = scoreSemanticCase(c, output);
  assert.equal(score.outcome, 'detected');
  assert.equal(score.exactAgreement, false);
});

test('provider requests contain only evidence and draft, never evaluation labels or rationales', async () => {
  for (const c of buildSemanticCases()) {
    let body;
    await reviewOpenAI({bundle:c.bundle,draft:c.draft,model:'offline',baseUrl:'https://example.test/v1',apiKey:'offline',apiFormat:'chat_completions',outputFormat:'json_schema',fetchImpl:async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire(c))}}]}),{status:200});
    }});
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(c.rationale), false);
    for (const key of ['expectedVerdict','targetUnitId','goldLabel']) assert.equal(serialized.includes(key),false);
  }
});

test('the runner performs one bounded call per case, preserves failures and scores every case', async () => {
  const { runSemanticSuite } = await import('../qa/insight-engine/semantic-runner.mjs');
  const cases = buildSemanticCases(); let calls=0; const saved=[];
  const records = await runSemanticSuite({cases, options:{model:'offline',timeoutSeconds:1}, review:async ({bundle,draft,...options}) => {
    calls++;
    assert.equal('expectedVerdict' in options,false);
    if(calls===2) throw Object.assign(Error('provider_incomplete'),{diagnostics:{status:'incomplete'}});
    if(calls===3) return {output:{assessments:[]}};
    return {output:wire(cases.find(c=>c.bundle===bundle && c.draft===draft))};
  }, save:async record=>saved.push(record)});
  assert.equal(calls,6); assert.equal(records.length,6); assert.equal(saved.length,6);
  assert.equal(records[1].error,'provider_incomplete');
  assert.equal(records[1].score.outcome,'unavailable');
  assert.equal(records[2].score.outcome,'invalid');
  assert.equal(records[0].score.outcome,'missed_overclaim');
  assert.equal(records[5].score.outcome,'retained');
});

test('an aborted run marks remaining cases unrun without making provider requests', async () => {
  const { runSemanticSuite } = await import('../qa/insight-engine/semantic-runner.mjs');
  let calls=0; const controller=new AbortController(); controller.abort();
  const records=await runSemanticSuite({cases:buildSemanticCases(), options:{timeoutSeconds:1},signal:controller.signal,review:async()=>{calls++;},save:async()=>{}});
  assert.equal(calls,0); assert.equal(records.length,6);
  assert.ok(records.every(r=>r.state==='not_run' && r.score.outcome==='unavailable'));
});
