import { createTranslationEnvironmentAtoms } from "@t3tools/client-runtime/state/translation";

import { connectionAtomRuntime } from "../connection/runtime";

export const translationEnvironment = createTranslationEnvironmentAtoms(connectionAtomRuntime);
