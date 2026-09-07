import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const { trustedFrame } = createRequire(import.meta.url)(
  "../electron/insight-ipc.cjs",
);
test("paid actions only accept the exact bundled main frame", () => {
  const frame = {
    url:
      pathToFileURL(
        fileURLToPath(new URL("../dist/index.html", import.meta.url)),
      ).href + "?desktop=1#/comparison",
  };
  assert.equal(
    trustedFrame({ senderFrame: frame, sender: { mainFrame: frame } }),
    true,
  );
  assert.equal(
    trustedFrame({ senderFrame: { ...frame }, sender: { mainFrame: frame } }),
    false,
  );
  const foreign = { url: "http://127.0.0.1:5178/#/comparison" };
  assert.equal(
    trustedFrame({ senderFrame: foreign, sender: { mainFrame: foreign } }),
    false,
  );
  assert.equal(
    trustedFrame({ senderFrame: null, sender: { mainFrame: frame } }),
    false,
  );
});
