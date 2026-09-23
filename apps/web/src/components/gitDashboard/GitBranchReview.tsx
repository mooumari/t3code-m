import type {
  EnvironmentId,
  GitDashboardBranch,
  GitDashboardComparison,
  GitDashboardFile,
  GitDashboardRemoteBranch,
} from "@t3tools/contracts";
import { ArrowLeftRightIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { gitDashboardEnvironment } from "~/state/gitDashboard";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { FileRow, PaneSection, relativeFromUnix } from "./gitDashboardShared";
import { BranchPicker } from "./GitRefPickers";

export interface BranchReview {
  readonly base: string;
  readonly head: string;
}

/** What a branch adds on top of its base, like a pull request: its commits and changed files. */
export function GitBranchReview(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly review: BranchReview;
  readonly onReviewChange: (review: BranchReview) => void;
  readonly onClose: () => void;
  readonly branches: ReadonlyArray<GitDashboardBranch>;
  readonly remoteBranches: ReadonlyArray<GitDashboardRemoteBranch>;
  readonly agentBranches: ReadonlySet<string>;
  /** Changes when history may have moved, to re-run the comparison. */
  readonly historySignature: string;
  readonly selectedSha: string | null;
  readonly selectedPath: string | null;
  readonly onSelectCommit: (sha: string) => void;
  readonly onSelectFile: (comparison: GitDashboardComparison, file: GitDashboardFile) => void;
}) {
  const { review } = props;
  const comparisonQuery = useEnvironmentQuery(
    gitDashboardEnvironment.comparison({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, base: review.base, head: review.head },
    }),
  );
  const lastSignature = useRef(props.historySignature);
  const refresh = comparisonQuery.refresh;
  useEffect(() => {
    if (lastSignature.current === props.historySignature) return;
    lastSignature.current = props.historySignature;
    refresh();
  }, [props.historySignature, refresh]);

  const [open, setOpen] = useState({ commits: true, files: true });
  const comparison = comparisonQuery.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-border/70 border-b px-2 py-1.5">
        <BranchPicker
          label="Branch to review"
          value={review.head}
          onChange={(head) => props.onReviewChange({ ...review, head })}
          branches={props.branches}
          remoteBranches={props.remoteBranches}
          agentBranches={props.agentBranches}
        />
        <span className="px-0.5 text-muted-foreground text-xs">into</span>
        <BranchPicker
          label="Base branch"
          value={review.base}
          onChange={(base) => props.onReviewChange({ ...review, base })}
          branches={props.branches}
          remoteBranches={props.remoteBranches}
          agentBranches={props.agentBranches}
        />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Swap branches"
          onClick={() => props.onReviewChange({ base: review.head, head: review.base })}
        >
          <ArrowLeftRightIcon aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Close review"
          className="ml-auto"
          onClick={props.onClose}
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      {comparison ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-4 py-2 text-muted-foreground text-xs">
            {comparison.commits.length === 0
              ? `${review.head} has nothing that ${review.base} lacks.`
              : `${comparison.commits.length}${comparison.commitsTruncated ? "+" : ""} ${
                  comparison.commits.length === 1 ? "commit" : "commits"
                } · ${comparison.files.length} ${comparison.files.length === 1 ? "file" : "files"}`}
            {comparison.behindCount > 0 ? ` · ${comparison.behindCount} behind ${review.base}` : ""}
          </p>
          {comparison.commits.length > 0 ? (
            <PaneSection
              title="Commits"
              count={comparison.commits.length}
              open={open.commits}
              onOpenChange={(commits) => setOpen((previous) => ({ ...previous, commits }))}
            >
              <ul className="flex flex-col pb-2">
                {comparison.commits.map((commit) => (
                  <li key={commit.sha}>
                    <button
                      type="button"
                      aria-pressed={props.selectedSha === commit.sha && props.selectedPath === null}
                      onClick={() => props.onSelectCommit(commit.sha)}
                      className={cn(
                        "flex h-6.5 w-full min-w-0 items-center gap-2 pr-3 pl-6 text-left text-sm hover:bg-accent/60",
                        props.selectedSha === commit.sha &&
                          props.selectedPath === null &&
                          "bg-accent hover:bg-accent",
                      )}
                    >
                      <span className="shrink-0 font-mono text-muted-foreground text-xs">
                        {commit.shortSha}
                      </span>
                      <span className="min-w-0 truncate">{commit.subject}</span>
                      <span className="ml-auto shrink-0 pl-2 text-muted-foreground text-xs">
                        {relativeFromUnix(commit.authoredAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </PaneSection>
          ) : null}
          {comparison.files.length > 0 ? (
            <PaneSection
              title="Files changed"
              count={comparison.files.length}
              open={open.files}
              onOpenChange={(files) => setOpen((previous) => ({ ...previous, files }))}
            >
              <ul className="flex flex-col pb-2">
                {comparison.files.map((file) => (
                  <li key={file.path}>
                    <FileRow
                      file={file}
                      selected={
                        props.selectedSha === comparison.headSha && props.selectedPath === file.path
                      }
                      onSelect={() => props.onSelectFile(comparison, file)}
                    />
                  </li>
                ))}
              </ul>
              {comparison.filesTruncated ? (
                <p className="px-6 pb-2 text-warning-foreground text-xs">
                  Too many files to list them all.
                </p>
              ) : null}
            </PaneSection>
          ) : null}
        </div>
      ) : comparisonQuery.error ? (
        <p className="p-4 text-destructive-foreground text-sm">{comparisonQuery.error}</p>
      ) : (
        <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
          <Spinner className="size-3.5" /> Comparing…
        </div>
      )}
    </div>
  );
}
