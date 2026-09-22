import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";

import { useThreadShell } from "../../state/entities";
import { resolveThreadRouteRef } from "../../threadRoutes";

/** Opens the Git dashboard on the project (and worktree) of the thread being viewed, if any. */
export function useOpenGitDashboard() {
  const navigate = useNavigate();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThread = useThreadShell(routeThreadRef);

  return useCallback(() => {
    void navigate({
      to: "/git",
      search: activeThread
        ? {
            environmentId: activeThread.environmentId,
            projectId: activeThread.projectId,
            ...(activeThread.worktreePath ? { cwd: activeThread.worktreePath } : {}),
          }
        : {},
    });
  }, [activeThread, navigate]);
}
