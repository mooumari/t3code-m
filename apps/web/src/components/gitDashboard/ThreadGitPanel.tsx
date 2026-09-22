import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import { useCallback } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useProject, useThreadShell } from "~/state/entities";
import { resolveThreadRouteRef } from "~/threadRoutes";
import { Button } from "../ui/button";
import { GitDashboardView } from "./GitDashboardView";

/** The checkout a thread works in: its worktree, or its project's folder. */
function useThreadCheckout(threadRef: ScopedThreadRef | null) {
  const thread = useThreadShell(threadRef);
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  if (!thread || !project) return null;
  return {
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    workspaceRoot: project.workspaceRoot,
    cwd: thread.worktreePath ?? project.workspaceRoot,
  };
}

/** The Git page, scoped to the thread's checkout, as a tab in the thread's right panel. */
export function ThreadGitPanel(props: { readonly threadRef: ScopedThreadRef }) {
  const checkout = useThreadCheckout(props.threadRef);
  const navigate = useNavigate();
  const openFullPage = (cwd: string) => {
    if (!checkout) return;
    void navigate({
      to: "/git",
      search: {
        environmentId: checkout.environmentId,
        projectId: checkout.projectId,
        ...(cwd === checkout.workspaceRoot ? {} : { cwd }),
      },
    });
  };

  if (!checkout) {
    return <p className="p-4 text-muted-foreground text-sm">This thread has no project folder.</p>;
  }
  return (
    <div className="@container/git flex h-full min-h-0 min-w-0 flex-col bg-background">
      <GitDashboardView
        key={`${checkout.environmentId}:${checkout.cwd}`}
        environmentId={checkout.environmentId}
        cwd={checkout.cwd}
        onSelectWorktree={openFullPage}
        actions={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Open the full Git page"
            onClick={() => openFullPage(checkout.cwd)}
          >
            <SquareArrowOutUpRightIcon aria-hidden />
          </Button>
        }
      />
    </div>
  );
}

/** Opens the Git tab beside the thread being viewed; unavailable outside a thread. */
export function useGitPanelLauncher() {
  const threadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const available = useThreadCheckout(threadRef) !== null;
  const open = useCallback(() => {
    if (threadRef) useRightPanelStore.getState().open(threadRef, "git");
  }, [threadRef]);
  return { available, open };
}
