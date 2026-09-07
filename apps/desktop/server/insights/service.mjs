import { createHash, randomUUID } from "node:crypto";
import { buildInsightBundle, validateInsightOutput } from "./evidence.mjs";
import { INSIGHT_VERSION } from "./schema.mjs";
import { analyzeOpenAI, PROMPT_VERSION } from "./provider.mjs";
import { privateRead, privateWrite, privateList } from "./private-files.mjs";
import { providerSettings } from "./endpoint.mjs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaults = {
  provider: "openai-compatible",
  model: "",
  enabled: false,
  ...providerSettings({}),
};
const safeErrors = new Set([
  "provider_authentication",
  "provider_rate_limit",
  "provider_error",
  "provider_unreachable",
  "provider_incomplete",
  "provider_refused",
  "provider_invalid_response",
  "provider_unsupported_request",
  "analysis_timeout",
  "analysis_input_too_large",
  "credential_store_unavailable",
]);
const settingsHash = (config) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        config.model,
        providerSettings(config),
        INSIGHT_VERSION,
        PROMPT_VERSION,
      ]),
    )
    .digest("hex");
const jobKey = (hash, config) =>
  createHash("sha256")
    .update(JSON.stringify([hash, settingsHash(config)]))
    .digest("hex");
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => keys.includes(k));
const alive = (j) => {
  if (j.deadlineAt < Date.now()) return false;
  try {
    process.kill(j.pid, 0);
    return true;
  } catch {
    return false;
  }
};
export function createInsightService({
  root,
  readComparison,
  credentialStore,
  analyze = analyzeOpenAI,
  desktopRequired = false,
}) {
  let queue = Promise.resolve();
  const serialize = (fn) => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  const settings = async () => {
    const saved = {
      ...defaults,
      ...(await privateRead(root, "settings.json")),
    };
    return { ...saved, ...providerSettings(saved) };
  };
  const current = async () => {
    const r = await readComparison();
    if (!r.ok) throw Error("comparison_unavailable");
    return buildInsightBundle(r.comparison);
  };
  const records = async () => {
    const all = await Promise.all(
      (await privateList(root)).map((n) => privateRead(root, n)),
    );
    return all
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  };
  const hasKey = async (config) =>
    config.authMode === "none"
      ? false
      : credentialStore?.has
        ? await credentialStore.has(config.baseUrl)
        : !!(await credentialStore?.get(config.baseUrl));
  async function read() {
    try {
      const [config, bundle, jobs] = await Promise.all([
        settings(),
        current(),
        records(),
      ]);
      const keyPresent = await hasKey(config);
      const key = jobKey(bundle.inputHash, config);
      const relevant = jobs.filter(
        (j) => j.comparisonId === bundle.comparisonId,
      );
      const latest = relevant.find((j) => j.key === key) ?? relevant[0];
      let state = "not_analyzed",
        analysis = null,
        error = null;
      if (!bundle.eligible) state = "insufficient_evidence";
      else if (latest) {
        if (latest.key !== key || latest.state === "stale") state = "stale";
        else if (latest.state === "running")
          state = alive(latest) ? "running" : "interrupted";
        else if (latest.state === "complete") {
          const checked = validateInsightOutput(bundle, latest.output);
          state = checked.findings.length ? "available" : "no_findings";
          analysis = {
            id: latest.id,
            model: latest.model,
            baseUrl: latest.baseUrl,
            apiFormat: latest.apiFormat,
            outputFormat: latest.outputFormat,
            createdAt: latest.endedAt,
            inputHash: latest.inputHash,
            ...checked,
            usage: latest.usage,
            analyzerVersion: latest.analyzerVersion,
            promptVersion: latest.promptVersion,
          };
        } else {
          state = "failed";
          error = latest.error ?? "analysis_failed";
        }
      }
      return {
        ok: true,
        settingsHash: settingsHash(config),
        settings: {
          provider: "openai-compatible",
          ...providerSettings(config),
          model: config.model,
          enabled: config.enabled,
          hasKey: keyPresent,
          desktopRequired,
        },
        input: {
          comparisonId: bundle.comparisonId,
          hash: bundle.inputHash,
          eligible: bundle.eligible,
          reason: bundle.reason,
          coverage: bundle.coverage,
          sources: bundle.sources.map(
            ({ id, attemptKey, label, path, provenance, excerpt }) => ({
              id,
              attemptKey,
              label,
              path,
              provenance,
              excerpt,
            }),
          ),
        },
        state,
        analysis,
        error,
        history: relevant.slice(0, 20).map((j) => ({
          id: j.id,
          state: j.state === "running" && !alive(j) ? "interrupted" : j.state,
          createdAt: j.createdAt,
          model: j.model,
          baseUrl: j.baseUrl,
        })),
      };
    } catch {
      return { ok: false, error: "insight_state_unavailable" };
    }
  }
  async function configure(input) {
    return serialize(async () => {
      try {
        if (
          desktopRequired ||
          !exact(input, [
            "model",
            "apiKey",
            "enabled",
            "baseUrl",
            "apiFormat",
            "outputFormat",
            "authMode",
          ]) ||
          typeof input.model !== "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(input.model) ||
          typeof input.enabled !== "boolean"
        )
          return { ok: false, error: "invalid_settings" };
        const previous = await settings();
        let connection;
        try {
          connection = providerSettings({ ...previous, ...input });
        } catch (e) {
          return {
            ok: false,
            error:
              e.message === "invalid_endpoint"
                ? "invalid_endpoint"
                : "invalid_settings",
          };
        }
        if (connection.authMode === "none" && input.apiKey !== undefined)
          return { ok: false, error: "invalid_key" };
        if (input.apiKey !== undefined) {
          if (
            typeof input.apiKey !== "string" ||
            input.apiKey.length < 1 ||
            input.apiKey.length > 4096 ||
            /\s/.test(input.apiKey)
          )
            return { ok: false, error: "invalid_key" };
        }
        if (
          input.enabled &&
          connection.authMode === "bearer" &&
          !input.apiKey &&
          connection.baseUrl !== previous.baseUrl
        )
          return { ok: false, error: "endpoint_key_required" };
        if (
          input.enabled &&
          connection.authMode === "bearer" &&
          !input.apiKey &&
          !(await hasKey(connection))
        )
          return { ok: false, error: "api_key_required" };
        if (input.apiKey !== undefined)
          await credentialStore.set(input.apiKey, connection.baseUrl);
        if (connection.authMode === "none") await credentialStore.remove();
        await privateWrite(root, "settings.json", {
          provider: "openai-compatible",
          ...connection,
          model: input.model,
          enabled: input.enabled,
        });
        return await read();
      } catch {
        return { ok: false, error: "credential_store_unavailable" };
      }
    });
  }
  async function finish(job, bundle, apiKey) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 90000);
    try {
      const result = await analyze({
        bundle,
        model: job.model,
        baseUrl: job.baseUrl,
        apiFormat: job.apiFormat,
        outputFormat: job.outputFormat,
        apiKey,
        signal: abort.signal,
      });
      validateInsightOutput(bundle, result.output);
      const [now, config] = await Promise.all([current(), settings()]);
      const state =
        now.inputHash === job.inputHash &&
        config.enabled &&
        jobKey(now.inputHash, config) === job.key
          ? "complete"
          : "stale";
      await privateWrite(root, `job-${job.id}.json`, {
        ...job,
        state,
        endedAt: Date.now(),
        output: result.output,
        usage: result.usage ?? null,
        providerResponseId: result.providerResponseId ?? null,
      });
    } catch (e) {
      await privateWrite(root, `job-${job.id}.json`, {
        ...job,
        state: "failed",
        endedAt: Date.now(),
        error: safeErrors.has(e.message)
          ? e.message
          : "analysis_validation_failed",
      }).catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  }
  async function generate(input) {
    return serialize(async () => {
      try {
        if (
          desktopRequired ||
          !exact(input, [
            "inputHash",
            "settingsHash",
            "requestId",
            "regenerate",
          ]) ||
          typeof input.inputHash !== "string" ||
          typeof input.requestId !== "string" ||
          !uuid.test(input.requestId) ||
          (input.regenerate !== undefined &&
            typeof input.regenerate !== "boolean")
        )
          return { ok: false, error: "invalid_request" };
        const requestId = input.requestId.toLowerCase();
        const [config, bundle, jobs] = await Promise.all([
          settings(),
          current(),
          records(),
        ]);
        if (!bundle.eligible)
          return { ok: false, error: "insufficient_evidence" };
        if (input.inputHash !== bundle.inputHash)
          return { ok: false, error: "evidence_changed" };
        if (input.settingsHash !== settingsHash(config))
          return { ok: false, error: "settings_changed" };
        if (!config.enabled || !config.model)
          return { ok: false, error: "analysis_not_configured" };
        const key = jobKey(bundle.inputHash, config),
          sameRequest = jobs.find((j) => j.id === requestId);
        if (sameRequest) {
          if (sameRequest.key !== key)
            return { ok: false, error: "request_identity_mismatch" };
          return await read();
        }
        if (jobs.some((j) => j.state === "running" && alive(j)))
          return await read();
        if (
          !input.regenerate &&
          jobs.some((j) => j.key === key && j.state === "complete")
        )
          return await read();
        const apiKey =
          config.authMode === "none"
            ? null
            : await credentialStore.get(config.baseUrl);
        if (config.authMode !== "none" && !apiKey)
          return { ok: false, error: "api_key_required" };
        const job = {
          id: requestId,
          comparisonId: bundle.comparisonId,
          inputHash: bundle.inputHash,
          key,
          model: config.model,
          ...providerSettings(config),
          analyzerVersion: INSIGHT_VERSION,
          promptVersion: PROMPT_VERSION,
          createdAt: Date.now(),
          deadlineAt: Date.now() + 95000,
          pid: process.pid,
          state: "running",
          coverage: bundle.coverage,
          evidence: bundle,
        };
        await privateWrite(root, `job-${job.id}.json`, job);
        void finish(job, bundle, apiKey);
        return await read();
      } catch {
        return { ok: false, error: "analysis_start_failed" };
      }
    });
  }
  async function forgetKey() {
    return serialize(async () => {
      try {
        if (desktopRequired) return { ok: false, error: "desktop_required" };
        await credentialStore.remove();
        const config = await settings();
        await privateWrite(root, "settings.json", {
          ...config,
          enabled: false,
        });
        return await read();
      } catch {
        return { ok: false, error: "credential_store_unavailable" };
      }
    });
  }
  return { read, configure, generate, forgetKey };
}
