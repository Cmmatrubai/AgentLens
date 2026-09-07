const { pathToFileURL } = require("node:url");
const path = require("node:path");
function createCredentialStore({ safeStorage, root }) {
  const defaultEndpoint = "https://api.openai.com/v1";
  const files = import(
    pathToFileURL(path.join(__dirname, "../server/insights/private-files.mjs"))
      .href
  );
  const available = () =>
    safeStorage.isEncryptionAvailable() &&
    !(
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    );
  return {
    async has(baseUrl = defaultEndpoint) {
      const saved = await (await files).privateRead(root, "credential.json");
      return !!saved && (saved.baseUrl ?? defaultEndpoint) === baseUrl;
    },
    async get(baseUrl = defaultEndpoint) {
      const saved = await (await files).privateRead(root, "credential.json");
      if (!saved) return null;
      if ((saved.baseUrl ?? defaultEndpoint) !== baseUrl) return null;
      if (!available()) throw Error("credential_store_unavailable");
      try {
        return safeStorage.decryptString(
          Buffer.from(saved.ciphertext, "base64"),
        );
      } catch {
        throw Error("credential_store_unavailable");
      }
    },
    async set(key, baseUrl = defaultEndpoint) {
      if (!available()) throw Error("credential_store_unavailable");
      const ciphertext = safeStorage.encryptString(key).toString("base64");
      await (
        await files
      ).privateWrite(root, "credential.json", { ciphertext, baseUrl });
    },
    async remove() {
      await (await files).privateRemove(root, "credential.json");
    },
  };
}
module.exports = { createCredentialStore };
