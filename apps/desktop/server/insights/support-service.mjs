import { createHash } from "node:crypto";
import { privateRead, privateWrite, privateList } from "./private-files.mjs";
import { providerSettings } from "./endpoint.mjs";
import { sanitizeDiagnostics } from "./diagnostics.mjs";
import { SUPPORT_VERSION, validateSupportOutput } from "./support-schema.mjs";
import { SUPPORT_PROMPT_VERSION, reviewOpenAI } from "./support-provider.mjs";
import {
  LOCAL_SUPPORT_POLICY_VERSION,
  applyLocalSupportPolicy,
} from "./import-facts.mjs";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = ({ bundle, job, settingsHash }) =>
  digest([
    bundle.inputHash,
    job.id,
    digest(job.output),
    settingsHash,
    SUPPORT_VERSION,
    SUPPORT_PROMPT_VERSION,
    LOCAL_SUPPORT_POLICY_VERSION,
  ]);
const alive = (job) => {
  if (!Number.isFinite(job.deadlineAt) || job.deadlineAt < Date.now())
    return false;
  try {
    process.kill(job.pid, 0);
    return true;
  } catch {
    return false;
  }
};

// All mutations share the draft service's queue; read additionally checks the full identity.
export function createSupportService({
  root,
  getContext,
  serialize,
  credentialStore,
  desktopRequired,
  review = reviewOpenAI,
  publicError,
}) {
  const safeError = (error) => {
    const code = publicError(error);
    return code === "analysis_validation_failed"
      ? "support_validation_failed"
      : code;
  };
  const records = async () =>
    (
      await Promise.all(
        (await privateList(root, "support")).map((name) =>
          privateRead(root, name),
        ),
      )
    )
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  async function read(context) {
    const key = identity(context);
    const empty = {
      state: "not_reviewed",
      reviewKey: key,
      review: null,
      error: null,
      diagnostics: null,
    };
    try {
      const matching = (await records()).filter(
        (j) => j.analysisId === context.job.id,
      );
      const latest = matching.find((j) => j.key === key) ?? matching[0];
      if (!latest) return empty;
      if (
        latest.key !== key ||
        latest.version !== SUPPORT_VERSION ||
        latest.promptVersion !== SUPPORT_PROMPT_VERSION ||
        latest.state === "stale"
      )
        return { ...empty, state: "stale" };
      if (latest.state === "running")
        return { ...empty, state: alive(latest) ? "running" : "interrupted" };
      if (latest.state !== "complete")
        return {
          ...empty,
          state: "failed",
          error: safeError(latest.error),
          diagnostics: sanitizeDiagnostics(latest.diagnostics),
        };
      const checked = applyLocalSupportPolicy(
        context.bundle,
        context.job.output,
        validateSupportOutput(
          context.bundle,
          context.job.output,
          latest.output,
        ),
      );
      return {
        ...empty,
        state: "available",
        review: {
          id: latest.id,
          createdAt: latest.endedAt,
          model: latest.model,
          baseUrl: latest.baseUrl,
          version: latest.version,
          promptVersion: latest.promptVersion,
          ...checked,
          usage: latest.usage ?? null,
          diagnostics: sanitizeDiagnostics(latest.diagnostics),
        },
      };
    } catch {
      return { ...empty, state: "failed", error: "support_validation_failed" };
    }
  }
  async function finish(job, context, apiKey) {
    const abort = new AbortController();
    const controls = providerSettings(job);
    const timer = setTimeout(
      () => abort.abort(),
      controls.timeoutSeconds * 1000,
    );
    let diagnostics = null;
    try {
      const result = await review({
        bundle: context.bundle,
        draft: context.job.output,
        model: job.model,
        ...controls,
        apiKey,
        signal: abort.signal,
      });
      diagnostics = sanitizeDiagnostics(result.diagnostics);
      validateSupportOutput(context.bundle, context.job.output, result.output);
      await serialize(async () => {
        let state = "stale";
        try {
          const current = await getContext();
          if (current.config.enabled && identity(current) === job.key)
            state = "complete";
        } catch {
          /* The reviewed draft is no longer current. */
        }
        await privateWrite(root, `support-${job.id}.json`, {
          ...job,
          state,
          endedAt: Date.now(),
          output: result.output,
          usage: result.usage ?? null,
          providerResponseId: result.providerResponseId ?? null,
          diagnostics,
        });
      });
    } catch (error) {
      await serialize(() =>
        privateWrite(root, `support-${job.id}.json`, {
          ...job,
          state: "failed",
          endedAt: Date.now(),
          error: safeError(error?.message),
          diagnostics: sanitizeDiagnostics(error?.diagnostics) ?? diagnostics,
        }),
      ).catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  }
  async function generate(input) {
    return serialize(async () => {
      try {
        const allowed = [
          "analysisId",
          "inputHash",
          "settingsHash",
          "reviewKey",
          "requestId",
          "recheck",
        ];
        if (
          desktopRequired ||
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).some((k) => !allowed.includes(k)) ||
          ![
            "analysisId",
            "inputHash",
            "settingsHash",
            "reviewKey",
            "requestId",
          ].every((k) => typeof input[k] === "string") ||
          !uuid.test(input.requestId) ||
          (input.recheck !== undefined && typeof input.recheck !== "boolean")
        )
          return { ok: false, error: "invalid_request" };
        const context = await getContext();
        const { config, bundle, job: analysis, settingsHash } = context;
        const key = identity(context),
          requestId = input.requestId.toLowerCase();
        if (
          input.analysisId !== analysis.id ||
          input.inputHash !== bundle.inputHash ||
          input.settingsHash !== settingsHash ||
          input.reviewKey !== key
        )
          return { ok: false, error: "support_changed" };
        if (!config.enabled || !config.model)
          return { ok: false, error: "analysis_not_configured" };
        const jobs = await records(),
          same = jobs.find((j) => j.id === requestId);
        if (same)
          return same.key === key
            ? { ok: true }
            : { ok: false, error: "request_identity_mismatch" };
        if (jobs.some((j) => j.state === "running" && alive(j)))
          return { ok: true };
        if (
          !input.recheck &&
          jobs.some((j) => j.key === key && j.state === "complete")
        )
          return { ok: true };
        const apiKey =
          config.authMode === "none"
            ? null
            : await credentialStore.get(config.baseUrl);
        if (config.authMode !== "none" && !apiKey)
          return { ok: false, error: "api_key_required" };
        const createdAt = Date.now();
        const job = {
          id: requestId,
          analysisId: analysis.id,
          analysisHash: digest(analysis.output),
          inputHash: bundle.inputHash,
          settingsHash,
          key,
          comparisonId: bundle.comparisonId,
          policyVersion: LOCAL_SUPPORT_POLICY_VERSION,
          version: SUPPORT_VERSION,
          promptVersion: SUPPORT_PROMPT_VERSION,
          model: config.model,
          ...providerSettings(config),
          createdAt,
          deadlineAt: createdAt + config.timeoutSeconds * 1000 + 5000,
          pid: process.pid,
          state: "running",
          draft: analysis.output,
          evidence: bundle,
        };
        await privateWrite(root, `support-${job.id}.json`, job);
        void finish(job, context, apiKey);
        return { ok: true };
      } catch {
        return { ok: false, error: "support_not_available" };
      }
    });
  }
  return { read, generate };
}
