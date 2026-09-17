import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const stylesheetImports = (source: string) => [...source.matchAll(
  /import\s+["'](\.\/styles\/[^"']+\.css)["'];/g
)].map(([, path]) => path);

describe("Flight Console visual foundation", () => {
  it("defines local technical typography, evidence colors, compact geometry, and final responsive precedence", () => {
    const tokens = read("apps/web/src/styles/tokens.css");
    const bootstrap = read("apps/web/src/bootstrap.tsx");
    const global = read("apps/web/src/styles/global.css");
    const stylesheets = stylesheetImports(bootstrap);

    expect(tokens).toContain("--font-ui:");
    expect(tokens).toContain("--font-code:");
    expect(tokens).toContain("--evidence-observed:");
    expect(tokens).toContain("--evidence-human:");
    expect(tokens).toContain("--trajectory-row-compact:");
    expect(tokens).toContain("--chrome-topbar-height:");
    expect(tokens).toContain("--text-dim: #76828b;");
    expect(tokens).toContain("--selection-duration: 150ms;");
    expect(global).not.toContain('@import "./responsive.css"');
    expect(stylesheets).toContain("./styles/shell.css");
    expect(stylesheets).toContain("./styles/run-detail.css");
    expect(stylesheets.filter((path) => path === "./styles/responsive.css")).toHaveLength(1);
    expect(stylesheets.at(-1)).toBe("./styles/responsive.css");
  });
});
