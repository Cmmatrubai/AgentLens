import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { createCredentialStore } = createRequire(import.meta.url)(
  "../electron/insight-credentials.cjs",
);
test("credential boundary persists only encrypted bytes and fails closed when unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "insight-credentials-"));
  let available = true;
  const safeStorage = {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(s.split("").reverse().join("")),
    decryptString: (b) => b.toString().split("").reverse().join(""),
  };
  const c = createCredentialStore({ root, safeStorage });
  try {
    await c.set("private-test-key");
    assert.equal(await c.has(), true);
    assert.equal(await c.get(), "private-test-key");
    assert.ok(
      !(await readFile(join(root, "credential.json"), "utf8")).includes(
        "private-test-key",
      ),
    );
    available = false;
    await assert.rejects(c.get(), /credential_store_unavailable/);
    await assert.rejects(c.set("replacement"), /credential_store_unavailable/);
    await c.remove();
    assert.equal(await c.has(), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
