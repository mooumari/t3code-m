import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";

export const GitDashboardOverviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  commitLimit: Schema.optionalKey(NonNegativeInt),
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

export const GitDashboardCommit = Schema.Struct({
  sha: Schema.String,
  shortSha: Schema.String,
  subject: Schema.String,
  authorName: Schema.String,
  /** Unix seconds. */
  authoredAt: Schema.Number,
  refs: Schema.Array(Schema.String),
});
export type GitDashboardCommit = typeof GitDashboardCommit.Type;

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
  commits: Schema.Array(GitDashboardCommit),
  stashes: Schema.Array(GitDashboardStash),
});
export type GitDashboardOverviewResult = typeof GitDashboardOverviewResult.Type;

export const GitDashboardDiffArea = Schema.Literals([
  "staged",
  "unstaged",
  "untracked",
  "conflicted",
]);
export type GitDashboardDiffArea = typeof GitDashboardDiffArea.Type;

export const GitDashboardFileDiffInput = Schema.Struct({
  /** Repository root returned by the overview; file paths are relative to it. */
  cwd: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  area: GitDashboardDiffArea,
});
export type GitDashboardFileDiffInput = typeof GitDashboardFileDiffInput.Type;

export const GitDashboardFileDiffResult = Schema.Struct({
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type GitDashboardFileDiffResult = typeof GitDashboardFileDiffResult.Type;

export const GitDashboardError = GitCommandError;
export type GitDashboardError = typeof GitDashboardError.Type;
