import { readRecordedRun } from "./recorded-reader.mjs";
import { allowBridgeRequest } from "./recorded-projector.mjs";
import {
  readActiveComparison,
  readBrowserInsights,
} from "./insights/runtime.mjs";
export function recordedRunPlugin() {
  const install = (server) => {
    server.middlewares.use(async (req, res, next) => {
      if (
        !req.url?.startsWith("/api/recorded-run") &&
        !req.url?.startsWith("/api/comparison") &&
        !req.url?.startsWith("/api/insights")
      )
        return next();
      const comparison = req.url?.startsWith("/api/comparison");
      const insights = req.url?.startsWith("/api/insights");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      if (
        !allowBridgeRequest(
          req,
          insights
            ? "/api/insights"
            : comparison
              ? "/api/comparison"
              : "/api/recorded-run",
        )
      ) {
        res.statusCode = 403;
        res.end(JSON.stringify({ ok: false, error: "forbidden" }));
        return;
      }
      const result = insights
        ? await readBrowserInsights()
        : comparison
          ? await readActiveComparison()
          : await readRecordedRun();
      res.statusCode = result.ok ? 200 : 503;
      res.end(JSON.stringify(result));
    });
  };
  return {
    name: "agentlens-recorded-read",
    configureServer: install,
    configurePreviewServer: install,
  };
}
