import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSemanticCases as baseline,scoreSemanticCase} from '../qa/insight-engine/semantic-cases.mjs';
import {buildSemanticCases as compound} from '../qa/insight-engine/semantic-compound-cases.mjs';
import {buildSemanticCases as ownership} from '../qa/insight-engine/semantic-ownership-cases.mjs';
import {buildSupportUnits,validateSupportOutput} from '../server/insights/support-schema.mjs';
function wire(c){return {assessments:buildSupportUnits(c.draft).map(u=>({unitId:u.id,claims:[{text:u.text,verdict:'supported',reason:'Offline scoring fixture.',passages:['S1:t1']}]}))};}
test('compound cases retain exact original evidence and target text',()=>{
 const small=baseline(),larger=compound();assert.equal(larger.length,6);
 for(let i=0;i<6;i++){
  assert.deepEqual(larger[i].bundle,small[i].bundle);
  assert.equal(larger[i].targetText,small[i].draft.findings[0].summary);
  assert.ok(larger[i].draft.findings[0].summary.includes(larger[i].targetText));
  assert.doesNotThrow(()=>validateSupportOutput(larger[i].bundle,larger[i].draft,wire(larger[i])));
 }
});
test('compound scoring ignores flagged neighbors and withholds mixed-scope detection',()=>{
 const c=compound()[0],output=wire(c),unit=output.assessments.find(a=>a.unitId===c.targetUnitId);
 unit.claims[0].verdict='unsupported';
 assert.equal(scoreSemanticCase(c,output).outcome,'requires_audit');
 const full=unit.claims[0].text,start=full.indexOf(c.targetText),end=start+c.targetText.length;
 const claim=(text,verdict)=>({text,verdict,reason:'Offline scoring fixture.',passages:['S1:t1']});
 unit.claims=[claim(full.slice(0,start),'unsupported'),claim(c.targetText,'supported'),claim(full.slice(end),'supported')];
 assert.equal(scoreSemanticCase(c,output).outcome,'missed_overclaim');
 unit.claims[0].verdict='supported';unit.claims[1].verdict='unsupported';
 assert.equal(scoreSemanticCase(c,output).outcome,'detected');
});
test('ownership cases present opposing evidence with correct source owners',()=>{
 const cases=ownership();assert.equal(cases.length,6);assert.deepEqual(cases,ownership());
 for(const c of cases){
  assert.equal(c.bundle.eligible,true);assert.equal(c.bundle.coverage.omittedSources,0);
  assert.ok(c.bundle.sources.some(s=>s.attemptKey==='north'));
  assert.ok(c.bundle.sources.some(s=>s.attemptKey==='south'));
  assert.doesNotThrow(()=>validateSupportOutput(c.bundle,c.draft,wire(c)));
 }
 const north=cases[0].bundle.sources.find(s=>s.attemptKey==='north').excerpt;
 const south=cases[0].bundle.sources.find(s=>s.attemptKey==='south').excerpt;
 assert.match(north,/const QUEUE_LIMIT = 64/);assert.match(south,/import \{ QUEUE_LIMIT, warnOverflow \}/);
 assert.equal(cases[4].expectedVerdict,'unsupported');assert.equal(cases[5].expectedVerdict,'supported');
});
