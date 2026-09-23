import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { useMemo } from "react";

import { GitDashboardView } from "../components/gitDashboard/GitDashboardView";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { Button } from "../components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../components/ui/menu";
import { RefreshIcon } from "../components/ui/refresh-icon";
import { SidebarInset } from "../components/ui/sidebar";
import { isElectron } from "../env";
import { useProjects } from "../state/entities";
import { gitDashboardEnvironment } from "../state/gitDashboard";
import { useEnvironmentQuery } from "../state/query";

interface GitDashboardSearch {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  /** A worktree of the project; defaults to the project's workspace root. */
  readonly cwd?: string;
}

export const Route = createFileRoute("/_chat/git")({
  validateSearch: (raw: Record<string, unknown>): GitDashboardSearch => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.cwd === "string" && raw.cwd ? { cwd: raw.cwd.slice(0, 4096) } : {}),
  }),
  component: GitDashboardRouteView,
});

const projectKey = (project: { environmentId: string; id: string }) =>
  `${project.environmentId}\u0000${project.id}`;

function GitDashboardRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const projects = useProjects();
  const project = useMemo(
    () =>
      projects.find(
        (candidate) =>
          candidate.id === search.projectId &&
          (search.environmentId === undefined || candidate.environmentId === search.environmentId),
      ) ??
      projects[0] ??
      null,
    [projects, search.environmentId, search.projectId],
  );
  const cwd = search.cwd ?? project?.workspaceRoot ?? null;

  const overviewQuery = useEnvironmentQuery(
    project && cwd
      ? gitDashboardEnvironment.overview({ environmentId: project.environmentId, input: { cwd } })
      : null,
  );

  const selectProject = (key: string) => {
    const next = projects.find((candidate) => projectKey(candidate) === key);
    if (!next) return;
    void navigate({ search: { environmentId: next.environmentId, projectId: next.id } });
  };
  const selectWorktree = (path: string) => {
    if (!project) return;
    void navigate({
      search: {
        environmentId: project.environmentId,
        projectId: project.id,
        ...(path === project.workspaceRoot ? {} : { cwd: path }),
      },
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="@container/git flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel="Git breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Git</h1>
            </WorkspaceBreadcrumbItem>
            {project ? (
              <>
                <WorkspaceBreadcrumbSeparator />
                <WorkspaceBreadcrumbItem className="min-w-0">
                  <Menu>
                    <MenuTrigger
                      aria-label="Choose project"
                      render={
                        <Button
                          variant="ghost-muted"
                          size="xs"
                          className="min-w-0 [-webkit-app-region:no-drag]"
                        />
                      }
                    >
                      <span className="truncate">{project.title}</span>
                      <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
                    </MenuTrigger>
                    <MenuPopup align="start" side="bottom">
                      <MenuRadioGroup value={projectKey(project)} onValueChange={selectProject}>
                        {projects.map((candidate) => (
                          <MenuRadioItem key={projectKey(candidate)} value={projectKey(candidate)}>
                            {candidate.title}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuPopup>
                  </Menu>
                </WorkspaceBreadcrumbItem>
              </>
            ) : null}
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {project && cwd ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh"
              className="[-webkit-app-region:no-drag]"
              onClick={() => overviewQuery.refresh()}
            >
              <RefreshIcon refreshing={overviewQuery.isPending} />
            </Button>
          ) : null}
        </WorkspacePageHeader>

        {project && cwd ? (
          <GitDashboardView
            key={`${project.environmentId}:${cwd}`}
            environmentId={project.environmentId}
            cwd={cwd}
            onSelectWorktree={selectWorktree}
          />
        ) : (
          <p className="p-4 text-muted-foreground text-sm">Add a project to see its Git state.</p>
        )}
      </div>
    </SidebarInset>
  );
}
