import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "../Sidebar.logic";

/** A thread working in one of the repository's checkouts. */
export interface WorktreeThread {
  readonly ref: ScopedThreadRef;
  readonly title: string;
  readonly status: SidebarThreadStatus;
}

type ThreadInput = Parameters<typeof resolveSidebarThreadStatus>[0] & {
  readonly id: ScopedThreadRef["threadId"];
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly archivedAt: string | null;
};

const STATUS_ORDER: Record<SidebarThreadStatus, number> = {
  approval: 0,
  input: 1,
  failed: 2,
  working: 3,
  monitoring: 4,
  ready: 5,
};

const isInside = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/**
 * Groups the environment's live threads by the worktree they run in: a thread's own worktree,
 * or its project's folder. Threads needing attention come first.
 */
export function groupThreadsByWorktree(input: {
  readonly environmentId: EnvironmentId;
  readonly worktreePaths: ReadonlyArray<string>;
  readonly threads: ReadonlyArray<ThreadInput>;
  readonly projectRoots: ReadonlyMap<string, string>;
}): Map<string, WorktreeThread[]> {
  // Longest first, so a worktree nested inside the main checkout claims its own threads.
  const roots = [...input.worktreePaths].toSorted((left, right) => right.length - left.length);
  const groups = new Map<string, WorktreeThread[]>();
  for (const thread of input.threads) {
    if (thread.environmentId !== input.environmentId || thread.archivedAt !== null) continue;
    const cwd = thread.worktreePath ?? input.projectRoots.get(thread.projectId);
    if (!cwd) continue;
    const root = roots.find((candidate) => isInside(cwd, candidate));
    if (!root) continue;
    const group = groups.get(root) ?? [];
    group.push({
      ref: { environmentId: thread.environmentId, threadId: thread.id },
      title: thread.title,
      status: resolveSidebarThreadStatus(thread),
    });
    groups.set(root, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status]);
  }
  return groups;
}
