export const LIVE_SETUP_DRAFT_KEY = "agentlens:live-setup-draft:v1";

export const LIVE_SETUP_TIMEOUTS = [5, 10, 20, 30, 60] as const;
export const LIVE_SETUP_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export type LiveSetupDraft = {
  task: string;
  models: [
    { model: string; effort: (typeof LIVE_SETUP_EFFORTS)[number] },
    { model: string; effort: (typeof LIVE_SETUP_EFFORTS)[number] },
  ];
  timeoutMinutes: (typeof LIVE_SETUP_TIMEOUTS)[number];
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function defaultLiveSetupDraft(): LiveSetupDraft {
  return {
    task: "",
    models: [
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.6-terra", effort: "high" },
    ],
    timeoutMinutes: 10,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDraft(value: unknown): LiveSetupDraft | null {
  if (
    !isRecord(value) ||
    typeof value.task !== "string" ||
    value.task.length > 20_000 ||
    !Array.isArray(value.models) ||
    value.models.length !== 2 ||
    typeof value.timeoutMinutes !== "number" ||
    !LIVE_SETUP_TIMEOUTS.includes(
      value.timeoutMinutes as LiveSetupDraft["timeoutMinutes"],
    )
  ) {
    return null;
  }
  const models = value.models.map((choice) => {
    if (
      !isRecord(choice) ||
      typeof choice.model !== "string" ||
      choice.model.length > 120 ||
      typeof choice.effort !== "string" ||
      !LIVE_SETUP_EFFORTS.includes(
        choice.effort as LiveSetupDraft["models"][number]["effort"],
      )
    ) {
      return null;
    }
    return {
      model: choice.model,
      effort: choice.effort as LiveSetupDraft["models"][number]["effort"],
    };
  });
  if (models.some((choice) => choice === null)) return null;
  return {
    task: value.task,
    models: models as LiveSetupDraft["models"],
    timeoutMinutes: value.timeoutMinutes as LiveSetupDraft["timeoutMinutes"],
  };
}

// Module memory survives route unmounts, but never a fresh renderer or app session.
const draftValues = new Map<string, string>();
const rendererDraftStorage: DraftStorage = {
  getItem: (key) => draftValues.get(key) ?? null,
  setItem: (key, value) => {
    draftValues.set(key, value);
  },
  removeItem: (key) => {
    draftValues.delete(key);
  },
};
export function getLiveSetupDraftStorage(): DraftStorage | undefined {
  return typeof window === "undefined" ? undefined : rendererDraftStorage;
}

export function readLiveSetupDraft(
  storage: DraftStorage | undefined,
): LiveSetupDraft | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(LIVE_SETUP_DRAFT_KEY);
    if (serialized === null) return null;
    const draft = parseDraft(JSON.parse(serialized));
    if (!draft) storage.removeItem(LIVE_SETUP_DRAFT_KEY);
    return draft;
  } catch {
    try {
      storage.removeItem(LIVE_SETUP_DRAFT_KEY);
    } catch {
      // Storage can be unavailable without blocking setup.
    }
    return null;
  }
}

function isDefaultDraft(draft: LiveSetupDraft) {
  const fallback = defaultLiveSetupDraft();
  return (
    draft.task === fallback.task &&
    draft.timeoutMinutes === fallback.timeoutMinutes &&
    draft.models.every(
      (choice, index) =>
        choice.model === fallback.models[index].model &&
        choice.effort === fallback.models[index].effort,
    )
  );
}

export function writeLiveSetupDraft(
  storage: DraftStorage | undefined,
  draft: LiveSetupDraft,
) {
  if (!storage) return;
  const safeDraft = parseDraft(draft);
  if (!safeDraft) return;
  draft = safeDraft;
  try {
    if (isDefaultDraft(draft)) {
      storage.removeItem(LIVE_SETUP_DRAFT_KEY);
      return;
    }
    storage.setItem(
      LIVE_SETUP_DRAFT_KEY,
      JSON.stringify({
        task: draft.task,
        models: draft.models.map(({ model, effort }) => ({ model, effort })),
        timeoutMinutes: draft.timeoutMinutes,
      }),
    );
  } catch {
    // Storage failures should not block a comparison.
  }
}

export function clearLiveSetupDraft(storage: DraftStorage | undefined) {
  try {
    storage?.removeItem(LIVE_SETUP_DRAFT_KEY);
  } catch {
    // Storage failures should not block a comparison.
  }
}

export async function startAndClearLiveSetupDraftOnSuccess<
  T extends { ok: boolean },
>(start: () => Promise<T>, storage: DraftStorage | undefined): Promise<T> {
  const result = await start();
  if (result.ok) clearLiveSetupDraft(storage);
  return result;
}
