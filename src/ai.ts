import { GoogleGenerativeAI } from "@google/generative-ai";
import { config, logStructured } from "./config.js";
import { buildSingleFilePrompt, type SingleFilePromptParams } from "./ai/prompt-builder.js";
import type { AIReviewComment } from "./types.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({
  model: config.geminiModel,
  generationConfig: {
    temperature: 0.2,
    responseMimeType: "application/json",
  },
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseComments(raw: unknown): AIReviewComment[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(isRecord)
    .filter(
      (c) =>
        typeof c["file"] === "string" &&
        typeof c["line"] === "number" &&
        (typeof c["problem"] === "string" || typeof c["comment"] === "string"),
    )
    .map((c) => {
      const severities = ["critical", "warning", "suggestion"] as const;
      const confidences = ["high", "medium", "low"] as const;

      const severity = severities.includes(c["severity"] as (typeof severities)[number])
        ? (c["severity"] as AIReviewComment["severity"])
        : "suggestion";

      const confidence = confidences.includes(c["confidence"] as (typeof confidences)[number])
        ? (c["confidence"] as AIReviewComment["confidence"])
        : "medium";

      const line = c["line"] as number;

      return {
        file: c["file"] as string,
        line,
        title: typeof c["title"] === "string" ? c["title"] : "Issue",
        problem:
          typeof c["problem"] === "string"
            ? c["problem"]
            : ((c["comment"] as string) ?? ""),
        impact: typeof c["impact"] === "string" ? c["impact"] : "",
        suggestion: typeof c["suggestion"] === "string" ? c["suggestion"] : null,
        suggestionStartLine:
          typeof c["suggestionStartLine"] === "number" ? c["suggestionStartLine"] : line,
        suggestionEndLine:
          typeof c["suggestionEndLine"] === "number" ? c["suggestionEndLine"] : line,
        severity,
        category: typeof c["category"] === "string" ? c["category"] : "other",
        confidence,
      };
    });
}

/**
 * Review a single file using the Gemini API.
 * Returns an array of inline comments for that file, or [] on any failure.
 */
export async function reviewSingleFile(
  params: SingleFilePromptParams,
): Promise<AIReviewComment[]> {
  const { systemPrompt, userPrompt } = buildSingleFilePrompt(params);
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  logStructured("ai.file.review.request", {
    filename: params.file.filename,
    category: params.category,
    promptLength: fullPrompt.length,
  });

  const result = await model.generateContent(fullPrompt);
  let raw = result.response.text().trim() || "{}";

  // Strip markdown code fences if the model wraps its output
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("Response root is not an object");
    const comments = parseComments(parsed["comments"]);

    logStructured("ai.file.review.parsed", {
      filename: params.file.filename,
      count: comments.length,
    });

    return comments;
  } catch (err) {
    logStructured("ai.file.review.parse_error", {
      filename: params.file.filename,
      error: String(err),
      raw,
    });
    return [];
  }
}
