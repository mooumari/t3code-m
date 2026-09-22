import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as NodeOS from "node:os";

import { TextGenerationError, type TranslateMessageInput } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";

/**
 * Builds the handler that translates a chat message with the text generation model from
 * Settings (or the project's override). It runs outside any thread, so the conversation
 * itself is untouched.
 */
export const makeTranslateMessage = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration;
  const settingsService = yield* ServerSettingsService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;

  return Effect.fn("translateMessage")(function* (input: TranslateMessageInput) {
    const project =
      input.projectId === undefined
        ? Option.none()
        : yield* snapshotQuery
            .getProjectShellById(input.projectId)
            .pipe(Effect.orElseSucceed(() => Option.none()));
    const environmentSettings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "translateText",
            detail: "Could not read the text generation model from settings.",
            cause,
          }),
      ),
    );
    const { settings } = resolveProjectSettings(environmentSettings, input.projectId ?? null);

    return yield* textGeneration.translateText({
      cwd: Option.match(project, {
        onNone: () => NodeOS.homedir(),
        onSome: (shell) => shell.workspaceRoot,
      }),
      text: input.text,
      context: input.context,
      targetLanguage: input.targetLanguage,
      instructions: input.instructions,
      modelSelection: settings.textGenerationModelSelection,
    });
  });
});
