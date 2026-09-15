import { test } from "node:test";
import assert from "node:assert/strict";
import { describeInsightFailure } from "../src/insight-presentation.ts";

test("a reported length stop explains the response limit without claiming a cause", () => {
  const message = describeInsightFailure("provider_incomplete", {
    finishReason: "length",
    reasoningTokens: 5994,
    answerCharacters: 0,
  });
  assert.equal(message?.title, "Response limit reached");
  assert.match(
    message?.description ?? "",
    /reported reasoning tokens but returned no answer text/,
  );
  assert.doesNotMatch(
    message?.description ?? "",
    /all tokens|exactly|model is|bad model/,
  );
});
test("missing usage does not turn an incomplete response into reasoning exhaustion", () => {
  assert.equal(describeInsightFailure("provider_incomplete", null), null);
  const message = describeInsightFailure("provider_incomplete", {
    finishReason: "length",
    answerCharacters: 40,
  });
  assert.doesNotMatch(message?.description ?? "", /reasoning tokens/);
  assert.match(message?.description ?? "", /complete analysis/);
});
test("unrelated failures and untrusted diagnostic text do not change the explanation", () => {
  assert.equal(
    describeInsightFailure("provider_authentication", {
      finishReason: "length",
    }),
    null,
  );
  assert.equal(
    describeInsightFailure("provider_incomplete", {
      finishReason: "private text",
    } as never),
    null,
  );
});

import * as presentation from "../src/insight-presentation.ts";
const actionContext = {
  desktop: true,
  eligible: true,
  busy: false,
  supportRunning: false,
  state: "not_analyzed" as const,
  error: null,
  settings: {
    enabled: true,
    hasKey: true,
    authMode: "bearer" as const,
    model: "example-model",
  },
};
test("the next action moves from provider setup to evidence preview without generating", () => {
  for (const settings of [
    { ...actionContext.settings, enabled: false },
    { ...actionContext.settings, hasKey: false },
    { ...actionContext.settings, model: " " },
  ]) {
    assert.equal(
      presentation.describeAnalysisAction({ ...actionContext, settings }).kind,
      "settings",
    );
  }
  assert.equal(
    presentation.describeAnalysisAction(actionContext).kind,
    "preview",
  );
  assert.equal(
    presentation.describeAnalysisAction({
      ...actionContext,
      settings: { ...actionContext.settings, hasKey: false, authMode: "none" },
    }).kind,
    "preview",
  );
});
test("unavailable and concurrent work explains the block before offering configuration or a new request", () => {
  for (const overrides of [
    { desktop: false },
    { eligible: false },
    { busy: true },
    { state: "running" },
    { supportRunning: true },
  ]) {
    const action = presentation.describeAnalysisAction({
      ...actionContext,
      ...overrides,
    } as Parameters<typeof presentation.describeAnalysisAction>[0]);
    assert.equal(action.kind, "none");
    assert.notEqual(action.canPreviewRetry, true);
    assert.ok(action.reason);
  }
});
test("credential and compatibility failures lead to settings while retryable failures lead to preview", () => {
  for (const error of [
    "provider_authentication",
    "provider_unsupported_request",
  ]) {
    const action = presentation.describeAnalysisAction({
      ...actionContext,
      state: "failed",
      error,
    });
    assert.equal(action.kind, "settings");
    assert.ok(action.reason);
  }
  for (const state of [
    "failed",
    "interrupted",
    "stale",
    "available",
    "no_findings",
  ] as const) {
    assert.equal(
      presentation.describeAnalysisAction({
        ...actionContext,
        state,
        error: "analysis_timeout",
      }).kind,
      "preview",
    );
  }
});
