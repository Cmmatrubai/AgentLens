/*
 * Bounded, explicit benchmark of the saved C01 draft's support review.
 * Offline validation: node review-models.cjs --plan /absolute/plan.json --check
 * Live execution: electron review-models.cjs --plan /absolute/plan.json
 * A live plan authorizes exactly one sequential request per candidate. There
 * are no automatic retries, settings mutations, or promotion of these results.
 */
const fs = require('node:fs/promises');
const { constants, realpathSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const DESKTOP_ROOT = path.resolve(__dirname, '../..');
const PRIVATE_ROOT = path.join(DESKTOP_ROOT, '.local/insight-engine');
const CATALOG_PATH = '/tmp/agentlens-model-catalog.json';
const ENDPOINT = 'https://api.tokenrouter.com/v1';
const DRAFT_ID = 'be0406bf-b8b8-40f5-89a1-c467757e33de';
const SOURCE_REVIEW_ID = 'aa58e3de-caa7-445f-b459-d158f812dadd';
const DRAFT_FILE_SHA = '4640cd3da1680fddc723dc8856b86c77e620b0cab618dc781b46fc8035caf740';
const INPUT_HASH = '798eb07284607e207f07baa3cbced134a0d622d292279b112ee7d72adcf74aba';
const EXPECTED_VERSION = 'support-v2';
const EXPECTED_PROMPT = 'evidence-support-v2';
const ENDPOINT_TYPES = { chat_completions: 'openai', responses: 'openai-response' };
const SAFE_ERRORS = new Set([
  'invalid_arguments', 'invalid_plan', 'invalid_catalog', 'model_not_in_catalog',
  'model_endpoint_mismatch', 'source_guard_failed', 'version_guard_failed',
  'native_electron_required', 'credential_unavailable', 'credential_store_unavailable',
  'provider_authentication', 'provider_rate_limit', 'provider_unsupported_request',
  'provider_error', 'provider_unreachable', 'provider_invalid_response',
  'provider_refused', 'provider_incomplete', 'analysis_timeout',
  'analysis_input_too_large', 'support_validation_failed', 'benchmark_interrupted',
  'unsafe_private_directory', 'invalid_private_file', 'unsafe_private_file',
  'private_file_too_large', 'benchmark_failed',
]);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const objectSha = (value) => sha(JSON.stringify(value));
const safeError = (error) => SAFE_ERRORS.has(error?.message) ? error.message : 'benchmark_failed';
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));

function validatePlan(plan, catalog, maximumOutputTokens = 8000) {
  if (![8000, 12000].includes(maximumOutputTokens)) throw Error('invalid_plan');
  if (!exactKeys(plan, ['endpoint', 'candidates']) || plan.endpoint !== ENDPOINT ||
      !Array.isArray(plan.candidates) || plan.candidates.length < 1 || plan.candidates.length > 6)
    throw Error('invalid_plan');
  const models = catalog?.data ?? catalog?.models;
  if (!Array.isArray(models)) throw Error('invalid_catalog');
  const seen = new Set();
  const candidates = plan.candidates.map((candidate) => {
    const fields = ['model', 'apiFormat', 'reasoningEffort', 'maxOutputTokens', 'timeoutSeconds'];
    if (candidate && Object.hasOwn(candidate, 'outputFormat')) fields.push('outputFormat');
    if (!exactKeys(candidate, fields) ||
        typeof candidate.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(candidate.model) ||
        !Object.hasOwn(ENDPOINT_TYPES, candidate.apiFormat) ||
        !['default', 'none', 'low', 'medium', 'high', 'max'].includes(candidate.reasoningEffort) ||
        (Object.hasOwn(candidate, 'outputFormat') && !['json_schema', 'json_object', 'prompted_json'].includes(candidate.outputFormat)) ||
        !Number.isSafeInteger(candidate.maxOutputTokens) || candidate.maxOutputTokens < 1000 || candidate.maxOutputTokens > maximumOutputTokens ||
        !Number.isSafeInteger(candidate.timeoutSeconds) || candidate.timeoutSeconds < 30 || candidate.timeoutSeconds > 120)
      throw Error('invalid_plan');
    const matches = models.filter((model) => model?.id === candidate.model);
    if (matches.length !== 1) throw Error('model_not_in_catalog');
    if (!Array.isArray(matches[0].supported_endpoint_types) ||
        !matches[0].supported_endpoint_types.includes(ENDPOINT_TYPES[candidate.apiFormat]))
      throw Error('model_endpoint_mismatch');
    const key = JSON.stringify([candidate.model, candidate.apiFormat, candidate.reasoningEffort,
      candidate.maxOutputTokens, candidate.timeoutSeconds, candidate.outputFormat ?? 'prompted_json']);
    if (seen.has(key)) throw Error('invalid_plan');
    seen.add(key);
    return { ...candidate };
  });
  return { endpoint: ENDPOINT, candidates };
}

async function readBoundedJSON(filename, maximum) {
  let file;
  try {
    file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw Error('invalid_private_file');
    // Bound the read itself, including growth after stat, rather than readFile.
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size <= maximum) {
      const { bytesRead } = await file.read(buffer, size, maximum + 1 - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maximum) throw Error('invalid_private_file');
    const raw = buffer.subarray(0, size);
    return { value: JSON.parse(raw.toString('utf8')), sha256: sha(raw) };
  } finally {
    await file?.close();
  }
}

async function loadInputs(planPath, protocol = { version: EXPECTED_VERSION, promptVersion: EXPECTED_PROMPT }) {
  const [planFile, catalogFile, jobFile, sourceFile, provider, schema, files, diagnostics] = await Promise.all([
    readBoundedJSON(planPath, 32768),
    readBoundedJSON(CATALOG_PATH, 2000000),
    readBoundedJSON(path.join(PRIVATE_ROOT, `job-${DRAFT_ID}.json`), 16 * 1024 * 1024),
    readBoundedJSON(path.join(PRIVATE_ROOT, `support-${SOURCE_REVIEW_ID}.json`), 16 * 1024 * 1024),
    import(pathToFileURL(path.join(DESKTOP_ROOT, 'server/insights/support-provider.mjs')).href),
    import(pathToFileURL(path.join(DESKTOP_ROOT, 'server/insights/support-schema.mjs')).href),
    import(pathToFileURL(path.join(DESKTOP_ROOT, 'server/insights/private-files.mjs')).href),
    import(pathToFileURL(path.join(DESKTOP_ROOT, 'server/insights/diagnostics.mjs')).href),
  ]);
  const plan = validatePlan(planFile.value, catalogFile.value, protocol.maximumOutputTokens ?? 8000);
  const job = jobFile.value;
  const source = sourceFile.value;
  if (jobFile.sha256 !== DRAFT_FILE_SHA || job.id !== DRAFT_ID || job.state !== 'complete' ||
      job.inputHash !== INPUT_HASH || source.id !== SOURCE_REVIEW_ID || source.analysisId !== DRAFT_ID ||
      source.inputHash !== INPUT_HASH || source.evidence?.inputHash !== INPUT_HASH ||
      !source.evidence?.eligible || objectSha(source.draft) !== objectSha(job.output) ||
      source.analysisHash !== objectSha(job.output) || objectSha(source.evidence) !== objectSha(job.evidence))
    throw Error('source_guard_failed');
  if (schema.SUPPORT_VERSION !== protocol.version || provider.SUPPORT_PROMPT_VERSION !== protocol.promptVersion ||
      source.version !== EXPECTED_VERSION || source.promptVersion !== EXPECTED_PROMPT)
    throw Error('version_guard_failed');
  const units = schema.buildSupportUnits(job.output);
  if (units.length !== 21) throw Error('source_guard_failed');
  // Exercise the current wire validator without claiming semantic support.
  const quoteRecord = ['support-v3', 'support-v4', 'support-v5'].includes(protocol.version)
    ? schema.buildSupportEvidence(source.evidence)[0] : null;
  schema.validateSupportOutput(source.evidence, job.output, {
    assessments: units.map((unit) => quoteRecord
      ? { unitId: unit.id, claims: [{ text: unit.text, verdict: 'supported',
          reason: 'Offline structure check only; not an evidence assessment.',
          passages: [protocol.version === 'support-v5' ? 'S1:t1' : protocol.version === 'support-v4'
            ? { ref: quoteRecord.ref, part: 'text', startLine: 1, endLine: 1 }
            : { ref: quoteRecord.ref, quote: quoteRecord.text.slice(0, 80) }] }] }
      : { unitId: unit.id, verdict: 'supported',
          reason: 'Offline source validation only; this is not an evidence assessment.', sourceIds: [unit.sourceIds[0]] }),
  });
  const providerSource = await fs.readFile(path.join(DESKTOP_ROOT, 'server/insights/support-provider.mjs'), 'utf8');
  const providerSourceSha256 = sha(providerSource);
  const schemaSource = await fs.readFile(path.join(DESKTOP_ROOT, 'server/insights/support-schema.mjs'), 'utf8');
  const schemaSourceSha256 = sha(schemaSource);
  return {
    protocolSources: { providerSource, schemaSource },
    plan, bundle: source.evidence, draft: job.output, provider, schema, files, diagnostics,
    provenance: {
      sourceAnalysisId: DRAFT_ID, sourceReviewId: SOURCE_REVIEW_ID,
      draftFileSha256: jobFile.sha256, draftOutputSha256: objectSha(job.output),
      sourceReviewFileSha256: sourceFile.sha256, sourceEvidenceSha256: objectSha(source.evidence),
      inputHash: INPUT_HASH, version: protocol.version, promptVersion: protocol.promptVersion,
      providerSourceSha256, schemaSourceSha256,
      planSha256: planFile.sha256, catalogSha256: catalogFile.sha256,
    },
  };
}

function usageFromDiagnostics(diagnostics) {
  const usage = {};
  for (const [key, value] of [['input_tokens', diagnostics?.inputTokens], ['output_tokens', diagnostics?.outputTokens], ['total_tokens', diagnostics?.totalTokens]]) {
    if (Number.isSafeInteger(value) && value >= 0) usage[key] = value;
  }
  return Object.keys(usage).length ? usage : null;
}

function verdictCounts(result) {
  if (!result) return null;
  const counts = { supported: 0, needs_review: 0, unsupported: 0 };
  for (const finding of result.findings) counts[finding.verdict] += 1;
  return counts;
}

async function createRunDirectory() {
  const parent = path.join(PRIVATE_ROOT, 'model-selection');
  await fs.mkdir(parent, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  const stat = await fs.lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('unsafe_private_directory');
  await fs.chmod(parent, 0o700);
  const runId = randomUUID();
  const directory = path.join(parent, runId);
  await fs.mkdir(directory, { mode: 0o700 });
  return { runId, directory };
}

async function runBenchmark(inputs, electron) {
  const { app, safeStorage } = electron;
  await app.whenReady();
  const store = require(path.join(DESKTOP_ROOT, 'electron/insight-credentials.cjs')).createCredentialStore({ safeStorage, root: PRIVATE_ROOT });
  let apiKey = await store.get(ENDPOINT);
  if (!apiKey) throw Error('credential_unavailable');
  const { runId, directory } = await createRunDirectory();
  const { privateWrite } = inputs.files;
  const { sanitizeDiagnostics } = inputs.diagnostics;
  const run = {
    schemaVersion: 1, id: runId, state: 'running', createdAt: Date.now(), endedAt: null,
    endpoint: ENDPOINT, outputFormat: 'per_candidate', ...inputs.provenance,
    plan: inputs.plan, candidates: [],
  };
  await privateWrite(directory, 'run.json', run);
  await privateWrite(directory, 'protocol-snapshot.json', inputs.protocolSources);
  let interrupted = false;
  let activeController = null;
  const interrupt = () => { interrupted = true; activeController?.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    for (const [index, candidate] of inputs.plan.candidates.entries()) {
      if (interrupted) break;
      const name = `candidate-${index + 1}.json`;
      const outputFormat = candidate.outputFormat ?? 'prompted_json';
      const record = {
        schemaVersion: 1, runId, candidateIndex: index + 1, ...inputs.provenance,
        ...candidate, baseUrl: ENDPOINT, outputFormat, authMode: 'bearer',
        state: 'running', createdAt: Date.now(), deadlineAt: Date.now() + candidate.timeoutSeconds * 1000,
        endedAt: null, elapsedMs: null, error: null, diagnostics: null, usage: null,
        output: null, result: null,
      };
      await privateWrite(directory, name, record);
      run.candidates.push({ model: candidate.model, state: 'running', file: name });
      await privateWrite(directory, 'run.json', run);
      const started = performance.now();
      activeController = new AbortController();
      const timer = setTimeout(() => activeController?.abort(), candidate.timeoutSeconds * 1000);
      try {
        const response = await inputs.provider.reviewOpenAI({
          bundle: inputs.bundle, draft: inputs.draft, apiKey, baseUrl: ENDPOINT,
          ...candidate, outputFormat, signal: activeController.signal,
        });
        record.output = response.output;
        record.diagnostics = sanitizeDiagnostics(response.diagnostics);
        record.usage = usageFromDiagnostics(record.diagnostics);
        try {
          record.result = inputs.schema.validateSupportOutput(inputs.bundle, inputs.draft, response.output);
        } catch {
          throw Error('support_validation_failed');
        }
        record.state = 'complete';
      } catch (error) {
        record.state = interrupted ? 'interrupted' : 'failed';
        record.error = interrupted ? 'benchmark_interrupted' : safeError(error);
        record.diagnostics = record.diagnostics ?? sanitizeDiagnostics(error?.diagnostics);
        record.usage = usageFromDiagnostics(record.diagnostics);
      } finally {
        clearTimeout(timer);
        activeController = null;
      }
      record.endedAt = Date.now();
      record.elapsedMs = Math.round(performance.now() - started);
      await privateWrite(directory, name, record);
      run.candidates[index] = { model: candidate.model, state: record.state, file: name, elapsedMs: record.elapsedMs };
      await privateWrite(directory, 'run.json', run);
      console.log(JSON.stringify({ model: candidate.model, state: record.state, elapsedMs: record.elapsedMs,
        diagnostics: record.diagnostics, verdictCounts: verdictCounts(record.result), resultPath: path.join(directory, name) }));
    }
    run.state = interrupted ? 'interrupted' : 'complete';
    run.endedAt = Date.now();
    await privateWrite(directory, 'run.json', run);
    console.log(JSON.stringify({ state: run.state, resultPath: path.join(directory, 'run.json') }));
    return interrupted ? 130 : 0;
  } catch (error) {
    run.state = 'failed';
    run.error = safeError(error);
    run.endedAt = Date.now();
    await privateWrite(directory, 'run.json', run);
    throw error;
  } finally {
    apiKey = null;
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

function parseArguments(args) {
  const check = args.includes('--check');
  const values = args.filter((arg) => arg !== '--check');
  if (values.length !== 2 || values[0] !== '--plan' || !values[1].endsWith('.json') ||
      args.filter((arg) => arg === '--check').length > 1)
    throw Error('invalid_arguments');
  return { planPath: path.resolve(values[1]), check };
}

async function main(protocol) {
  let electron;
  let code = 1;
  try {
    if (process.versions.electron) {
      electron = require('electron');
      // Set the native identity before any asynchronous work can reach ready.
      require(path.join(DESKTOP_ROOT, 'electron/identity.cjs')).applyDesktopIdentity(electron.app);
    }
    const { planPath, check } = parseArguments(process.argv.slice(2));
    const inputs = await loadInputs(planPath, protocol);
    if (check) {
      for (const candidate of inputs.plan.candidates) console.log(JSON.stringify({ model: candidate.model, state: 'validated_offline' }));
      code = 0;
    } else {
      if (!electron) throw Error('native_electron_required');
      code = await runBenchmark(inputs, electron);
    }
  } catch (error) {
    console.log(JSON.stringify({ state: 'failed', error: safeError(error) }));
  } finally {
    process.exitCode = code;
    if (electron) electron.app.exit(code);
  }
}

function matchesEntryFile(argument, filename = __filename) {
  if (typeof argument !== 'string') return false;
  try {
    return realpathSync(argument) === realpathSync(filename);
  } catch {
    return false;
  }
}

module.exports = { validatePlan, parseArguments, usageFromDiagnostics, verdictCounts, loadInputs, runBenchmark, matchesEntryFile, main };
// Electron's default app is require.main even when this file is its entry.
if (require.main === module || (process.versions.electron && matchesEntryFile(process.argv[1]))) void main();
