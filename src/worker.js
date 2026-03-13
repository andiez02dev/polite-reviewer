import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createGitHubClientForInstallation } from "./github.js";
import { reviewDiffFilesWithAI } from "./ai.js";
import { buildReviewableFiles } from "./analysis/file-filter.js";
import { deduplicateComments } from "./analysis/comment-deduplicator.js";
import { clampToNearestAnchor, extractNewLineAnchorsFromPatch } from "./analysis/diff-parser.js";
import { config, logStructured } from "./config.js";

const redisOptions = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: config.redis.host,
      port: config.redis.port,
    };

const connection = new IORedis(redisOptions, {
  maxRetriesPerRequest: null,
});

async function fetchPrFiles(octokit, { owner, repo, pullNumber }) {
  const files = [];
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

async function loadRepoContext(octokit, { owner, repo }) {
  const context = {
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
    if (!Array.isArray(pkg.data) && "content" in pkg.data && pkg.data.content) {
      const buff = Buffer.from(pkg.data.content, pkg.data.encoding || "base64");
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
    if (!Array.isArray(tsconfig.data) && "content" in tsconfig.data && tsconfig.data.content) {
      const buff = Buffer.from(tsconfig.data.content, tsconfig.data.encoding || "base64");
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

  for (const path of candidateConfigFiles) {
    try {
      const res = await octokit.repos.getContent({ owner, repo, path });
      if (!Array.isArray(res.data) && "content" in res.data && res.data.content) {
        const buff = Buffer.from(res.data.content, res.data.encoding || "base64");
        context.configFiles.push({ path, content: buff.toString("utf8") });
      }
    } catch {
      // ignore missing optional files
    }
  }

  return context;
}

function formatCommentBody(comment) {
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

function formatSummaryBody(summary, comments) {
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

const worker = new Worker(
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
    const anchorMap = new Map();
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

    const inlineByFile = new Map();
    const inlineComments = [];
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
