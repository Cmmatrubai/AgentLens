const path = require("node:path");
// Keep the existing native identity when the workspace package is renamed.
// macOS safeStorage and the user's local preferences depend on this identity.
const DESKTOP_IDENTITY = "agentlens-desktop-prototype";
function applyDesktopIdentity(app) {
  app.setName(DESKTOP_IDENTITY);
  app.setPath("userData", path.join(app.getPath("appData"), DESKTOP_IDENTITY));
}
module.exports = { applyDesktopIdentity, DESKTOP_IDENTITY };
