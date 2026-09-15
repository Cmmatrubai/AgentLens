import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissingCheckResults } from "../src/ComparisonStates";

test("missing evaluation offers an import without inventing success conditions", () => {
  const html = renderToStaticMarkup(
    createElement(MissingCheckResults, {
      canImport: true,
      busy: false,
      onImport() {},
    }),
  );
  assert.match(html, /No check results yet/);
  assert.match(html, /Open evaluated comparison/);
  assert.match(html, /opens the supplied comparison/);
  assert.doesNotMatch(html, /Passed|API key required|All tests/);
});
test("a browser-only view explains where supplied results can be opened", () => {
  const html = renderToStaticMarkup(
    createElement(MissingCheckResults, {
      canImport: false,
      busy: false,
      onImport() {},
    }),
  );
  assert.match(html, /desktop app/);
  assert.doesNotMatch(html, /<button/);
});
