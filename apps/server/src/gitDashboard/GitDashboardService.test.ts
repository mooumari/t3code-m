import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitDashboardService from "./GitDashboardService.ts";
import {
  isSafeRefName,
  parseNameStatus,
  parsePorcelainV2Status,
  parseWorktreeList,
} from "./gitDashboardParsing.ts";

const TestLayer = GitDashboardService.layer.pipe(
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-dashboard-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const result = yield* driver.execute({
      operation: "GitDashboardService.test.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });

const makeRepo = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "t3-git-dash-" }));
  yield* git(cwd, ["init", "--initial-branch=main"]);
  yield* git(cwd, ["config", "user.email", "test@test.com"]);
  yield* git(cwd, ["config", "user.name", "Test"]);
  yield* fs.writeFileString(path.join(cwd, "README.md"), "# test\n");
  yield* fs.writeFileString(path.join(cwd, "old name.txt"), "rename me\n");
  yield* git(cwd, ["add", "."]);
  yield* git(cwd, ["commit", "-m", "initial commit"]);
  return cwd;
});

describe("GitDashboardService", () => {
  it.effect("splits staged, unstaged and untracked files and lists branches and commits", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* makeRepo;

      yield* fs.writeFileString(path.join(cwd, "README.md"), "# staged\n");
      yield* git(cwd, ["add", "README.md"]);
      yield* fs.writeFileString(path.join(cwd, "README.md"), "# staged then edited\n");
      yield* git(cwd, ["mv", "old name.txt", "new name.txt"]);
      yield* fs.writeFileString(path.join(cwd, "fresh file.ts"), "export {};\n");
      yield* git(cwd, ["branch", "feature/side"]);

      const dashboard = yield* GitDashboardService.GitDashboardService;
      const overview = yield* dashboard.getOverview({ cwd });

      assert.isTrue(overview.isRepo);
      assert.strictEqual(overview.repoRoot, cwd);
      assert.strictEqual(overview.head?.branch, "main");
      assert.deepStrictEqual(
        overview.staged.map((file) => [file.change, file.path, file.previousPath]),
        [
          ["modified", "README.md", null],
          ["renamed", "new name.txt", "old name.txt"],
        ],
      );
      assert.deepStrictEqual(
        overview.unstaged.map((file) => file.path),
        ["README.md"],
      );
      assert.deepStrictEqual(
        overview.untracked.map((file) => file.path),
        ["fresh file.ts"],
      );
      assert.deepStrictEqual(
        overview.branches.map((branch) => [branch.name, branch.isCurrent]),
        [
          ["main", true],
          ["feature/side", false],
        ],
      );
      assert.strictEqual(overview.worktrees.length, 1);
      assert.isTrue(overview.worktrees[0]?.isCurrent);

      const stagedDiff = yield* dashboard.getFileDiff({
        cwd,
        path: "README.md",
        previousPath: null,
        area: "staged",
      });
      assert.include(stagedDiff.patch, "+# staged");
      assert.notInclude(stagedDiff.patch, "edited");

      const untrackedDiff = yield* dashboard.getFileDiff({
        cwd,
        path: "fresh file.ts",
        previousPath: null,
        area: "untracked",
      });
      assert.include(untrackedDiff.patch, "+export {};");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("builds the graph with unpushed commits, and shows a commit and its file diffs", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* makeRepo;
      const remote = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "t3-git-dash-remote-" }),
      );
      yield* git(remote, ["init", "--bare", "--initial-branch=main"]);
      yield* git(cwd, ["remote", "add", "origin", remote]);
      yield* git(cwd, ["push", "-u", "origin", "main"]);
      yield* fs.writeFileString(path.join(cwd, "README.md"), "# second\n");
      yield* git(cwd, ["commit", "-am", "second commit"]);
      const initial = yield* git(cwd, ["rev-parse", "HEAD~1"]);
      const second = yield* git(cwd, ["rev-parse", "HEAD"]);

      const dashboard = yield* GitDashboardService.GitDashboardService;
      const graph = yield* dashboard.getGraph({ cwd, scope: "auto" });
      assert.deepStrictEqual(
        graph.commits.map((commit) => [commit.subject, commit.parents]),
        [
          ["second commit", [initial]],
          ["initial commit", []],
        ],
      );
      assert.strictEqual(graph.upstream, "origin/main");
      assert.deepStrictEqual(graph.outgoing, [second]);
      assert.deepStrictEqual(graph.incoming, []);
      assert.isFalse(graph.hasMore);

      const limited = yield* dashboard.getGraph({ cwd, scope: "all", limit: 1 });
      assert.strictEqual(limited.commits.length, 1);
      assert.isTrue(limited.hasMore);

      const details = yield* dashboard.getCommit({ cwd, sha: second });
      assert.strictEqual(details.subject, "second commit");
      assert.deepStrictEqual(
        details.files.map((file) => [file.change, file.path]),
        [["modified", "README.md"]],
      );
      const rootDetails = yield* dashboard.getCommit({ cwd, sha: initial });
      assert.deepStrictEqual(
        rootDetails.files.map((file) => file.path),
        ["README.md", "old name.txt"],
      );

      const commitDiff = yield* dashboard.getFileDiff({
        cwd,
        path: "README.md",
        previousPath: null,
        area: "commit",
        sha: second,
      });
      assert.include(commitDiff.patch, "-# test");
      assert.include(commitDiff.patch, "+# second");
      const rootDiff = yield* dashboard.getFileDiff({
        cwd,
        path: "README.md",
        previousPath: null,
        area: "commit",
        sha: initial,
      });
      assert.include(rootDiff.patch, "+# test");

      const rejected = yield* dashboard
        .getGraph({ cwd, scope: "refs", refs: ["--output=/tmp/x"] })
        .pipe(Effect.flip);
      assert.match(rejected.detail, /cannot start with/);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("stages and unstages chosen files or every change", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* makeRepo;
      const dashboard = yield* GitDashboardService.GitDashboardService;

      yield* fs.writeFileString(path.join(cwd, "README.md"), "# edited\n");
      yield* fs.writeFileString(path.join(cwd, "fresh file.ts"), "export {};\n");
      yield* fs.remove(path.join(cwd, "old name.txt"));
      const staged = () =>
        dashboard
          .getOverview({ cwd })
          .pipe(Effect.map((overview) => overview.staged.map((file) => file.path)));

      yield* dashboard.setStaged({ cwd, paths: ["fresh file.ts", "old name.txt"], staged: true });
      assert.deepStrictEqual(yield* staged(), ["fresh file.ts", "old name.txt"]);

      yield* dashboard.setStaged({ cwd, paths: ["fresh file.ts"], staged: false });
      assert.deepStrictEqual(yield* staged(), ["old name.txt"]);

      yield* dashboard.setStaged({ cwd, staged: true });
      assert.deepStrictEqual(yield* staged(), ["README.md", "fresh file.ts", "old name.txt"]);

      yield* dashboard.setStaged({ cwd, staged: false });
      assert.deepStrictEqual(yield* staged(), []);
      const overview = yield* dashboard.getOverview({ cwd });
      assert.strictEqual(overview.unstaged.length, 2);
      assert.strictEqual(overview.untracked.length, 1);

      const outside = yield* dashboard
        .setStaged({ cwd, paths: ["../elsewhere"], staged: true })
        .pipe(Effect.flip);
      assert.strictEqual(outside.detail, "Invalid file path.");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("compares a branch with its base from the merge base", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* makeRepo;
      yield* git(cwd, ["checkout", "-b", "feature"]);
      yield* fs.writeFileString(path.join(cwd, "feature.ts"), "export const a = 1;\n");
      yield* git(cwd, ["add", "."]);
      yield* git(cwd, ["commit", "-m", "add feature"]);
      yield* git(cwd, ["checkout", "main"]);
      yield* fs.writeFileString(path.join(cwd, "README.md"), "# moved on\n");
      yield* git(cwd, ["commit", "-am", "main moves on"]);

      const dashboard = yield* GitDashboardService.GitDashboardService;
      const overview = yield* dashboard.getOverview({ cwd });
      assert.strictEqual(overview.defaultBranch, "main");

      const comparison = yield* dashboard.getComparison({ cwd, base: "main", head: "feature" });
      assert.deepStrictEqual(
        comparison.commits.map((commit) => commit.subject),
        ["add feature"],
      );
      assert.strictEqual(comparison.behindCount, 1);
      // README changed only on main, so the branch's own changes are just the new file.
      assert.deepStrictEqual(
        comparison.files.map((file) => [file.change, file.path]),
        [["added", "feature.ts"]],
      );

      const diff = yield* dashboard.getFileDiff({
        cwd,
        path: "feature.ts",
        previousPath: null,
        area: "comparison",
        sha: comparison.headSha,
        baseSha: comparison.baseSha,
      });
      assert.include(diff.patch, "+export const a = 1;");

      const rejected = yield* dashboard
        .getComparison({ cwd, base: "main", head: "--output=/tmp/x" })
        .pipe(Effect.flip);
      assert.match(rejected.detail, /cannot start with/);
      const missing = yield* dashboard
        .getComparison({ cwd, base: "main", head: "nope" })
        .pipe(Effect.flip);
      assert.match(missing.detail, /Unknown branch nope/);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("reports non-repositories without failing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-git-dash-plain-" });
      const dashboard = yield* GitDashboardService.GitDashboardService;
      const overview = yield* dashboard.getOverview({ cwd });
      assert.isFalse(overview.isRepo);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects diff paths that escape the repository", () =>
    Effect.gen(function* () {
      const cwd = yield* makeRepo;
      const dashboard = yield* GitDashboardService.GitDashboardService;
      const error = yield* dashboard
        .getFileDiff({ cwd, path: "../../etc/passwd", previousPath: null, area: "untracked" })
        .pipe(Effect.flip);
      assert.match(error.detail, /relative to the repository root/);
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe("gitDashboardParsing", () => {
  it("parses conflicts, detached heads and ahead/behind counts", () => {
    const status = parsePorcelainV2Status(
      [
        "# branch.oid abc123",
        "# branch.head feature",
        "# branch.upstream origin/feature",
        "# branch.ab +2 -3",
        "u UU N... 100644 100644 100644 100644 h1 h2 h3 src/conflict file.ts",
        "",
      ].join("\0"),
      { outputTruncated: false, maxFiles: 100 },
    );
    assert.deepStrictEqual(status.head, {
      branch: "feature",
      sha: "abc123",
      detached: false,
      upstream: "origin/feature",
      aheadCount: 2,
      behindCount: 3,
    });
    assert.deepStrictEqual(
      status.conflicted.map((file) => file.path),
      ["src/conflict file.ts"],
    );
  });

  it("caps file lists and flags truncation", () => {
    const status = parsePorcelainV2Status(["? a", "? b", "? c", ""].join("\0"), {
      outputTruncated: false,
      maxFiles: 2,
    });
    assert.strictEqual(status.untracked.length, 2);
    assert.isTrue(status.truncated);
  });

  it("marks the main and current worktrees", () => {
    const worktrees = parseWorktreeList(
      [
        "worktree /repo",
        "HEAD aaa",
        "branch refs/heads/main",
        "",
        "worktree /repo-wt",
        "HEAD bbb",
        "detached",
        "locked",
        "",
        "",
      ].join("\0"),
      "/repo-wt",
    );
    assert.deepStrictEqual(
      worktrees.map((worktree) => [
        worktree.path,
        worktree.branch,
        worktree.isMain,
        worktree.isCurrent,
        worktree.detached,
        worktree.locked,
      ]),
      [
        ["/repo", "main", true, false, false, false],
        ["/repo-wt", null, false, true, true, true],
      ],
    );
  });

  it("reads renames from name-status output", () => {
    const parsed = parseNameStatus(
      ["M", "a.ts", "R100", "old.ts", "new.ts", "D", "gone.ts", ""].join("\0"),
      10,
    );
    assert.deepStrictEqual(
      parsed.files.map((file) => [file.change, file.path, file.previousPath]),
      [
        ["modified", "a.ts", null],
        ["renamed", "new.ts", "old.ts"],
        ["deleted", "gone.ts", null],
      ],
    );
  });

  it("only accepts branch names git cannot read as options or ranges", () => {
    assert.isTrue(isSafeRefName("feat/cutout-outline"));
    assert.isTrue(isSafeRefName("origin/main"));
    assert.isFalse(isSafeRefName("--all"));
    assert.isFalse(isSafeRefName("main..feature"));
    assert.isFalse(isSafeRefName("main feature"));
  });
});
