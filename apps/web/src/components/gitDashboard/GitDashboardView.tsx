import type {
  EnvironmentId,
  GitDashboardBranch,
  GitDashboardCommit,
  GitDashboardDiffArea,
  GitDashboardFile,
  GitDashboardFileChange,
  GitDashboardOverviewResult,
  GitDashboardWorktree,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  LockIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { gitDashboardEnvironment } from "~/state/gitDashboard";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Badge } from "../ui/badge";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Spinner } from "../ui/spinner";
import { GitDashboardDiff } from "./GitDashboardDiff";

interface SelectedFile {
  readonly area: GitDashboardDiffArea;
  readonly path: string;
  readonly previousPath: string | null;
}

const CHANGE_LETTER: Record<GitDashboardFileChange, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "U",
  conflicted: "!",
};

const CHANGE_TONE: Record<GitDashboardFileChange, string> = {
  modified: "text-warning-foreground",
  added: "text-success-foreground",
  deleted: "text-destructive-foreground",
  renamed: "text-info-foreground",
  copied: "text-info-foreground",
  "type-changed": "text-warning-foreground",
  untracked: "text-success-foreground",
  conflicted: "text-destructive-foreground",
};

const relativeFromUnix = (seconds: number | null) =>
  seconds === null ? "" : formatRelativeTimeLabel(new Date(seconds * 1000).toISOString());

export function GitDashboardView(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly onSelectWorktree: (path: string) => void;
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

  const [selection, setSelected] = useState<SelectedFile | null>(null);
  const overview = overviewQuery.data;
  // A selection is dropped once its file leaves that bucket (committed, staged, reverted…).
  const selected =
    selection && overview?.[selection.area].some((file) => file.path === selection.path)
      ? selection
      : null;

  if (overviewQuery.error && !overview) {
    return <p className="text-destructive-foreground text-sm">{overviewQuery.error}</p>;
  }
  if (!overview) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner className="size-4" /> Reading repository…
      </div>
    );
  }
  if (!overview.isRepo) {
    return (
      <p className="text-muted-foreground text-sm">
        <span className="font-mono">{cwd}</span> is not a Git repository.
      </p>
    );
  }

  const repoRoot = overview.repoRoot ?? cwd;
  return (
    <div className="flex flex-col gap-5">
      <HeadSummary overview={overview} />
      <div className="grid gap-5 @4xl/git:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          <WorkingTree overview={overview} selected={selected} onSelect={setSelected} />
          {selected ? (
            <Section
              icon={GitCommitHorizontalIcon}
              title={selected.path}
              subtitle={`${selected.area} changes`}
            >
              <GitDashboardDiff
                environmentId={environmentId}
                input={{
                  cwd: repoRoot,
                  path: selected.path,
                  previousPath: selected.previousPath,
                  area: selected.area,
                }}
              />
            </Section>
          ) : null}
          <Commits commits={overview.commits} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Worktrees worktrees={overview.worktrees} onSelect={props.onSelectWorktree} />
          <Branches branches={overview.branches} />
          {overview.stashes.length > 0 ? (
            <Section icon={ArchiveIcon} title="Stashes" count={overview.stashes.length}>
              <ul className="flex flex-col">
                {overview.stashes.map((stash) => (
                  <li key={stash.ref} className="flex gap-2 px-3 py-1.5 text-sm">
                    <span className="shrink-0 font-mono text-muted-foreground text-xs leading-5">
                      {stash.ref}
                    </span>
                    <span className="min-w-0 truncate">{stash.subject}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section(props: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subtitle?: string;
  readonly count?: number;
  readonly children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-card">
      <header className="flex items-center gap-2 border-border/60 border-b px-3 py-2">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 truncate font-medium text-sm">{props.title}</h2>
        {props.count !== undefined ? (
          <span className="text-muted-foreground text-xs tabular-nums">{props.count}</span>
        ) : null}
        {props.subtitle ? (
          <span className="ml-auto shrink-0 text-muted-foreground text-xs">{props.subtitle}</span>
        ) : null}
      </header>
      <div className="min-w-0">{props.children}</div>
    </section>
  );
}

function HeadSummary({ overview }: { readonly overview: GitDashboardOverviewResult }) {
  const head = overview.head;
  const changeCount =
    overview.staged.length +
    overview.unstaged.length +
    overview.untracked.length +
    overview.conflicted.length;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/70 bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">
          {head?.detached ? "Detached HEAD" : (head?.branch ?? "No branch")}
        </span>
        {head?.sha ? (
          <span className="font-mono text-muted-foreground text-xs">{head.sha.slice(0, 8)}</span>
        ) : null}
      </div>
      {head?.upstream ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <span className="truncate">{head.upstream}</span>
          <AheadBehind ahead={head.aheadCount} behind={head.behindCount} />
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">No upstream</span>
      )}
      <span className="text-muted-foreground text-sm">
        {changeCount === 0 ? "Working tree clean" : `${changeCount} changed files`}
      </span>
      <span className="ml-auto min-w-0 max-w-full font-mono text-muted-foreground text-xs">
        <MiddleTruncate value={overview.repoRoot ?? ""} />
      </span>
    </div>
  );
}

function AheadBehind(props: { readonly ahead: number; readonly behind: number }) {
  if (props.ahead === 0 && props.behind === 0) {
    return <span className="text-xs">up to date</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs tabular-nums">
      {props.ahead > 0 ? (
        <span className="flex items-center gap-0.5 text-success-foreground">
          <ArrowUpIcon aria-label="ahead" className="size-3" />
          {props.ahead}
        </span>
      ) : null}
      {props.behind > 0 ? (
        <span className="flex items-center gap-0.5 text-warning-foreground">
          <ArrowDownIcon aria-label="behind" className="size-3" />
          {props.behind}
        </span>
      ) : null}
    </span>
  );
}

const WORKING_TREE_GROUPS: ReadonlyArray<{
  readonly area: GitDashboardDiffArea;
  readonly label: string;
}> = [
  { area: "conflicted", label: "Conflicts" },
  { area: "staged", label: "Staged" },
  { area: "unstaged", label: "Not staged" },
  { area: "untracked", label: "Untracked" },
];

function WorkingTree(props: {
  readonly overview: GitDashboardOverviewResult;
  readonly selected: SelectedFile | null;
  readonly onSelect: (file: SelectedFile) => void;
}) {
  const groups = WORKING_TREE_GROUPS.filter((group) => props.overview[group.area].length > 0);
  return (
    <Section icon={FolderGit2Icon} title="Working tree">
      {groups.length === 0 ? (
        <p className="px-3 py-4 text-muted-foreground text-sm">Nothing to commit.</p>
      ) : (
        <div className="flex flex-col py-1">
          {groups.map((group) => (
            <FileGroup
              key={group.area}
              area={group.area}
              label={group.label}
              files={props.overview[group.area]}
              selected={props.selected}
              onSelect={props.onSelect}
            />
          ))}
          {props.overview.filesTruncated ? (
            <p className="px-3 py-2 text-warning-foreground text-xs">
              Too many changed files to list them all.
            </p>
          ) : null}
        </div>
      )}
    </Section>
  );
}

function FileGroup(props: {
  readonly area: GitDashboardDiffArea;
  readonly label: string;
  readonly files: ReadonlyArray<GitDashboardFile>;
  readonly selected: SelectedFile | null;
  readonly onSelect: (file: SelectedFile) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-muted-foreground text-xs">
        <span className="font-medium">{props.label}</span>
        <span className="tabular-nums">{props.files.length}</span>
      </div>
      <ul className="flex flex-col">
        {props.files.map((file) => {
          const isSelected =
            props.selected?.area === props.area && props.selected.path === file.path;
          return (
            <li key={file.path}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() =>
                  props.onSelect({
                    area: props.area,
                    path: file.path,
                    previousPath: file.previousPath,
                  })
                }
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left text-sm hover:bg-accent/60",
                  isSelected && "bg-accent",
                )}
              >
                <span
                  className={cn(
                    "w-3 shrink-0 text-center font-mono font-semibold text-xs",
                    CHANGE_TONE[file.change],
                  )}
                  aria-label={file.change}
                >
                  {CHANGE_LETTER[file.change]}
                </span>
                <span className="min-w-0 font-mono text-xs">
                  <MiddleTruncate value={file.path} />
                </span>
                {file.previousPath ? (
                  <span className="min-w-0 shrink truncate text-muted-foreground text-xs">
                    from {file.previousPath}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Worktrees(props: {
  readonly worktrees: ReadonlyArray<GitDashboardWorktree>;
  readonly onSelect: (path: string) => void;
}) {
  return (
    <Section icon={FolderGit2Icon} title="Worktrees" count={props.worktrees.length}>
      <ul className="flex flex-col py-1">
        {props.worktrees.map((worktree) => (
          <li key={worktree.path}>
            <button
              type="button"
              disabled={worktree.isCurrent}
              onClick={() => props.onSelect(worktree.path)}
              aria-label={
                worktree.isCurrent ? "Currently viewing this worktree" : "View this worktree"
              }
              className={cn(
                "flex w-full min-w-0 flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-accent/60 disabled:cursor-default",
                worktree.isCurrent && "bg-accent/50 hover:bg-accent/50",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                <span className="truncate font-medium">
                  {worktree.detached ? "detached" : (worktree.branch ?? "—")}
                </span>
                {worktree.isMain ? (
                  <Badge size="sm" variant="secondary">
                    main
                  </Badge>
                ) : null}
                {worktree.isCurrent ? (
                  <Badge size="sm" variant="info">
                    viewing
                  </Badge>
                ) : null}
                {worktree.locked ? (
                  <LockIcon aria-label="locked" className="size-3 text-muted-foreground" />
                ) : null}
                {worktree.prunable ? (
                  <Badge size="sm" variant="warning">
                    missing
                  </Badge>
                ) : null}
              </span>
              <span className="min-w-0 font-mono text-muted-foreground text-xs">
                <MiddleTruncate value={worktree.path} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Branches({ branches }: { readonly branches: ReadonlyArray<GitDashboardBranch> }) {
  return (
    <Section icon={GitBranchIcon} title="Branches" count={branches.length}>
      <ul className="flex max-h-96 flex-col overflow-y-auto py-1">
        {branches.map((branch) => (
          <li key={branch.name} className="flex min-w-0 flex-col gap-0.5 px-3 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className={cn("truncate", branch.isCurrent && "font-semibold")}>
                {branch.name}
              </span>
              {branch.isCurrent ? (
                <Badge size="sm" variant="info">
                  HEAD
                </Badge>
              ) : null}
              {branch.worktreePath && !branch.isCurrent ? (
                <Badge size="sm" variant="secondary">
                  worktree
                </Badge>
              ) : null}
              <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                {relativeFromUnix(branch.committedAt)}
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
              {branch.upstreamGone ? (
                <span className="text-warning-foreground">upstream gone</span>
              ) : branch.upstream ? (
                <>
                  <span className="truncate">{branch.upstream}</span>
                  <AheadBehind ahead={branch.aheadCount} behind={branch.behindCount} />
                </>
              ) : (
                <span>local only</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Commits({ commits }: { readonly commits: ReadonlyArray<GitDashboardCommit> }) {
  return (
    <Section icon={GitCommitHorizontalIcon} title="Recent commits" count={commits.length}>
      {commits.length === 0 ? (
        <p className="px-3 py-4 text-muted-foreground text-sm">No commits yet.</p>
      ) : (
        <ul className="flex flex-col py-1">
          {commits.map((commit) => (
            <li key={commit.sha} className="flex min-w-0 items-baseline gap-3 px-3 py-1.5">
              <span className="shrink-0 font-mono text-muted-foreground text-xs">
                {commit.shortSha}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5 text-sm">
                  <span className="truncate">{commit.subject}</span>
                  {commit.refs.map((ref) => (
                    <Badge
                      key={ref}
                      size="sm"
                      variant={ref.startsWith("HEAD") ? "info" : "outline"}
                    >
                      {ref}
                    </Badge>
                  ))}
                </span>
                <span className="text-muted-foreground text-xs">
                  {commit.authorName} · {relativeFromUnix(commit.authoredAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
