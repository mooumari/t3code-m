import * as Schema from "effect/Schema";
import { IsoDateTime, ThreadId } from "./baseSchemas.ts";
import { TextGenerationError } from "./git.ts";

/** Summarizes a thread's latest run with the text generation model; the agent is untouched. */
export const TurnSummaryInput = Schema.Struct({
  threadId: ThreadId,
});
export type TurnSummaryInput = typeof TurnSummaryInput.Type;

export const TurnSummaryResult = Schema.Struct({
  /** Markdown: goal, what is done, what the agent is on now, anything needing attention. */
  summary: Schema.String,
  turnState: Schema.Literals(["running", "interrupted", "completed", "error"]),
  generatedAt: IsoDateTime,
});
export type TurnSummaryResult = typeof TurnSummaryResult.Type;

export const TurnSummaryError = TextGenerationError;
export type TurnSummaryError = typeof TurnSummaryError.Type;
