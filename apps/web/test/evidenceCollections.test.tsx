import type { GitStatusContentV1, GitUntrackedContentV1 } from "@agentlens/api-contract";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { GitStatusView } from "../src/evidence/GitStatusView.js";
import { UntrackedMetadataView } from "../src/evidence/UntrackedMetadataView.js";

describe("bounded Git evidence collections", () => {
  it("replaces Git status pages while keeping all 10,000 entries reachable and the DOM bounded", async () => {
    const value: GitStatusContentV1 = {
      schemaVersion: 1,
      kind: "status",
      entries: Array.from({ length: 10_000 }, (_, index) => ({
        code: "M",
        path: `status-${String(index).padStart(5, "0")}.txt`
      }))
    };
    const { container } = render(<GitStatusView title="Final status" value={value} />);

    expect(screen.getByLabelText("Final status entry range")).toHaveTextContent("Entries 1–100 of 10000");
    expect(container.querySelectorAll(".git-status-view li")).toHaveLength(100);
    expect(screen.getByText("status-00000.txt")).toBeVisible();
    expect(screen.queryByText("status-00100.txt")).not.toBeInTheDocument();

    const next = screen.getByRole("button", { name: "Next Final status entries" });
    await userEvent.click(next);
    expect(next).toHaveFocus();
    expect(screen.getByLabelText("Final status entry range")).toHaveTextContent("Entries 101–200 of 10000");
    expect(screen.queryByText("status-00000.txt")).not.toBeInTheDocument();
    expect(screen.getByText("status-00199.txt")).toBeVisible();
    expect(container.querySelectorAll(".git-status-view li")).toHaveLength(100);

    await userEvent.click(screen.getByRole("button", { name: "Previous Final status entries" }));
    expect(screen.getByText("status-00000.txt")).toBeVisible();
  });

  it("replaces untracked metadata pages while keeping a near-bound 9,000th entry reachable", async () => {
    const value: GitUntrackedContentV1 = {
      schemaVersion: 1,
      kind: "untracked",
      entries: Array.from({ length: 9_000 }, (_, index) => ({
        path: `untracked-${String(index).padStart(5, "0")}.txt`,
        type: "file",
        size: index
      }))
    };
    const { container } = render(<UntrackedMetadataView value={value} />);

    expect(screen.getByLabelText("Untracked-file metadata entry range")).toHaveTextContent("Entries 1–100 of 9000");
    expect(container.querySelectorAll(".untracked-metadata li")).toHaveLength(100);
    const next = screen.getByRole("button", { name: "Next untracked-file metadata entries" });
    for (let page = 1; page < 90; page += 1) await userEvent.click(next);

    expect(next).toHaveFocus();
    expect(screen.getByLabelText("Untracked-file metadata entry range")).toHaveTextContent("Entries 8901–9000 of 9000");
    expect(screen.getByText(/untracked-08999\.txt/)).toBeVisible();
    expect(screen.queryByText(/untracked-00000\.txt/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".untracked-metadata li")).toHaveLength(100);
  });

  it("keeps explicit empty states without pagination controls", () => {
    render(
      <>
        <GitStatusView title="Initial status" value={{ schemaVersion: 1, kind: "status", entries: [] }} />
        <UntrackedMetadataView value={{ schemaVersion: 1, kind: "untracked", entries: [] }} />
      </>
    );
    expect(screen.getByText("Recorded status is clean.")).toBeVisible();
    expect(screen.getByText("Recorded metadata contains no entries.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /entries/ })).not.toBeInTheDocument();
  });
});
