import type {
  EnvironmentId,
  GitDashboardCommit,
  GitDashboardFile,
  GitDashboardGraphResult,
} from "@t3tools/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BotIcon,
  CloudIcon,
  FolderGit2Icon,
  TagIcon,
} from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { gitDashboardEnvironment } from "~/state/gitDashboard";
import { useEnvironmentQuery } from "~/state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { FileRow, shortRelativeFromUnix } from "./gitDashboardShared";
import { layoutGraph, type GraphRow } from "./gitGraphLayout";

const LANE_WIDTH = 12;
const ROW_HEIGHT = 26;
const GRAPH_PADDING = 8;
/** Wider graphs are clipped so commit messages stay readable. */
const MAX_VISIBLE_LANES = 12;
const LANE_COLORS = [
  "#4f9cf9",
  "#c678dd",
  "#e5a042",
  "#3fb950",
  "#f47067",
  "#39c5cf",
  "#d2a8ff",
  "#e3b341",
];
const laneColor = (color: number) => LANE_COLORS[color % LANE_COLORS.length]!;
const laneX = (lane: number) => GRAPH_PADDING + lane * LANE_WIDTH;

/** A vertical S-curve between two lanes, so lane changes read as smooth bends. */
const curve = (fromLane: number, fromY: number, toLane: number, toY: number) => {
  const x1 = laneX(fromLane);
  const x2 = laneX(toLane);
  const middle = (fromY + toY) / 2;
  return x1 === x2
    ? `M ${x1} ${fromY} L ${x2} ${toY}`
    : `M ${x1} ${fromY} C ${x1} ${middle} ${x2} ${middle} ${x2} ${toY}`;
};

function GraphCell(props: {
  readonly row: GraphRow;
  readonly columns: number;
  readonly isHead: boolean;
  readonly isMerge: boolean;
}) {
  const { row } = props;
  const middle = ROW_HEIGHT / 2;
  const dotColor = laneColor(row.color);
  return (
    <svg
      aria-hidden
      width={props.columns * LANE_WIDTH + GRAPH_PADDING}
      height={ROW_HEIGHT}
      className="shrink-0"
    >
      {row.top.map((segment) => (
        <path
          key={`t${segment.from}`}
          d={curve(segment.from, 0, segment.to, middle)}
          stroke={laneColor(segment.color)}
          strokeWidth={1.5}
          fill="none"
        />
      ))}
      {row.bottom.map((segment) => (
        <path
          key={`b${segment.from}-${segment.to}`}
          d={curve(segment.from, middle, segment.to, ROW_HEIGHT)}
          stroke={laneColor(segment.color)}
          strokeWidth={1.5}
          fill="none"
        />
      ))}
      {props.isHead ? (
        // The checked-out commit: a ring with a dot, so it stands out from merges.
        <>
          <circle
            cx={laneX(row.lane)}
            cy={middle}
            r={5}
            fill="var(--background)"
            stroke={dotColor}
            strokeWidth={1.5}
          />
          <circle cx={laneX(row.lane)} cy={middle} r={2} fill={dotColor} />
        </>
      ) : props.isMerge ? (
        <circle
          cx={laneX(row.lane)}
          cy={middle}
          r={3.5}
          fill="var(--background)"
          stroke={dotColor}
          strokeWidth={1.5}
        />
      ) : (
        <circle cx={laneX(row.lane)} cy={middle} r={3.5} fill={dotColor} />
      )}
    </svg>
  );
}

/** Lanes that keep going past an open commit, drawn beside its file list. */
function GraphThrough(props: { readonly row: GraphRow; readonly columns: number }) {
  return (
    <svg
      aria-hidden
      width={props.columns * LANE_WIDTH + GRAPH_PADDING}
      height={ROW_HEIGHT}
      className="shrink-0"
    >
      {props.row.through.map((lane) => (
        <path
          key={lane.lane}
          d={curve(lane.lane, 0, lane.lane, ROW_HEIGHT)}
          stroke={laneColor(lane.color)}
          strokeWidth={1.5}
          fill="none"
        />
      ))}
    </svg>
  );
}

interface RefChip {
  readonly kind: "head" | "local" | "remote" | "tag";
  readonly name: string;
}

/** Turns `git log %D` decorations into labels; `origin/HEAD` only points at another ref. */
function parseRefs(refs: ReadonlyArray<string>, remoteNames: ReadonlySet<string>): RefChip[] {
  const chips: RefChip[] = [];
  for (const ref of refs) {
    if (ref.startsWith("HEAD -> ")) chips.push({ kind: "head", name: ref.slice(8) });
    else if (ref === "HEAD") chips.push({ kind: "head", name: "HEAD" });
    else if (ref.startsWith("tag: ")) chips.push({ kind: "tag", name: ref.slice(5) });
    else if (ref.endsWith("/HEAD")) continue;
    else chips.push({ kind: remoteNames.has(ref) ? "remote" : "local", name: ref });
  }
  return chips;
}

const MAX_CHIPS = 3;

function RefChips(props: {
  readonly chips: ReadonlyArray<RefChip>;
  readonly worktreeBranches: ReadonlyMap<string, string>;
  readonly agentBranches: ReadonlySet<string>;
}) {
  const shown = props.chips.slice(0, MAX_CHIPS);
  const hidden = props.chips.slice(MAX_CHIPS);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shown.map((chip) => {
        // A narrow panel only labels the checked-out branch; the branch picker lists the rest.
        const narrowHidden = chip.kind !== "head";
        const worktreePath =
          chip.kind === "tag" ? undefined : props.worktreeBranches.get(chip.name);
        return (
          <span
            key={`${chip.kind}:${chip.name}`}
            className={cn(narrowHidden && "@max-3xl/git:hidden")}
          >
            <Badge
              size="sm"
              variant={
                chip.kind === "head" ? "info" : chip.kind === "remote" ? "secondary" : "outline"
              }
              title={worktreePath ? `${chip.name} is checked out in ${worktreePath}` : chip.name}
            >
              {chip.kind === "remote" ? <CloudIcon aria-hidden /> : null}
              {chip.kind === "tag" ? <TagIcon aria-hidden /> : null}
              {worktreePath ? <FolderGit2Icon aria-label="worktree" /> : null}
              {chip.kind !== "remote" &&
              chip.kind !== "tag" &&
              props.agentBranches.has(chip.name) ? (
                <BotIcon aria-label="a thread works here" className="text-sky-500" />
              ) : null}
              <span className="max-w-40 truncate">{chip.name}</span>
            </Badge>
          </span>
        );
      })}
      {hidden.length > 0 ? (
        <span className="@max-3xl/git:hidden">
          <Badge size="sm" variant="outline" title={hidden.map((chip) => chip.name).join(", ")}>
            +{hidden.length}
          </Badge>
        </span>
      ) : null}
    </span>
  );
}

export interface GraphSelection {
  readonly sha: string;
  /** A file of the commit, when one is open. */
  readonly path: string | null;
}

export function GitGraph(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly graph: GitDashboardGraphResult;
  readonly headSha: string | null;
  readonly remoteNames: ReadonlySet<string>;
  /** Branch name → path, for branches checked out in another worktree. */
  readonly worktreeBranches: ReadonlyMap<string, string>;
  /** Branches a thread is working on. */
  readonly agentBranches: ReadonlySet<string>;
  readonly selection: GraphSelection | null;
  readonly expanded: ReadonlySet<string>;
  readonly onSelectCommit: (sha: string) => void;
  readonly onSelectFile: (sha: string, file: GitDashboardFile) => void;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
}) {
  const { graph } = props;
  const rows = useMemo(() => layoutGraph(graph.commits), [graph.commits]);
  const columns = Math.min(
    MAX_VISIBLE_LANES,
    rows.reduce((widest, row) => Math.max(widest, row.width), 1),
  );
  const outgoing = useMemo(() => new Set(graph.outgoing), [graph.outgoing]);
  const incoming = useMemo(() => new Set(graph.incoming), [graph.incoming]);

  if (graph.commits.length === 0) {
    return <p className="px-6 py-3 text-muted-foreground text-sm">No commits yet.</p>;
  }

  return (
    <ol className="flex flex-col pb-2">
      {graph.commits.map((commit, index) => (
        <li key={commit.sha}>
          <CommitRow
            commit={commit}
            row={rows[index]!}
            columns={columns}
            isHead={commit.sha === props.headSha}
            direction={
              outgoing.has(commit.sha) ? "outgoing" : incoming.has(commit.sha) ? "incoming" : null
            }
            remoteNames={props.remoteNames}
            worktreeBranches={props.worktreeBranches}
            agentBranches={props.agentBranches}
            selected={props.selection?.sha === commit.sha && props.selection.path === null}
            expanded={props.expanded.has(commit.sha)}
            onSelect={props.onSelectCommit}
          />
          {props.expanded.has(commit.sha) ? (
            <CommitFiles
              environmentId={props.environmentId}
              cwd={props.cwd}
              sha={commit.sha}
              leading={<GraphThrough row={rows[index]!} columns={columns} />}
              selectedPath={props.selection?.sha === commit.sha ? props.selection.path : null}
              onSelectFile={props.onSelectFile}
            />
          ) : null}
        </li>
      ))}
      {graph.hasMore ? (
        <li className="px-6 pt-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
          >
            {props.loadingMore ? <Spinner className="size-3" /> : null}
            Load older commits
          </Button>
        </li>
      ) : null}
    </ol>
  );
}

const CommitRow = memo(function CommitRow(props: {
  readonly commit: GitDashboardCommit;
  readonly row: GraphRow;
  readonly columns: number;
  readonly isHead: boolean;
  readonly direction: "outgoing" | "incoming" | null;
  readonly remoteNames: ReadonlySet<string>;
  readonly worktreeBranches: ReadonlyMap<string, string>;
  readonly agentBranches: ReadonlySet<string>;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly onSelect: (sha: string) => void;
}) {
  const { commit } = props;
  const chips = parseRefs(commit.refs, props.remoteNames);
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      aria-pressed={props.selected}
      onClick={() => props.onSelect(commit.sha)}
      className={cn(
        "flex h-6.5 w-full min-w-0 items-center gap-1.5 pr-3 text-left text-sm [contain-intrinsic-size:auto_26px] [content-visibility:auto] hover:bg-accent/60",
        props.selected && "bg-accent hover:bg-accent",
      )}
    >
      <GraphCell
        row={props.row}
        columns={props.columns}
        isHead={props.isHead}
        isMerge={commit.parents.length > 1}
      />
      <span className={cn("min-w-0 truncate", props.isHead && "font-semibold")}>
        {commit.subject}
      </span>
      {props.direction === "outgoing" ? (
        <ArrowUpIcon
          aria-label="not pushed yet"
          className="size-3 shrink-0 text-success-foreground"
        />
      ) : props.direction === "incoming" ? (
        <ArrowDownIcon
          aria-label="not pulled yet"
          className="size-3 shrink-0 text-warning-foreground"
        />
      ) : null}
      {chips.length > 0 ? (
        <RefChips
          chips={chips}
          worktreeBranches={props.worktreeBranches}
          agentBranches={props.agentBranches}
        />
      ) : null}
      <span className="ml-auto min-w-8 shrink-0 pl-2 text-right text-muted-foreground/70 text-xs tabular-nums">
        {shortRelativeFromUnix(commit.authoredAt)}
      </span>
    </button>
  );
});

function CommitFiles(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly sha: string;
  readonly leading: ReactNode;
  readonly selectedPath: string | null;
  readonly onSelectFile: (sha: string, file: GitDashboardFile) => void;
}) {
  const commitQuery = useEnvironmentQuery(
    gitDashboardEnvironment.commit({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, sha: props.sha },
    }),
  );
  const details = commitQuery.data;
  if (!details) {
    return (
      <div className="flex h-6.5 items-center gap-1.5 text-muted-foreground text-xs">
        {props.leading}
        {commitQuery.error ?? (
          <>
            <Spinner className="size-3" /> Loading files…
          </>
        )}
      </div>
    );
  }
  return (
    <ul>
      {details.files.map((file) => (
        <li key={file.path}>
          <FileRow
            file={file}
            leading={props.leading}
            selected={props.selectedPath === file.path}
            onSelect={() => props.onSelectFile(props.sha, file)}
          />
        </li>
      ))}
      {details.files.length === 0 ? (
        <li className="flex h-6.5 items-center gap-1.5 text-muted-foreground text-xs">
          {props.leading}
          No file changes against the first parent.
        </li>
      ) : null}
    </ul>
  );
}
