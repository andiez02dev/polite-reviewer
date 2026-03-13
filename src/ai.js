import { GoogleGenerativeAI } from "@google/generative-ai";
import { config, logStructured } from "./config.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({ model: config.geminiModel });

export async function reviewDiffFilesWithAI({ title, description, files }) {
  const payload = {
    title,
    description: description || "",
    files: files.map((f) => ({
      filename: f.filename,
      patch: f.patch,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };

  logStructured("ai.review.request", {
    fileCount: payload.files.length,
  });

  const systemPrompt =
    "You are a senior staff engineer performing a precise GitHub pull request review. " +
    "You return ONLY valid JSON in the requested format, with no extra text.";

  const userPrompt = `
You are a senior staff engineer doing a code review.

Review this pull request diff and identify:
- bugs
- security vulnerabilities
- performance problems
- bad practices
- concurrency issues
- architecture problems

Input payload (JSON):
${JSON.stringify(payload, null, 2)}

Return ONLY a JSON array of comments in this format:
[
  {
    "file": "src/auth/login.ts",
    "line": 42,
    "comment": "Possible null pointer when user.email is undefined"
  }
]

Rules:
- "file" must be one of the provided filenames.
- "line" is the line number in the NEW file version.
- Omit comments if the diff looks good; then return [].
`;

  const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);

  let raw = result.response.text().trim() || "[]";

  // Some models may wrap JSON in Markdown code fences; strip them if present.
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("AI response is not an array");
    }

    const normalized = parsed
      .filter(
        (c) =>
          c &&
          typeof c.file === "string" &&
          typeof c.line === "number" &&
          typeof c.comment === "string",
      )
      .map((c) => ({
        file: c.file,
        line: c.line,
        comment: c.comment.trim(),
      }));

    logStructured("ai.review.response.parsed", {
      count: normalized.length,
    });

    return normalized;
  } catch (err) {
    logStructured("ai.review.response.parse_error", {
      error: String(err),
      raw,
    });
    return [];
  }
}


