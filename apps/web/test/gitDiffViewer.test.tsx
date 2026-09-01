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
    await userEvent.click(screen.getByRole("button", { name: "Show next diff evidence" }));
    expect(screen.getByText(/00400 x+/)).toBeVisible();
    expect(screen.queryByText(/00000 x+/)).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-diff-line]").length).toBeLessThanOrEqual(400);
  });

  it("globally bounds files, hunks, and lines for a near-limit multi-file diff", async () => {
    const files = Array.from({ length: 20_000 }, (_, fileIndex) => ({
      oldPath: `src/${fileIndex}.ts`,
      newPath: `src/${fileIndex}.ts`,
      headers: [`diff --git a/src/${fileIndex}.ts b/src/${fileIndex}.ts`],
      metadata: [],
      hunks: Array.from({ length: 8 }, (_, hunkIndex) => ({
        header: `@@ -${hunkIndex + 1},1 +${hunkIndex + 1},1 @@`,
        oldStart: hunkIndex + 1,
        oldCount: 1,
        newStart: hunkIndex + 1,
        newCount: 1,
        lines: [{ type: "add" as const, oldLineNumber: null, newLineNumber: hunkIndex + 1, text: "bounded" }]
      }))
    }));
    const { container } = render(<GitDiffViewer evidence={{ state: "available", value: diff({ preamble: [], files }) }} />);
    expect(screen.getAllByRole("group").length).toBeLessThanOrEqual(50);
    const toggles = screen.getAllByRole("button", { name: /^Expand diff for/ });
    await userEvent.click(toggles[0]!);
    await userEvent.click(toggles[19]!);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(toggles[19]).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelectorAll(".git-diff__hunk").length).toBeLessThanOrEqual(100);
    expect(container.querySelectorAll("[data-diff-line]").length).toBeLessThanOrEqual(400);
    expect(container.querySelectorAll("*").length).toBeLessThan(2_000);
    expect(screen.getByRole("button", { name: "Next diff files" })).toBeVisible();
  });

  it("replaces the expanded file so later file evidence remains reachable after an earlier 400-line file", async () => {
    const firstLines = Array.from({ length: 400 }, (_, index) => ({
      type: "add" as const,
      oldLineNumber: null,
      newLineNumber: index + 1,
      text: `first-${index}`
    }));
    const value = diff({
      preamble: [],
      files: [
        {
          oldPath: "first.txt", newPath: "first.txt", headers: ["first header"], metadata: [],
          hunks: [{ header: "@@ first @@", oldStart: 0, oldCount: 0, newStart: 1, newCount: 400, lines: firstLines }]
        },
        {
          oldPath: "later.txt", newPath: "later.txt", headers: ["later header"],
          metadata: [{ type: "binary", text: "later metadata" }],
          hunks: [
            { header: "@@ zero-line hunk @@", oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, lines: [] },
            {
              header: "@@ later content @@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
              lines: [{ type: "context", oldLineNumber: 1, newLineNumber: 1, text: "later line" }]
            }
          ]
        }
      ]
    });
    const { container } = render(<GitDiffViewer evidence={{ state: "available", value }} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand diff for first.txt" }));
    expect(container.querySelectorAll("[data-diff-line]")).toHaveLength(400);

    await userEvent.click(screen.getByRole("button", { name: "Expand diff for later.txt" }));
    expect(screen.getByRole("button", { name: "Expand diff for first.txt" })).toHaveAttribute("aria-expanded", "false");
    const later = screen.getByRole("group", { name: "Diff file later.txt" });
    expect(within(later).getByText("later header")).toBeVisible();
    expect(within(later).getByText("later metadata")).toBeVisible();
    expect(within(later).getByText("@@ zero-line hunk @@")).toBeVisible();
    expect(within(later).getByText("later line")).toBeVisible();
    expect(container.querySelectorAll("[data-diff-line]").length).toBeLessThanOrEqual(400);
  });

  it("pages zero-line hunk headers forward and backward even when a page renders no lines", async () => {
    const zeroHunks = Array.from({ length: 100 }, (_, index) => ({
      header: `@@ zero ${index} @@`, oldStart: index, oldCount: 0, newStart: index, newCount: 0, lines: []
    }));
    const value = diff({
      preamble: [],
      files: [{
        oldPath: "zero.txt", newPath: "zero.txt", headers: [], metadata: [],
        hunks: [
          ...zeroHunks,
          {
            header: "@@ reachable later hunk @@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
            lines: [{ type: "add", oldLineNumber: null, newLineNumber: 1, text: "reachable later line" }]
          }
        ]
      }]
    });
    const { container } = render(<GitDiffViewer evidence={{ state: "available", value }} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand diff for zero.txt" }));
    expect(container.querySelectorAll(".git-diff__hunk")).toHaveLength(100);
    expect(container.querySelectorAll("[data-diff-line]")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Show next diff evidence" }));
    expect(screen.getByText("@@ reachable later hunk @@")).toBeVisible();
    expect(screen.getByText("reachable later line")).toBeVisible();
    expect(screen.queryByText("@@ zero 0 @@")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show previous diff evidence" }));
    expect(screen.getByText("@@ zero 0 @@")).toBeVisible();
    expect(screen.queryByText("@@ reachable later hunk @@")).not.toBeInTheDocument();
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
