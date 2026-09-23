/**
 * Turns one run's recorded work into a compact text a small model can summarize. Tool output
 * is never included: it is most of the bytes and says little about progress. Long runs keep
 * their start and their latest work and drop the middle.
 */

/** The fields of one tool call that describe it, merged over its started/updated/completed rows. */
export interface TurnStep {
  readonly kind: "tool" | "subagent" | "error";
  readonly itemType: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  /** The agent's own words for the call, such as Claude's Bash `description`. */
  readonly description: string | null;
  readonly filePath: string | null;
  /** Newline-separated, for providers that report several files per change (Codex). */
  readonly changedPaths: string | null;
  readonly status: string | null;
  readonly finished: boolean;
}

export interface TurnDigestInput {
  readonly request: string;
  readonly state: "running" | "interrupted" | "completed" | "error";
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly now: string;
  readonly waitingFor: "approval" | "input" | null;
  readonly agentMessages: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<TurnStep>;
  readonly changedFiles: ReadonlyArray<string>;
  /** Stripped from paths to keep lines short. */
  readonly workspaceRoot: string | null;
}

const REQUEST_BUDGET = 3_000;
const MESSAGES_BUDGET = 10_000;
const MESSAGES_HEAD = 2_000;
const MESSAGE_MAX = 3_000;
const STEPS_BUDGET = 8_000;
const STEPS_HEAD = 1_500;
const STEP_LINE_MAX = 160;
const MAX_CHANGED_FILES = 40;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const relative = (text: string, root: string | null) =>
  root ? text.replaceAll(`${root}/`, "") : text;

/** A tool or error activity of the run, with only the small payload fields read from the database. */
export interface StepActivityRow {
  readonly kind: string;
  readonly summary: string;
  readonly toolCallId: string | null;
  readonly itemType: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  readonly status: string | null;
  readonly description: string | null;
  readonly filePath: string | null;
  readonly changedPaths: string | null;
}

/**
 * Folds each tool call's started/updated/completed rows into one step, in the order the calls
 * began. Later rows fill in what earlier ones lacked (Claude only sends the input on completion).
 * Older runs recorded no call id, so there only completed rows count, plus the latest row after
 * the last completion: the call running now.
 */
export function mergeStepRows(rows: ReadonlyArray<StepActivityRow>): TurnStep[] {
  const lastCompleted = rows.findLastIndex((row) => row.kind === "tool.completed");
  const lastUntracked = rows.findLastIndex((row) => row.toolCallId === null);
  const steps: TurnStep[] = [];
  const byCall = new Map<string, number>();
  for (const [position, row] of rows.entries()) {
    const untrackedNoise =
      row.toolCallId === null &&
      row.kind !== "tool.completed" &&
      row.kind !== "runtime.error" &&
      !(position > lastCompleted && position === lastUntracked);
    if (untrackedNoise) continue;
    if (row.kind === "runtime.error") {
      steps.push({
        kind: "error",
        itemType: null,
        title: null,
        detail: row.summary,
        description: null,
        filePath: null,
        changedPaths: null,
        status: "failed",
        finished: true,
      });
      continue;
    }
    const index = row.toolCallId === null ? undefined : byCall.get(row.toolCallId);
    const previous = index === undefined ? undefined : steps[index];
    const itemType = row.itemType ?? previous?.itemType ?? null;
    const step: TurnStep = {
      kind: itemType === "collab_agent_tool_call" ? "subagent" : "tool",
      itemType,
      title: row.title ?? previous?.title ?? null,
      detail: row.detail ?? previous?.detail ?? null,
      description: row.description ?? previous?.description ?? null,
      filePath: row.filePath ?? previous?.filePath ?? null,
      changedPaths: row.changedPaths ?? previous?.changedPaths ?? null,
      status: row.status ?? previous?.status ?? null,
      finished: row.kind === "tool.completed" || (previous?.finished ?? false),
    };
    if (index === undefined) {
      if (row.toolCallId !== null) byCall.set(row.toolCallId, steps.length);
      steps.push(step);
    } else {
      steps[index] = step;
    }
  }
  return steps;
}

/** One short line per step, or null for steps that say nothing (a bare "Command run"). */
export function describeStep(step: TurnStep, root: string | null): string | null {
  const status = step.status === "failed" ? "FAILED " : !step.finished ? "RUNNING " : "";
  const paths = step.changedPaths
    ? step.changedPaths.split("\n").filter(Boolean)
    : step.filePath
      ? [step.filePath]
      : [];

  let text: string | null;
  if (step.kind === "subagent") {
    text = `Subagent: ${step.description ?? step.title ?? step.detail ?? "task"}`;
  } else if (step.kind === "error") {
    text = `Error: ${step.detail ?? step.title ?? "unknown"}`;
  } else if (step.itemType === "file_change" && paths.length > 0) {
    text = `Edited ${paths.map((path) => relative(path, root)).join(", ")}`;
  } else if (step.description) {
    text = step.description;
  } else if (step.filePath) {
    text = `${step.title ?? "Read"} ${relative(step.filePath, root)}`;
  } else if (step.detail && step.detail !== "{}" && !step.detail.endsWith(": {}")) {
    text = step.detail;
  } else {
    text = null;
  }
  return text === null ? null : clip(`${status}${oneLine(relative(text, root))}`, STEP_LINE_MAX);
}

/** Keeps the head and the tail within `budget`, noting what was dropped. */
function keepHeadAndTail(parts: ReadonlyArray<string>, budget: number, head: number) {
  const total = parts.reduce((sum, part) => sum + part.length + 1, 0);
  if (total <= budget) return [...parts];
  const kept: string[] = [];
  let used = 0;
  let start = 0;
  for (; start < parts.length && used < head; start++) {
    kept.push(parts[start]!);
    used += parts[start]!.length + 1;
  }
  const tail: string[] = [];
  let end = parts.length;
  while (end > start && used + parts[end - 1]!.length + 1 <= budget) {
    tail.unshift(parts[end - 1]!);
    used += parts[end - 1]!.length + 1;
    end--;
  }
  return end > start ? [...kept, `[… ${end - start} omitted …]`, ...tail] : [...kept, ...tail];
}

const minutesBetween = (from: string | null, to: string) =>
  from === null ? null : Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));

export function buildTurnDigest(input: TurnDigestInput): string {
  const lines = input.steps.flatMap((step) => {
    const line = describeStep(step, input.workspaceRoot);
    return line === null ? [] : [line];
  });
  const failed = input.steps.filter((step) => step.status === "failed").length;
  const minutes = minutesBetween(input.startedAt, input.completedAt ?? input.now);
  const status =
    input.state === "running"
      ? `still running${minutes === null ? "" : ` (${minutes} min so far)`}`
      : `${input.state}${minutes === null ? "" : ` after ${minutes} min`}`;

  return [
    `Run status: ${status}.`,
    ...(input.waitingFor ? [`The agent is waiting for the developer's ${input.waitingFor}.`] : []),
    "",
    "## The developer's request",
    clip(input.request.trim(), REQUEST_BUDGET),
    "",
    "## What the agent wrote during the run (oldest first)",
    ...(input.agentMessages.length === 0
      ? ["(nothing yet)"]
      : keepHeadAndTail(
          input.agentMessages.map((message) => clip(message.trim(), MESSAGE_MAX)).filter(Boolean),
          MESSAGES_BUDGET,
          MESSAGES_HEAD,
        )),
    "",
    `## Steps (${input.steps.length} tool calls, ${failed} failed; oldest first)`,
    ...(lines.length === 0 ? ["(none yet)"] : keepHeadAndTail(lines, STEPS_BUDGET, STEPS_HEAD)),
    ...(input.changedFiles.length > 0
      ? [
          "",
          "## Files changed in this run",
          ...input.changedFiles
            .slice(0, MAX_CHANGED_FILES)
            .map((path) => relative(path, input.workspaceRoot)),
          ...(input.changedFiles.length > MAX_CHANGED_FILES
            ? [`and ${input.changedFiles.length - MAX_CHANGED_FILES} more`]
            : []),
        ]
      : []),
  ].join("\n");
}

export function buildTurnSummaryPrompt(digest: string): string {
  return [
    "A developer started a coding agent on a task and stepped away. Using the run log below, tell them what the agent is doing and what it has achieved so far in this run.",
    "",
    "Write markdown with these sections, in this order:",
    "**Goal**: one sentence on what the developer asked for.",
    "**Done so far**: 2-6 short bullets of concrete progress (findings, files changed, tests passing or failing). Oldest first.",
    "**Now**: one or two sentences on what the agent is working on right now. If the run has ended, say how it ended instead.",
    "**Needs attention**: only if the agent is waiting for the developer, failing repeatedly, stuck in a loop, or drifting from the request. Leave the section out otherwise.",
    "",
    "Rules:",
    "- Use only what the log shows. Do not guess at results the log does not contain.",
    "- Be specific: name files, commands and outcomes. No filler.",
    "- Under 180 words. Write in the language of the developer's request.",
    "- Return only the summary in `text`.",
    "",
    "Run log:",
    digest,
  ].join("\n");
}
