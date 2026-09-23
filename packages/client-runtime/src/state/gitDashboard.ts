import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createGitDashboardEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // Polls only while the dashboard is mounted; the short idle TTL stops git work soon after.
    overview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-dashboard:overview",
      tag: WS_METHODS.gitDashboardGetOverview,
      staleTimeMs: 2_000,
      refreshIntervalMs: 10_000,
      idleTtlMs: 5_000,
    }),
    fileDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-dashboard:file-diff",
      tag: WS_METHODS.gitDashboardGetFileDiff,
      staleTimeMs: 2_000,
      idleTtlMs: 30_000,
    }),
    // Refreshed by the dashboard when the working copy changes, not on a timer.
    graph: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-dashboard:graph",
      tag: WS_METHODS.gitDashboardGetGraph,
      staleTimeMs: 2_000,
      idleTtlMs: 30_000,
    }),
    // A commit never changes, so its details can stay cached for a long time.
    commit: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-dashboard:commit",
      tag: WS_METHODS.gitDashboardGetCommit,
      staleTimeMs: 10 * 60_000,
      idleTtlMs: 60_000,
    }),
    // Branch review; refreshed with the graph when history changes.
    comparison: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-dashboard:comparison",
      tag: WS_METHODS.gitDashboardGetComparison,
      staleTimeMs: 2_000,
      idleTtlMs: 30_000,
    }),
    setStaged: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-dashboard:set-staged",
      tag: WS_METHODS.gitDashboardSetStaged,
    }),
  };
}
