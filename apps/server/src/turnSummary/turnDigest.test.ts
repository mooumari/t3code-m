import { describe, expect, it } from "vite-plus/test";

import {
  buildTurnDigest,
  describeStep,
  mergeStepRows,
  type StepActivityRow,
} from "./turnDigest.ts";

const row = (overrides: Partial<StepActivityRow>): StepActivityRow => ({
  kind: "tool.updated",
  summary: "Command run",
  toolCallId: "call-1",
  itemType: "command_execution",
  title: "Command run",
  detail: null,
  status: "inProgress",
  description: null,
  filePath: null,
  changedPaths: null,
  ...overrides,
});

const digestInput = {
  request: "Fix the flaky server test.",
  state: "running" as const,
  startedAt: "2026-09-23T10:00:00.000Z",
  completedAt: null,
  now: "2026-09-23T12:00:00.000Z",
  waitingFor: null,
  agentMessages: [],
  steps: [],
  changedFiles: [],
  workspaceRoot: "/repo",
};

describe("mergeStepRows", () => {
  it("folds a call's rows into one step, keeping fields that only some rows carry", () => {
    const steps = mergeStepRows([
      row({ kind: "tool.started", detail: "Bash: {}" }),
      row({ kind: "tool.updated", detail: "Bash: vp test run src/server.test.ts" }),
      row({ kind: "tool.completed", status: "failed", description: "Run the server tests" }),
      row({ toolCallId: "call-2", kind: "tool.started", itemType: "file_change" }),
    ]);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      detail: "Bash: vp test run src/server.test.ts",
      description: "Run the server tests",
      status: "failed",
      finished: true,
    });
    expect(steps[1]).toMatchObject({ itemType: "file_change", finished: false });
  });

  it("keeps runtime errors as their own steps", () => {
    const steps = mergeStepRows([
      row({ kind: "runtime.error", summary: "Provider crashed", toolCallId: null }),
    ]);
    expect(describeStep(steps[0]!, null)).toBe("FAILED Error: Provider crashed");
  });
});

describe("describeStep", () => {
  const [base] = mergeStepRows([row({ kind: "tool.completed", status: "completed" })]);

  it("prefers the agent's own description, then edited paths, then the raw detail", () => {
    expect(describeStep({ ...base!, description: "Check GitHub auth" }, "/repo")).toBe(
      "Check GitHub auth",
    );
    expect(
      describeStep(
        { ...base!, itemType: "file_change", changedPaths: "/repo/a.rs\n/repo/src/b.rs" },
        "/repo",
      ),
    ).toBe("Edited a.rs, src/b.rs");
    expect(describeStep({ ...base!, detail: "Bash: cd /repo/app && cargo test" }, "/repo")).toBe(
      "Bash: cd app && cargo test",
    );
  });

  it("drops steps that say nothing and marks unfinished ones", () => {
    expect(describeStep({ ...base!, detail: "Bash: {}" }, null)).toBeNull();
    expect(describeStep({ ...base!, finished: false, description: "Build" }, null)).toBe(
      "RUNNING Build",
    );
  });
});

describe("buildTurnDigest", () => {
  it("states how long the run has gone and what it waits for", () => {
    const digest = buildTurnDigest({ ...digestInput, waitingFor: "approval" });
    expect(digest).toContain("Run status: still running (120 min so far).");
    expect(digest).toContain("waiting for the developer's approval");
    expect(digest).toContain("Fix the flaky server test.");
  });

  it("keeps the start and the latest work of a long run within budget", () => {
    const steps = mergeStepRows(
      Array.from({ length: 2_000 }, (_, index) =>
        row({
          kind: "tool.completed",
          toolCallId: `call-${index}`,
          status: "completed",
          description: `Step number ${index} with a reasonably long description of the work`,
        }),
      ),
    );
    const digest = buildTurnDigest({
      ...digestInput,
      steps,
      agentMessages: Array.from({ length: 300 }, (_, index) => `Message ${index}. `.repeat(20)),
    });

    expect(digest.length).toBeLessThan(25_000);
    expect(digest).toContain("Step number 0 with");
    expect(digest).toContain("Step number 1999 with");
    expect(digest).toContain("Message 0.");
    expect(digest).toContain("Message 299.");
    expect(digest).toMatch(/\[… \d+ omitted …\]/);
  });
});

describe("mergeStepRows without call ids", () => {
  it("counts completed rows once and keeps only the call running now", () => {
    const untracked = (kind: string, description: string) =>
      row({
        kind,
        toolCallId: null,
        description,
        status: kind === "tool.completed" ? "completed" : "inProgress",
      });
    const steps = mergeStepRows([
      untracked("tool.started", "Read"),
      untracked("tool.updated", "Read"),
      untracked("tool.completed", "Read"),
      untracked("tool.started", "Test"),
      untracked("tool.updated", "Test"),
    ]);
    expect(steps.map((step) => describeStep(step, null))).toEqual(["Read", "RUNNING Test"]);
  });
});
