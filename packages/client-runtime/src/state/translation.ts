import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createTranslationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    translateMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:translation:translate-message",
      tag: WS_METHODS.translationTranslateMessage,
    }),
  };
}
