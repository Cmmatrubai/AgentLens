import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveLane } from "../src/LiveWorkspace";
import type { LiveAttempt } from "../src/live-types";

const attempt: LiveAttempt = {
  key: "a",
  model: "fixture-a",
  effort: "high",
  workspace: "/fixture/a",
  state: "failed",
  eventCount: 1,
  omittedEvents: 0,
  events: [
    {
      id: "e1",
      kind: "command",
      status: "failed",
      summary: "Command failed",
      command: "node --test",
      output: "<script>untrusted output</script>",
      message: "",
      files: [],
      truncated: true,
      receivedAt: 1000,
    },
  ],
};
test("a failed lane preserves expandable escaped output without claiming success or offering stop", () => {
  const html = renderToStaticMarkup(
    createElement(LiveLane, { attempt, now: 2000, busy: false, onStop() {} }),
  );
  assert.match(html, /Needs attention/);
  assert.match(html, /&lt;script&gt;untrusted output&lt;\/script&gt;/);
  assert.match(html, /Preview shortened/);
  assert.match(html, /aria-label="Full command"/);
  assert.doesNotMatch(html, /<script>|Stop agent|Tests passed/);
});
test("a running empty lane explains quiet recording and provides a named independent stop control", () => {
  const html = renderToStaticMarkup(
    createElement(LiveLane, {
      attempt: { ...attempt, state: "running", events: [], eventCount: 0 },
      now: 2000,
      busy: false,
      onStop() {},
    }),
  );
  assert.match(html, /Waiting for recorded activity/);
  assert.match(html, /Stop agent A/);
  assert.doesNotMatch(html, /100%|Thinking|Tests passed/);
});

test("activity previews expose the agent's update and distinguish a finished command from a passing task", () => {
  const html = renderToStaticMarkup(
    createElement(LiveLane, {
      attempt: {
        ...attempt,
        state: "completed",
        events: [
          {
            ...attempt.events[0],
            id: "message",
            kind: "message.agent",
            status: "completed",
            command: "",
            output: "",
            message:
              "I found the draft reset.\nI will preserve only safe fields.",
          },
          {
            ...attempt.events[0],
            id: "command",
            status: "completed",
            output: "source contents",
          },
        ],
      },
      now: 2000,
      busy: false,
      onStop() {},
    }),
  );
  assert.match(html, /Update · I found the draft reset\./);
  assert.match(html, /Finished/);
  assert.doesNotMatch(html, /Tests passed|Task complete/);
});
