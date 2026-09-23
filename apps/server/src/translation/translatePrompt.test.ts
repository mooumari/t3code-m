import { describe, expect, it } from "vite-plus/test";

import { buildTranslatePrompt } from "./translatePrompt.ts";

describe("buildTranslatePrompt", () => {
  it("targets the language and keeps the user message as context only", () => {
    const prompt = buildTranslatePrompt({
      text: "Run `vp test run` before you push.",
      context: "How do I run the tests?",
      targetLanguage: "Arabic",
    });
    expect(prompt).toContain("into Arabic");
    expect(prompt).toContain("do not translate it");
    expect(prompt).toContain("How do I run the tests?");
    expect(prompt.endsWith("Run `vp test run` before you push.")).toBe(true);
  });

  it("omits the context section when there is no user message", () => {
    const prompt = buildTranslatePrompt({ text: "Done.", targetLanguage: "French" });
    expect(prompt).not.toContain("For context only");
  });

  it("switches from a faithful translation to the developer's style when given instructions", () => {
    const faithful = buildTranslatePrompt({ text: "Done.", targetLanguage: "French" });
    expect(faithful).toContain("Do not add, drop, summarize");
    expect(faithful).not.toContain("developer's instructions");

    const styled = buildTranslatePrompt({
      text: "Done.",
      targetLanguage: "French",
      instructions: "Explain it like I'm 5.",
    });
    expect(styled).toContain("Rewrite the assistant message below in French");
    expect(styled).toContain("Explain it like I'm 5.");
    expect(styled).not.toContain("Do not add, drop, summarize");
  });
});
