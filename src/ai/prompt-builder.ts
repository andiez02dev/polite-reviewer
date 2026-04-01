import type { EnrichedFile, RepoContext } from "../types.js";
import { annotatePatchWithNewLineNumbers } from "../analysis/diff-parser.js";

export function buildReviewPrompt(params: {
  pr: { title: string; body: string | null };
  files: EnrichedFile[];
  repoContext: RepoContext;
}): { systemPrompt: string; userPrompt: string } {
  const { pr, files, repoContext } = params;
  const contextParts: string[] = [];

  if (repoContext.packageJson) {
    contextParts.push(`package.json:\n${repoContext.packageJson}`);
  }
  if (repoContext.tsconfig) {
    contextParts.push(`tsconfig.json:\n${repoContext.tsconfig}`);
  }
  if (repoContext.configFiles && repoContext.configFiles.length > 0) {
    contextParts.push(
      `Key config files:\n${repoContext.configFiles
        .map((f) => `- ${f.path}\n${f.content}`)
        .join("\n\n")}`,
    );
  }

  const contextBlock =
    contextParts.length > 0
      ? `Repository context:\n\n${contextParts.join("\n\n")}\n\n`
      : "";

  const filesSummary = files
    .map((f) => {
      const header = `File: ${f.filename} (status: ${f.status}, +${f.additions} -${f.deletions})`;
      if (f.logicalBlocks && f.logicalBlocks.length > 0) {
        const blocks = f.logicalBlocks
          .map(
            (b) =>
              `// File: ${f.filename} | Changed lines: ${b.coveredChangedLines.join(", ")} | Node: ${b.nodeKind}\n${b.text}`,
          )
          .join("\n\n---\n\n");
        return `${header}\nLogical blocks (AST-extracted):\n${blocks}`;
      }
      return `${header}\nPatch (with new-file line numbers):\n${annotatePatchWithNewLineNumbers(f.patch)}`;
    })
    .join("\n\n----------------\n\n");

  const systemPrompt =
    "You are PR Police Bot, a senior staff engineer doing an in-depth, actionable code review. " +
    "You focus on correctness, security, performance, maintainability, and code quality. " +
    "You must respond ONLY with valid JSON, no Markdown or backticks.";

  const userPrompt = `
Review this pull request thoroughly.

Pull request title: ${pr.title}
Pull request description:
${pr.body ?? "(no description)"}

${contextBlock}

Changed files (diffs):

${filesSummary}

## Your task

Perform a deep code review focusing on:
1. **Logic bugs** - null checks, edge cases, race conditions
2. **Security issues** - injection, auth bypass, secrets exposure
3. **Performance** - N+1 queries, memory leaks, blocking calls
4. **Architecture** - coupling, separation of concerns, DRY violations
5. **Observability** - missing logs, error handling
6. **Race conditions** - duplicate processing, idempotency

## Rules for comments

**IMPORTANT: Only comment on real issues. Do NOT comment on:**
- Minor style preferences (rename variable, add comment)
- Obvious or trivial changes
- Nit-picks that don't affect functionality

**Every comment MUST be actionable with:**
1. Clear explanation of the problem
2. Why it matters (impact)
3. Concrete code fix suggestion (provide the exact replacement code snippet directly in the "suggestion" field)
4. Confidence level (high/medium/low)

## Severity definitions

- **critical**: Bugs, security vulnerabilities, data loss risks. MUST fix before merge.
- **warning**: Performance issues, potential runtime problems, maintainability concerns. Should fix.
- **suggestion**: Improvements that would be nice but not blocking.

## JSON output format

Return ONLY this JSON structure:

{
  "comments": [
    {
      "file": "src/server.js",
      "line": 45,
      "severity": "warning",
      "category": "security",
      "confidence": "high",
      "title": "Webhook secret should not be hardcoded",
      "problem": "The webhook secret is hardcoded in the source code, which is a security risk if the code is public.",
      "impact": "Attackers could forge webhook requests if they obtain the secret from the repository.",
      "suggestion": "const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;\\n\\nif (!WEBHOOK_SECRET) {\\n  throw new Error('GITHUB_WEBHOOK_SECRET is required');\\n}",
      "suggestionStartLine": 45,
      "suggestionEndLine": 45
    }
  ],
  "summary": {
    "overview": "Brief summary of PR quality and main findings",
    "verdict": "approve",
    "criticalIssues": [
      { "file": "src/file.js", "line": 10, "title": "Brief issue title" }
    ],
    "warnings": [
      { "file": "src/file.js", "line": 20, "title": "Brief issue title" }
    ],
    "suggestions": [
      { "file": "src/file.js", "line": 30, "title": "Brief issue title" }
    ]
  }
}

## Comment fields

- "file": exact filename from the diff
- "line": MUST be a line number shown in the annotated patch above (new-file line number)
- "severity": "critical" | "warning" | "suggestion"
- "category": "bug" | "security" | "performance" | "architecture" | "observability" | "other"
- "confidence": "high" | "medium" | "low"
- "title": short (< 60 chars) title for the issue
- "problem": detailed explanation of what's wrong
- "impact": why this matters, what could go wrong
- "suggestion": the EXACT replacement code for the line range [suggestionStartLine, suggestionEndLine]. This will be rendered as a GitHub suggestion block. The suggestion MUST contain ONLY the replacement lines — no surrounding context, no extra lines outside the range. Keep suggestion code concise: no inline comments, no explanatory text inside the code block (put explanations in "problem" and "impact" fields instead).
- "suggestionStartLine": the FIRST line number of the code block being replaced. MUST match the actual start of the code you want to replace in the file.
- "suggestionEndLine": the LAST line number of the code block being replaced. MUST match the actual end of the code you want to replace. If your suggestion adds lines after the original block, extend suggestionEndLine to cover all original lines that will be replaced. The number of lines in "suggestion" does NOT need to equal suggestionEndLine minus suggestionStartLine plus 1 — GitHub allows expanding or shrinking the block.

## Critical rule for suggestions

The GitHub suggestion block replaces EXACTLY the lines from suggestionStartLine to suggestionEndLine (inclusive) with the content of "suggestion". Therefore:
- If you want to replace lines 10-12 with new code, set suggestionStartLine=10, suggestionEndLine=12
- If you want to insert new lines after line 10 without removing anything, set suggestionStartLine=10, suggestionEndLine=10 and include line 10's original content at the top of "suggestion" followed by the new lines
- NEVER set suggestionStartLine=suggestionEndLine=X when your suggestion replaces multiple lines starting at X — always set the correct end line
- For multi-line expressions (ternary operators, object literals, function calls spanning multiple lines), the suggestionEndLine MUST be the line containing the closing token (semicolon, closing brace, closing paren) of that expression
- When in doubt about the exact end line, set suggestionEndLine to be conservative (include more lines rather than fewer)

## If no issues found

{
  "comments": [],
  "summary": {
    "overview": "The changes look good. No significant issues found.",
    "verdict": "approve",
    "criticalIssues": [],
    "warnings": [],
    "suggestions": []
  }
}

Do NOT include any text outside the JSON.
`;

  return { systemPrompt, userPrompt };
}
