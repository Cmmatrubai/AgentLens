import { performance } from 'node:perf_hooks';
import { scoreSemanticCase } from './semantic-cases.mjs';
import { reviewOpenAI } from '../../server/insights/support-provider.mjs';
import { sanitizeDiagnostics } from '../../server/insights/diagnostics.mjs';

export function safeEvaluationError(error) {
  const allowed = ['provider_authentication','provider_rate_limit','provider_unsupported_request','provider_error','provider_unreachable','provider_invalid_response','provider_refused','provider_incomplete','analysis_timeout','analysis_input_too_large'];
  return allowed.includes(error?.message) ? error.message : 'evaluation_failed';
}

// The caller controls credentials and persistence; labels never reach review().
export async function runSemanticSuite({ cases, options, save, signal, review = reviewOpenAI }) {
  if (!Array.isArray(cases) || cases.length !== 6 || !Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0 || options.timeoutSeconds > 120) throw Error('invalid_evaluation_plan');
  const records = [];
  for (const fixture of cases) {
    const record = {caseId:fixture.id,state:'not_run',error:null,elapsedMs:0,output:null,diagnostics:null,score:null};
    if (!signal?.aborted) {
      const started = performance.now();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort',abort,{once:true});
      const timer = setTimeout(abort,options.timeoutSeconds*1000);
      try {
        const {timeoutSeconds: _deadline, ...providerOptions} = options;
        const response = await review({...providerOptions,bundle:fixture.bundle,draft:fixture.draft,signal:controller.signal});
        record.output = response.output;
        record.diagnostics = sanitizeDiagnostics(response.diagnostics);
        record.state = 'complete';
      } catch(error) {
        record.state = signal?.aborted ? 'interrupted' : 'failed';
        record.error = safeEvaluationError(error);
        record.diagnostics = sanitizeDiagnostics(error?.diagnostics);
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort',abort);
        record.elapsedMs = Math.round(performance.now()-started);
      }
    }
    record.score = scoreSemanticCase(fixture,record.output);
    if(record.score.outcome==='invalid') { record.state='failed'; record.error='support_validation_failed'; }
    records.push(record);
    await save(record);
  }
  return records;
}
