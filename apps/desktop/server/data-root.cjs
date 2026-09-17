const path = require("node:path");
let configured;
function configureDataRoot(storage) {
  if (configured) throw Error("desktop_storage_already_configured");
  if (!storage || !path.isAbsolute(storage.root))
    throw Error("desktop_storage_unavailable");
  configured = Object.freeze({ ...storage });
}
function getDataRoot() {
  return configured?.root ?? path.join(__dirname, "../.local");
}
function getStorageInfo() {
  return configured ?? { root: getDataRoot(), mode: "development" };
}
module.exports = { configureDataRoot, getDataRoot, getStorageInfo };
