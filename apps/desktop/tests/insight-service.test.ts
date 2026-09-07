import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInsightService } from "../server/insights/service.mjs";
import { makePair, makeFinding } from "./fixtures/insight-comparisons.mjs";
import { analyzeOpenAI } from "../server/insights/provider.mjs";
function pair() {
  return {
    schemaVersion: 1,
    id: "generic-task",
    title: "Validate names",
    taskPrompt: "Reject empty names",
    manifestHash: "manifest",
    promptHash: "prompt",
    baseCommit: "base",
    attempts: ["first", "second"].map((key) => ({
      key,
      model: key + "-model",
      reasoningEffort: "high",
      checks: [],
      run: {
        id: key + "-run",
        status: "completed",
        elapsedMs: 100,
        commandCount: 1,
        failedCommandCount: 0,
        events: [
          {
            id: key + "-command",
            sequence: 1,
            kind: "command",
            provenance: "observed",
            status: "completed",
            command: "run tests",
            output: "1 passed",
            outputState: "available",
            message: "",
            exitCode: 0,
          },
        ],
        git: {
          state: "available",
          artifactId: key + "-patch",
          initialHead: "base",
          files: [{ path: "a.ts", content: "-old\n+new", truncated: false }],
        },
      },
    })),
    checks: [],
    ready: false,
  };
}
async function setup(analyze, initialComparison = pair()) {
  const root = await mkdtemp(join(tmpdir(), "insight-jobs-"));
  let key = null;
  let current = initialComparison;
  const options = {
    root,
    readComparison: async () => ({ ok: true, comparison: current }),
    credentialStore: {
      get: async () => key,
      set: async (k) => {
        key = k;
      },
      remove: async () => {
        key = null;
      },
    },
    analyze,
  };
  return {
    root,
    options,
    service: createInsightService(options),
    change: () => {
      current = { ...current, taskPrompt: "Changed task" };
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
const waitFor = async (s, state) => {
  for (let i = 0; i < 100; i++) {
    const r = await s.read();
    if (r.state === state) return r;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("job did not settle");
};
test("a structured provider result survives persistence with server-resolved evidence", async () => {
  let calls = 0;
  const t = await setup(
    (args) =>
      analyzeOpenAI({
        ...args,
        fetchImpl: async () => {
          calls++;
          return new Response(
            JSON.stringify({
              status: "completed",
              id: "offline-fixture",
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify(makeFinding(args.bundle)),
                    },
                  ],
                },
              ],
            }),
          );
        },
      }),
    makePair(),
  );
  try {
    await t.service.configure({
      model: "configured-model",
      apiKey: "offline-test-key-12345",
      enabled: true,
    });
    await t.service.generate({
      settingsHash: (await t.service.read()).settingsHash,
      inputHash: (await t.service.read()).input.hash,
      requestId: randomUUID(),
    });
    const r = await waitFor(t.service, "available");
    assert.equal(r.analysis.findings.length, 1);
    for (const side of r.analysis.findings[0].sides) {
      assert.ok(side.sources.length > 0);
      assert.ok(
        side.sources.every((source) => source.attemptKey === side.attemptKey),
      );
    }
    const reread = await createInsightService(t.options).read();
    assert.deepEqual(reread.analysis, r.analysis);
    assert.equal(calls, 1);
  } finally {
    await t.cleanup();
  }
});
test("reads never generate and settings persist without the secret", async () => {
  let calls = 0;
  const t = await setup(async () => {
    calls++;
  });
  try {
    await t.service.configure({
      model: "chosen-model",
      apiKey: "secret-test-key-12345",
      enabled: true,
    });
    const r = await t.service.read();
    assert.equal(r.settings.model, "chosen-model");
    assert.equal(r.settings.hasKey, true);
    assert.equal(calls, 0);
    const disk = await readFile(join(t.root, "settings.json"), "utf8");
    assert.ok(!disk.includes("secret-test"));
    const fresh = createInsightService(t.options);
    assert.equal((await fresh.read()).settings.model, "chosen-model");
  } finally {
    await t.cleanup();
  }
});
test("deduplicates paid starts and returns cached empty findings without another call", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const t = await setup(async () => {
    calls++;
    await gate;
    return {
      output: {
        findings: [],
        abstentionReason: "No material difference supported.",
      },
      usage: { total_tokens: 20 },
    };
  });
  try {
    await t.service.configure({
      model: "chosen",
      apiKey: "secret-test-key-12345",
      enabled: true,
    });
    const inputHash = (await t.service.read()).input.hash;
    const request = {
      settingsHash: (await t.service.read()).settingsHash,
      inputHash,
      requestId: randomUUID(),
    };
    const [a, b] = await Promise.all([
      t.service.generate(request),
      t.service.generate(request),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(calls, 1);
    release();
    const done = await waitFor(t.service, "no_findings");
    assert.equal(
      done.analysis.abstentionReason,
      "No material difference supported.",
    );
    await t.service.generate({
      settingsHash: (await t.service.read()).settingsHash,
      inputHash,
      requestId: randomUUID(),
    });
    assert.equal(calls, 1);
    assert.equal(
      (await readdir(t.root)).filter((x) => x.startsWith("job-")).length,
      1,
    );
  } finally {
    release?.();
    await t.cleanup();
  }
});
test("rejects unconsented and stale requests before calling the provider", async () => {
  let calls = 0;
  const t = await setup(async () => {
    calls++;
  });
  try {
    const hash = (await t.service.read()).input.hash;
    assert.equal(
      (
        await t.service.generate({
          settingsHash: (await t.service.read()).settingsHash,
          inputHash: hash,
          requestId: randomUUID(),
        })
      ).ok,
      false,
    );
    await t.service.configure({
      model: "chosen",
      apiKey: "secret-test-key-12345",
      enabled: true,
    });
    t.change();
    assert.equal(
      (
        await t.service.generate({
          settingsHash: (await t.service.read()).settingsHash,
          inputHash: hash,
          requestId: randomUUID(),
        })
      ).ok,
      false,
    );
    assert.equal(calls, 0);
  } finally {
    await t.cleanup();
  }
});
test("changed evidence during generation cannot publish a finding", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const t = await setup(async () => {
    await gate;
    return { output: { findings: [], abstentionReason: "No difference." } };
  });
  try {
    await t.service.configure({
      model: "chosen",
      apiKey: "secret-test-key-12345",
      enabled: true,
    });
    const requestId = randomUUID();
    await t.service.generate({
      settingsHash: (await t.service.read()).settingsHash,
      inputHash: (await t.service.read()).input.hash,
      requestId,
    });
    t.change();
    release();
    const r = await waitFor(t.service, "stale");
    assert.equal(r.analysis, null);
    let settled = false;
    for (let i = 0; i < 100; i++) {
      const saved = JSON.parse(
        await readFile(join(t.root, `job-${requestId}.json`), "utf8"),
      );
      if (saved.state === "stale") {
        settled = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(
      settled,
      "background job must settle before removing its private directory",
    );
  } finally {
    release?.();
    await t.cleanup();
  }
});
test("provider errors are retained safely, never automatically retried", async () => {
  let calls = 0;
  const t = await setup(async () => {
    calls++;
    throw Error("secret-test-key-12345 private body");
  });
  try {
    await t.service.configure({
      model: "chosen",
      apiKey: "secret-test-key-12345",
      enabled: true,
    });
    await t.service.generate({
      settingsHash: (await t.service.read()).settingsHash,
      inputHash: (await t.service.read()).input.hash,
      requestId: randomUUID(),
    });
    const r = await waitFor(t.service, "failed");
    assert.ok(!JSON.stringify(r).includes("secret-test"));
    await t.service.read();
    assert.equal(calls, 1);
    assert.equal(r.analysis, null);
  } finally {
    await t.cleanup();
  }
});

test("uppercase UUID retries share the same persisted job identity", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const t = await setup(async () => {
    calls++;
    await gate;
    return {
      output: { findings: [], abstentionReason: "No material difference." },
    };
  });
  try {
    await t.service.configure({
      model: "chosen",
      apiKey: "secret-test-key-12345",
      enabled: true,
    });
    const inputHash = (await t.service.read()).input.hash;
    const requestId = randomUUID().toUpperCase();
    await t.service.generate({
      settingsHash: (await t.service.read()).settingsHash,
      inputHash,
      requestId,
    });
    await t.service.generate({
      settingsHash: (await t.service.read()).settingsHash,
      inputHash,
      requestId: requestId.toLowerCase(),
    });
    assert.equal(calls, 1);
    release();
    const r = await waitFor(t.service, "no_findings");
    assert.equal(r.history.length, 1);
  } finally {
    release?.();
    await t.cleanup();
  }
});

test("a saved revision retains the selected evidence it analyzed", async () => {
  const t = await setup(async () => ({
    output: { findings: [], abstentionReason: "No material difference." },
  }));
  try {
    await t.service.configure({
      model: "chosen",
      apiKey: "secret-test-key-12345",
      enabled: true,
    });
    const inputHash = (await t.service.read()).input.hash;
    const requestId = randomUUID();
    await t.service.generate({
      settingsHash: (await t.service.read()).settingsHash,
      inputHash,
      requestId,
    });
    await waitFor(t.service, "no_findings");
    const saved = JSON.parse(
      await readFile(join(t.root, `job-${requestId}.json`), "utf8"),
    );
    assert.equal(saved.evidence?.inputHash, inputHash);
    assert.ok(saved.evidence.sources.length > 0);
  } finally {
    await t.cleanup();
  }
});

test("real process restart exposes an interrupted job without resuming the provider", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  let calls = 0;
  const t = await setup(async () => {
    calls++;
    return {
      output: { findings: [], abstentionReason: "No material difference." },
    };
  });
  try {
    const serviceUrl = new URL(
      "../server/insights/service.mjs",
      import.meta.url,
    ).href;
    const script = `import {createInsightService} from ${JSON.stringify(serviceUrl)};import {randomUUID} from 'node:crypto';const service=createInsightService({root:${JSON.stringify(t.root)},readComparison:async()=>({ok:true,comparison:${JSON.stringify(pair())}}),credentialStore:{get:async()=>'secret-test-key-12345',set:async()=>{},remove:async()=>{}},analyze:async()=>new Promise(()=>{})});await service.configure({model:'chosen',enabled:true});await service.generate({settingsHash:(await service.read()).settingsHash,inputHash:(await service.read()).input.hash,requestId:randomUUID()});process.exit(0);`;
    await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      script,
    ]);
    const r = await t.service.read();
    assert.equal(r.state, "interrupted");
    assert.equal(calls, 0);
    assert.equal(r.analysis, null);
    assert.equal(r.history.length, 1);
  } finally {
    await t.cleanup();
  }
});
