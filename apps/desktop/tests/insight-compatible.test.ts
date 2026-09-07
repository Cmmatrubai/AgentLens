import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { analyzeOpenAI } from "../server/insights/provider.mjs";
import { createInsightService } from "../server/insights/service.mjs";
import { makePair } from "./fixtures/insight-comparisons.mjs";
const { createCredentialStore } = createRequire(import.meta.url)(
  "../electron/insight-credentials.cjs",
);
const output = { findings: [], abstentionReason: "No supported difference." };
const bundle = {
  task: { title: "Fixture" },
  attempts: [],
  sources: [],
  coverage: {},
};
const chatReply = () =>
  new Response(
    JSON.stringify({
      id: "chat-fixture",
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(output) } },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    }),
  );
test("custom Chat Completions endpoint accepts another provider key and normalizes usage", async () => {
  const result = await analyzeOpenAI({
    bundle,
    model: "other/model",
    apiKey: "provider-key",
    baseUrl: "https://provider.example/api/v1/",
    apiFormat: "chat_completions",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://provider.example/api/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer provider-key");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "other/model");
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(options.redirect, "error");
      return chatReply();
    },
  });
  assert.deepEqual(result.output, output);
  assert.deepEqual(result.usage, {
    input_tokens: 12,
    output_tokens: 7,
    total_tokens: 19,
  });
});
test("local no-key and prompted JSON mode send neither credentials nor unsupported formatting fields", async () => {
  await analyzeOpenAI({
    bundle,
    model: "local-model",
    apiKey: null,
    baseUrl: "http://127.0.0.1:1234/v1",
    apiFormat: "chat_completions",
    outputFormat: "prompted_json",
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:1234/v1/chat/completions");
      assert.equal(options.headers.Authorization, undefined);
      const body = JSON.parse(options.body);
      assert.equal(body.response_format, undefined);
      assert.ok(body.messages[0].content.includes("abstentionReason"));
      return chatReply();
    },
  });
});
test("invalid or insecure remote base URLs fail before any network request", async () => {
  for (const baseUrl of [
    "http://remote.example/v1",
    "https://user:secret@remote.example/v1",
    "https://remote.example/v1?key=secret",
    "file:///tmp/server",
    "https://remote.example/v1#fragment",
  ]) {
    let calls = 0;
    await assert.rejects(
      analyzeOpenAI({
        bundle,
        model: "model",
        apiKey: "key",
        baseUrl,
        fetchImpl: async () => {
          calls++;
          return chatReply();
        },
      }),
      /invalid_endpoint/,
    );
    assert.equal(calls, 0);
  }
});
test("Chat refusals, truncated responses and tool requests are never accepted as findings", async () => {
  for (const choice of [
    { finish_reason: "length", message: { content: JSON.stringify(output) } },
    { finish_reason: "stop", message: { refusal: "refused", content: null } },
    {
      finish_reason: "tool_calls",
      message: { tool_calls: [], content: JSON.stringify(output) },
    },
  ]) {
    await assert.rejects(
      analyzeOpenAI({
        bundle,
        model: "model",
        baseUrl: "http://localhost:1234/v1",
        apiFormat: "chat_completions",
        fetchImpl: async () =>
          new Response(JSON.stringify({ choices: [choice] })),
      }),
      /provider_/,
    );
  }
});
test("encrypted credentials are bound to the complete normalized base URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "insight-endpoint-key-"));
  try {
    const store = createCredentialStore({
      root,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (bytes) => bytes.toString(),
      },
    });
    await store.set("provider-secret", "https://a.example/v1");
    assert.equal(await store.get("https://a.example/v1"), "provider-secret");
    assert.equal(await store.get("https://b.example/v1"), null);
    assert.equal(await store.has("https://a.example/other"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("service supports no-key endpoints and binds consent and saved revisions to provider settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "insight-compatible-"));
  let calls = 0;
  let key = null;
  let target = null;
  const credentials = {
    has: async (base) => !!key && base === target,
    get: async (base) => (base === target ? key : null),
    set: async (value, base) => {
      key = value;
      target = base;
    },
    remove: async () => {
      key = null;
      target = null;
    },
  };
  const service = createInsightService({
    root,
    credentialStore: credentials,
    readComparison: async () => ({ ok: true, comparison: makePair() }),
    analyze: async (args) => {
      calls++;
      assert.equal(args.baseUrl, "http://localhost:1234/v1");
      assert.equal(args.apiKey, null);
      return { output };
    },
  });
  try {
    let configured = await service.configure({
      model: "local-model",
      enabled: true,
      baseUrl: "http://localhost:1234/v1/",
      apiFormat: "chat_completions",
      authMode: "none",
      outputFormat: "json_object",
    });
    assert.equal(configured.ok, true);
    assert.equal(configured.settings.hasKey, false);
    const request = {
      inputHash: configured.input.hash,
      settingsHash: configured.settingsHash,
      requestId: randomUUID(),
    };
    await service.generate(request);
    let done;
    for (let i = 0; i < 100; i++) {
      done = await service.read();
      if (done.state === "no_findings") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(done.state, "no_findings");
    assert.equal(done.analysis.baseUrl, "http://localhost:1234/v1");
    assert.equal(calls, 1);
    configured = await service.configure({
      model: "local-model",
      enabled: true,
      baseUrl: "http://localhost:1235/v1",
      apiFormat: "chat_completions",
      authMode: "none",
      outputFormat: "json_object",
    });
    assert.equal(configured.state, "stale");
    const refused = await service.generate({
      ...request,
      requestId: randomUUID(),
    });
    assert.equal(refused.error, "settings_changed");
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the real HTTP adapter interoperates with a loopback Chat Completions server", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  let received;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    received = {
      url: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(output) },
          },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const result = await analyzeOpenAI({
      bundle,
      model: "local-fixture",
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiFormat: "chat_completions",
      outputFormat: "json_object",
      apiKey: null,
    });
    assert.deepEqual(result.output, output);
    assert.equal(received.url, "/v1/chat/completions");
    assert.equal(received.authorization, undefined);
    assert.equal(received.body.response_format.type, "json_object");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("changing a provider cannot reuse its saved key or a prior consent request", async () => {
  const root = await mkdtemp(join(tmpdir(), "insight-key-target-"));
  let key = null;
  let target = null;
  let calls = 0;
  const service = createInsightService({
    root,
    readComparison: async () => ({ ok: true, comparison: makePair() }),
    credentialStore: {
      has: async (base) => base === target && !!key,
      get: async (base) => (base === target ? key : null),
      set: async (value, base) => {
        key = value;
        target = base;
      },
      remove: async () => {
        key = null;
      },
    },
    analyze: async () => {
      calls++;
      return { output };
    },
  });
  try {
    const old = await service.configure({
      model: "chosen",
      apiKey: "original-key",
      enabled: true,
    });
    assert.equal(old.ok, true);
    const changed = await service.configure({
      model: "chosen",
      enabled: true,
      baseUrl: "https://another.example/v1",
    });
    assert.equal(changed.error, "endpoint_key_required");
    assert.equal((await service.read()).settings.baseUrl, old.settings.baseUrl);
    assert.equal(
      (
        await service.generate({
          inputHash: old.input.hash,
          requestId: randomUUID(),
        })
      ).error,
      "settings_changed",
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
