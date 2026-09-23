import type { GitDashboardFile, GitDashboardFileChange } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

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

export const relativeFromUnix = (seconds: number | null) =>
  seconds === null ? "" : formatRelativeTimeLabel(new Date(seconds * 1000).toISOString());

export function AheadBehind(props: { readonly ahead: number; readonly behind: number }) {
  if (props.ahead === 0 && props.behind === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
      {props.ahead > 0 ? (
        <span className="flex items-center gap-0.5 text-success-foreground">
          <ArrowUpIcon aria-label="to push" className="size-3" />
          {props.ahead}
        </span>
      ) : null}
      {props.behind > 0 ? (
        <span className="flex items-center gap-0.5 text-warning-foreground">
          <ArrowDownIcon aria-label="to pull" className="size-3" />
          {props.behind}
        </span>
      ) : null}
    </span>
  );
}

/** A collapsible pane section with a sticky header, like VS Code's Source Control views. */
export function PaneSection(props: {
  readonly title: string;
  readonly count?: number;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const Chevron = props.open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <section className="flex min-w-0 flex-col">
      <header className="sticky top-0 z-10 flex h-8 items-center gap-1 bg-background pr-2">
        <button
          type="button"
          aria-expanded={props.open}
          onClick={() => props.onOpenChange(!props.open)}
          className="flex h-full min-w-0 flex-1 items-center gap-1 pl-1.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide hover:text-foreground"
        >
          <Chevron aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{props.title}</span>
          {props.count !== undefined ? (
            <span className="ml-1 rounded-full bg-muted px-1.5 font-normal tabular-nums normal-case tracking-normal">
              {props.count}
            </span>
          ) : null}
        </button>
        {props.actions}
      </header>
      {props.open ? props.children : null}
    </section>
  );
}

const splitPath = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { name: path, directory: "" }
    : { name: path.slice(slash + 1), directory: path.slice(0, slash) };
};

/** A changed file: name first, its folder dimmed after it, the change letter on the right. */
export function FileRow(props: {
  readonly file: GitDashboardFile;
  readonly selected: boolean;
  readonly onSelect: () => void;
  /** Drawn before the name, such as graph lanes continuing past an open commit. */
  readonly leading?: ReactNode;
}) {
  const { name, directory } = splitPath(props.file.path);
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      className={cn(
        "flex h-6.5 w-full min-w-0 items-center gap-1.5 pr-3 text-left text-sm hover:bg-accent/60",
        props.leading ? "pl-0" : "pl-6",
        props.selected && "bg-accent hover:bg-accent",
      )}
    >
      {props.leading}
      <span className="shrink-0 truncate">{name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
        {props.file.previousPath ? `${directory} ← ${props.file.previousPath}` : directory}
      </span>
      <span
        aria-label={props.file.change}
        className={cn(
          "w-3 shrink-0 text-center font-mono font-semibold text-xs",
          CHANGE_TONE[props.file.change],
        )}
      >
        {CHANGE_LETTER[props.file.change]}
      </span>
    </button>
  );
}
