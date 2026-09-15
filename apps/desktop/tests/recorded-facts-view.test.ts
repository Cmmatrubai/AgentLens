import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordedFacts } from "../src/RecordedFacts.tsx";
import { buildInsightBundle } from "../server/insights/evidence.mjs";
import { makePair } from "./fixtures/insight-comparisons.mjs";
const render = (bundle, ledger = bundle.recordedFacts) => renderToStaticMarkup(createElement(RecordedFacts, {ledger, inputHash:bundle.inputHash, sources:bundle.sources, attempts:bundle.attempts}));

test("recorded facts stay collapsed with explicit unknown outcomes and separate command exits", () => {
  const pair = makePair();
  pair.checks.push({id:"unrun", title:"Unrun boundary check"});
  const html = render(buildInsightBundle(pair));
  assert.match(html, /<details class="recorded-facts">/);
  assert.match(html, /Recorded facts/);
  assert.match(html, /Unrun boundary check/);
  assert.equal((html.match(/>Unknown<\/span>/g) ?? []).length, 2);
  assert.match(html, /Exit 1/);
  assert.match(html, /orion-code/);
  assert.match(html, /nebula-dev/);
  assert.doesNotMatch(html, /<details[^>]+open/);
});

test("selected evidence opens inside its owning fact and omitted output stays disclosed", () => {
  const full = render(buildInsightBundle(makePair()));
  assert.match(full, /north independent result: pass/);
  assert.match(full, /north-independent-artifact/);
  const limited = render(buildInsightBundle(makePair(), {maxSources:1}));
  assert.match(limited, /outside the selected evidence/);
  assert.doesNotMatch(limited, /south independent result: fail/);
});

test("stale ledgers and wrong-attempt evidence cannot be presented as current facts", () => {
  const bundle = buildInsightBundle(makePair());
  assert.equal(render(bundle, {...bundle.recordedFacts, inputHash:"stale"}), "");
  const damaged = structuredClone(bundle);
  damaged.sources = damaged.sources.map(source => ({...source, attemptKey:"other"}));
  assert.doesNotMatch(render(damaged), /north independent result: pass/);
  assert.match(render(damaged), /Selected evidence is unavailable/);
});
