import type {
  GitDashboardBranch,
  GitDashboardCommit,
  GitDashboardFile,
  GitDashboardFileChange,
  GitDashboardHead,
  GitDashboardStash,
  GitDashboardWorktree,
} from "@t3tools/contracts";

// Field and record separators requested through git's `%x1f` / `%x1e` format escapes.
export const FIELD_SEPARATOR = "\x1f";
export const RECORD_SEPARATOR = "\x1e";

export interface ParsedStatus {
  readonly head: GitDashboardHead;
  readonly staged: GitDashboardFile[];
  readonly unstaged: GitDashboardFile[];
  readonly untracked: GitDashboardFile[];
  readonly conflicted: GitDashboardFile[];
  readonly truncated: boolean;
}

const changeFromStatusCode = (code: string): GitDashboardFileChange => {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    default:
      return "modified";
  }
};

/** Splits off `count` space-separated fields; the remainder (a path that may contain spaces) is last. */
const splitFields = (line: string, count: number): string[] | null => {
  const fields: string[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const next = line.indexOf(" ", cursor);
    if (next === -1) return null;
    fields.push(line.slice(cursor, next));
    cursor = next + 1;
  }
  fields.push(line.slice(cursor));
  return fields;
};

/**
 * Parses `git status --porcelain=v2 --branch -z`. Entries are split into the buckets a
 * user thinks in: staged (index), unstaged (worktree), untracked, and conflicted.
 */
export function parsePorcelainV2Status(
  stdout: string,
  options: { readonly outputTruncated: boolean; readonly maxFiles: number },
): ParsedStatus {
  const tokens = stdout.split("\0");
  if (options.outputTruncated) {
    // The final record may have been cut mid-path.
    tokens.pop();
  }

  let branch: string | null = null;
  let sha: string | null = null;
  let detached = false;
  let upstream: string | null = null;
  let aheadCount = 0;
  let behindCount = 0;
  const staged: GitDashboardFile[] = [];
  const unstaged: GitDashboardFile[] = [];
  const untracked: GitDashboardFile[] = [];
  const conflicted: GitDashboardFile[] = [];
  let fileCount = 0;
  let truncated = options.outputTruncated;

  const push = (bucket: GitDashboardFile[], file: GitDashboardFile) => {
    if (fileCount >= options.maxFiles) {
      truncated = true;
      return;
    }
    fileCount += 1;
    bucket.push(file);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.length === 0) continue;

    if (token.startsWith("# ")) {
      const [key, ...rest] = token.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") {
        sha = value === "(initial)" ? null : value;
      } else if (key === "branch.head") {
        detached = value === "(detached)";
        branch = detached ? null : value;
      } else if (key === "branch.upstream") {
        upstream = value;
      } else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          aheadCount = Number(match[1]);
          behindCount = Number(match[2]);
        }
      }
      continue;
    }

    const kind = token[0];
    if (kind === "?") {
      push(untracked, { path: token.slice(2), previousPath: null, change: "untracked" });
      continue;
    }
    if (kind === "u") {
      const fields = splitFields(token, 10);
      if (fields) push(conflicted, { path: fields[10]!, previousPath: null, change: "conflicted" });
      continue;
    }
    if (kind !== "1" && kind !== "2") continue;

    const fields = splitFields(token, kind === "1" ? 8 : 9);
    if (!fields) continue;
    const path = fields[kind === "1" ? 8 : 9]!;
    let previousPath: string | null = null;
    if (kind === "2") {
      // Rename/copy records carry the original path as the next NUL-separated token.
      previousPath = tokens[index + 1] ?? null;
      index += 1;
    }

    const indexCode = fields[1]![0] ?? ".";
    const worktreeCode = fields[1]![1] ?? ".";
    if (indexCode !== ".") {
      const change = changeFromStatusCode(indexCode);
      push(staged, {
        path,
        previousPath: change === "renamed" || change === "copied" ? previousPath : null,
        change,
      });
    }
    if (worktreeCode !== ".") {
      push(unstaged, { path, previousPath: null, change: changeFromStatusCode(worktreeCode) });
    }
  }

  return {
    head: { branch, sha, detached, upstream, aheadCount, behindCount },
    staged,
    unstaged,
    untracked,
    conflicted,
    truncated,
  };
}

/** Parses `git worktree list --porcelain -z`. The first record is always the main worktree. */
export function parseWorktreeList(
  stdout: string,
  currentWorktreePath: string,
): GitDashboardWorktree[] {
  const worktrees: GitDashboardWorktree[] = [];
  let current: {
    path: string;
    branch: string | null;
    sha: string | null;
    detached: boolean;
    locked: boolean;
    prunable: boolean;
  } | null = null;

  const flush = () => {
    if (!current) return;
    worktrees.push({
      ...current,
      isMain: worktrees.length === 0,
      isCurrent: current.path === currentWorktreePath,
    });
    current = null;
  };

  for (const token of stdout.split("\0")) {
    if (token.length === 0) {
      flush();
      continue;
    }
    const space = token.indexOf(" ");
    const key = space === -1 ? token : token.slice(0, space);
    const value = space === -1 ? "" : token.slice(space + 1);
    if (key === "worktree") {
      flush();
      current = {
        path: value,
        branch: null,
        sha: null,
        detached: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.sha = value;
    else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") current.detached = true;
    else if (key === "locked") current.locked = true;
    else if (key === "prunable") current.prunable = true;
  }
  flush();
  return worktrees;
}

export const BRANCH_FORMAT = [
  "%(refname:short)",
  "%(HEAD)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(committerdate:unix)",
  "%(worktreepath)",
  "%(contents:subject)",
]
  .join("%1f")
  .concat("%1e");

const parseTrack = (track: string) => {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return {
    aheadCount: ahead ? Number(ahead[1]) : 0,
    behindCount: behind ? Number(behind[1]) : 0,
    upstreamGone: track === "gone",
  };
};

/** Parses `git for-each-ref --format=<BRANCH_FORMAT> refs/heads`, most recently committed first. */
export function parseBranchList(stdout: string): GitDashboardBranch[] {
  const branches: GitDashboardBranch[] = [];
  for (const record of stdout.split(RECORD_SEPARATOR)) {
    const trimmed = record.replace(/^\n/, "");
    if (trimmed.length === 0) continue;
    const [name, head, upstream, track, committedAt, worktreePath, subject] =
      trimmed.split(FIELD_SEPARATOR);
    if (!name) continue;
    const timestamp = Number(committedAt);
    branches.push({
      name,
      isCurrent: head === "*",
      upstream: upstream || null,
      ...parseTrack(track ?? ""),
      committedAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
      subject: subject ?? "",
      worktreePath: worktreePath || null,
    });
  }
  return branches.toSorted(
    (left, right) =>
      Number(right.isCurrent) - Number(left.isCurrent) ||
      (right.committedAt ?? 0) - (left.committedAt ?? 0),
  );
}

export const COMMIT_FORMAT = ["%H", "%h", "%an", "%at", "%D", "%s"].join("%x1f").concat("%x1e");

/** Parses `git log --format=<COMMIT_FORMAT>`. */
export function parseCommitLog(stdout: string): GitDashboardCommit[] {
  const commits: GitDashboardCommit[] = [];
  for (const record of stdout.split(RECORD_SEPARATOR)) {
    const trimmed = record.replace(/^\n/, "");
    if (trimmed.length === 0) continue;
    const [sha, shortSha, authorName, authoredAt, refs, subject] = trimmed.split(FIELD_SEPARATOR);
    if (!sha || !shortSha) continue;
    commits.push({
      sha,
      shortSha,
      authorName: authorName ?? "",
      authoredAt: Number(authoredAt) || 0,
      refs: refs ? refs.split(", ").filter((ref) => ref.length > 0) : [],
      subject: subject ?? "",
    });
  }
  return commits;
}

export const STASH_FORMAT = ["%gd", "%s"].join("%x1f").concat("%x1e");

/** Parses `git stash list --format=<STASH_FORMAT>`. */
export function parseStashList(stdout: string): GitDashboardStash[] {
  const stashes: GitDashboardStash[] = [];
  for (const record of stdout.split(RECORD_SEPARATOR)) {
    const trimmed = record.replace(/^\n/, "");
    if (trimmed.length === 0) continue;
    const [ref, subject] = trimmed.split(FIELD_SEPARATOR);
    if (ref) stashes.push({ ref, subject: subject ?? "" });
  }
  return stashes;
}

/** Diff paths come from the client, so keep them repository-relative. */
export function isSafeRepositoryRelativePath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-zA-Z]:/.test(path)) return false;
  return !path.split(/[\\/]/).some((segment) => segment === "..");
}
