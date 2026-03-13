import { GoogleGenerativeAI } from "@google/generative-ai";
import { config, logStructured } from "./config.js";
import { buildReviewPrompt } from "./ai/prompt-builder.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({ model: config.geminiModel });

export async function reviewDiffFilesWithAI({ pr, files, repoContext }) {
  logStructured("ai.review.request", {
    fileCount: files.length,
  });

  const { systemPrompt, userPrompt } = buildReviewPrompt({ pr, files, repoContext });

  const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);

  let raw = result.response.text().trim() || "{}";

  // Some models may wrap JSON in Markdown code fences; strip them if present.
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("AI response root is not an object");
    }

    const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
    const summary = parsed.summary || {
      overview: "No summary provided.",
      verdict: "comment",
      criticalIssues: [],
      warnings: [],
      suggestions: [],
    };

    const normalizedComments = comments
      .filter(
        (c) =>
          c &&
          typeof c.file === "string" &&
          typeof c.line === "number" &&
          (typeof c.problem === "string" || typeof c.comment === "string"),
      )
      .map((c) => ({
        file: c.file,
        line: c.line,
        title: typeof c.title === "string" ? c.title : "Issue",
        problem: c.problem || c.comment || "",
        impact: c.impact || "",
        suggestion: c.suggestion || null,
        suggestionStartLine: c.suggestionStartLine || c.line,
        suggestionEndLine: c.suggestionEndLine || c.line,
        severity: ["critical", "warning", "suggestion"].includes(c.severity)
          ? c.severity
          : "suggestion",
        category: typeof c.category === "string" ? c.category : "other",
        confidence: ["high", "medium", "low"].includes(c.confidence)
          ? c.confidence
          : "medium",
      }));

    logStructured("ai.review.response.parsed", {
      count: normalizedComments.length,
    });

    return { comments: normalizedComments, summary };
  } catch (err) {
    logStructured("ai.review.response.parse_error", {
      error: String(err),
      raw,
    });
    return {
      comments: [],
      summary: {
        overview: "AI response could not be parsed.",
        verdict: "comment",
        criticalIssues: [],
        warnings: [],
        suggestions: [],
      },
    };
  }
}
