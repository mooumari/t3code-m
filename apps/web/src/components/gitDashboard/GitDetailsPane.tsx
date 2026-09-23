import type { EnvironmentId, GitDashboardDiffArea, GitDashboardFile } from "@t3tools/contracts";
import { ArrowLeftIcon, ChevronLeftIcon, GitCommitHorizontalIcon } from "lucide-react";

import { gitDashboardEnvironment } from "~/state/gitDashboard";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { MessageCopyButton } from "../chat/MessageCopyButton";
import { GitDashboardDiff } from "./GitDashboardDiff";
import { FileRow, relativeFromUnix } from "./gitDashboardShared";

type WorkingArea = Exclude<GitDashboardDiffArea, "commit" | "comparison">;

/** What the right pane shows. */
export type DetailSelection =
  | {
      readonly kind: "working-file";
      readonly area: WorkingArea;
      readonly path: string;
      readonly previousPath: string | null;
    }
  | { readonly kind: "commit"; readonly sha: string }
  | {
      readonly kind: "commit-file";
      readonly sha: string;
      readonly path: string;
      readonly previousPath: string | null;
    }
  | {
      /** A file of a branch review, from the merge base of `base` to `headSha`. */
      readonly kind: "comparison-file";
      readonly base: string;
      readonly head: string;
      readonly baseSha: string;
      readonly headSha: string;
      readonly path: string;
      readonly previousPath: string | null;
    };

const AREA_LABEL: Record<WorkingArea, string> = {
  staged: "Staged changes",
  unstaged: "Changes",
  untracked: "New file",
  conflicted: "Conflict",
};

export function GitDetailsPane(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly selection: DetailSelection | null;
  readonly onSelectCommit: (sha: string) => void;
  readonly onSelectCommitFile: (sha: string, file: GitDashboardFile) => void;
  /** Returns to the lists when the pane is too narrow to show both. */
  readonly onBack: () => void;
}) {
  const { selection } = props;
  if (selection === null) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground text-sm">
        Select a change or a commit to see it here.
      </div>
    );
  }
  const back = (
    <div className="@3xl/git:hidden">
      <Button type="button" size="xs" variant="ghost" onClick={props.onBack}>
        <ChevronLeftIcon aria-hidden />
        Back
      </Button>
    </div>
  );
  if (selection.kind === "commit") {
    return (
      <>
        <div className="px-2 pt-2">{back}</div>
        <CommitDetails {...props} sha={selection.sha} />
      </>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      {back}
      <header className="flex min-w-0 flex-col gap-1">
        <h2 className="truncate font-mono text-sm">{selection.path}</h2>
        {selection.kind === "commit-file" ? (
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={() => props.onSelectCommit(selection.sha)}
          >
            <ArrowLeftIcon aria-hidden />
            Commit {selection.sha.slice(0, 8)}
          </Button>
        ) : selection.kind === "comparison-file" ? (
          <p className="truncate text-muted-foreground text-xs">
            Changes on {selection.head} since it left {selection.base}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{AREA_LABEL[selection.area]}</p>
        )}
      </header>
      <GitDashboardDiff
        environmentId={props.environmentId}
        input={{
          cwd: props.cwd,
          path: selection.path,
          previousPath: selection.previousPath,
          ...(selection.kind === "commit-file"
            ? { area: "commit" as const, sha: selection.sha }
            : selection.kind === "comparison-file"
              ? { area: "comparison" as const, sha: selection.headSha, baseSha: selection.baseSha }
              : { area: selection.area }),
        }}
      />
    </div>
  );
}

function CommitDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly sha: string;
  readonly onSelectCommit: (sha: string) => void;
  readonly onSelectCommitFile: (sha: string, file: GitDashboardFile) => void;
}) {
  const commitQuery = useEnvironmentQuery(
    gitDashboardEnvironment.commit({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, sha: props.sha },
    }),
  );
  const details = commitQuery.data;
  if (!details) {
    return commitQuery.error ? (
      <p className="p-4 text-destructive-foreground text-sm">{commitQuery.error}</p>
    ) : (
      <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
        <Spinner className="size-4" /> Loading commit…
      </div>
    );
  }
  const committedSeparately =
    details.committerName !== details.authorName || details.committedAt !== details.authoredAt;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-2">
        <h2 className="font-semibold text-base">{details.subject}</h2>
        {details.body ? (
          <p className="whitespace-pre-wrap text-muted-foreground text-sm">{details.body}</p>
        ) : null}
      </header>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Author</dt>
        <dd className="truncate">
          {details.authorName}{" "}
          <span className="text-muted-foreground">
            {details.authorEmail ? `<${details.authorEmail}> · ` : ""}
            {relativeFromUnix(details.authoredAt)}
          </span>
        </dd>
        {committedSeparately ? (
          <>
            <dt className="text-muted-foreground">Committed</dt>
            <dd className="truncate">
              {details.committerName}{" "}
              <span className="text-muted-foreground">{relativeFromUnix(details.committedAt)}</span>
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Commit</dt>
        <dd className="flex items-center gap-1">
          <span className="truncate font-mono text-xs">{details.sha}</span>
          <MessageCopyButton text={details.sha} size="icon-xs" variant="ghost" />
        </dd>
        {details.parents.length > 0 ? (
          <>
            <dt className="text-muted-foreground">
              {details.parents.length > 1 ? "Parents" : "Parent"}
            </dt>
            <dd className="flex flex-wrap gap-1">
              {details.parents.map((parent) => (
                <Button
                  key={parent}
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => props.onSelectCommit(parent)}
                >
                  <GitCommitHorizontalIcon aria-hidden />
                  <span className="font-mono">{parent.slice(0, 8)}</span>
                </Button>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
      <section className="flex flex-col">
        <h3 className="pb-1 font-medium text-muted-foreground text-xs">
          {details.files.length} {details.files.length === 1 ? "file" : "files"} changed
          {details.parents.length > 1 ? " (against the first parent)" : ""}
        </h3>
        <ul className="-mx-4">
          {details.files.map((file) => (
            <li key={file.path}>
              <FileRow
                file={file}
                selected={false}
                onSelect={() => props.onSelectCommitFile(details.sha, file)}
              />
            </li>
          ))}
        </ul>
        {details.filesTruncated ? (
          <p className="pt-1 text-warning-foreground text-xs">Too many files to list them all.</p>
        ) : null}
      </section>
    </div>
  );
}
