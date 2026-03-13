import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createGitHubClientForInstallation } from "./github.js";
import { reviewDiffFilesWithAI } from "./ai.js";
import { buildReviewableFiles } from "./diff.js";
import { config, logStructured } from "./config.js";

// Use REDIS_URL when available (e.g. Railway), otherwise fall back to host/port.
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

  // Paginate through PR files
  // eslint-disable-next-line no-constant-condition
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

    logStructured("worker.files.reviewable", {
      count: reviewableFiles.length,
      pullRequestNumber,
    });

    if (reviewableFiles.length === 0) {
      return;
    }

    const comments = await reviewDiffFilesWithAI({
      title: pr.data.title,
      description: pr.data.body,
      files: reviewableFiles,
    });

    logStructured("worker.ai.comments.generated", {
      count: comments.length,
      pullRequestNumber,
    });

    const headSha = pr.data.head.sha;

    for (const comment of comments) {
      try {
        await octokit.pulls.createReviewComment({
          owner: repository.owner,
          repo: repository.name,
          pull_number: pullRequestNumber,
          body: comment.comment,
          path: comment.file,
          commit_id: headSha,
          line: comment.line,
          side: "RIGHT",
        });
      } catch (err) {
        logStructured("github.createReviewComment.error", {
          error: String(err),
          file: comment.file,
          line: comment.line,
        });
      }
    }
  },
  { connection },
);

worker.on("completed", (job) => {
  logStructured("worker.job.completed", { jobId: job.id });
});

worker.on("failed", (job, err) => {
  logStructured("worker.job.failed", { jobId: job?.id, error: String(err) });
});

