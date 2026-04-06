import type { RepoContext } from "../types.js";
import { FileCategory } from "../analysis/file-filter.js";

// ---------------------------------------------------------------------------
// Role-based instructions — injected per file based on its category
// ---------------------------------------------------------------------------

const ROLE_INSTRUCTIONS: Record<FileCategory, string> = {
  [FileCategory.UI_COMPONENT]: `You are a senior frontend engineer specialising in UI quality.
Focus STRICTLY on:
- Accessibility (a11y): missing ARIA roles/labels, keyboard navigation, focus management, colour contrast issues
- Render cycle optimisation: unnecessary re-renders, missing React.memo / useMemo / useCallback
- DOM structure: invalid nesting, semantic HTML correctness
- Component API design: prop drilling, missing default props, incorrect key usage in lists
Do NOT comment on business logic, data fetching, or backend concerns.`,

  [FileCategory.LOGIC_HOOK]: `You are a senior engineer performing a [CRITICAL MENTAL EXECUTION] review.
For every function and hook you MUST:
1. Trace the algorithm step-by-step with concrete example inputs to verify correctness
2. Detect circular dependencies or infinite loops in recursive logic
3. Verify array mutations — check that sort/filter/map do not mutate the original array and that sort comparators satisfy transitivity
4. Strictly audit React hook dependency arrays (exhaustive-deps): identify stale closures, missing deps, and over-specified deps that cause infinite loops
5. Check for off-by-one errors, incorrect boundary conditions, and floating-point precision issues
Flag anything that would produce a wrong result on a valid input.`,

  [FileCategory.API_SERVICE]: `You are a senior backend engineer reviewing a service/API layer.
Focus on:
- Data fetching correctness: pagination, cursor handling, missing await
- Retry & resilience: missing retry logic, no timeout, swallowed errors
- Payload mapping: field name mismatches, missing null-checks on API responses, incorrect type casts
- Type safety: any-casts, missing runtime validation of external data
- Error surfacing: errors silently caught and not re-thrown or logged
- Security: exposed secrets, missing auth checks, SSRF risks in dynamic URLs`,

  [FileCategory.GENERAL]: `You are a senior staff engineer performing a thorough code review.
Focus on:
- Logic bugs: null/undefined checks, edge cases, race conditions
- Security: injection, auth bypass, secrets exposure
- Performance: N+1 queries, memory leaks, blocking calls
- Architecture: tight coupling, DRY violations, separation of concerns
- Observability: missing logs, swallowed errors, missing metrics`,
};

// ---------------------------------------------------------------------------
// JSON output schema — per-file comments only, no global summary
// ---------------------------------------------------------------------------

const JSON_OUTPUT_SCHEMA = `Return ONLY a JSON object with a single "comments" array — no markdown, no backticks, no extra fields.

Each element in "comments" MUST conform to:
{
  "file": "<exact filename>",
  "line": <new-file line number from the annotated diff>,
  "severity": "critical" | "warning" | "suggestion",
  "category": "bug" | "security" | "performance" | "architecture" | "observability" | "other",
  "confidence": "high" | "medium" | "low",
  "title": "<short title, max 60 chars>",
  "problem": "<detailed explanation of what is wrong>",
  "impact": "<why this matters / what could go wrong>",
  "suggestion": "<exact replacement code for lines suggestionStartLine–suggestionEndLine>",
  "suggestionStartLine": <first line of the replaced range>,
  "suggestionEndLine": <last line of the replaced range>
}

Severity definitions:
- "critical": bugs, security vulnerabilities, data loss risks — MUST fix before merge
- "warning": performance issues, potential runtime problems, maintainability concerns
- "suggestion": improvements that are nice-to-have but not blocking

Rules for "suggestion" field:
- Provide ONLY the replacement lines for [suggestionStartLine, suggestionEndLine] — no surrounding context
- For multi-line expressions set suggestionEndLine to the line containing the closing token
- When in doubt, be conservative and include more lines rather than fewer

If there are no issues, return: { "comments": [] }
Do NOT include any text outside the JSON object.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SingleFilePromptParams {
  pr: { title: string; body: string | null };
  file: {
    filename: string;
    diffContent: string;
    extractedContext: string;
  };
  category: FileCategory;
  repoContext?: RepoContext;
}

/**
 * Build a role-specific prompt pair for reviewing a single file.
 *
 * systemPrompt — core persona, JSON-only output rule, severity definitions
 * userPrompt   — PR context + repo context + role instructions + AST context + diff + schema
 */
export function buildSingleFilePrompt(
  params: SingleFilePromptParams,
): { systemPrompt: string; userPrompt: string } {
  const { pr, file, category, repoContext } = params;

  const systemPrompt =
    "You are PR Police Bot, a senior staff engineer doing an in-depth, actionable code review. " +
    "You focus on correctness, security, performance, maintainability, and code quality. " +
    "You must respond ONLY with valid JSON — no Markdown, no backticks, no prose outside the JSON.";

  const repoParts: string[] = [];
  if (repoContext?.packageJson) {
    repoParts.push(`package.json:\n${repoContext.packageJson}`);
  }
  if (repoContext?.tsconfig) {
    repoParts.push(`tsconfig.json:\n${repoContext.tsconfig}`);
  }
  if (repoContext?.configFiles && repoContext.configFiles.length > 0) {
    repoParts.push(
      `Key config files:\n${repoContext.configFiles
        .map((f) => `- ${f.path}\n${f.content}`)
        .join("\n\n")}`,
    );
  }
  const repoBlock =
    repoParts.length > 0
      ? `## Repository context\n\n${repoParts.join("\n\n")}\n\n`
      : "";

  // Optimisation 3: cap PR body to avoid wasting tokens on long templates/changelogs
  const prBodyTrimmed = pr.body ? pr.body.slice(0, 500) + (pr.body.length > 500 ? "\n...(truncated)" : "") : "(no description)";

  const userPrompt = `## PR context

Title: ${pr.title}
Description:
${prBodyTrimmed}

${repoBlock}## Role-specific review instructions

${ROLE_INSTRUCTIONS[category]}

## Extracted file context (imports, types, changed scopes)

\`\`\`typescript
${file.extractedContext}
\`\`\`

## File under review: ${file.filename}

\`\`\`diff
${file.diffContent}
\`\`\`

## Output instructions

${JSON_OUTPUT_SCHEMA}`;

  return { systemPrompt, userPrompt };
}
