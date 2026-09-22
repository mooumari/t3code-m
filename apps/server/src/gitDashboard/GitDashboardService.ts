import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  GitCommandError,
  type GitDashboardFileDiffInput,
  type GitDashboardFileDiffResult,
  type GitDashboardOverviewInput,
  type GitDashboardOverviewResult,
} from "@t3tools/contracts";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  BRANCH_FORMAT,
  COMMIT_FORMAT,
  STASH_FORMAT,
  isSafeRepositoryRelativePath,
  parseBranchList,
  parseCommitLog,
  parsePorcelainV2Status,
  parseStashList,
  parseWorktreeList,
} from "./gitDashboardParsing.ts";

const DEFAULT_COMMIT_LIMIT = 30;
const MAX_COMMIT_LIMIT = 200;
const MAX_STATUS_FILES = 1_000;
const MAX_DIFF_BYTES = 2_000_000;
// Stable English output for parsing, and never take optional locks that could race an agent's git work.
const READ_ONLY_ENV = { LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };

export class GitDashboardService extends Context.Service<
  GitDashboardService,
  {
    readonly getOverview: (
      input: GitDashboardOverviewInput,
    ) => Effect.Effect<GitDashboardOverviewResult, GitCommandError>;
    readonly getFileDiff: (
      input: GitDashboardFileDiffInput,
    ) => Effect.Effect<GitDashboardFileDiffResult, GitCommandError>;
  }
>()("t3/gitDashboard/GitDashboardService") {}

const EMPTY_OVERVIEW: GitDashboardOverviewResult = {
  isRepo: false,
  repoRoot: null,
  head: null,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
  filesTruncated: false,
  worktrees: [],
  branches: [],
  commits: [],
  stashes: [],
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const path = yield* Path.Path;

  const run = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: { readonly maxOutputBytes?: number } = {},
  ) =>
    git.execute({
      operation: `GitDashboardService.${operation}`,
      cwd,
      args,
      env: READ_ONLY_ENV,
      allowNonZeroExit: true,
      ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
    });

  const getOverview: GitDashboardService["Service"]["getOverview"] = Effect.fn(
    "GitDashboardService.getOverview",
  )(function* (input) {
    const toplevel = yield* run("resolveRoot", input.cwd, ["rev-parse", "--show-toplevel"]);
    const repoRoot = toplevel.stdout.trim();
    if (toplevel.exitCode !== 0 || repoRoot.length === 0) {
      return EMPTY_OVERVIEW;
    }

    const commitLimit = Math.min(input.commitLimit ?? DEFAULT_COMMIT_LIMIT, MAX_COMMIT_LIMIT);
    const [status, worktrees, branches, log, stashes] = yield* Effect.all(
      [
        run("status", repoRoot, [
          "status",
          "--porcelain=v2",
          "--branch",
          "-z",
          "--untracked-files=all",
        ]),
        run("worktrees", repoRoot, ["worktree", "list", "--porcelain", "-z"]),
        run("branches", repoRoot, ["for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads"]),
        // Fails on an unborn HEAD; treated as "no commits yet" below.
        run("log", repoRoot, ["log", `-n${commitLimit}`, `--format=${COMMIT_FORMAT}`]),
        run("stashes", repoRoot, ["stash", "list", `--format=${STASH_FORMAT}`]),
      ],
      { concurrency: "unbounded" },
    );

    if (status.exitCode !== 0) {
      return yield* new GitCommandError({
        operation: "GitDashboardService.status",
        command: "git",
        cwd: repoRoot,
        detail: "git status failed.",
        exitCode: status.exitCode,
      });
    }

    const parsedStatus = parsePorcelainV2Status(status.stdout, {
      outputTruncated: status.stdoutTruncated,
      maxFiles: MAX_STATUS_FILES,
    });

    return {
      isRepo: true,
      repoRoot,
      head: parsedStatus.head,
      staged: parsedStatus.staged,
      unstaged: parsedStatus.unstaged,
      untracked: parsedStatus.untracked,
      conflicted: parsedStatus.conflicted,
      filesTruncated: parsedStatus.truncated,
      worktrees:
        worktrees.exitCode === 0 ? parseWorktreeList(worktrees.stdout, path.resolve(repoRoot)) : [],
      branches: branches.exitCode === 0 ? parseBranchList(branches.stdout) : [],
      commits: log.exitCode === 0 ? parseCommitLog(log.stdout) : [],
      stashes: stashes.exitCode === 0 ? parseStashList(stashes.stdout) : [],
    };
  });

  const getFileDiff: GitDashboardService["Service"]["getFileDiff"] = Effect.fn(
    "GitDashboardService.getFileDiff",
  )(function* (input) {
    const paths = [input.path, ...(input.previousPath ? [input.previousPath] : [])];
    if (!paths.every(isSafeRepositoryRelativePath)) {
      return yield* new GitCommandError({
        operation: "GitDashboardService.getFileDiff",
        command: "git",
        cwd: input.cwd,
        detail: "Diff paths must be relative to the repository root.",
      });
    }

    const baseArgs = ["diff", "--no-color", "--no-ext-diff"];
    const args =
      input.area === "staged"
        ? [...baseArgs, "--cached", "-M", "--", ...paths]
        : input.area === "untracked"
          ? // `--no-index` exits 1 whenever the files differ, which is always here.
            [...baseArgs, "--no-index", "--", "/dev/null", input.path]
          : [...baseArgs, "--", input.path];

    const result = yield* run("fileDiff", input.cwd, args, { maxOutputBytes: MAX_DIFF_BYTES });
    if (result.exitCode !== 0 && !(input.area === "untracked" && result.exitCode === 1)) {
      return yield* new GitCommandError({
        operation: "GitDashboardService.getFileDiff",
        command: "git",
        cwd: input.cwd,
        detail: "git diff failed.",
        exitCode: result.exitCode,
      });
    }

    return { patch: result.stdout, truncated: result.stdoutTruncated };
  });

  return GitDashboardService.of({ getOverview, getFileDiff });
});

export const layer = Layer.effect(GitDashboardService, make);
