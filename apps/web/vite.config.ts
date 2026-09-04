import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    sourcemap: false,
    outDir: "../server/dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/bootstrap.tsx",
      preserveEntrySignatures: "strict"
    }
  }
});
