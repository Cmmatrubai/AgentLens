import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      environment: "node",
      include: ["{packages,apps}/*/test/**/*.test.ts"]
    }
  }
]);
