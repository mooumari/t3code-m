import { createGitDashboardEnvironmentAtoms } from "@t3tools/client-runtime/state/gitDashboard";

import { connectionAtomRuntime } from "../connection/runtime";

export const gitDashboardEnvironment = createGitDashboardEnvironmentAtoms(connectionAtomRuntime);
