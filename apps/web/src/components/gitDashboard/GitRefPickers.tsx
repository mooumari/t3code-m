import type {
  GitDashboardBranch,
  GitDashboardRemoteBranch,
  GitDashboardWorktree,
} from "@t3tools/contracts";
import {
  BotIcon,
  ChevronDownIcon,
  CloudIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LockIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { AheadBehind, relativeFromUnix } from "./gitDashboardShared";

/** What the graph shows: the current branch and its upstream, everything, or one branch. */
export type GraphScope =
  | { readonly kind: "auto" }
  | { readonly kind: "all" }
  | { readonly kind: "branch"; readonly name: string };

/** Enough to find any branch by typing; the search narrows past it. */
const MAX_LISTED_BRANCHES = 60;

export function describeScope(scope: GraphScope, currentBranch: string | null) {
  if (scope.kind === "all") return "All branches";
  if (scope.kind === "branch") return scope.name;
  return currentBranch ?? "HEAD";
}

export function GraphScopePicker(props: {
  readonly scope: GraphScope;
  readonly onScopeChange: (scope: GraphScope) => void;
  readonly currentBranch: string | null;
  readonly upstream: string | null;
  readonly branches: ReadonlyArray<GitDashboardBranch>;
  readonly remoteBranches: ReadonlyArray<GitDashboardRemoteBranch>;
  readonly agentBranches: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const choose = (scope: GraphScope) => {
    props.onScopeChange(scope);
    setOpen(false);
    setQuery("");
  };
  const isChosen = (scope: GraphScope) =>
    scope.kind === props.scope.kind &&
    (scope.kind !== "branch" || (props.scope.kind === "branch" && props.scope.name === scope.name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" size="xs" variant="ghost" aria-label="Choose branches to show" />
        }
      >
        <GitBranchIcon aria-hidden className="size-3.5" />
        <span className="max-w-48 truncate">{describeScope(props.scope, props.currentBranch)}</span>
        {props.scope.kind === "auto" && props.upstream ? (
          <span className="max-w-32 truncate text-muted-foreground">+ {props.upstream}</span>
        ) : null}
        <ChevronDownIcon aria-hidden className="size-3" />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" width="md">
        <div className="flex max-h-[min(32rem,70vh)] flex-col gap-2">
          <Input
            autoFocus
            aria-label="Search branches"
            placeholder="Search branches"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="-mx-1 min-h-0 overflow-y-auto">
            {needle.length === 0 ? (
              <PickerGroup label="Show">
                <PickerItem
                  chosen={isChosen({ kind: "auto" })}
                  onClick={() => choose({ kind: "auto" })}
                  title="Current branch"
                  detail={
                    props.upstream
                      ? `${props.currentBranch ?? "HEAD"} and ${props.upstream}`
                      : (props.currentBranch ?? "HEAD")
                  }
                />
                <PickerItem
                  chosen={isChosen({ kind: "all" })}
                  onClick={() => choose({ kind: "all" })}
                  title="All branches"
                  detail={`${props.branches.length} local, ${props.remoteBranches.length} remote`}
                />
              </PickerGroup>
            ) : null}
            <BranchLists
              needle={needle}
              branches={props.branches}
              remoteBranches={props.remoteBranches}
              agentBranches={props.agentBranches}
              isChosen={(name) => isChosen({ kind: "branch", name })}
              onChoose={(name) => choose({ kind: "branch", name })}
            />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** One branch to compare, such as the base of a review. */
export function BranchPicker(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (name: string) => void;
  readonly branches: ReadonlyArray<GitDashboardBranch>;
  readonly remoteBranches: ReadonlyArray<GitDashboardRemoteBranch>;
  readonly agentBranches: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const choose = (name: string) => {
    props.onChange(name);
    setOpen(false);
    setQuery("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" size="xs" variant="outline" aria-label={props.label} />}
      >
        <GitBranchIcon aria-hidden className="size-3.5" />
        <span className="max-w-40 truncate">{props.value}</span>
        <ChevronDownIcon aria-hidden className="size-3" />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" width="md">
        <div className="flex max-h-[min(32rem,70vh)] flex-col gap-2">
          <Input
            autoFocus
            aria-label="Search branches"
            placeholder="Search branches"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="-mx-1 min-h-0 overflow-y-auto">
            <BranchLists
              needle={query.trim().toLowerCase()}
              branches={props.branches}
              remoteBranches={props.remoteBranches}
              agentBranches={props.agentBranches}
              isChosen={(name) => name === props.value}
              onChoose={choose}
            />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function BranchLists(props: {
  readonly needle: string;
  readonly branches: ReadonlyArray<GitDashboardBranch>;
  readonly remoteBranches: ReadonlyArray<GitDashboardRemoteBranch>;
  /** Branches a thread is working on. */
  readonly agentBranches: ReadonlySet<string>;
  readonly isChosen: (name: string) => boolean;
  readonly onChoose: (name: string) => void;
}) {
  const matches = (name: string) =>
    props.needle.length === 0 || name.toLowerCase().includes(props.needle);
  const local = props.branches.filter((branch) => matches(branch.name));
  const remote = props.remoteBranches.filter((branch) => matches(branch.name));
  return (
    <>
      <PickerGroup label="Local" count={local.length}>
        {local.slice(0, MAX_LISTED_BRANCHES).map((branch) => (
          <PickerItem
            key={branch.name}
            chosen={props.isChosen(branch.name)}
            onClick={() => props.onChoose(branch.name)}
            title={branch.name}
            badges={
              <>
                {branch.isCurrent ? (
                  <Badge size="sm" variant="info">
                    HEAD
                  </Badge>
                ) : null}
                {branch.worktreePath && !branch.isCurrent ? (
                  <FolderGit2Icon
                    aria-label="checked out in a worktree"
                    className="size-3 text-muted-foreground"
                  />
                ) : null}
                {props.agentBranches.has(branch.name) ? (
                  <BotIcon aria-label="a thread works here" className="size-3 text-sky-500" />
                ) : null}
                <AheadBehind ahead={branch.aheadCount} behind={branch.behindCount} />
              </>
            }
            detail={relativeFromUnix(branch.committedAt)}
          />
        ))}
      </PickerGroup>
      <PickerGroup label="Remote" count={remote.length}>
        {remote.slice(0, MAX_LISTED_BRANCHES).map((branch) => (
          <PickerItem
            key={branch.name}
            chosen={props.isChosen(branch.name)}
            onClick={() => props.onChoose(branch.name)}
            title={branch.name}
            badges={<CloudIcon aria-hidden className="size-3 text-muted-foreground" />}
            detail={relativeFromUnix(branch.committedAt)}
          />
        ))}
      </PickerGroup>
    </>
  );
}

function PickerGroup(props: {
  readonly label: string;
  readonly count?: number;
  readonly children: ReactNode;
}) {
  if (props.count === 0) return null;
  return (
    <div className="flex flex-col pb-1">
      <div className="px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs">
        {props.label}
        {props.count !== undefined && props.count > MAX_LISTED_BRANCHES ? (
          <span className="font-normal">
            {" "}
            · {MAX_LISTED_BRANCHES} of {props.count}, search to narrow
          </span>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}

function PickerItem(props: {
  readonly title: string;
  readonly detail?: string;
  readonly badges?: ReactNode;
  readonly chosen: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.chosen}
      onClick={props.onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent",
        props.chosen && "bg-accent/70",
      )}
    >
      <span className="min-w-0 truncate">{props.title}</span>
      {props.badges}
      {props.detail ? (
        <span className="ml-auto shrink-0 pl-2 text-muted-foreground text-xs">{props.detail}</span>
      ) : null}
    </button>
  );
}

export function WorktreePicker(props: {
  readonly worktrees: ReadonlyArray<GitDashboardWorktree>;
  readonly onSelect: (path: string) => void;
}) {
  const current = props.worktrees.find((worktree) => worktree.isCurrent);
  if (!current) return null;
  const label = (worktree: GitDashboardWorktree) =>
    worktree.detached ? "detached HEAD" : (worktree.branch ?? "—");
  return (
    <Menu>
      <MenuTrigger
        aria-label="Choose worktree"
        render={
          <Button type="button" size="xs" variant="ghost" disabled={props.worktrees.length < 2} />
        }
      >
        <FolderGit2Icon aria-hidden className="size-3.5" />
        <span className="max-w-40 truncate">
          {current.isMain ? "Main worktree" : current.path.split("/").at(-1)}
        </span>
        {props.worktrees.length > 1 ? (
          <>
            <span className="text-muted-foreground tabular-nums">{props.worktrees.length}</span>
            <ChevronDownIcon aria-hidden className="size-3" />
          </>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuRadioGroup value={current.path} onValueChange={(path) => props.onSelect(path)}>
          {props.worktrees.map((worktree) => (
            <MenuRadioItem key={worktree.path} value={worktree.path}>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{label(worktree)}</span>
                  {worktree.isMain ? (
                    <Badge size="sm" variant="secondary">
                      main
                    </Badge>
                  ) : null}
                  {worktree.locked ? <LockIcon aria-label="locked" className="size-3" /> : null}
                  {worktree.prunable ? (
                    <Badge size="sm" variant="warning">
                      missing
                    </Badge>
                  ) : null}
                </span>
                <span className="truncate font-mono text-muted-foreground text-xs">
                  {worktree.path}
                </span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
