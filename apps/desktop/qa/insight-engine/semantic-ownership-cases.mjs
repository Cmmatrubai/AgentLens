import {buildSemanticCases as baseline} from './semantic-cases.mjs';
export const SEMANTIC_SUITE_VERSION='semantic-ownership-v1';
export function buildSemanticCases(){
 const originals=baseline();let index=0;
 return baseline(pair=>{
  const i=index++,north=pair.attempts.find(a=>a.key==='north'),south=pair.attempts.find(a=>a.key==='south');
  if(i<4){south.run.events[0].output=originals[i^1].bundle.sources.find(s=>s.attemptKey==='north').excerpt;return;}
  const northReport=north.run.events.find(e=>e.kind==='message.agent');
  const original=northReport.message;
  const unknown='I cannot determine why this test failed. The cause is unknown.';
  northReport.message=i===4 ? unknown : original;
  south.run.events.push({...northReport,id:'south-report',message:i===4 ? original : unknown});
  south.run.events[0].output=north.run.events[0].output;
  south.run.events[0].command=north.run.events[0].command;
  south.run.events[0].status='failed';south.run.events[0].exitCode=1;
  south.run.events[0].testOutcome='fail';south.run.events[0].testAttribution='source_exit';
  south.run.failedCommandCount=1;south.run.eventCount=south.run.events.length;south.eventCount=south.run.eventCount;
  south.run.tests=structuredClone(north.run.tests);
 }).map((c,i)=>i<4 ? c : ({...c,
  expectedVerdict:i===4 ? 'unsupported' : 'supported',
  rationale:i===4 ? 'Only the South report supplies the DNS explanation; the North report explicitly leaves the cause unknown.' : 'The North report supplies the DNS explanation while the South report leaves the cause unknown.',
  draft:{...c.draft,findings:c.draft.findings.map(f=>({...f,summary:"North's report attributes the failure to a DNS outage."}))},
 }));
}
