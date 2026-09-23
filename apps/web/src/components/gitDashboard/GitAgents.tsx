import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, GitDashboardWorktree } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { FolderGit2Icon } from "lucide-react";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import type { SidebarThreadStatus } from "../Sidebar.logic";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { groupThreadsByWorktree, type WorktreeThread } from "./worktreeThreads";

const EMPTY_THREADS: ReadonlyArray<WorktreeThread> = [];

/** Threads by the worktree path they run in, plus the branch each worktree has checked out. */
export function useWorktreeThreads(
  environmentId: EnvironmentId,
  worktrees: ReadonlyArray<GitDashboardWorktree>,
) {
  const threads = useThreadShells();
  const projects = useProjects();
  return useMemo(() => {
    const byWorktree = groupThreadsByWorktree({
      environmentId,
      worktreePaths: worktrees.map((worktree) => worktree.path),
      threads,
      projectRoots: new Map(
        projects
          .filter((project) => project.environmentId === environmentId)
          .map((project) => [project.id, project.workspaceRoot]),
      ),
    });
    const byBranch = new Map<string, ReadonlyArray<WorktreeThread>>();
    for (const worktree of worktrees) {
      const group = byWorktree.get(worktree.path);
      if (worktree.branch && group) byBranch.set(worktree.branch, group);
    }
    return { byWorktree, byBranch };
  }, [environmentId, worktrees, threads, projects]);
}

const STATUS_STYLE: Record<SidebarThreadStatus, { label: string; dot: string }> = {
  approval: { label: "Needs approval", dot: "bg-amber-500" },
  input: { label: "Needs input", dot: "bg-indigo-500" },
  working: { label: "Working", dot: "bg-sky-500" },
  monitoring: { label: "Monitoring", dot: "bg-foreground/60" },
  failed: { label: "Failed", dot: "bg-red-500" },
  ready: { label: "Idle", dot: "bg-muted-foreground/40" },
};

/** A thread's status and title; opens the thread. */
export function ThreadLink(props: { readonly thread: WorktreeThread }) {
  const navigate = useNavigate();
  const style = STATUS_STYLE[props.thread.status];
  return (
    <button
      type="button"
      onClick={() =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(props.thread.ref.environmentId, props.thread.ref.threadId),
          ),
        })
      }
      className="flex h-6.5 w-full min-w-0 items-center gap-2 rounded-sm pr-3 pl-10 text-left text-sm hover:bg-accent/60"
    >
      <span aria-label={style.label} className={cn("size-2 shrink-0 rounded-full", style.dot)} />
      <span className="min-w-0 truncate">{props.thread.title}</span>
      {props.thread.status !== "ready" ? (
        <span className="ml-auto shrink-0 text-muted-foreground text-xs">{style.label}</span>
      ) : null}
    </button>
  );
}

/**
 * Each checkout of the repository with the threads that are active in it. Idle threads are
 * only counted; the sidebar already lists them.
 */
export function WorktreeList(props: {
  readonly worktrees: ReadonlyArray<GitDashboardWorktree>;
  readonly threadsByWorktree: ReadonlyMap<string, ReadonlyArray<WorktreeThread>>;
  readonly defaultBranch: string | null;
  readonly onSelectWorktree: (path: string) => void;
  readonly onReview: (branch: string) => void;
}) {
  return (
    <ul className="flex flex-col pb-2">
      {props.worktrees.map((worktree) => {
        const threads = props.threadsByWorktree.get(worktree.path) ?? EMPTY_THREADS;
        const active = threads.filter((thread) => thread.status !== "ready");
        const idleCount = threads.length - active.length;
        const branch = worktree.detached ? null : worktree.branch;
        return (
          <li key={worktree.path} className="flex flex-col">
            <div className="flex h-7 min-w-0 items-center gap-1.5 pr-2 pl-6 text-sm">
              <FolderGit2Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                disabled={worktree.isCurrent}
                onClick={() => props.onSelectWorktree(worktree.path)}
                className={cn(
                  "min-w-0 truncate text-left",
                  worktree.isCurrent ? "font-medium" : "hover:underline",
                )}
              >
                {branch ?? "detached HEAD"}
              </button>
              <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                {worktree.isMain ? "main checkout" : worktree.path.split("/").at(-1)}
                {worktree.isCurrent ? " · shown" : ""}
                {idleCount > 0 ? ` · ${idleCount} idle` : ""}
              </span>
              {branch && branch !== props.defaultBranch ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  aria-label={`Review ${branch}`}
                  onClick={() => props.onReview(branch)}
                >
                  <PullRequestGlyph.pullRequest aria-hidden />
                  Review
                </Button>
              ) : null}
            </div>
            {active.map((thread) => (
              <ThreadLink key={thread.ref.threadId} thread={thread} />
            ))}
          </li>
        );
      })}
    </ul>
  );
}
