import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, LanguagesIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { memo, useState, type FormEvent } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { randomUUID } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readThreadShell } from "~/state/entities";
import { environmentThreadDetails } from "~/state/threads";
import { translationEnvironment } from "~/state/translation";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ChatMessage } from "~/types";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Group } from "../ui/group";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  BUILT_IN_STYLES,
  CUSTOM_STYLES_KEY,
  DEFAULT_TRANSLATION_KEY,
  findStyle,
  messageTranslationsAtom,
  readMessageTranslations,
  RECENT_LANGUAGES_KEY,
  TranslationDefault,
  TranslationStyles,
  updateMessageTranslations,
  variantKey,
  type TranslationRequest,
  type TranslationStyle,
} from "./messageTranslations";

const RECENT_LANGUAGES_LIMIT = 6;
const RecentLanguages = Schema.Array(Schema.String);
const SUGGESTED_LANGUAGES = ["Arabic", "Spanish", "French", "German", "Chinese", "Japanese"];
const NO_CUSTOM_STYLES: ReadonlyArray<TranslationStyle> = [];
const NO_RECENT_LANGUAGES: ReadonlyArray<string> = [];

function messageKeyOf(message: ChatMessage, threadRef: ScopedThreadRef) {
  return `${threadRef.environmentId}:${message.id}`;
}

function describeRequest(request: TranslationRequest) {
  return request.instructions.trim().length === 0
    ? request.language
    : `${request.language} · ${request.styleName}`;
}

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

function describeFailure(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The translation failed.";
}

let nextRequestId = 0;

/**
 * Shows a translation of the message, reusing a finished or running one for the same
 * language and style. `retranslate` asks the model again.
 */
function useShowTranslation(message: ChatMessage, threadRef: ScopedThreadRef) {
  const translate = useAtomCommand(translationEnvironment.translateMessage, {
    reportFailure: false,
  });
  const messageKey = messageKeyOf(message, threadRef);

  return async (request: TranslationRequest, options?: { retranslate?: boolean }) => {
    const key = variantKey(request);
    const existing = readMessageTranslations(messageKey).variants[key];
    const reuse =
      !options?.retranslate &&
      (existing?.result.status === "done" || existing?.result.status === "pending");
    if (reuse) {
      updateMessageTranslations(messageKey, (current) => ({ ...current, shown: key }));
      return;
    }

    const requestId = ++nextRequestId;
    updateMessageTranslations(messageKey, (current) => ({
      shown: key,
      variants: {
        ...current.variants,
        [key]: { request, result: { status: "pending", requestId } },
      },
    }));
    const context = findPrecedingUserText(threadRef, message.id);
    const projectId = readThreadShell(threadRef)?.projectId;
    const instructions = request.instructions.trim();
    const result = await translate({
      environmentId: threadRef.environmentId,
      input: {
        text: message.text,
        targetLanguage: request.language,
        ...(instructions ? { instructions } : {}),
        ...(context ? { context } : {}),
        ...(projectId ? { projectId } : {}),
      },
    });
    updateMessageTranslations(messageKey, (current) => {
      const variant = current.variants[key];
      // A newer request for the same variant owns it now.
      if (variant?.result.status !== "pending" || variant.result.requestId !== requestId) {
        return current;
      }
      return {
        ...current,
        variants: {
          ...current.variants,
          [key]: {
            request,
            result:
              result._tag === "Success"
                ? { status: "done", translation: result.value.translation }
                : { status: "failed", error: describeFailure(result.cause) },
          },
        },
      };
    });
  };
}

function useTranslationPreferences() {
  const [customStyles, setCustomStyles] = useLocalStorage(
    CUSTOM_STYLES_KEY,
    NO_CUSTOM_STYLES,
    TranslationStyles,
  );
  const [recentLanguages, setRecentLanguages] = useLocalStorage(
    RECENT_LANGUAGES_KEY,
    NO_RECENT_LANGUAGES,
    RecentLanguages,
  );
  const [defaultTranslation, setDefaultTranslation] = useLocalStorage(
    DEFAULT_TRANSLATION_KEY,
    null,
    TranslationDefault,
  );
  const styles = [...BUILT_IN_STYLES, ...customStyles];
  const rememberLanguage = (language: string) =>
    setRecentLanguages((previous) =>
      [
        language,
        ...previous.filter((entry) => entry.toLowerCase() !== language.toLowerCase()),
      ].slice(0, RECENT_LANGUAGES_LIMIT),
    );
  return {
    styles,
    customStyles,
    setCustomStyles,
    recentLanguages,
    rememberLanguage,
    defaultTranslation,
    setDefaultTranslation,
  };
}

function toRequest(language: string, style: TranslationStyle): TranslationRequest {
  return { language, styleName: style.name, instructions: style.instructions };
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

/** One click translates with the default; the arrow picks another language or style. */
function MessageTranslateControl({
  message,
  threadRef,
}: {
  message: ChatMessage;
  threadRef: ScopedThreadRef;
}) {
  const [open, setOpen] = useState(false);
  const preferences = useTranslationPreferences();
  const showTranslation = useShowTranslation(message, threadRef);
  const messageKey = messageKeyOf(message, threadRef);
  const translations = useAtomValue(messageTranslationsAtom(messageKey));

  const defaults = preferences.defaultTranslation;
  const defaultRequest = defaults
    ? toRequest(defaults.language, findStyle(preferences.styles, defaults.styleId))
    : null;
  const defaultShown = defaultRequest !== null && translations.shown === variantKey(defaultRequest);

  const onQuickTranslate = () => {
    if (defaultRequest === null) {
      setOpen(true);
    } else if (defaultShown) {
      updateMessageTranslations(messageKey, (current) => ({ ...current, shown: null }));
    } else {
      void showTranslation(defaultRequest);
    }
  };

  const quickLabel =
    defaultRequest === null
      ? "Translate message"
      : defaultShown
        ? "Hide translation"
        : `Translate to ${describeRequest(defaultRequest)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Group>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={quickLabel}
                type="button"
                size="xs"
                variant="ghost"
                onClick={onQuickTranslate}
              />
            }
          >
            <LanguagesIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup>
            <p>{quickLabel}</p>
          </TooltipPopup>
        </Tooltip>
        <PopoverTrigger
          render={
            <Button aria-label="Translation options" type="button" size="xs" variant="ghost" />
          }
        >
          <ChevronDownIcon className="size-3" />
        </PopoverTrigger>
      </Group>
      <PopoverPopup side="top" align="start" width="md">
        <TranslatePicker
          preferences={preferences}
          onTranslate={(request) => {
            setOpen(false);
            void showTranslation(request);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}

function TranslatePicker({
  preferences,
  onTranslate,
}: {
  preferences: ReturnType<typeof useTranslationPreferences>;
  onTranslate: (request: TranslationRequest) => void;
}) {
  const { styles, recentLanguages, defaultTranslation } = preferences;
  const [view, setView] = useState<"pick" | "styles">("pick");
  const [draft, setDraft] = useState(defaultTranslation?.language ?? recentLanguages[0] ?? "");
  const [styleId, setStyleId] = useState(findStyle(styles, defaultTranslation?.styleId ?? "").id);
  const [makeDefault, setMakeDefault] = useState(defaultTranslation === null);

  if (view === "styles") {
    return (
      <StyleEditor
        customStyles={preferences.customStyles}
        setCustomStyles={preferences.setCustomStyles}
        onDone={() => setView("pick")}
      />
    );
  }

  const start = (rawLanguage: string) => {
    const language = rawLanguage.trim().slice(0, 64);
    if (language.length === 0) return;
    preferences.rememberLanguage(language);
    if (makeDefault) preferences.setDefaultTranslation({ language, styleId });
    onTranslate(toRequest(language, findStyle(styles, styleId)));
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    start(draft);
  };
  const quickPicks = recentLanguages.length > 0 ? recentLanguages : SUGGESTED_LANGUAGES;

  return (
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
      <div className="flex items-center gap-2">
        <Select
          value={styleId}
          items={Object.fromEntries(styles.map((style) => [style.id, style.name]))}
          onValueChange={(value) => {
            if (typeof value === "string") setStyleId(value);
          }}
        >
          <SelectTrigger aria-label="Translation style" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {styles.map((style) => (
              <SelectItem key={style.id} value={style.id}>
                {style.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button type="button" size="xs" variant="ghost" onClick={() => setView("styles")}>
          Edit styles
        </Button>
      </div>
      <Label>
        <Checkbox checked={makeDefault} onCheckedChange={(checked) => setMakeDefault(checked)} />
        Make this the one-click default
      </Label>
      <p className="text-muted-foreground text-xs">
        Uses the text generation model from Settings. The conversation itself stays unchanged.
      </p>
    </form>
  );
}

/** Adds, edits, and deletes the user's own styles. Built-in styles stay fixed. */
function StyleEditor({
  customStyles,
  setCustomStyles,
  onDone,
}: {
  customStyles: ReadonlyArray<TranslationStyle>;
  setCustomStyles: (
    update: (styles: ReadonlyArray<TranslationStyle>) => ReadonlyArray<TranslationStyle>,
  ) => void;
  onDone: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");

  const edit = (style: TranslationStyle | null) => {
    setEditingId(style?.id ?? null);
    setName(style?.name ?? "");
    setInstructions(style?.instructions ?? "");
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const style = {
      id: editingId ?? randomUUID(),
      name: name.trim().slice(0, 40),
      instructions: instructions.trim().slice(0, 2_000),
    };
    if (style.name.length === 0 || style.instructions.length === 0) return;
    setCustomStyles((previous) =>
      editingId === null
        ? [...previous, style]
        : previous.map((entry) => (entry.id === editingId ? style : entry)),
    );
    edit(null);
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <PopoverTitle>Translation styles</PopoverTitle>
      <p className="text-muted-foreground text-xs">
        A style tells the model how to present the message, for example “explain it like I'm 5”.
        Built-in: {BUILT_IN_STYLES.map((style) => style.name).join(", ")}.
      </p>
      {customStyles.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {customStyles.map((style) => (
            <li key={style.id} className="flex items-center gap-1 text-sm">
              <span className="min-w-0 flex-1 truncate">{style.name}</span>
              <Button type="button" size="xs" variant="ghost" onClick={() => edit(style)}>
                Edit
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost-destructive"
                onClick={() => {
                  setCustomStyles((previous) => previous.filter((entry) => entry.id !== style.id));
                  if (editingId === style.id) edit(null);
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        aria-label="Style name"
        placeholder="Name, e.g. Like I'm 5"
        size="sm"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        aria-label="Style instructions"
        placeholder="Instructions, e.g. Explain it simply with an everyday analogy."
        size="sm"
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        {editingId !== null ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => edit(null)}>
            Cancel edit
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Back
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={name.trim().length === 0 || instructions.trim().length === 0}
        >
          {editingId === null ? "Add style" : "Save style"}
        </Button>
      </div>
    </form>
  );
}

/** Shows the message's current translation under it. */
export const MessageTranslationPanel = memo(function MessageTranslationPanel({
  message,
  threadRef,
  cwd,
}: {
  message: ChatMessage;
  threadRef: ScopedThreadRef | null;
  cwd: string | undefined;
}) {
  if (threadRef === null) return null;
  return <TranslationPanel message={message} threadRef={threadRef} cwd={cwd} />;
});

function TranslationPanel({
  message,
  threadRef,
  cwd,
}: {
  message: ChatMessage;
  threadRef: ScopedThreadRef;
  cwd: string | undefined;
}) {
  const messageKey = messageKeyOf(message, threadRef);
  const translations = useAtomValue(messageTranslationsAtom(messageKey));
  const showTranslation = useShowTranslation(message, threadRef);
  const variant =
    translations.shown === null ? undefined : translations.variants[translations.shown];
  if (!variant) return null;
  const { request, result } = variant;
  const label = describeRequest(request);
  const hide = () =>
    updateMessageTranslations(messageKey, (current) => ({ ...current, shown: null }));

  return (
    <section
      aria-label={`Translation: ${label}`}
      className="mt-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2"
    >
      <header className="flex items-center gap-2 text-muted-foreground text-xs">
        <LanguagesIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {result.status === "done" ? (
          <MessageCopyButton text={result.translation} size="icon-xs" variant="ghost" />
        ) : null}
        {result.status !== "pending" ? (
          <Button
            aria-label="Translate again"
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            onClick={() => showTranslation(request, { retranslate: true })}
          >
            <RefreshCwIcon />
          </Button>
        ) : null}
        <Button
          aria-label="Close translation"
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          onClick={hide}
        >
          <XIcon />
        </Button>
      </header>
      <div className="mt-1.5" dir="auto">
        {result.status === "pending" ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-3.5" /> Translating…
          </p>
        ) : result.status === "failed" ? (
          <p className="text-destructive-foreground text-sm">{result.error}</p>
        ) : (
          <ChatMarkdown text={result.translation} cwd={cwd} threadRef={threadRef} />
        )}
      </div>
    </section>
  );
}
