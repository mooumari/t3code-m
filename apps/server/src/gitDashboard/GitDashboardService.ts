import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  GitCommandError,
  type GitDashboardCommitDetails,
  type GitDashboardCommitInput,
  type GitDashboardComparison,
  type GitDashboardComparisonInput,
  type GitDashboardFileDiffInput,
  type GitDashboardFileDiffResult,
  type GitDashboardGraphInput,
  type GitDashboardGraphResult,
  type GitDashboardOverviewInput,
  type GitDashboardOverviewResult,
} from "@t3tools/contracts";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  BRANCH_FORMAT,
  COMMIT_DETAILS_FORMAT,
  COMMIT_FORMAT,
  REMOTE_BRANCH_FORMAT,
  STASH_FORMAT,
  isSafeRefName,
  isSafeRepositoryRelativePath,
  parseBranchList,
  parseCommitDetails,
  parseCommitLog,
  parseNameStatus,
  parsePorcelainV2Status,
  parseRemoteBranchList,
  parseStashList,
  parseWorktreeList,
} from "./gitDashboardParsing.ts";

const DEFAULT_COMMIT_LIMIT = 100;
const MAX_COMMIT_LIMIT = 2_000;
const MAX_STATUS_FILES = 1_000;
const MAX_COMMIT_FILES = 2_000;
const MAX_REMOTE_BRANCHES = 1_000;
/** Outgoing and incoming commits past this count are not marked individually. */
const MAX_AHEAD_BEHIND_MARKS = 500;
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
    readonly getGraph: (
      input: GitDashboardGraphInput,
    ) => Effect.Effect<GitDashboardGraphResult, GitCommandError>;
    readonly getCommit: (
      input: GitDashboardCommitInput,
    ) => Effect.Effect<GitDashboardCommitDetails, GitCommandError>;
    readonly getComparison: (
      input: GitDashboardComparisonInput,
    ) => Effect.Effect<GitDashboardComparison, GitCommandError>;
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
  remoteBranches: [],
  defaultBranch: null,
  stashes: [],
};

/** Branches work usually merges into, in the order to guess them when the remote names none. */
const DEFAULT_BRANCH_GUESSES = ["origin/main", "origin/master", "main", "master"];
const MAX_COMPARISON_COMMITS = 500;

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

    const [status, worktrees, branches, remoteBranches, stashes, originHead] = yield* Effect.all(
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
        run("remoteBranches", repoRoot, [
          "for-each-ref",
          `--format=${REMOTE_BRANCH_FORMAT}`,
          `--count=${MAX_REMOTE_BRANCHES}`,
          "--sort=-committerdate",
          "refs/remotes",
        ]),
        run("stashes", repoRoot, ["stash", "list", `--format=${STASH_FORMAT}`]),
        run("originHead", repoRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
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

    const parsedBranches = branches.exitCode === 0 ? parseBranchList(branches.stdout) : [];
    const parsedRemoteBranches =
      remoteBranches.exitCode === 0 ? parseRemoteBranchList(remoteBranches.stdout) : [];
    const knownBranches = new Set([
      ...parsedBranches.map((branch) => branch.name),
      ...parsedRemoteBranches.map((branch) => branch.name),
    ]);
    const defaultBranch =
      (originHead.exitCode === 0 && originHead.stdout.trim()) ||
      DEFAULT_BRANCH_GUESSES.find((name) => knownBranches.has(name)) ||
      null;

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
      branches: parsedBranches,
      remoteBranches: parsedRemoteBranches,
      defaultBranch,
      stashes: stashes.exitCode === 0 ? parseStashList(stashes.stdout) : [],
    };
  });

  const commitError = (operation: string, cwd: string, detail: string, exitCode?: number) =>
    new GitCommandError({
      operation: `GitDashboardService.${operation}`,
      command: "git",
      cwd,
      detail,
      ...(exitCode === undefined ? {} : { exitCode }),
    });

  const readParents = (cwd: string, sha: string) =>
    run("parents", cwd, ["rev-list", "--parents", "-n1", "--end-of-options", sha]).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.succeed(result.stdout.trim().split(" ").slice(1))
          : Effect.fail(commitError("parents", cwd, `Unknown commit ${sha}.`, result.exitCode)),
      ),
    );

  const listShas = (cwd: string, range: string) =>
    run("aheadBehind", cwd, ["rev-list", `--max-count=${MAX_AHEAD_BEHIND_MARKS}`, range]).pipe(
      Effect.map((result) =>
        result.exitCode === 0 ? result.stdout.split("\n").filter((sha) => sha.length > 0) : [],
      ),
    );

  const getGraph: GitDashboardService["Service"]["getGraph"] = Effect.fn(
    "GitDashboardService.getGraph",
  )(function* (input) {
    const refs = input.refs ?? [];
    if (!refs.every(isSafeRefName)) {
      return yield* commitError("graph", input.cwd, "Branch names cannot start with '-'.");
    }
    const upstreamResult = yield* run("upstream", input.cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const upstream =
      upstreamResult.exitCode === 0 && upstreamResult.stdout.trim().length > 0
        ? upstreamResult.stdout.trim()
        : null;

    const revisions =
      input.scope === "all"
        ? ["--branches", "--remotes", "--tags", "HEAD"]
        : input.scope === "refs" && refs.length > 0
          ? ["--end-of-options", ...refs]
          : ["HEAD", ...(upstream ? [upstream] : [])];
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_COMMIT_LIMIT, 1), MAX_COMMIT_LIMIT);

    const [log, outgoing, incoming] = yield* Effect.all(
      [
        // One extra commit tells whether there is more history to load.
        run("graph", input.cwd, [
          "log",
          "--date-order",
          `-n${limit + 1}`,
          `--format=${COMMIT_FORMAT}`,
          ...revisions,
        ]),
        upstream ? listShas(input.cwd, `${upstream}..HEAD`) : Effect.succeed([]),
        upstream ? listShas(input.cwd, `HEAD..${upstream}`) : Effect.succeed([]),
      ],
      { concurrency: "unbounded" },
    );
    // An unborn HEAD has no history yet; anything else is a real failure.
    if (log.exitCode !== 0 && input.scope === "refs") {
      return yield* commitError("graph", input.cwd, "git log failed.", log.exitCode);
    }
    const commits = log.exitCode === 0 ? parseCommitLog(log.stdout) : [];
    return {
      commits: commits.slice(0, limit),
      hasMore: commits.length > limit,
      upstream,
      outgoing,
      incoming,
    };
  });

  const getCommit: GitDashboardService["Service"]["getCommit"] = Effect.fn(
    "GitDashboardService.getCommit",
  )(function* (input) {
    const show = yield* run("commit", input.cwd, [
      "show",
      "-s",
      `--format=${COMMIT_DETAILS_FORMAT}`,
      "--end-of-options",
      input.sha,
    ]);
    const details = show.exitCode === 0 ? parseCommitDetails(show.stdout) : null;
    if (!details) {
      return yield* commitError("commit", input.cwd, `Unknown commit ${input.sha}.`, show.exitCode);
    }
    const firstParent = details.parents[0];
    const files = yield* run("commitFiles", input.cwd, [
      "diff-tree",
      "-r",
      "-M",
      "--no-commit-id",
      "--name-status",
      "-z",
      ...(firstParent ? [firstParent, details.sha] : ["--root", details.sha]),
    ]);
    if (files.exitCode !== 0) {
      return yield* commitError("commitFiles", input.cwd, "git diff-tree failed.", files.exitCode);
    }
    const parsed = parseNameStatus(files.stdout, MAX_COMMIT_FILES);
    return { ...details, files: parsed.files, filesTruncated: parsed.truncated };
  });

  const resolveCommit = (cwd: string, ref: string) =>
    isSafeRefName(ref)
      ? run("resolveRef", cwd, [
          "rev-parse",
          "--verify",
          "--quiet",
          "--end-of-options",
          `${ref}^{commit}`,
        ]).pipe(
          Effect.flatMap((result) =>
            result.exitCode === 0
              ? Effect.succeed(result.stdout.trim())
              : Effect.fail(commitError("resolveRef", cwd, `Unknown branch ${ref}.`)),
          ),
        )
      : Effect.fail(commitError("resolveRef", cwd, "Branch names cannot start with '-'."));

  const getComparison: GitDashboardService["Service"]["getComparison"] = Effect.fn(
    "GitDashboardService.getComparison",
  )(function* (input) {
    const [baseSha, headSha] = yield* Effect.all(
      [resolveCommit(input.cwd, input.base), resolveCommit(input.cwd, input.head)],
      { concurrency: "unbounded" },
    );
    const [log, behind, files] = yield* Effect.all(
      [
        run("comparisonLog", input.cwd, [
          "log",
          `-n${MAX_COMPARISON_COMMITS + 1}`,
          `--format=${COMMIT_FORMAT}`,
          `${baseSha}..${headSha}`,
        ]),
        run("comparisonBehind", input.cwd, ["rev-list", "--count", `${headSha}..${baseSha}`]),
        // Three dots: from the merge base, so work that landed on the base is not shown as removed.
        run("comparisonFiles", input.cwd, [
          "diff",
          "-M",
          "--name-status",
          "-z",
          `${baseSha}...${headSha}`,
        ]),
      ],
      { concurrency: "unbounded" },
    );
    if (log.exitCode !== 0 || files.exitCode !== 0) {
      return yield* commitError(
        "comparison",
        input.cwd,
        `Could not compare ${input.head} with ${input.base}.`,
        log.exitCode || files.exitCode,
      );
    }
    const commits = parseCommitLog(log.stdout);
    const parsedFiles = parseNameStatus(files.stdout, MAX_COMMIT_FILES);
    return {
      base: input.base,
      head: input.head,
      baseSha,
      headSha,
      commits: commits.slice(0, MAX_COMPARISON_COMMITS),
      commitsTruncated: commits.length > MAX_COMPARISON_COMMITS,
      behindCount: behind.exitCode === 0 ? Number.parseInt(behind.stdout.trim(), 10) || 0 : 0,
      files: parsedFiles.files,
      filesTruncated: parsedFiles.truncated,
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
    let args: ReadonlyArray<string>;
    if (input.area === "comparison") {
      if (!input.sha || !input.baseSha) {
        return yield* commitError(
          "getFileDiff",
          input.cwd,
          "A comparison diff needs both commits.",
        );
      }
      args = [...baseArgs, "-M", `${input.baseSha}...${input.sha}`, "--", ...paths];
    } else if (input.area === "commit") {
      if (!input.sha) {
        return yield* new GitCommandError({
          operation: "GitDashboardService.getFileDiff",
          command: "git",
          cwd: input.cwd,
          detail: "A commit diff needs the commit id.",
        });
      }
      // Against the first parent, the same base the commit's file list uses.
      const parents = yield* readParents(input.cwd, input.sha);
      args = parents[0]
        ? [...baseArgs, "-M", parents[0], input.sha, "--", ...paths]
        : ["show", "--no-color", "--no-ext-diff", "--format=", input.sha, "--", ...paths];
    } else {
      args =
        input.area === "staged"
          ? [...baseArgs, "--cached", "-M", "--", ...paths]
          : input.area === "untracked"
            ? // `--no-index` exits 1 whenever the files differ, which is always here.
              [...baseArgs, "--no-index", "--", "/dev/null", input.path]
            : [...baseArgs, "--", input.path];
    }

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

  return GitDashboardService.of({
    getOverview,
    getFileDiff,
    getGraph,
    getCommit,
    getComparison,
  });
});

export const layer = Layer.effect(GitDashboardService, make);
