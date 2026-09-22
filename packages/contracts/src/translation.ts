import * as Schema from "effect/Schema";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { TextGenerationError } from "./git.ts";

export const TRANSLATE_MESSAGE_TEXT_MAX_LENGTH = 60_000;
export const TRANSLATE_MESSAGE_CONTEXT_MAX_LENGTH = 8_000;
export const TRANSLATE_MESSAGE_INSTRUCTIONS_MAX_LENGTH = 2_000;

/** Translates one chat message with the environment's text generation model. */
export const TranslateMessageInput = Schema.Struct({
  /** Picks up the project's text generation model override, when it has one. */
  projectId: Schema.optionalKey(ProjectId),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(TRANSLATE_MESSAGE_TEXT_MAX_LENGTH)),
  /** The user message the text answers; helps the model pick the right terms. */
  context: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(TRANSLATE_MESSAGE_CONTEXT_MAX_LENGTH)),
  ),
  targetLanguage: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  /** The user's style, such as "explain it simply"; omitted means a faithful translation. */
  instructions: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(TRANSLATE_MESSAGE_INSTRUCTIONS_MAX_LENGTH)),
  ),
});
export type TranslateMessageInput = typeof TranslateMessageInput.Type;

export const TranslateMessageResult = Schema.Struct({
  translation: Schema.String,
});
export type TranslateMessageResult = typeof TranslateMessageResult.Type;

export const TranslateMessageError = TextGenerationError;
