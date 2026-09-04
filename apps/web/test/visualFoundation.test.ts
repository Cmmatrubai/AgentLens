import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Flight Console visual foundation", () => {
  it("defines local technical typography, evidence colors, compact geometry, and final responsive precedence", () => {
    const tokens = read("apps/web/src/styles/tokens.css");
    const bootstrap = read("apps/web/src/bootstrap.tsx");
    const global = read("apps/web/src/styles/global.css");

    expect(tokens).toContain("--font-ui:");
    expect(tokens).toContain("--font-code:");
    expect(tokens).toContain("--evidence-observed:");
    expect(tokens).toContain("--evidence-human:");
    expect(tokens).toContain("--trajectory-row-compact:");
    expect(tokens).toContain("--chrome-topbar-height:");
    expect(global).not.toContain('@import "./responsive.css"');
    expect(bootstrap.indexOf('"./styles/responsive.css"'))
      .toBeGreaterThan(bootstrap.indexOf('"./styles/assessment.css"'));
  });
});
