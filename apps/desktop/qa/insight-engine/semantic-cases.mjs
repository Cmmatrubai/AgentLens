import { makeInsightComparisonWithoutChecks } from '../../tests/fixtures/insight-comparisons.mjs';
import { buildInsightBundle } from './protocol-snapshots/evidence-v3.mjs';
import { validateSupportOutput } from '../../server/insights/support-schema.mjs';

export const SEMANTIC_SUITE_VERSION = 'semantic-relations-v1';
const definitions = [
  {
    id: 'case-01', family: 'imports', expectedVerdict: 'unsupported',
    title: 'Module imports',
    claim: 'North imports both QUEUE_LIMIT and warnOverflow from the policy module into entry.ts.',
    excerpt: 'src/policy.ts:\nexport const QUEUE_LIMIT = 64;\nexport function warnOverflow() { return "overflow"; }\n\nsrc/entry.ts:\nimport { warnOverflow } from "./policy";\nconst QUEUE_LIMIT = 64;\nexport const policy = { QUEUE_LIMIT, warnOverflow };\n',
    rationale: 'QUEUE_LIMIT is defined locally in entry.ts; only warnOverflow is imported there. Co-occurrence does not establish the asserted import relation.',
  },
  {
    id: 'case-02', family: 'imports', expectedVerdict: 'supported',
    title: 'Module imports',
    claim: 'North imports both QUEUE_LIMIT and warnOverflow from the policy module into entry.ts.',
    excerpt: 'src/policy.ts:\nexport const QUEUE_LIMIT = 64;\nexport function warnOverflow() { return "overflow"; }\n\nsrc/entry.ts:\nimport { QUEUE_LIMIT, warnOverflow } from "./policy";\nexport const policy = { QUEUE_LIMIT, warnOverflow };\n',
    rationale: 'Both names occur in the displayed import specifiers from policy into entry.ts.',
  },
  {
    id: 'case-03', family: 'conditions', expectedVerdict: 'unsupported',
    title: 'Copy conditions',
    claim: 'North copies durationMs from value to result without checking its type.',
    excerpt: 'export function normalize(value: Record<string, unknown>) {\n  const result: Record<string, unknown> = {};\n  if (typeof value.durationMs === "number") {\n    result.durationMs = value.durationMs;\n  }\n  return result;\n}\n',
    rationale: 'The assignment is inside a numeric type guard, contradicting the explicit absence-of-type-check claim.',
  },
  {
    id: 'case-04', family: 'conditions', expectedVerdict: 'supported',
    title: 'Copy conditions',
    claim: 'North copies durationMs from value to result without checking its type.',
    excerpt: 'export function normalize(value: Record<string, unknown>) {\n  const result: Record<string, unknown> = {};\n  result.durationMs = value.durationMs;\n  return result;\n}\n',
    rationale: 'The complete displayed function directly assigns the value without a type condition. This says nothing about callers.',
  },
  {
    id: 'case-05', family: 'attribution', expectedVerdict: 'needs_review',
    title: 'Failure attribution',
    claim: "North's test failure was caused by a DNS outage.",
    excerpt: 'FAIL checkout request\nAssertionError: response missing\n1 test failed\n',
    report: 'The test failed because a DNS outage prevented the request. I did not run a separate DNS diagnostic.',
    rationale: 'The log records an assertion failure; only the agent report supplies the DNS explanation, with no separate diagnostic establishing that cause.',
  },
  {
    id: 'case-06', family: 'attribution', expectedVerdict: 'supported',
    title: 'Failure attribution',
    claim: 'North reported that its test failed because of a DNS outage.',
    excerpt: 'FAIL checkout request\nAssertionError: response missing\n1 test failed\n',
    report: 'The test failed because a DNS outage prevented the request. I did not run a separate DNS diagnostic.',
    rationale: 'The claim explicitly attributes the explanation to the agent, and the report contains that explanation. It does not endorse the cause as independently established.',
  },
];

function buildCase(definition, transformComparison) {
  const pair = makeInsightComparisonWithoutChecks();
  pair.id = 'synthetic-relation-task';
  pair.title = 'Compare saved implementation excerpts';
  pair.taskPrompt = 'Inspect the supplied implementations and report validation results accurately.';
  pair.manifestHash = 'synthetic-relation-manifest';
  pair.promptHash = 'synthetic-relation-prompt';
  for (const attempt of pair.attempts) {
    const north = attempt.key === 'north';
    const failed = north && !!definition.report;
    const event = {
      id: `${attempt.key}-excerpt`, sequence: 1, kind: 'command', status: failed ? 'failed' : 'completed',
      provenance: 'observed', receivedAt: 1001, summary: 'Supplied command output',
      command: failed ? 'node checkout.test.mjs' : 'cat src/implementation.ts',
      output: north ? definition.excerpt : 'export const policy = "retained";\n',
      outputState: 'available', exitCode: failed ? 1 : 0, message: '', files: [],
      testOutcome: failed ? 'fail' : null, testAttribution: failed ? 'source_exit' : null, artifactId: null, relationships: [],
    };
    attempt.run.events = [event];
    if (failed) attempt.run.events.push({...event, id:'north-report',sequence:2,kind:'message.agent',status:'completed',command:'',output:'',exitCode:null,testOutcome:null,testAttribution:null,message:definition.report});
    attempt.run.git.files = [];
    attempt.run.eventCount = attempt.run.events.length;
    attempt.run.commandCount = 1;
    attempt.run.failedCommandCount = failed ? 1 : 0;
    attempt.run.tests = {total:failed ? 1 : 0,passed:0,failed:failed ? 1 : 0,unknown:0,derivation:'synthetic-fixture',durability:'complete'};
    attempt.eventCount = attempt.run.eventCount;
    attempt.controlNotes = ['Synthetic evaluation example, not an actual model run.'];
  }
  transformComparison?.(pair);
  const bundle = buildInsightBundle(pair);
  const draft = { findings: [{
    id: 'comparison-detail', category: 'Evidence review', title: definition.title,
    summary: definition.claim,
    interpretation: 'This finding concerns the supplied excerpts.',
    limitations: 'This pair does not establish a general model ranking.',
    sides: bundle.attempts.map(attempt => ({attemptKey:attempt.key, observation:`${attempt.key === 'north' ? 'North' : 'South'} has a supplied command excerpt.`, sourceIds:bundle.sources.filter(s=>s.attemptKey===attempt.key).map(s=>s.id)})),
  }], abstentionReason:'' };
  return {id:definition.id, family:definition.family, expectedVerdict:definition.expectedVerdict,
    rationale:definition.rationale, targetUnitId:'f0:summary', bundle, draft};
}
export function buildSemanticCases(transformComparison) { return definitions.map(definition => buildCase(definition, transformComparison)); }

export function scoreSemanticCase(fixture, output) {
  const base = {caseId:fixture.id, expectedVerdict:fixture.expectedVerdict, actualVerdict:null, exactAgreement:false};
  if (!output) return {...base,outcome:'unavailable'};
  let result;
  try { result = validateSupportOutput(fixture.bundle, fixture.draft, output); }
  catch { return {...base,outcome:'invalid'}; }
  let claims = result.findings.flatMap(f=>f.claims).filter(c=>c.unitId===fixture.targetUnitId);
  let mixedScope = false;
  if (fixture.targetText !== undefined) {
    const unit = result.findings.flatMap(f=>f.claims).filter(c=>c.unitId===fixture.targetUnitId);
    const full = fixture.draft.findings[0].summary;
    const start = typeof fixture.targetText === 'string' && fixture.targetText.trim() ? full.indexOf(fixture.targetText) : -1;
    if(start<0 || full.indexOf(fixture.targetText,start+1)>=0) return {...base,outcome:'invalid'};
    const end=start+fixture.targetText.length; let cursor=0;
    claims=unit.filter(claim=>{
      const from=full.indexOf(claim.text,cursor),to=from+claim.text.length;cursor=to;
      const overlap=from<end && to>start;
      if(overlap && claim.verdict!=='supported' &&
        (/\S/.test(full.slice(from,Math.min(start,to))) || /\S/.test(full.slice(Math.max(end,from),to)))) mixedScope=true;
      return overlap;
    });
  }
  if (!claims.length) return {...base,outcome:'invalid'};
  const actualVerdict = claims.some(c=>c.verdict==='unsupported') ? 'unsupported' : claims.some(c=>c.verdict==='needs_review') ? 'needs_review' : 'supported';
  const outcome = mixedScope ? 'requires_audit' : fixture.expectedVerdict === 'supported'
    ? actualVerdict === 'supported' ? 'retained' : 'false_flag'
    : actualVerdict === 'supported' ? 'missed_overclaim' : 'detected';
  return {...base, actualVerdict, outcome, exactAgreement:!mixedScope && actualVerdict===fixture.expectedVerdict};
}
