import { serializeForInlineScript } from "./security/tokens.js";

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function documentShell(
  body: string,
  script: string,
  nonce: string,
  styleUrls: readonly string[]
): string {
  const styles = styleUrls
    .map((url) => `<link rel="stylesheet" href="${escapeHtmlAttribute(url)}">`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentLens</title>
${styles}
</head>
<body>
${body}
${script.replace("NONCE_PLACEHOLDER", nonce)}
</body>
</html>`;
}

export function createBootstrapHtml(
  bearer: string,
  entryUrl: string,
  nonce: string,
  styleUrls: readonly string[] = []
): string {
  const script = `<script id="agentlens-bootstrap" type="module" nonce="NONCE_PLACEHOLDER">
const token = ${serializeForInlineScript(bearer)};
history.replaceState(null, '', '/runs');
document.getElementById("agentlens-bootstrap")?.remove();
const { boot } = await import(${serializeForInlineScript(entryUrl)});
boot(token);
</script>`;
  return documentShell('<main id="root"></main>', script, nonce, styleUrls);
}

export function createReloadHtml(
  entryUrl: string,
  nonce: string,
  styleUrls: readonly string[] = []
): string {
  const script = `<script type="module" nonce="NONCE_PLACEHOLDER">
const { boot } = await import(${serializeForInlineScript(entryUrl)});
boot(null);
</script>`;
  return documentShell(
    '<main id="root"><h1>Authentication expired</h1><p>Restart AgentLens UI to reconnect.</p></main>',
    script,
    nonce,
    styleUrls
  );
}
