import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { appAtomRegistry } from "~/rpc/atomRegistry";

/** How a translation is presented. Empty instructions mean a faithful translation. */
export const TranslationStyle = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  instructions: Schema.String,
});
export type TranslationStyle = typeof TranslationStyle.Type;
export const TranslationStyles = Schema.Array(TranslationStyle);

export const BUILT_IN_STYLES: ReadonlyArray<TranslationStyle> = [
  { id: "translate", name: "Translate", instructions: "" },
  {
    id: "simple",
    name: "Explain simply",
    instructions:
      "Explain it so a curious 5-year-old could follow: short sentences, everyday words, and one simple analogy when it helps. Keep code blocks and commands as they are.",
  },
  {
    id: "key-points",
    name: "Key points",
    instructions:
      "Summarize it as a few short bullet points: what happened, what matters, and anything the developer needs to do next.",
  },
];

export const TranslationDefault = Schema.NullOr(
  Schema.Struct({ language: Schema.String, styleId: Schema.String }),
);
export type TranslationDefault = typeof TranslationDefault.Type;

export const RECENT_LANGUAGES_KEY = "t3code:translate:recent-languages";
export const CUSTOM_STYLES_KEY = "t3code:translate:styles";
export const DEFAULT_TRANSLATION_KEY = "t3code:translate:default";

export function findStyle(
  styles: ReadonlyArray<TranslationStyle>,
  styleId: string,
): TranslationStyle {
  return styles.find((style) => style.id === styleId) ?? BUILT_IN_STYLES[0]!;
}

/** One language + style combination asked for a message. */
export interface TranslationRequest {
  readonly language: string;
  readonly styleName: string;
  readonly instructions: string;
}

export type TranslationResult =
  | { readonly status: "pending"; readonly requestId: number }
  | { readonly status: "done"; readonly translation: string }
  | { readonly status: "failed"; readonly error: string };

export interface TranslationVariant {
  readonly request: TranslationRequest;
  readonly result: TranslationResult;
}

/** Every translation of one message, and which one (if any) is on screen. */
export interface MessageTranslations {
  readonly shown: string | null;
  readonly variants: Readonly<Record<string, TranslationVariant>>;
}

const EMPTY: MessageTranslations = { shown: null, variants: {} };

/** Keyed by content rather than style id, so editing a style's instructions asks again. */
export function variantKey(request: Pick<TranslationRequest, "language" | "instructions">) {
  return `${request.language.trim().toLowerCase()}\u0000${request.instructions.trim()}`;
}

// ---------------------------------------------------------------------------
// Saved translations: finished results survive reloads, per device.
// ---------------------------------------------------------------------------

const SAVED_TRANSLATIONS_KEY = "t3code:translate:saved";
const SAVED_MESSAGES_LIMIT = 200;
/** Characters, well under the ~5 MB localStorage quota shared with the rest of the app. */
const SAVED_CHARACTERS_LIMIT = 1_500_000;

const SavedMessage = Schema.Struct({
  shown: Schema.NullOr(Schema.String),
  savedAt: Schema.Finite,
  variants: Schema.Array(
    Schema.Struct({
      language: Schema.String,
      styleName: Schema.String,
      instructions: Schema.String,
      translation: Schema.String,
    }),
  ),
});
type SavedMessage = typeof SavedMessage.Type;
const SavedTranslations = Schema.Record(Schema.String, SavedMessage);
type SavedTranslations = typeof SavedTranslations.Type;

let saved: Record<string, SavedMessage> | null = null;

function loadSaved(): Record<string, SavedMessage> {
  if (saved !== null) return saved;
  try {
    saved = { ...getLocalStorageItem(SAVED_TRANSLATIONS_KEY, SavedTranslations) };
  } catch (error) {
    console.error("[TRANSLATE] Could not read saved translations.", error);
    saved = {};
  }
  return saved;
}

/** Keeps the most recently used messages that fit in the count and size limits. */
export function pruneSavedTranslations(
  entries: SavedTranslations,
  limits = { messages: SAVED_MESSAGES_LIMIT, characters: SAVED_CHARACTERS_LIMIT },
): Record<string, SavedMessage> {
  const kept: Record<string, SavedMessage> = {};
  let characters = 0;
  let count = 0;
  const newestFirst = Object.entries(entries).toSorted(([, a], [, b]) => b.savedAt - a.savedAt);
  for (const [key, entry] of newestFirst) {
    const size = entry.variants.reduce(
      (total, variant) => total + variant.translation.length + variant.instructions.length,
      key.length,
    );
    if (count >= limits.messages || characters + size > limits.characters) break;
    kept[key] = entry;
    characters += size;
    count++;
  }
  return kept;
}

function persist(messageKey: string, value: MessageTranslations) {
  const variants = Object.values(value.variants).flatMap(({ request, result }) =>
    result.status === "done" ? [{ ...request, translation: result.translation }] : [],
  );
  const next = { ...loadSaved() };
  if (variants.length === 0) {
    delete next[messageKey];
  } else {
    const shown = value.shown !== null && value.variants[value.shown]?.result.status === "done";
    next[messageKey] = { shown: shown ? value.shown : null, savedAt: Date.now(), variants };
  }
  saved = pruneSavedTranslations(next);
  try {
    setLocalStorageItem(SAVED_TRANSLATIONS_KEY, saved, SavedTranslations);
  } catch (error) {
    console.error("[TRANSLATE] Could not save translations.", error);
  }
}

function restore(messageKey: string): MessageTranslations {
  const entry = loadSaved()[messageKey];
  if (!entry) return EMPTY;
  const variants: Record<string, TranslationVariant> = {};
  for (const { translation, ...request } of entry.variants) {
    variants[variantKey(request)] = { request, result: { status: "done", translation } };
  }
  return { shown: entry.shown !== null && variants[entry.shown] ? entry.shown : null, variants };
}

export const messageTranslationsAtom = Atom.family((messageKey: string) =>
  Atom.make<MessageTranslations>(restore(messageKey)).pipe(
    Atom.keepAlive,
    Atom.withLabel(`translation:${messageKey}`),
  ),
);

export function readMessageTranslations(messageKey: string): MessageTranslations {
  return appAtomRegistry.get(messageTranslationsAtom(messageKey));
}

/** Updates one message's translations and saves the finished ones. */
export function updateMessageTranslations(
  messageKey: string,
  update: (current: MessageTranslations) => MessageTranslations,
) {
  const atom = messageTranslationsAtom(messageKey);
  const next = update(appAtomRegistry.get(atom));
  appAtomRegistry.set(atom, next);
  persist(messageKey, next);
}
