import { createTurnSummaryEnvironmentAtoms } from "@t3tools/client-runtime/state/turnSummary";

import { connectionAtomRuntime } from "../connection/runtime";

export const turnSummaryEnvironment = createTurnSummaryEnvironmentAtoms(connectionAtomRuntime);
