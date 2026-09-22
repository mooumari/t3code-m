import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupThreadsByWorktree } from "./worktreeThreads";

const environmentId = EnvironmentId.make("env-1");

const thread = (id: string, overrides: Record<string, unknown> = {}) => ({
  id: ThreadId.make(id),
  environmentId,
  projectId: "project-1",
  title: id,
  worktreePath: null,
  archivedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  session: null,
  backgroundLiveness: null,
  ...overrides,
});

describe("groupThreadsByWorktree", () => {
  it("places threads in their worktree, or their project's checkout, attention first", () => {
    const groups = groupThreadsByWorktree({
      environmentId,
      worktreePaths: ["/repo", "/repo/.t3/worktrees/feature"],
      projectRoots: new Map([["project-1", "/repo"]]),
      threads: [
        thread("in-project"),
        thread("in-worktree", { worktreePath: "/repo/.t3/worktrees/feature" }),
        thread("needs-approval", {
          worktreePath: "/repo/.t3/worktrees/feature",
          hasPendingApprovals: true,
        }),
        thread("archived", { archivedAt: "2026-01-01T00:00:00.000Z" }),
        thread("elsewhere", { worktreePath: "/other" }),
        thread("other-env", { environmentId: EnvironmentId.make("env-2") }),
      ],
    });

    expect(groups.get("/repo")?.map((entry) => entry.title)).toEqual(["in-project"]);
    expect(
      groups.get("/repo/.t3/worktrees/feature")?.map((entry) => [entry.title, entry.status]),
    ).toEqual([
      ["needs-approval", "approval"],
      ["in-worktree", "ready"],
    ]);
    expect(groups.size).toBe(2);
  });
});
