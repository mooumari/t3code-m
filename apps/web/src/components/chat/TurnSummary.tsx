import type { ScopedThreadRef, TurnSummaryResult } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { Atom } from "effect/unstable/reactivity";
import { useAtomValue } from "@effect/atom-react";
import { NotebookTextIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { turnSummaryEnvironment } from "~/state/turnSummary";
import { useAtomCommand } from "~/state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { MessageCopyButton } from "./MessageCopyButton";

interface TurnSummaryState {
  readonly result: TurnSummaryResult | null;
  readonly pending: boolean;
  readonly error: string | null;
}

const EMPTY: TurnSummaryState = { result: null, pending: false, error: null };

// Per thread and kept in memory, so it survives the working row remounting as the timeline
// scrolls, and reopening shows the last summary instead of paying for a new one.
const turnSummaryAtom = Atom.family((threadKey: string) =>
  Atom.make<TurnSummaryState>(EMPTY).pipe(
    Atom.keepAlive,
    Atom.withLabel(`turn-summary:${threadKey}`),
  ),
);

const update = (threadKey: string, next: (current: TurnSummaryState) => TurnSummaryState) => {
  const atom = turnSummaryAtom(threadKey);
  appAtomRegistry.set(atom, next(appAtomRegistry.get(atom)));
};

const describeFailure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The summary failed.";
};

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * "Catch me up" on the working row: a small model reads what the agent has done in this run
 * and says where it stands. The agent itself is never interrupted or told.
 */
export function TurnSummaryButton(props: {
  readonly threadRef: ScopedThreadRef;
  /** When the current run started; a summary from before it belongs to an older run. */
  readonly runStartedAt: string | null;
  readonly cwd: string | undefined;
}) {
  const threadKey = `${props.threadRef.environmentId}:${props.threadRef.threadId}`;
  const state = useAtomValue(turnSummaryAtom(threadKey));
  const [open, setOpen] = useState(false);
  const summarize = useAtomCommand(turnSummaryEnvironment.summarize, { reportFailure: false });

  const run = async () => {
    if (appAtomRegistry.get(turnSummaryAtom(threadKey)).pending) return;
    update(threadKey, (current) => ({ ...current, pending: true, error: null }));
    const result = await summarize({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId },
    });
    update(threadKey, (current) =>
      result._tag === "Success"
        ? { result: result.value, pending: false, error: null }
        : { ...current, pending: false, error: describeFailure(result.cause) },
    );
  };

  const isStale =
    state.result === null ||
    (props.runStartedAt !== null && state.result.generatedAt < props.runStartedAt);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && isStale) void run();
      }}
    >
      <PopoverTrigger
        render={<Button type="button" size="xs" variant="ghost-muted" aria-label="Catch me up" />}
      >
        <NotebookTextIcon aria-hidden />
        Catch me up
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" width="lg">
        <div className="flex flex-col gap-2">
          <header className="flex items-center gap-2">
            <PopoverTitle className="min-w-0 flex-1">What the agent is doing</PopoverTitle>
            {state.result && !isStale ? (
              <span className="shrink-0 text-muted-foreground text-xs">
                as of {timeOf(state.result.generatedAt)}
              </span>
            ) : null}
            {state.result && !isStale ? (
              <MessageCopyButton text={state.result.summary} size="icon-xs" variant="ghost" />
            ) : null}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Summarize again"
              disabled={state.pending}
              onClick={() => void run()}
            >
              <RefreshCwIcon />
            </Button>
          </header>
          {state.pending ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner className="size-3.5" /> Reading this run…
            </p>
          ) : state.error ? (
            <p className="text-destructive-foreground text-sm">{state.error}</p>
          ) : state.result && !isStale ? (
            <div className="max-h-[60vh] overflow-y-auto text-sm">
              <ChatMarkdown
                text={state.result.summary}
                cwd={props.cwd}
                threadRef={props.threadRef}
              />
            </div>
          ) : null}
          <p className="text-muted-foreground/70 text-xs">
            Written by your text generation model from this run's messages and steps. The agent
            isn't interrupted.
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
