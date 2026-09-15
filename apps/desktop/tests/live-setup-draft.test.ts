import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveSetup } from "../src/LiveSetup";
import {
  LIVE_SETUP_DRAFT_KEY,
  clearLiveSetupDraft,
  defaultLiveSetupDraft,
  readLiveSetupDraft,
  startAndClearLiveSetupDraftOnSuccess,
  writeLiveSetupDraft,
  type LiveSetupDraft,
} from "../src/live-setup-draft";

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const draft: LiveSetupDraft = {
  task: "Preserve this comparison",
  models: [
    { model: "model-a", effort: "medium" },
    { model: "model-b", effort: "xhigh" },
  ],
  timeoutMinutes: 30,
};

test("a valid draft restores exactly the setup fields and no runtime state", () => {
  const storage = new MemoryStorage();
  writeLiveSetupDraft(storage, {
    ...draft,
    acknowledged: true,
    project: { id: "secret" },
    error: "failed",
    credential: "do-not-store",
  } as LiveSetupDraft);

  assert.deepEqual(readLiveSetupDraft(storage), draft);
  assert.deepEqual(JSON.parse(storage.getItem(LIVE_SETUP_DRAFT_KEY)!), draft);
});

test("clearing removes a saved draft and default values do not recreate one", () => {
  const storage = new MemoryStorage();
  writeLiveSetupDraft(storage, draft);
  clearLiveSetupDraft(storage);
  assert.equal(readLiveSetupDraft(storage), null);

  writeLiveSetupDraft(storage, defaultLiveSetupDraft());
  assert.equal(storage.getItem(LIVE_SETUP_DRAFT_KEY), null);
});

test("malformed and out-of-bounds drafts are rejected and removed", () => {
  const invalid = [
    "not json",
    JSON.stringify({ ...draft, task: "x".repeat(20_001) }),
    JSON.stringify({ ...draft, models: draft.models.slice(0, 1) }),
    JSON.stringify({
      ...draft,
      models: [{ model: "x".repeat(121), effort: "high" }, draft.models[1]],
    }),
    JSON.stringify({
      ...draft,
      models: [draft.models[0], { model: "b", effort: "extreme" }],
    }),
    JSON.stringify({ ...draft, timeoutMinutes: 31 }),
  ];

  for (const serialized of invalid) {
    const storage = new MemoryStorage();
    storage.setItem(LIVE_SETUP_DRAFT_KEY, serialized);
    assert.equal(readLiveSetupDraft(storage), null);
    assert.equal(storage.getItem(LIVE_SETUP_DRAFT_KEY), null);
  }
});

test("failed and rejected starts preserve the draft; a successful start clears it", async () => {
  const storage = new MemoryStorage();
  writeLiveSetupDraft(storage, draft);

  const failed = await startAndClearLiveSetupDraftOnSuccess(
    async () => ({ ok: false as const, error: "could_not_start" }),
    storage,
  );
  assert.equal(failed.ok, false);
  assert.deepEqual(readLiveSetupDraft(storage), draft);

  await assert.rejects(
    startAndClearLiveSetupDraftOnSuccess(async () => {
      throw Error("ipc failed");
    }, storage),
    /ipc failed/,
  );
  assert.deepEqual(readLiveSetupDraft(storage), draft);

  const started = await startAndClearLiveSetupDraftOnSuccess(
    async () => ({ ok: true as const, jobId: "job-1" }),
    storage,
  );
  assert.equal(started.ok, true);
  assert.equal(readLiveSetupDraft(storage), null);
});

test("the setup exposes an explicit named Clear draft action", () => {
  const html = renderToStaticMarkup(
    createElement(LiveSetup, { onStarted() {} }),
  );
  assert.match(html, /<button[^>]*>Clear draft<\/button>/);
});

test("invalid writes cannot replace a valid draft", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const valid = { ...defaultLiveSetupDraft(), task: "Keep my task" };
  writeLiveSetupDraft(storage, valid);
  writeLiveSetupDraft(storage, { ...valid, task: "x".repeat(20_001) });
  assert.equal(readLiveSetupDraft(storage)?.task, "Keep my task");
});

test("navigation shares a memory draft but a fresh renderer module starts clean", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const browserStorage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: browserStorage },
  });
  try {
    const module = await import("../src/live-setup-draft");
    const storage = module.getLiveSetupDraftStorage();
    writeLiveSetupDraft(storage, {
      ...defaultLiveSetupDraft(),
      task: "Navigation draft",
    });
    assert.equal(
      readLiveSetupDraft(module.getLiveSetupDraftStorage())?.task,
      "Navigation draft",
    );
    assert.equal(
      values.size,
      0,
      "draft must not be written to browser storage",
    );
    const fresh =
      await import("../src/live-setup-draft.ts?fresh-renderer-test");
    assert.equal(
      fresh.readLiveSetupDraft(fresh.getLiveSetupDraftStorage()),
      null,
    );
    clearLiveSetupDraft(storage);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
