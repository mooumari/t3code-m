import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createTurnSummaryEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    summarize: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:turn-summary:summarize",
      tag: WS_METHODS.turnSummarySummarize,
    }),
  };
}
