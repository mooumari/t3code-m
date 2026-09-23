import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitDashboardDiffArea,
  GitDashboardFile,
  GitDashboardOverviewResult,
} from "@t3tools/contracts";
import { GitBranchIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { gitDashboardEnvironment } from "~/state/gitDashboard";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { useWorktreeThreads, WorktreeList } from "./GitAgents";
import { GitBranchReview, type BranchReview } from "./GitBranchReview";
import { GitCommitBox } from "./GitCommitBox";
import { GitSplitPanes, type GitSplitPane } from "./GitSplitPanes";
import { AheadBehind, FileRow, PaneSection } from "./gitDashboardShared";
import { GitDetailsPane, type DetailSelection } from "./GitDetailsPane";
import { GitGraph } from "./GitGraph";
import { GraphScopePicker, WorktreePicker, type GraphScope } from "./GitRefPickers";

const GRAPH_PAGE_SIZE = 100;

const describeFailure = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
};

const WORKING_TREE_GROUPS: ReadonlyArray<{
  readonly area: Exclude<GitDashboardDiffArea, "commit" | "comparison">;
  readonly label: string;
}> = [
  { area: "conflicted", label: "Merge conflicts" },
  { area: "staged", label: "Staged changes" },
  { area: "unstaged", label: "Changes" },
  { area: "untracked", label: "Untracked" },
];

/** Changes whenever the history the graph draws could have moved. */
const historySignature = (overview: GitDashboardOverviewResult) =>
  [
    overview.head?.sha,
    overview.head?.aheadCount,
    overview.head?.behindCount,
    ...overview.branches.map((branch) => `${branch.name}@${branch.committedAt}`),
    ...overview.remoteBranches.map((branch) => `${branch.name}@${branch.committedAt}`),
  ].join("\n");

export function GitDashboardView(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly onSelectWorktree: (path: string) => void;
  /** Extra toolbar buttons, such as opening the full page from a thread's panel. */
  readonly actions?: ReactNode;
  /**
   * A thread's panel: just changes and the graph, and commits expand in place (like VS Code's
   * Source Control) instead of opening their details.
   */
  readonly compact?: boolean;
}) {
  const { environmentId, cwd } = props;
  const overviewQuery = useEnvironmentQuery(
    gitDashboardEnvironment.overview({ environmentId, input: { cwd } }),
  );
  // The shared status stream already watches this checkout; use its updates as a cheap
  // "something changed" signal so the dashboard reacts faster than its polling interval.
  const statusQuery = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));
  const refreshOverview = overviewQuery.refresh;
  useEffect(() => {
    if (statusQuery.dataUpdatedAt !== null) refreshOverview();
  }, [statusQuery.dataUpdatedAt, refreshOverview]);

  const overview = overviewQuery.data;
  if (overviewQuery.error && !overview) {
    return <p className="p-4 text-destructive-foreground text-sm">{overviewQuery.error}</p>;
  }
  if (!overview) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
        <Spinner className="size-4" /> Reading repository…
      </div>
    );
  }
  if (!overview.isRepo) {
    return (
      <p className="p-4 text-muted-foreground text-sm">
        <span className="font-mono">{cwd}</span> is not a Git repository.
      </p>
    );
  }
  return (
    <RepositoryView
      environmentId={environmentId}
      repoRoot={overview.repoRoot ?? cwd}
      overview={overview}
      onChanged={refreshOverview}
      onSelectWorktree={props.onSelectWorktree}
      actions={props.actions}
      compact={props.compact ?? false}
    />
  );
}

function RepositoryView(props: {
  readonly environmentId: EnvironmentId;
  readonly repoRoot: string;
  readonly overview: GitDashboardOverviewResult;
  /** Called after the dashboard itself changes the repository, such as staging a file. */
  readonly onChanged: () => void;
  readonly onSelectWorktree: (path: string) => void;
  readonly actions?: ReactNode;
  readonly compact: boolean;
}) {
  const { environmentId, repoRoot, overview } = props;
  const head = overview.head;

  const [scope, setScope] = useState<GraphScope>({ kind: "auto" });
  const [limit, setLimit] = useState(GRAPH_PAGE_SIZE);
  const graphInput = (pageLimit: number) => ({
    cwd: repoRoot,
    scope: scope.kind === "branch" ? ("refs" as const) : scope.kind,
    ...(scope.kind === "branch" ? { refs: [scope.name] } : {}),
    limit: pageLimit,
  });
  const graphQuery = useEnvironmentQuery(
    gitDashboardEnvironment.graph({ environmentId, input: graphInput(limit) }),
  );
  // While older commits load, keep showing the page before it instead of flashing empty.
  const previousPageQuery = useEnvironmentQuery(
    limit > GRAPH_PAGE_SIZE
      ? gitDashboardEnvironment.graph({ environmentId, input: graphInput(limit - GRAPH_PAGE_SIZE) })
      : null,
  );
  const graph = graphQuery.data ?? previousPageQuery.data;

  const signature = historySignature(overview);
  const lastSignature = useRef(signature);
  const refreshGraph = graphQuery.refresh;
  const refreshPreviousPage = previousPageQuery.refresh;
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    refreshGraph();
    refreshPreviousPage();
  }, [signature, refreshGraph, refreshPreviousPage]);

  const [selection, setSelection] = useState<DetailSelection | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState({
    changes: true,
    worktrees: true,
    graph: true,
  });
  const [review, setReview] = useState<BranchReview | null>(null);
  const startReview = (branch: string) => {
    setReview({ base: overview.defaultBranch ?? "HEAD", head: branch });
    setSelection(null);
  };

  const worktreeThreads = useWorktreeThreads(environmentId, overview.worktrees);
  const agentBranches = useMemo(
    () => new Set(worktreeThreads.byBranch.keys()),
    [worktreeThreads.byBranch],
  );
  const currentWorktreePath =
    overview.worktrees.find((worktree) => worktree.isCurrent)?.path ?? repoRoot;
  const workingThreadCount = (worktreeThreads.byWorktree.get(currentWorktreePath) ?? []).filter(
    (thread) => thread.status === "working",
  ).length;

  // A working-tree selection is dropped once its file leaves that group (committed, reverted…).
  const visibleSelection =
    selection?.kind === "working-file" &&
    !overview[selection.area].some((file) => file.path === selection.path)
      ? null
      : selection;

  const { compact } = props;
  const onSelectCommit = useCallback(
    (sha: string) => {
      if (!compact) setSelection({ kind: "commit", sha });
      setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(sha)) next.delete(sha);
        else next.add(sha);
        return next;
      });
    },
    [compact],
  );
  const showCommit = useCallback((sha: string) => setSelection({ kind: "commit", sha }), []);
  const onSelectCommitFile = useCallback(
    (sha: string, file: GitDashboardFile) =>
      setSelection({ kind: "commit-file", sha, path: file.path, previousPath: file.previousPath }),
    [],
  );
  const changeScope = (next: GraphScope) => {
    setScope(next);
    setLimit(GRAPH_PAGE_SIZE);
  };

  const remoteNames = useMemo(
    () => new Set(overview.remoteBranches.map((branch) => branch.name)),
    [overview.remoteBranches],
  );
  const worktreeBranches = useMemo(
    () =>
      new Map(
        overview.worktrees.flatMap((worktree) =>
          worktree.branch && !worktree.isCurrent ? [[worktree.branch, worktree.path] as const] : [],
        ),
      ),
    [overview.worktrees],
  );

  const setStagedCommand = useAtomCommand(gitDashboardEnvironment.setStaged, {
    reportFailure: false,
  });
  const onChanged = props.onChanged;
  // No files means every change. A rename needs both paths to move as one.
  const setStaged = async (staged: boolean, files?: ReadonlyArray<GitDashboardFile>) => {
    const paths = files?.flatMap((file) =>
      file.previousPath ? [file.path, file.previousPath] : [file.path],
    );
    const result = await setStagedCommand({
      environmentId,
      input: { cwd: repoRoot, staged, ...(paths ? { paths } : {}) },
    });
    onChanged();
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: staged ? "Couldn't stage" : "Couldn't unstage",
        description: describeFailure(result),
      });
    }
  };
  const stageButton = (staged: boolean, label: string, files?: ReadonlyArray<GitDashboardFile>) => (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      onClick={() => void setStaged(staged, files)}
    >
      {staged ? <PlusIcon aria-hidden /> : <MinusIcon aria-hidden />}
    </Button>
  );

  const groups = WORKING_TREE_GROUPS.filter((group) => overview[group.area].length > 0);
  const changeCount = groups.reduce((total, group) => total + overview[group.area].length, 0);
  const stagedPaths = useMemo(
    () =>
      overview.staged.flatMap((file) =>
        file.previousPath ? [file.path, file.previousPath] : [file.path],
      ),
    [overview.staged],
  );
  const graphSelection =
    visibleSelection?.kind === "commit"
      ? { sha: visibleSelection.sha, path: null }
      : visibleSelection?.kind === "commit-file" || visibleSelection?.kind === "comparison-file"
        ? {
            sha:
              visibleSelection.kind === "commit-file"
                ? visibleSelection.sha
                : visibleSelection.headSha,
            path: visibleSelection.path,
          }
        : null;

  const changesSection = (
    <PaneSection
      title="Changes"
      {...(changeCount > 0 ? { count: changeCount } : { note: "clean" })}
      fill
      open={open.changes}
      onOpenChange={(changes) => setOpen((previous) => ({ ...previous, changes }))}
    >
      <GitCommitBox
        environmentId={environmentId}
        cwd={repoRoot}
        branch={head?.detached ? null : (head?.branch ?? null)}
        hasUpstream={head?.upstream != null}
        changeCount={changeCount}
        stagedPaths={stagedPaths}
        stagedFileCount={overview.staged.length}
        aheadCount={head?.aheadCount ?? 0}
        behindCount={head?.behindCount ?? 0}
        workingThreadCount={workingThreadCount}
      />
      {groups.length === 0 ? null : (
        <div className="flex flex-col pb-2">
          {groups.map((group) => (
            <div key={group.area} className="flex flex-col">
              <div className="flex h-6 items-center gap-1 pr-3 pl-6 text-muted-foreground text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {group.label} · {overview[group.area].length}
                </span>
                {group.area === "staged"
                  ? stageButton(false, "Unstage all")
                  : stageButton(
                      true,
                      `Stage all ${group.label.toLowerCase()}`,
                      overview[group.area],
                    )}
              </div>
              {overview[group.area].map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  actions={
                    group.area === "staged"
                      ? stageButton(false, `Unstage ${file.path}`, [file])
                      : stageButton(true, `Stage ${file.path}`, [file])
                  }
                  selected={
                    visibleSelection?.kind === "working-file" &&
                    visibleSelection.area === group.area &&
                    visibleSelection.path === file.path
                  }
                  onSelect={() =>
                    setSelection({
                      kind: "working-file",
                      area: group.area,
                      path: file.path,
                      previousPath: file.previousPath,
                    })
                  }
                />
              ))}
            </div>
          ))}
          {overview.filesTruncated ? (
            <p className="px-6 pt-1 text-warning-foreground text-xs">
              Too many changed files to list them all.
            </p>
          ) : null}
        </div>
      )}
    </PaneSection>
  );
  const graphSection = (
    <PaneSection
      title="Graph"
      fill
      open={open.graph}
      onOpenChange={(graphOpen) => setOpen((previous) => ({ ...previous, graph: graphOpen }))}
      actions={
        <GraphScopePicker
          scope={scope}
          onScopeChange={changeScope}
          currentBranch={head?.branch ?? null}
          upstream={head?.upstream ?? null}
          branches={overview.branches}
          remoteBranches={overview.remoteBranches}
          agentBranches={agentBranches}
        />
      }
    >
      {graph ? (
        <GitGraph
          environmentId={environmentId}
          cwd={repoRoot}
          graph={graph}
          headSha={head?.sha ?? null}
          remoteNames={remoteNames}
          worktreeBranches={worktreeBranches}
          agentBranches={agentBranches}
          selection={graphSelection}
          expanded={expanded}
          onSelectCommit={onSelectCommit}
          onSelectFile={onSelectCommitFile}
          loadingMore={graphQuery.isPending && graphQuery.data === null}
          onLoadMore={() => setLimit((previous) => previous + GRAPH_PAGE_SIZE)}
        />
      ) : graphQuery.error ? (
        <p className="px-6 pb-2 text-destructive-foreground text-sm">{graphQuery.error}</p>
      ) : (
        <div className="flex items-center gap-2 px-6 pb-2 text-muted-foreground text-sm">
          <Spinner className="size-3.5" /> Loading history…
        </div>
      )}
    </PaneSection>
  );

  const panes: GitSplitPane[] = [
    {
      id: "changes",
      label: "changes",
      open: open.changes,
      defaultWeight: compact ? 7 : 4,
      node: changesSection,
    },
  ];
  // Only worth the space once agents work in separate checkouts.
  if (!compact && overview.worktrees.length > 1) {
    panes.push({
      id: "worktrees",
      label: "worktrees",
      open: open.worktrees,
      defaultWeight: 2,
      node: (
        <PaneSection
          fill
          title="Worktrees"
          count={overview.worktrees.length}
          open={open.worktrees}
          onOpenChange={(worktrees) => setOpen((previous) => ({ ...previous, worktrees }))}
        >
          <WorktreeList
            worktrees={overview.worktrees}
            threadsByWorktree={worktreeThreads.byWorktree}
            defaultBranch={overview.defaultBranch}
            onSelectWorktree={props.onSelectWorktree}
            onReview={startReview}
          />
        </PaneSection>
      ),
    });
  }
  panes.push({
    id: "graph",
    label: "graph",
    open: open.graph,
    defaultWeight: compact ? 3 : 4,
    node: graphSection,
  });

  // Side by side when wide; when narrow (a thread's panel), the lists and the details take turns.
  return (
    <div className="flex min-h-0 flex-1 flex-col @3xl/git:flex-row">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col @3xl/git:w-[clamp(24rem,42%,40rem)] @3xl/git:flex-none @3xl/git:border-border/70 @3xl/git:border-r",
          visibleSelection && "@max-3xl/git:hidden",
        )}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1 border-border/70 border-b px-2 py-1.5">
          {overview.worktrees.length > 1 ? (
            <WorktreePicker worktrees={overview.worktrees} onSelect={props.onSelectWorktree} />
          ) : null}
          <span className="flex min-w-0 items-center gap-1.5 px-2 text-sm">
            <GitBranchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">
              {head?.detached ? "Detached HEAD" : (head?.branch ?? "No branch")}
            </span>
            {head?.upstream ? (
              <span className="truncate text-muted-foreground text-xs">{head.upstream}</span>
            ) : (
              <span className="text-muted-foreground text-xs">not published</span>
            )}
            <AheadBehind ahead={head?.aheadCount ?? 0} behind={head?.behindCount ?? 0} />
          </span>
          <span className="ml-auto flex min-w-0 max-w-full items-center gap-1">
            <span className="min-w-0 px-2 font-mono text-muted-foreground text-xs @max-3xl/git:hidden">
              <MiddleTruncate value={repoRoot} />
            </span>
            {head?.branch && !review ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => startReview(head.branch ?? "HEAD")}
              >
                <PullRequestGlyph.pullRequest aria-hidden />
                Review
              </Button>
            ) : null}
            {props.actions}
          </span>
        </div>
        {review ? (
          <GitBranchReview
            environmentId={environmentId}
            cwd={repoRoot}
            review={review}
            onReviewChange={(next) => {
              setReview(next);
              setSelection(null);
            }}
            onClose={() => {
              setReview(null);
              setSelection(null);
            }}
            branches={overview.branches}
            remoteBranches={overview.remoteBranches}
            agentBranches={agentBranches}
            historySignature={signature}
            selectedSha={graphSelection?.sha ?? null}
            selectedPath={graphSelection?.path ?? null}
            onSelectCommit={showCommit}
            onSelectFile={(comparison, file) =>
              setSelection({
                kind: "comparison-file",
                base: comparison.base,
                head: comparison.head,
                baseSha: comparison.baseSha,
                headSha: comparison.headSha,
                path: file.path,
                previousPath: file.previousPath,
              })
            }
          />
        ) : (
          <GitSplitPanes
            storageKey={compact ? "t3code:git-panel:pane-weights" : "t3code:git-page:pane-weights"}
            panes={panes}
          />
        )}
      </div>
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto",
          !visibleSelection && "@max-3xl/git:hidden",
        )}
      >
        <GitDetailsPane
          environmentId={environmentId}
          cwd={repoRoot}
          selection={visibleSelection}
          onSelectCommit={showCommit}
          onSelectCommitFile={onSelectCommitFile}
          onBack={() => setSelection(null)}
        />
      </div>
    </div>
  );
}
