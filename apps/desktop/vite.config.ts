import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { recordedRunPlugin } from "./server/vite-recorded.mjs";
export default defineConfig({
  plugins: [react(), recordedRunPlugin()],
  base: "./",
  server: {
    fs: {
      // Moving into a workspace must not expose sibling repositories or data.
      allow: [".", "../../node_modules"],
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "**/.local/**",
        "**/qa/real-run/**",
        "**/qa/insight-engine/**",
      ],
    },
  },
});
