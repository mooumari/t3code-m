import { describe, expect, it } from "vite-plus/test";

import { pruneSavedTranslations, variantKey } from "./messageTranslations";

const entry = (savedAt: number, translation: string) => ({
  shown: null,
  savedAt,
  variants: [{ language: "Arabic", styleName: "Translate", instructions: "", translation }],
});

describe("pruneSavedTranslations", () => {
  it("keeps the most recently used messages within the count limit", () => {
    const kept = pruneSavedTranslations(
      { old: entry(1, "a"), newest: entry(3, "b"), middle: entry(2, "c") },
      { messages: 2, characters: 1_000 },
    );
    expect(Object.keys(kept)).toEqual(["newest", "middle"]);
  });

  it("drops older messages once the saved text would exceed the size limit", () => {
    const kept = pruneSavedTranslations(
      { old: entry(1, "x".repeat(60)), recent: entry(2, "y".repeat(60)) },
      { messages: 10, characters: 100 },
    );
    expect(Object.keys(kept)).toEqual(["recent"]);
  });
});

describe("variantKey", () => {
  it("treats the same language and instructions as one translation", () => {
    expect(variantKey({ language: " arabic", instructions: "Simple." })).toBe(
      variantKey({ language: "Arabic", instructions: "Simple. " }),
    );
    expect(variantKey({ language: "Arabic", instructions: "" })).not.toBe(
      variantKey({ language: "Arabic", instructions: "Simple." }),
    );
  });
});
