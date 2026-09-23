import type { ScopedThreadRef, TurnId, TurnSummaryResult } from "@t3tools/contracts";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MessageCopyButton } from "./MessageCopyButton";

interface TurnSummaryState {
  readonly result: TurnSummaryResult | null;
  readonly pending: boolean;
  readonly error: string | null;
}

const EMPTY: TurnSummaryState = { result: null, pending: false, error: null };

// Per run (the current one, or a finished one by id) and kept in memory, so it survives rows
// remounting as the timeline scrolls, and reopening shows the last summary instead of paying
// for a new one.
const turnSummaryAtom = Atom.family((runKey: string) =>
  Atom.make<TurnSummaryState>(EMPTY).pipe(Atom.keepAlive, Atom.withLabel(`turn-summary:${runKey}`)),
);

const update = (runKey: string, next: (current: TurnSummaryState) => TurnSummaryState) => {
  const atom = turnSummaryAtom(runKey);
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
 * "Catch me up": a small model reads what the agent did in a run and says where it stands. The
 * agent itself is never interrupted or told. On the working row it covers the run in progress
 * (`runStartedAt`); on a finished reply it covers that reply's run (`turnId`).
 */
export function TurnSummaryButton(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
  /** A finished run to recap. Without it, the thread's current run. */
  readonly turnId?: TurnId | undefined;
  /** When the current run started; a summary from before it belongs to an older run. */
  readonly runStartedAt?: string | null | undefined;
}) {
  const { turnId, runStartedAt = null } = props;
  const runKey = `${props.threadRef.environmentId}:${props.threadRef.threadId}:${turnId ?? "current"}`;
  const state = useAtomValue(turnSummaryAtom(runKey));
  const [open, setOpen] = useState(false);
  const summarize = useAtomCommand(turnSummaryEnvironment.summarize, { reportFailure: false });

  const run = async () => {
    if (appAtomRegistry.get(turnSummaryAtom(runKey)).pending) return;
    update(runKey, (current) => ({ ...current, pending: true, error: null }));
    const result = await summarize({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId, ...(turnId ? { turnId } : {}) },
    });
    update(runKey, (current) =>
      result._tag === "Success"
        ? { result: result.value, pending: false, error: null }
        : { ...current, pending: false, error: describeFailure(result.cause) },
    );
  };

  // A finished run's recap only goes stale if it was written while the run was still going.
  const isStale =
    state.result === null ||
    (turnId
      ? state.result.turnState === "running"
      : runStartedAt !== null && state.result.generatedAt < runStartedAt);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && isStale) void run();
      }}
    >
      {turnId ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button type="button" size="xs" variant="ghost" aria-label="Recap this run" />
                }
              />
            }
          >
            <NotebookTextIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup>
            <p>Recap this run</p>
          </TooltipPopup>
        </Tooltip>
      ) : (
        <PopoverTrigger
          render={<Button type="button" size="xs" variant="ghost-muted" aria-label="Catch me up" />}
        >
          <NotebookTextIcon aria-hidden />
          Catch me up
        </PopoverTrigger>
      )}
      <PopoverPopup side={turnId ? "top" : "bottom"} align="start" width="lg">
        <div className="flex flex-col gap-2">
          <header className="flex items-center gap-2">
            <PopoverTitle className="min-w-0 flex-1">
              {turnId ? "What the agent did" : "What the agent is doing"}
            </PopoverTitle>
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
            Written by your text generation model from this run's messages and steps.
            {turnId ? null : " The agent isn't interrupted."}
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
