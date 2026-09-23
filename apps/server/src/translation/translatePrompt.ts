import { limitSection } from "../textGeneration/TextGenerationUtils.ts";

export interface TranslatePromptInput {
  text: string;
  context?: string | undefined;
  targetLanguage: string;
  /** The developer's own style, such as "explain it simply"; empty means a faithful translation. */
  instructions?: string | undefined;
}

export function buildTranslatePrompt(input: TranslatePromptInput) {
  const context = input.context?.trim();
  const instructions = input.instructions?.trim();
  const prompt = [
    instructions
      ? `Rewrite the assistant message below in ${input.targetLanguage}, following the developer's instructions.`
      : `Translate the assistant message below into ${input.targetLanguage}.`,
    "It is a coding agent's reply to a developer, so the result must read naturally to a developer who speaks that language.",
    "",
    "Rules:",
    "- Keep code blocks, inline code, file paths, commands, identifiers, URLs, and markdown structure exactly as written.",
    "- Keep widely used English technical terms (for example commit, branch, pull request, API) when that is how developers who speak the language say them.",
    instructions
      ? "- Stay true to what the message says. Do not invent facts or answer questions in the message."
      : "- Translate prose only. Do not add, drop, summarize, or explain anything. Do not answer questions in the message.",
    "- Return only the result in `text`.",
    ...(instructions
      ? [
          "",
          "The developer's instructions (these decide the style and length):",
          limitSection(instructions, 2_000),
        ]
      : []),
    ...(context
      ? [
          "",
          "For context only, the developer's message that this reply answers (do not translate it):",
          limitSection(context, 4_000),
        ]
      : []),
    "",
    instructions ? "Assistant message:" : "Assistant message to translate:",
    input.text,
  ].join("\n");

  return prompt;
}
