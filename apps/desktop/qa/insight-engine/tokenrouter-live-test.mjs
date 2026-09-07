// Explicit live diagnostic. Read an ephemeral provider-key environment variable; never print or save it.
// Reuses the evidence from the user's first authorized desktop request.
import { readFile } from "node:fs/promises";
import { analyzeOpenAI } from "../../server/insights/provider.mjs";
import { validateInsightOutput } from "../../server/insights/schema.mjs";
import { privateWrite } from "../../server/insights/private-files.mjs";
const root = new URL("../../.local/insight-engine/", import.meta.url);
const originalJobId = "b826d851-4b42-4f00-87a8-6146ac1fdbfb";
const job = JSON.parse(await readFile(new URL("job-" + originalJobId + ".json", root), "utf8"));
if (job.baseUrl !== "https://api.tokenrouter.com/v1" || job.model !== "z-ai/glm-5.3") {
  throw Error("Unexpected diagnostic target");
}
let apiKey = (process.env.AGENTLENS_TEST_KEY ?? "").trim();
delete process.env.AGENTLENS_TEST_KEY;
if (!apiKey || apiKey.length > 4096 || /\s/.test(apiKey)) throw Error("Invalid key input");
const startedAt = Date.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 210000);
const record = { diagnosticOnly: true, originalJobId, baseUrl: job.baseUrl, model: job.model, apiFormat: job.apiFormat, outputFormat: job.outputFormat, inputHash: job.inputHash, startedAt };
record.reasoningEffort = "low";
record.maxOutputTokens = 12000;
console.log("Starting bounded provider diagnostic with a 12000-token allowance.");
try {
  const result = await analyzeOpenAI({ bundle: job.evidence, model: job.model, apiKey, baseUrl: job.baseUrl, apiFormat: job.apiFormat, outputFormat: job.outputFormat, signal: controller.signal,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      body.reasoning_effort = "low";
      body.max_tokens = 12000;
      const response = await fetch(url, { ...options, body: JSON.stringify(body) });
      const text = await response.text();
      if (Buffer.byteLength(text) > 512000) throw Error("provider_invalid_response");
      let raw;
      try { raw = JSON.parse(text); } catch {}
      record.httpStatus = response.status;
      record.responseMetadata = { finishReasons: raw?.choices?.map(c => c.finish_reason), usage: raw?.usage, contentCharacters: raw?.choices?.[0]?.message?.content?.length };
      return new Response(text, { status: response.status, headers: response.headers });
    }
  });
  validateInsightOutput(job.evidence, result.output);
  Object.assign(record, { state: "validated", ...result });
} catch (error) {
  record.state = "failed";
  record.error = /^(provider_[a-z_]+|analysis_timeout)$/.test(error.message) ? error.message : "analysis_validation_failed";
} finally {
  apiKey = "";
  clearTimeout(timer);
}
record.endedAt = Date.now();
record.elapsedSeconds = (record.endedAt - startedAt) / 1000;
await privateWrite(root.pathname, "tokenrouter-diagnostic-12000.json", record);
console.log(JSON.stringify({ state: record.state, error: record.error, elapsedSeconds: record.elapsedSeconds, usage: record.usage, findings: record.output?.findings?.length, responseMetadata: record.responseMetadata }));
