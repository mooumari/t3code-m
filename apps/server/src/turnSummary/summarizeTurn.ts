import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeOS from "node:os";

import {
  OrchestrationCheckpointFile,
  type ProjectId,
  TextGenerationError,
  type TurnSummaryInput,
  type TurnSummaryResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import {
  buildTurnDigest,
  buildTurnSummaryPrompt,
  mergeStepRows,
  type StepActivityRow,
} from "./turnDigest.ts";

const failure = (detail: string, cause?: unknown) =>
  new TextGenerationError({ operation: "generateText", detail, cause });

const decodeCheckpointFiles = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
);

const TURN_STATES = new Set(["running", "interrupted", "completed", "error"]);

/**
 * Builds the handler that summarizes a thread's latest run with the text generation model from
 * Settings. It only reads what the run recorded, reading small payload fields in SQL rather
 * than whole tool outputs, and runs outside the thread, so the agent never sees it.
 */
export const makeSummarizeTurn = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const textGeneration = yield* TextGeneration;
  const settingsService = yield* ServerSettingsService;

  const read = Effect.fn("summarizeTurn.read")(function* (threadId: string) {
    const [thread] = yield* sql<{
      readonly latestTurnId: string | null;
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
      readonly workspaceRoot: string | null;
      readonly pendingApprovals: number;
      readonly pendingUserInputs: number;
    }>`
      SELECT t.latest_turn_id AS "latestTurnId", t.project_id AS "projectId",
        t.worktree_path AS "worktreePath", p.workspace_root AS "workspaceRoot",
        t.pending_approval_count AS "pendingApprovals",
        t.pending_user_input_count AS "pendingUserInputs"
      FROM projection_threads t
      LEFT JOIN projection_projects p ON p.project_id = t.project_id
      WHERE t.thread_id = ${threadId}
    `;
    if (!thread?.latestTurnId) return null;
    const turnId = thread.latestTurnId;

    const [turn] = yield* sql<{
      readonly state: string;
      readonly startedAt: string | null;
      readonly requestedAt: string;
      readonly completedAt: string | null;
      readonly pendingMessageId: string | null;
      readonly checkpointFiles: string | null;
    }>`
      SELECT state, started_at AS "startedAt", requested_at AS "requestedAt",
        completed_at AS "completedAt", pending_message_id AS "pendingMessageId",
        checkpoint_files_json AS "checkpointFiles"
      FROM projection_turns
      WHERE thread_id = ${threadId} AND turn_id = ${turnId}
    `;
    if (!turn) return null;

    const [request] =
      turn.pendingMessageId === null
        ? []
        : yield* sql<{ readonly text: string }>`
            SELECT text FROM projection_thread_messages WHERE message_id = ${turn.pendingMessageId}
          `;
    const agentMessages = yield* sql<{ readonly text: string }>`
      SELECT text FROM projection_thread_messages
      WHERE thread_id = ${threadId} AND turn_id = ${turnId} AND role = 'assistant'
      ORDER BY created_at
    `;
    const stepRows = yield* sql<StepActivityRow>`
      SELECT kind, summary,
        json_extract(payload_json, '$.toolCallId') AS "toolCallId",
        json_extract(payload_json, '$.itemType') AS "itemType",
        json_extract(payload_json, '$.title') AS "title",
        substr(json_extract(payload_json, '$.detail'), 1, 300) AS "detail",
        json_extract(payload_json, '$.status') AS "status",
        substr(json_extract(payload_json, '$.data.input.description'), 1, 300) AS "description",
        json_extract(payload_json, '$.data.input.file_path') AS "filePath",
        (SELECT group_concat(json_extract(change.value, '$.path'), char(10))
          FROM json_each(json_extract(payload_json, '$.data.item.changes')) AS change) AS "changedPaths"
      FROM projection_thread_activities
      WHERE thread_id = ${threadId} AND turn_id = ${turnId}
        AND kind IN ('tool.started', 'tool.updated', 'tool.completed', 'runtime.error')
      ORDER BY sequence, created_at
    `;

    return { thread, turn, request: request?.text ?? "", agentMessages, stepRows };
  });

  return Effect.fn("summarizeTurn")(function* (input: TurnSummaryInput) {
    const run = yield* read(input.threadId).pipe(
      Effect.mapError((cause) => failure("Could not read the run.", cause)),
    );
    if (run === null) return yield* failure("This thread has no run to summarize yet.");
    const { thread, turn } = run;
    const turnState = TURN_STATES.has(turn.state)
      ? (turn.state as TurnSummaryResult["turnState"])
      : "running";

    const changedFiles = Option.match(decodeCheckpointFiles(turn.checkpointFiles ?? "[]"), {
      onNone: () => [],
      onSome: (files) => files.map((file) => file.path),
    });

    const now = DateTime.formatIso(yield* DateTime.now);
    const digest = buildTurnDigest({
      request: run.request,
      state: turnState,
      startedAt: turn.startedAt ?? turn.requestedAt,
      completedAt: turnState === "running" ? null : turn.completedAt,
      now,
      waitingFor:
        thread.pendingApprovals > 0 ? "approval" : thread.pendingUserInputs > 0 ? "input" : null,
      agentMessages: run.agentMessages.map((message) => message.text),
      steps: mergeStepRows(run.stepRows),
      changedFiles,
      workspaceRoot: thread.worktreePath ?? thread.workspaceRoot,
    });

    const environmentSettings = yield* settingsService.getSettings.pipe(
      Effect.mapError((cause) =>
        failure("Could not read the text generation model from settings.", cause),
      ),
    );
    const { settings } = resolveProjectSettings(environmentSettings, thread.projectId);
    const generated = yield* textGeneration.generateText({
      cwd: thread.workspaceRoot ?? NodeOS.homedir(),
      prompt: buildTurnSummaryPrompt(digest),
      modelSelection: settings.textGenerationModelSelection,
    });

    return { summary: generated.text, turnState, generatedAt: now };
  });
});
