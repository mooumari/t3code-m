import { ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { makeSummarizeTurn } from "./summarizeTurn.ts";

const prompts: string[] = [];
const unused = () => Effect.die("not used by the turn summary");
const TextGenerationStub = Layer.succeed(TextGeneration, {
  generateCommitMessage: unused,
  generatePrContent: unused,
  generateBranchName: unused,
  generateThreadTitle: unused,
  generateText: (input) => {
    prompts.push(input.prompt);
    return Effect.succeed({ text: "**Goal**: fix the test." });
  },
});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const layer = it.layer(
  Layer.mergeAll(SqlitePersistenceMemory, TextGenerationStub, ServerSettings.layerTest()),
);

layer("summarizeTurn", (it) => {
  it.effect("summarizes a run from its request, messages and steps, not tool output", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-summary");
      yield* sql`
        INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('project-1', 'Repo', '/repo', '[]', '2026-09-23T10:00:00.000Z', '2026-09-23T10:00:00.000Z')
      `;
      yield* sql`
        INSERT INTO projection_threads (thread_id, project_id, title, latest_turn_id, created_at, updated_at)
        VALUES (${threadId}, 'project-1', 'Thread', 'turn-2', '2026-09-23T10:00:00.000Z', '2026-09-23T10:00:00.000Z')
      `;
      yield* sql`
        INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, started_at, checkpoint_files_json)
        VALUES
          (${threadId}, 'turn-1', 'user-1', 'completed', '2026-09-23T09:00:00.000Z', '2026-09-23T09:00:00.000Z', '[]'),
          (${threadId}, 'turn-2', 'user-2', 'running', '2026-09-23T10:00:00.000Z', '2026-09-23T10:00:00.000Z', '[]')
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
        VALUES
          ('user-1', ${threadId}, NULL, 'user', 'An older request', 0, '2026-09-23T09:00:00.000Z', '2026-09-23T09:00:00.000Z'),
          ('old-reply', ${threadId}, 'turn-1', 'assistant', 'An older reply', 0, '2026-09-23T09:01:00.000Z', '2026-09-23T09:01:00.000Z'),
          ('user-2', ${threadId}, NULL, 'user', 'Fix the flaky server test', 0, '2026-09-23T10:00:00.000Z', '2026-09-23T10:00:00.000Z'),
          ('reply', ${threadId}, 'turn-2', 'assistant', 'Found it: a race in ready().', 0, '2026-09-23T10:05:00.000Z', '2026-09-23T10:05:00.000Z')
      `;
      const claudeCommand = encodeJson({
        itemType: "command_execution",
        toolCallId: "call-1",
        status: "completed",
        title: "Command run",
        detail: "Bash: vp test run",
        data: {
          toolName: "Bash",
          input: { command: "vp test run", description: "Run the server tests" },
          result: { content: "SECRET TOOL OUTPUT" },
        },
      });
      const codexEdit = encodeJson({
        itemType: "file_change",
        toolCallId: "call-2",
        status: "completed",
        data: { item: { changes: [{ path: "/repo/src/server.ts", diff: "SECRET DIFF" }] } },
      });
      yield* sql`
        INSERT INTO projection_thread_activities (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at)
        VALUES
          ('a1', ${threadId}, 'turn-2', 'tool', 'tool.completed', 'Command run', ${claudeCommand}, 1, '2026-09-23T10:02:00.000Z'),
          ('a2', ${threadId}, 'turn-2', 'tool', 'tool.completed', 'File change', ${codexEdit}, 2, '2026-09-23T10:03:00.000Z')
      `;

      const summarizeTurn = yield* makeSummarizeTurn;
      const result = yield* summarizeTurn({ threadId });

      assert.strictEqual(result.summary, "**Goal**: fix the test.");
      assert.strictEqual(result.turnState, "running");
      const prompt = prompts.at(-1) ?? "";
      assert.include(prompt, "Fix the flaky server test");
      assert.include(prompt, "Found it: a race in ready().");
      assert.include(prompt, "Run the server tests");
      assert.include(prompt, "Edited src/server.ts");
      assert.notInclude(prompt, "An older");
      assert.notInclude(prompt, "SECRET");

      const older = yield* summarizeTurn({ threadId, turnId: TurnId.make("turn-1") });
      assert.strictEqual(older.turnState, "completed");
      const olderPrompt = prompts.at(-1) ?? "";
      assert.include(olderPrompt, "An older request");
      assert.include(olderPrompt, "An older reply");
      assert.notInclude(olderPrompt, "Fix the flaky server test");
    }),
  );

  it.effect("fails clearly when the thread has not run yet", () =>
    Effect.gen(function* () {
      const summarizeTurn = yield* makeSummarizeTurn;
      const error = yield* summarizeTurn({ threadId: ThreadId.make("no-such-thread") }).pipe(
        Effect.flip,
      );
      assert.strictEqual(error.detail, "This thread has no run to summarize yet.");
    }),
  );
});
