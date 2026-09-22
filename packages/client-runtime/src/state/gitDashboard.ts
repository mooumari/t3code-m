import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

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
  };
}
