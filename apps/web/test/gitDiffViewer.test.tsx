import type { GitDiffContentV1 } from "@agentlens/api-contract";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { GitDiffViewer } from "../src/evidence/GitDiffViewer.js";

function diff(overrides: Partial<GitDiffContentV1> = {}): GitDiffContentV1 {
  return {
    schemaVersion: 1,
    kind: "diff",
    preamble: ["synthetic bounded diff"],
    truncated: false,
    malformed: false,
    files: [
      {
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        headers: ["diff --git a/src/old.ts b/src/new.ts"],
        metadata: [{ type: "binary", text: "Binary files differ" }],
        hunks: [{
          header: "@@ -1,2 +1,3 @@",
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 3,
          lines: [
            { type: "context", oldLineNumber: 1, newLineNumber: 1, text: "const safe = true;" },
            { type: "delete", oldLineNumber: 2, newLineNumber: null, text: "const oldValue = 1;" },
            { type: "add", oldLineNumber: null, newLineNumber: 2, text: "const newValue = '<script>unsafe()</script>';" },
            { type: "excluded", oldLineNumber: null, newLineNumber: 3, text: "[[EXCLUDED:SENSITIVE_PATH]]" },
            { type: "no_newline", oldLineNumber: null, newLineNumber: null, text: "No newline at end of file" }
          ]
        }]
      },
      {
        oldPath: "README.md",
        newPath: "README.md",
        headers: [],
        metadata: [],
        hunks: []
      }
    ],
    ...overrides
  };
}

describe("structured Final Git evidence diff", () => {
  it("groups collapsed files and renders structured hunks, numbers, labels, metadata, and exclusions as text", async () => {
    const { container } = render(<GitDiffViewer evidence={{ state: "available", value: diff() }} />);
    const files = screen.getAllByRole("group");
    expect(files).toHaveLength(2);
    const firstToggle = screen.getByRole("button", { name: "Expand diff for src/new.ts" });
    expect(firstToggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(firstToggle);

    const first = files[0]!;
    expect(within(first).getByText("@@ -1,2 +1,3 @@")).toBeVisible();
    expect(within(first).getByText("Binary files differ")).toBeVisible();
    expect(within(first).getByText("Context line 1 → 1")).toBeInTheDocument();
    expect(within(first).getByText("Deleted line 2")).toBeInTheDocument();
    expect(within(first).getByText("Added line 2")).toBeInTheDocument();
    expect(within(first).getByText("Excluded sensitive evidence at new line 3")).toBeInTheDocument();
    expect(within(first).getByText("[[EXCLUDED:SENSITIVE_PATH]]")).toBeVisible();
    expect(first.querySelector(".git-diff__code-scroll")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("dangerouslySetInnerHTML");
    expect(within(first).getByText(/const newValue = '<script>unsafe\(\)<\/script>';/)).toBeVisible();
  });

  it("keeps a large response DOM-bounded and expands it only in bounded pages", async () => {
    const lines = Array.from({ length: 5_000 }, (_, index) => ({
      type: "add" as const,
      oldLineNumber: null,
      newLineNumber: index + 1,
      text: `${String(index).padStart(5, "0")} ${"x".repeat(380)}`
    }));
    const value = diff({
      truncated: true,
      files: [{
        oldPath: "large.txt",
        newPath: "large.txt",
        headers: [],
        metadata: [],
        hunks: [{ header: "@@ -0,0 +1,5000 @@", oldStart: 0, oldCount: 0, newStart: 1, newCount: 5_000, lines }]
      }]
    });
    const { container } = render(<GitDiffViewer evidence={{ state: "available", value }} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand diff for large.txt" }));
    expect(container.querySelectorAll("[data-diff-line]").length).toBeLessThanOrEqual(400);
    expect(screen.getByText("Evidence truncated at the response bound")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show next 400 diff lines" })).toBeVisible();
  });

  it("distinguishes empty, malformed, corrupt, unreadable, and unavailable diff states", () => {
    const { rerender } = render(<GitDiffViewer evidence={{ state: "available", value: diff({ files: [], preamble: [] }) }} />);
    expect(screen.getByText("Tracked final diff is empty.")).toBeVisible();

    rerender(<GitDiffViewer evidence={{ state: "available", value: diff({ malformed: true }) }} />);
    expect(screen.getByText("Structured diff is malformed or corrupt.")).toBeVisible();

    for (const [reason, text] of [
      ["corrupt", "Evidence corrupt or binding-invalid"],
      ["artifact_unreadable", "Artifact unreadable"],
      ["artifact_omitted", "Artifact omitted"],
      ["not_captured", "Not captured"]
    ] as const) {
      rerender(<GitDiffViewer evidence={{ state: "unavailable", reason }} />);
      expect(screen.getByText(text)).toBeVisible();
    }
  });
});
