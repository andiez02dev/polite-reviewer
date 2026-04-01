import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createGitHubClientForInstallation } from "./github.js";
import { reviewDiffFilesWithAI } from "./ai.js";
import { buildReviewableFiles } from "./analysis/file-filter.js";
import { deduplicateComments } from "./analysis/comment-deduplicator.js";
import { clampToNearestAnchor, extractNewLineAnchorsFromPatch } from "./analysis/diff-parser.js";
import { config, logStructured } from "./config.js";
import type { JobData, AIReviewComment, AIReviewSummary } from "./types.js";
import type { Octokit } from "@octokit/rest";

type RedisConnection = string | { host: string; port: number };

const redisOptions: RedisConnection = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: config.redis.host,
      port: config.redis.port,
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connection = new (IORedis as any)(redisOptions, {
  maxRetriesPerRequest: null,
});

async function fetchPrFiles(
  octokit: Octokit,
  { owner, repo, pullNumber }: { owner: string; repo: string; pullNumber: number },
): Promise<unknown[]> {
  const files: unknown[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: perPage,
      page,
    });

    files.push(...data);

    if (data.length < perPage) {
      break;
    }
    page += 1;
  }

  return files;
}

async function loadRepoContext(
  octokit: Octokit,
  { owner, repo }: { owner: string; repo: string },
): Promise<{ packageJson: string | null; tsconfig: string | null; configFiles: Array<{ path: string; content: string }> }> {
  const context: { packageJson: string | null; tsconfig: string | null; configFiles: Array<{ path: string; content: string }> } = {
    packageJson: null,
    tsconfig: null,
    configFiles: [],
  };

  try {
    const pkg = await octokit.repos.getContent({
      owner,
      repo,
      path: "package.json",
    });
    if ("content" in pkg.data && typeof pkg.data.content === "string" && pkg.data.content) {
      const encoding = "encoding" in pkg.data ? (pkg.data.encoding as BufferEncoding) : "base64";
      const buff = Buffer.from(pkg.data.content, encoding);
      context.packageJson = buff.toString("utf8");
    }
  } catch (err) {
    logStructured("repoContext.packageJson.missing", { error: String(err) });
  }

  try {
    const tsconfig = await octokit.repos.getContent({
      owner,
      repo,
      path: "tsconfig.json",
    });
    if ("content" in tsconfig.data && typeof tsconfig.data.content === "string" && tsconfig.data.content) {
      const encoding = "encoding" in tsconfig.data ? (tsconfig.data.encoding as BufferEncoding) : "base64";
      const buff = Buffer.from(tsconfig.data.content, encoding);
      context.tsconfig = buff.toString("utf8");
    }
  } catch {
    // ok if repo is not TS
  }

  const candidateConfigFiles = [
    ".eslintrc.json",
    ".eslintrc.js",
    ".prettierrc",
    ".prettierrc.json",
    "jest.config.js",
    "vitest.config.ts",
  ];

  for (const filePath of candidateConfigFiles) {
    try {
      const res = await octokit.repos.getContent({ owner, repo, path: filePath });
      if ("content" in res.data && typeof res.data.content === "string" && res.data.content) {
        const encoding = "encoding" in res.data ? (res.data.encoding as BufferEncoding) : "base64";
        const buff = Buffer.from(res.data.content, encoding);
        context.configFiles.push({ path: filePath, content: buff.toString("utf8") });
      }
    } catch {
      // ignore missing optional files
    }
  }

  return context;
}

function formatCommentBody(comment: AIReviewComment): string {
  const severityIcon =
    comment.severity === "critical"
      ? "❌"
      : comment.severity === "warning"
        ? "⚠️"
        : "💡";

  const severityLabel =
    comment.severity === "critical"
      ? "Critical"
      : comment.severity === "warning"
        ? "Warning"
        : "Suggestion";

  const confidenceBadge = `\`Confidence: ${comment.confidence}\``;

  let body = `### ${severityIcon} ${severityLabel}: ${comment.title}\n\n`;
  body += `${confidenceBadge}\n\n`;

  if (comment.problem) {
    body += `**Problem:**\n${comment.problem}\n\n`;
  }

  if (comment.impact) {
    body += `**Impact:**\n${comment.impact}\n\n`;
  }

  if (comment.suggestion) {
    body += `**Suggested fix:**\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\`\n`;
  }

  return body;
}

function formatSummaryBody(summary: AIReviewSummary, _comments: AIReviewComment[]): string {
  const criticalCount = summary.criticalIssues?.length ?? 0;
  const warningCount = summary.warnings?.length ?? 0;
  const suggestionCount = summary.suggestions?.length ?? 0;

  const verdictEmoji =
    summary.verdict === "approve"
      ? "✅"
      : summary.verdict === "request_changes"
        ? "❌"
        : "💬";

  let body = `## ${verdictEmoji} PR Police Review Summary\n\n`;
  body += `${summary.overview || "No overview provided."}\n\n`;

  body += `### Severity Definitions\n`;
  body += `- **Critical**: Bugs, security issues, data loss risks. Must fix before merge.\n`;
  body += `- **Warning**: Performance, potential runtime problems. Should fix.\n`;
  body += `- **Suggestion**: Improvements that would be nice but not blocking.\n\n`;

  body += `---\n\n`;

  if (criticalCount > 0) {
    body += `### ❌ Critical Issues (${criticalCount})\n\n`;
    for (const issue of summary.criticalIssues) {
      body += `- \`${issue.file}:${issue.line}\` - ${issue.title}\n`;
    }
    body += `\n`;
  }

  if (warningCount > 0) {
    body += `### ⚠️ Warnings (${warningCount})\n\n`;
    for (const issue of summary.warnings) {
      body += `- \`${issue.file}:${issue.line}\` - ${issue.title}\n`;
    }
    body += `\n`;
  }

  if (suggestionCount > 0) {
    body += `### 💡 Suggestions (${suggestionCount})\n\n`;
    for (const issue of summary.suggestions) {
      body += `- \`${issue.file}:${issue.line}\` - ${issue.title}\n`;
    }
    body += `\n`;
  }

  if (criticalCount === 0 && warningCount === 0 && suggestionCount === 0) {
    body += `### ✨ No issues found!\n\nThe code looks good.\n`;
  }

  body += `\n---\n*Reviewed by PR Police Bot*`;

  return body;
}

const worker = new Worker<JobData>(
  "ai-pr-reviews",
  async (job) => {
    const { installationId, repository, pullRequestNumber } = job.data;

    logStructured("worker.job.received", {
      jobId: job.id,
      repo: `${repository.owner}/${repository.name}`,
      pullRequestNumber,
    });

    const octokit = await createGitHubClientForInstallation(installationId);

    const [pr, files] = await Promise.all([
      octokit.pulls.get({
        owner: repository.owner,
        repo: repository.name,
        pull_number: pullRequestNumber,
      }),
      fetchPrFiles(octokit, {
        owner: repository.owner,
        repo: repository.name,
        pullNumber: pullRequestNumber,
      }),
    ]);

    const reviewableFiles = buildReviewableFiles(files);
    const anchorMap = new Map<string, Set<number>>();
    for (const f of reviewableFiles) {
      anchorMap.set(f.filename, extractNewLineAnchorsFromPatch(f.patch));
    }

    logStructured("worker.files.reviewable", {
      count: reviewableFiles.length,
      pullRequestNumber,
    });

    if (reviewableFiles.length === 0) {
      logStructured("worker.files.none_reviewable", { pullRequestNumber });
      return;
    }

    const repoContext = await loadRepoContext(octokit, {
      owner: repository.owner,
      repo: repository.name,
    });

    const { comments, summary } = await reviewDiffFilesWithAI({
      pr: { title: pr.data.title, body: pr.data.body },
      files: reviewableFiles,
      repoContext,
    });

    const dedupedComments = deduplicateComments(comments);

    logStructured("worker.ai.comments.generated", {
      count: dedupedComments.length,
      pullRequestNumber,
    });

    const headSha = pr.data.head.sha;

    // Reduce noise:
    // - Inline only critical/warning with confidence != low
    // - Cap total and per-file
    const MAX_INLINE = Number(process.env.MAX_INLINE_COMMENTS || 8);
    const MAX_INLINE_PER_FILE = Number(process.env.MAX_INLINE_PER_FILE || 2);

    const inlineCandidates = dedupedComments.filter(
      (c) =>
        (c.severity === "critical" || c.severity === "warning") &&
        c.confidence !== "low",
    );

    const inlineByFile = new Map<string, number>();
    const inlineComments: AIReviewComment[] = [];
    for (const c of inlineCandidates) {
      if (inlineComments.length >= MAX_INLINE) break;
      const n = inlineByFile.get(c.file) || 0;
      if (n >= MAX_INLINE_PER_FILE) continue;
      inlineByFile.set(c.file, n + 1);
      inlineComments.push(c);
    }

    for (const comment of inlineComments) {
      const body = formatCommentBody(comment);
      const anchors = anchorMap.get(comment.file);
      const safeLine = anchors ? clampToNearestAnchor(comment.line, anchors) : null;

      if (!safeLine) {
        logStructured("worker.comment.unanchorable", {
          file: comment.file,
          requestedLine: comment.line,
        });
        continue;
      }

      try {
        await octokit.pulls.createReviewComment({
          owner: repository.owner,
          repo: repository.name,
          pull_number: pullRequestNumber,
          body,
          path: comment.file,
          commit_id: headSha,
          line: safeLine,
          side: "RIGHT",
        });
      } catch (err) {
        logStructured("github.createReviewComment.error", {
          error: String(err),
          file: comment.file,
          line: safeLine,
        });
      }
    }

    // Post a comprehensive summary comment
    const summaryBody = formatSummaryBody(summary, dedupedComments);

    await octokit.issues.createComment({
      owner: repository.owner,
      repo: repository.name,
      issue_number: pullRequestNumber,
      body: summaryBody,
    });
  },
  {
    connection,
    concurrency: 2,
  },
);

worker.on("completed", (job) => {
  logStructured("worker.job.completed", { jobId: job.id });
});

worker.on("failed", (job, err) => {
  logStructured("worker.job.failed", { jobId: job?.id, error: String(err) });
});
