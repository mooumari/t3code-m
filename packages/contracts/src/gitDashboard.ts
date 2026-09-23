import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";

export const GitDashboardOverviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type GitDashboardOverviewInput = typeof GitDashboardOverviewInput.Type;

export const GitDashboardFileChange = Schema.Literals([
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "untracked",
  "conflicted",
]);
export type GitDashboardFileChange = typeof GitDashboardFileChange.Type;

export const GitDashboardFile = Schema.Struct({
  path: Schema.String,
  previousPath: Schema.NullOr(Schema.String),
  change: GitDashboardFileChange,
});
export type GitDashboardFile = typeof GitDashboardFile.Type;

export const GitDashboardHead = Schema.Struct({
  branch: Schema.NullOr(Schema.String),
  sha: Schema.NullOr(Schema.String),
  detached: Schema.Boolean,
  upstream: Schema.NullOr(Schema.String),
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
});
export type GitDashboardHead = typeof GitDashboardHead.Type;

export const GitDashboardWorktree = Schema.Struct({
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  sha: Schema.NullOr(Schema.String),
  isMain: Schema.Boolean,
  isCurrent: Schema.Boolean,
  detached: Schema.Boolean,
  locked: Schema.Boolean,
  prunable: Schema.Boolean,
});
export type GitDashboardWorktree = typeof GitDashboardWorktree.Type;

export const GitDashboardBranch = Schema.Struct({
  name: Schema.String,
  isCurrent: Schema.Boolean,
  upstream: Schema.NullOr(Schema.String),
  upstreamGone: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  /** Unix seconds of the tip commit. */
  committedAt: Schema.NullOr(Schema.Number),
  subject: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
});
export type GitDashboardBranch = typeof GitDashboardBranch.Type;

export const GitDashboardRemoteBranch = Schema.Struct({
  /** Short name such as `origin/main`. */
  name: Schema.String,
  /** Unix seconds of the tip commit. */
  committedAt: Schema.NullOr(Schema.Number),
});
export type GitDashboardRemoteBranch = typeof GitDashboardRemoteBranch.Type;

export const GitDashboardStash = Schema.Struct({
  ref: Schema.String,
  subject: Schema.String,
});
export type GitDashboardStash = typeof GitDashboardStash.Type;

export const GitDashboardOverviewResult = Schema.Struct({
  isRepo: Schema.Boolean,
  repoRoot: Schema.NullOr(Schema.String),
  head: Schema.NullOr(GitDashboardHead),
  staged: Schema.Array(GitDashboardFile),
  unstaged: Schema.Array(GitDashboardFile),
  untracked: Schema.Array(GitDashboardFile),
  conflicted: Schema.Array(GitDashboardFile),
  /** True when the file lists were cut short because the working tree is huge. */
  filesTruncated: Schema.Boolean,
  worktrees: Schema.Array(GitDashboardWorktree),
  branches: Schema.Array(GitDashboardBranch),
  remoteBranches: Schema.Array(GitDashboardRemoteBranch),
  /** The branch work usually merges into, such as `origin/main`; the review base by default. */
  defaultBranch: Schema.NullOr(Schema.String),
  stashes: Schema.Array(GitDashboardStash),
});
export type GitDashboardOverviewResult = typeof GitDashboardOverviewResult.Type;

export const GitDashboardDiffArea = Schema.Literals([
  "staged",
  "unstaged",
  "untracked",
  "conflicted",
  "commit",
  "comparison",
]);
export type GitDashboardDiffArea = typeof GitDashboardDiffArea.Type;

/** A full or abbreviated commit id. */
export const GitDashboardSha = TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{4,64}$/));

export const GitDashboardFileDiffInput = Schema.Struct({
  /** Repository root returned by the overview; file paths are relative to it. */
  cwd: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  area: GitDashboardDiffArea,
  /** The commit whose change to show; required for `commit` and `comparison`. */
  sha: Schema.optionalKey(GitDashboardSha),
  /** For `comparison`: the base commit; the diff runs from its merge base with `sha`. */
  baseSha: Schema.optionalKey(GitDashboardSha),
});
export type GitDashboardFileDiffInput = typeof GitDashboardFileDiffInput.Type;

export const GitDashboardFileDiffResult = Schema.Struct({
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type GitDashboardFileDiffResult = typeof GitDashboardFileDiffResult.Type;

// ---------------------------------------------------------------------------
// Commit graph
// ---------------------------------------------------------------------------

/**
 * Which history the graph shows. `auto` is the current branch and its upstream, `all` is
 * every local and remote branch and tag, `refs` is the given branches.
 */
export const GitDashboardGraphScope = Schema.Literals(["auto", "all", "refs"]);
export type GitDashboardGraphScope = typeof GitDashboardGraphScope.Type;

export const GitDashboardGraphInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  scope: GitDashboardGraphScope,
  refs: Schema.optionalKey(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(255))).check(
      Schema.isMaxLength(20),
    ),
  ),
  limit: Schema.optionalKey(NonNegativeInt),
});
export type GitDashboardGraphInput = typeof GitDashboardGraphInput.Type;

export const GitDashboardCommit = Schema.Struct({
  sha: Schema.String,
  shortSha: Schema.String,
  parents: Schema.Array(Schema.String),
  subject: Schema.String,
  authorName: Schema.String,
  /** Unix seconds. */
  authoredAt: Schema.Number,
  /** Decorations as git prints them, such as `HEAD -> main`, `origin/main`, `tag: v1`. */
  refs: Schema.Array(Schema.String),
});
export type GitDashboardCommit = typeof GitDashboardCommit.Type;

export const GitDashboardGraphResult = Schema.Struct({
  commits: Schema.Array(GitDashboardCommit),
  /** True when older commits exist beyond `limit`. */
  hasMore: Schema.Boolean,
  /** The current branch's upstream, such as `origin/main`. */
  upstream: Schema.NullOr(Schema.String),
  /** Commits on the current branch that its upstream lacks (not pushed yet). */
  outgoing: Schema.Array(Schema.String),
  /** Commits on the upstream that the current branch lacks (not pulled yet). */
  incoming: Schema.Array(Schema.String),
});
export type GitDashboardGraphResult = typeof GitDashboardGraphResult.Type;

export const GitDashboardCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sha: GitDashboardSha,
});
export type GitDashboardCommitInput = typeof GitDashboardCommitInput.Type;

export const GitDashboardCommitDetails = Schema.Struct({
  sha: Schema.String,
  parents: Schema.Array(Schema.String),
  subject: Schema.String,
  body: Schema.String,
  authorName: Schema.String,
  authorEmail: Schema.String,
  /** Unix seconds. */
  authoredAt: Schema.Number,
  committerName: Schema.String,
  /** Unix seconds. */
  committedAt: Schema.Number,
  /** Changes against the first parent, like `git show` for a regular commit. */
  files: Schema.Array(GitDashboardFile),
  filesTruncated: Schema.Boolean,
});
export type GitDashboardCommitDetails = typeof GitDashboardCommitDetails.Type;

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

export const GitDashboardSetStagedInput = Schema.Struct({
  /** Repository root returned by the overview; file paths are relative to it. */
  cwd: TrimmedNonEmptyString,
  /** Files to stage or unstage. Omitted means every change. */
  paths: Schema.optionalKey(
    Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
  ),
  staged: Schema.Boolean,
});
export type GitDashboardSetStagedInput = typeof GitDashboardSetStagedInput.Type;

// ---------------------------------------------------------------------------
// Branch review
// ---------------------------------------------------------------------------

const GitDashboardRefName = TrimmedNonEmptyString.check(Schema.isMaxLength(255));

export const GitDashboardComparisonInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** The branch work merges into, such as `origin/main`. */
  base: GitDashboardRefName,
  /** The branch under review. */
  head: GitDashboardRefName,
});
export type GitDashboardComparisonInput = typeof GitDashboardComparisonInput.Type;

/** What `head` adds on top of `base`, like a pull request's commits and files. */
export const GitDashboardComparison = Schema.Struct({
  base: Schema.String,
  head: Schema.String,
  baseSha: Schema.String,
  headSha: Schema.String,
  /** Commits on `head` that `base` lacks, newest first. */
  commits: Schema.Array(GitDashboardCommit),
  commitsTruncated: Schema.Boolean,
  /** Commits on `base` that `head` lacks: how far the branch is behind. */
  behindCount: NonNegativeInt,
  /** Changes from the merge base to `head`. */
  files: Schema.Array(GitDashboardFile),
  filesTruncated: Schema.Boolean,
});
export type GitDashboardComparison = typeof GitDashboardComparison.Type;

export const GitDashboardError = GitCommandError;
export type GitDashboardError = typeof GitDashboardError.Type;
