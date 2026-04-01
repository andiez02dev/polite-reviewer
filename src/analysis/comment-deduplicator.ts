import type { AIReviewComment } from "../types.js";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]/g, "")
    .trim();
}

export function deduplicateComments(comments: AIReviewComment[]): AIReviewComment[] {
  const seen = new Map<string, boolean>();
  const result: AIReviewComment[] = [];

  for (const comment of comments) {
    const keyBase = `${comment.file}:${comment.line}`;
    const normalized = normalizeText(comment.title || comment.problem || "");
    const key = `${keyBase}:${normalized}`;

    if (seen.has(key)) {
      continue;
    }

    seen.set(key, true);
    result.push(comment);
  }

  return result;
}

export function groupCommentsBySeverity(comments: AIReviewComment[]): {
  critical: AIReviewComment[];
  warning: AIReviewComment[];
  suggestion: AIReviewComment[];
} {
  const groups: {
    critical: AIReviewComment[];
    warning: AIReviewComment[];
    suggestion: AIReviewComment[];
  } = {
    critical: [],
    warning: [],
    suggestion: [],
  };

  for (const c of comments) {
    if (c.severity === "critical") {
      groups.critical.push(c);
    } else if (c.severity === "warning") {
      groups.warning.push(c);
    } else {
      groups.suggestion.push(c);
    }
  }

  return groups;
}
