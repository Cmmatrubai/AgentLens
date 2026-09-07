const { app, safeStorage } = require("electron");
const { readFile, writeFile } = require("node:fs/promises");
const [mode, artifact, identity] = process.argv.slice(2);
if (!["write", "read"].includes(mode) || !artifact || !identity)
  process.exit(2);
if (identity === "migrated-desktop")
  require("../../electron/identity.cjs").applyDesktopIdentity(app);
else app.setName(identity);
app.whenReady().then(async () => {
  try {
    const marker = "agentlens-migration-noncredential-marker";
    if (!safeStorage.isEncryptionAvailable()) throw Error("unavailable");
    if (mode === "write")
      await writeFile(artifact, safeStorage.encryptString(marker), {
        mode: 0o600,
        flag: "wx",
      });
    const verified =
      mode === "write" ||
      safeStorage.decryptString(await readFile(artifact)) === marker;
    console.log(JSON.stringify({ mode, identity: app.getName(), verified }));
    app.exit(verified ? 0 : 1);
  } catch {
    console.log(JSON.stringify({ mode, verified: false }));
    app.exit(1);
  }
});
