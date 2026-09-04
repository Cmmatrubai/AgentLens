import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      environment: "node",
      include: ["{packages,apps}/*/test/**/*.test.ts"]
    }
  },
  {
    test: {
      environment: "jsdom",
      include: ["apps/web/test/**/*.test.tsx"],
      setupFiles: ["apps/web/test/setup.ts"]
    }
  }
]);
