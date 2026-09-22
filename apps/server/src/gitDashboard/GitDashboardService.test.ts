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
import { parsePorcelainV2Status, parseWorktreeList } from "./gitDashboardParsing.ts";

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
      assert.strictEqual(overview.commits[0]?.subject, "initial commit");
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
});
