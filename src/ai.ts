import { GoogleGenerativeAI } from "@google/generative-ai";
import { config, logStructured } from "./config.js";
import { buildReviewPrompt } from "./ai/prompt-builder.js";
import type {
  ReviewableFile,
  RepoContext,
  AIReviewResult,
  AIReviewComment,
  AIReviewSummary,
  SummaryIssue,
} from "./types.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({ model: config.geminiModel });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseSummaryIssues(arr: unknown): SummaryIssue[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(isRecord)
    .filter(
      (item) =>
        typeof item["file"] === "string" &&
        typeof item["line"] === "number" &&
        typeof item["title"] === "string",
    )
    .map((item) => ({
      file: item["file"] as string,
      line: item["line"] as number,
      title: item["title"] as string,
    }));
}

function parseSummary(raw: unknown): AIReviewSummary {
  const defaultSummary: AIReviewSummary = {
    overview: "No summary provided.",
    verdict: "comment",
    criticalIssues: [],
    warnings: [],
    suggestions: [],
  };

  if (!isRecord(raw)) return defaultSummary;

  const verdict = raw["verdict"];
  const validVerdicts = ["approve", "request_changes", "comment"] as const;

  return {
    overview: typeof raw["overview"] === "string" ? raw["overview"] : defaultSummary.overview,
    verdict: validVerdicts.includes(verdict as (typeof validVerdicts)[number])
      ? (verdict as AIReviewSummary["verdict"])
      : "comment",
    criticalIssues: parseSummaryIssues(raw["criticalIssues"]),
    warnings: parseSummaryIssues(raw["warnings"]),
    suggestions: parseSummaryIssues(raw["suggestions"]),
  };
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
        problem: typeof c["problem"] === "string" ? c["problem"] : (c["comment"] as string) ?? "",
        impact: typeof c["impact"] === "string" ? c["impact"] : "",
        suggestion: typeof c["suggestion"] === "string" ? c["suggestion"] : null,
        suggestionStartLine: typeof c["suggestionStartLine"] === "number" ? c["suggestionStartLine"] : line,
        suggestionEndLine: typeof c["suggestionEndLine"] === "number" ? c["suggestionEndLine"] : line,
        severity,
        category: typeof c["category"] === "string" ? c["category"] : "other",
        confidence,
      };
    });
}

export async function reviewDiffFilesWithAI(params: {
  pr: { title: string; body: string | null };
  files: ReviewableFile[];
  repoContext: RepoContext;
}): Promise<AIReviewResult> {
  const { pr, files, repoContext } = params;

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
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error("AI response root is not an object");
    }

    const comments = parseComments(parsed["comments"]);
    const summary = parseSummary(parsed["summary"]);

    logStructured("ai.review.response.parsed", {
      count: comments.length,
    });

    return { comments, summary };
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
