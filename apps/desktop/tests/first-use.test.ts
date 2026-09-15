import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App";

// Empty and obsolete URLs must offer a safe example before exposing simulated work.
test("a fresh launch offers an example and a separate own-comparison path", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  try {
    for (const hash of ["", "#/unknown"]) {
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: { hash, search: "" },
      });
      const html = renderToStaticMarkup(createElement(App));
      assert.match(html, /Explore an example/);
      assert.match(html, /Compare your own agents/);
      assert.doesNotMatch(html, /Prototype 05|REPOSITORIES|3 tasks/);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "location", previous);
    else Reflect.deleteProperty(globalThis, "location");
  }
});
