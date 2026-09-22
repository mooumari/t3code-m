import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";
import { LanguagesIcon, XIcon } from "lucide-react";
import { memo, useState, type FormEvent } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readThreadShell } from "~/state/entities";
import { environmentThreadDetails } from "~/state/threads";
import { translationEnvironment } from "~/state/translation";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ChatMessage } from "~/types";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MessageCopyButton } from "./MessageCopyButton";

type TranslationState =
  | { readonly status: "pending"; readonly language: string }
  | { readonly status: "done"; readonly language: string; readonly translation: string }
  | { readonly status: "failed"; readonly language: string; readonly error: string };

/** One translation per message, kept while the app runs so scrolling away does not drop it. */
const translationAtom = Atom.family((messageId: string) =>
  Atom.make<TranslationState | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`translation:${messageId}`),
  ),
);

const RECENT_LANGUAGES_KEY = "t3code:translate:recent-languages";
const RECENT_LANGUAGES_LIMIT = 6;
const RecentLanguages = Schema.Array(Schema.String);
const SUGGESTED_LANGUAGES = ["Arabic", "Spanish", "French", "German", "Chinese", "Japanese"];

/** The user message the assistant message answers, sent along so terms translate correctly. */
function findPrecedingUserText(threadRef: ScopedThreadRef, messageId: string): string | undefined {
  const messages = appAtomRegistry.get(environmentThreadDetails.detailAtom(threadRef))?.messages;
  if (!messages) return undefined;
  const index = messages.findIndex((message) => message.id === messageId);
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = messages[cursor];
    if (candidate?.role === "user" && candidate.text.trim().length > 0) {
      return candidate.text.slice(0, 8_000);
    }
  }
  return undefined;
}

function useTranslateMessage(message: ChatMessage, threadRef: ScopedThreadRef) {
  const translate = useAtomCommand(translationEnvironment.translateMessage, {
    reportFailure: false,
  });
  return async (language: string) => {
    const atom = translationAtom(message.id);
    appAtomRegistry.set(atom, { status: "pending", language });
    const context = findPrecedingUserText(threadRef, message.id);
    const projectId = readThreadShell(threadRef)?.projectId;
    const result = await translate({
      environmentId: threadRef.environmentId,
      input: {
        text: message.text,
        targetLanguage: language,
        ...(context ? { context } : {}),
        ...(projectId ? { projectId } : {}),
      },
    });
    // A newer request for another language owns the state now.
    const current = appAtomRegistry.get(atom);
    if (current?.status !== "pending" || current.language !== language) return;
    appAtomRegistry.set(
      atom,
      result._tag === "Success"
        ? { status: "done", language, translation: result.value.translation }
        : { status: "failed", language, error: describeFailure(result.cause) },
    );
  };
}

function describeFailure(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The translation failed.";
}

export const MessageTranslateButton = memo(function MessageTranslateButton({
  message,
  threadRef,
}: {
  message: ChatMessage;
  threadRef: ScopedThreadRef | null;
}) {
  if (threadRef === null || message.streaming || message.text.trim().length === 0) return null;
  return <MessageTranslateControl message={message} threadRef={threadRef} />;
});

function MessageTranslateControl({
  message,
  threadRef,
}: {
  message: ChatMessage;
  threadRef: ScopedThreadRef;
}) {
  const [open, setOpen] = useState(false);
  const [recentLanguages, setRecentLanguages] = useLocalStorage(
    RECENT_LANGUAGES_KEY,
    [] as ReadonlyArray<string>,
    RecentLanguages,
  );
  const [draft, setDraft] = useState(recentLanguages[0] ?? "");
  const translate = useTranslateMessage(message, threadRef);

  const start = (rawLanguage: string) => {
    const language = rawLanguage.trim().slice(0, 64);
    if (language.length === 0) return;
    setRecentLanguages((previous) =>
      [
        language,
        ...previous.filter((entry) => entry.toLowerCase() !== language.toLowerCase()),
      ].slice(0, RECENT_LANGUAGES_LIMIT),
    );
    setOpen(false);
    void translate(language);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    start(draft);
  };
  const quickPicks = recentLanguages.length > 0 ? recentLanguages : SUGGESTED_LANGUAGES;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button aria-label="Translate message" type="button" size="xs" variant="ghost" />
              }
            />
          }
        >
          <LanguagesIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup>
          <p>Translate message</p>
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup side="top" align="start" width="md">
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <PopoverTitle>Translate this message</PopoverTitle>
          <div className="flex gap-2">
            <Input
              autoFocus
              aria-label="Target language"
              placeholder="Any language, e.g. Arabic"
              size="sm"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={draft.trim().length === 0}>
              Translate
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickPicks.map((language) => (
              <Button
                key={language}
                type="button"
                size="xs"
                variant="outline"
                onClick={() => start(language)}
              >
                {language}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            Uses the text generation model from Settings. The conversation itself stays unchanged.
          </p>
        </form>
      </PopoverPopup>
    </Popover>
  );
}

/** Shows a message's translation under it, once one was requested. */
export const MessageTranslationPanel = memo(function MessageTranslationPanel({
  message,
  threadRef,
  cwd,
}: {
  message: ChatMessage;
  threadRef: ScopedThreadRef | null;
  cwd: string | undefined;
}) {
  const state = useAtomValue(translationAtom(message.id));
  if (state === null || threadRef === null) return null;
  return <TranslationPanelBody message={message} threadRef={threadRef} cwd={cwd} state={state} />;
});

function TranslationPanelBody({
  message,
  threadRef,
  cwd,
  state,
}: {
  message: ChatMessage;
  threadRef: ScopedThreadRef;
  cwd: string | undefined;
  state: TranslationState;
}) {
  const translate = useTranslateMessage(message, threadRef);
  const dismiss = () => appAtomRegistry.set(translationAtom(message.id), null);

  return (
    <section
      aria-label={`Translation to ${state.language}`}
      className="mt-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2"
    >
      <header className="flex items-center gap-2 text-muted-foreground text-xs">
        <LanguagesIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Translated to {state.language}</span>
        {state.status === "done" ? (
          <MessageCopyButton text={state.translation} size="icon-xs" variant="ghost" />
        ) : null}
        <Button
          aria-label="Close translation"
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          onClick={dismiss}
        >
          <XIcon />
        </Button>
      </header>
      <div className="mt-1.5" dir="auto">
        {state.status === "pending" ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-3.5" /> Translating…
          </p>
        ) : state.status === "failed" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <p className="text-destructive-foreground">{state.error}</p>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => translate(state.language)}
            >
              Try again
            </Button>
          </div>
        ) : (
          <ChatMarkdown text={state.translation} cwd={cwd} threadRef={threadRef} />
        )}
      </div>
    </section>
  );
}
