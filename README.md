## PR Police Bot

An AI-powered GitHub App that automatically reviews pull requests using Gemini. It receives GitHub webhooks, enqueues background jobs with BullMQ + Redis, performs AST-based context extraction, and posts inline review comments back to the PR.

### How it works

```
GitHub Webhook → server.ts → BullMQ Queue (Redis)
                                    ↓
                              worker.ts
                                    ↓
                    Fetch PR files (GitHub API)
                                    ↓
                    Filter files (file-filter.ts)
                                    ↓
                    Fetch full file content + AST extraction (ast-extractor.ts)
                    [extracts logical blocks: functions, classes, interfaces]
                                    ↓
                    Build prompt with logical blocks (prompt-builder.ts)
                                    ↓
                    Gemini AI review (ai.ts)
                                    ↓
                    Post inline comments + summary (worker.ts)
```

**Webhook flow**
- GitHub sends a `pull_request` or `issue_comment` webhook
- Server verifies HMAC-SHA256 signature and enqueues a `review-pr` job

**Worker flow**
- Fetches PR files and filters out binaries, lock files, generated files
- For each TypeScript/JavaScript file: fetches full content and uses `ts-morph` to extract the logical blocks (functions, classes, interfaces) containing changed lines — instead of sending raw diffs
- Sends enriched context to Gemini with structured JSON output format
- Posts inline review comments (critical/warning only, max 8 total, max 2 per file) and a summary comment

### Project structure

```
src/
  server.ts                    — Express webhook server (POST /webhook)
  worker.ts                    — BullMQ worker, orchestrates the review pipeline
  queue.ts                     — BullMQ queue + Redis connection
  github.ts                    — GitHub App auth, Octokit client helpers
  ai.ts                        — Gemini API integration, response parsing
  config.ts                    — Environment config, structured logging
  types.ts                     — Shared TypeScript interfaces
  diff.ts                      — Legacy diff utilities (unused in main pipeline)
  ai/
    prompt-builder.ts          — Builds system/user prompts for Gemini
  analysis/
    ast-extractor.ts           — ts-morph AST extraction of logical blocks
    diff-parser.ts             — Git diff parsing, line anchor mapping
    file-filter.ts             — PR file filtering and patch normalization
    comment-deduplicator.ts    — Deduplicates AI-generated comments
  utils/
    logger.ts                  — Structured logging helpers
```

### Requirements

- Node.js 20+
- Redis (local or remote)
- A GitHub App with:
  - Webhook configured
  - Permissions: Pull requests (Read & write), Contents (Read-only), Issues (Read & write)
  - Events: `Pull request`, `Issue comment`
  - Private key downloaded as a `.pem` file

### Setup

1. **Install dependencies**

```bash
npm install
```

2. **Configure environment**

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Gemini API key |
| `GEMINI_MODEL` | | Model name (default: `gemini-1.5-flash`) |
| `GITHUB_APP_ID` | ✅ | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | ✅* | Full PEM content (recommended for Railway/cloud) |
| `GITHUB_PRIVATE_KEY_PATH` | ✅* | Path to PEM file (for local dev) |
| `GITHUB_INSTALLATION_ID` | | Default installation ID if not in webhook payload |
| `WEBHOOK_SECRET` | | HMAC secret for webhook signature verification |
| `PORT` | | Express server port (default: `3000`) |
| `REDIS_URL` | ✅* | Full Redis URL (e.g. Railway: `redis://default:pass@host:6379`) |
| `REDIS_HOST` | ✅* | Redis host for local dev (default: `127.0.0.1`) |
| `REDIS_PORT` | | Redis port (default: `6379`) |
| `MAX_INLINE_COMMENTS` | | Max inline comments per review (default: `8`) |
| `MAX_INLINE_PER_FILE` | | Max inline comments per file (default: `2`) |
| `GITHUB_BOT_NAME` | | Bot slug for duplicate comment detection (default: `polite-reviewer`) |

*Use either `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_PATH`. Use either `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`.

3. **Add GitHub private key** (local dev only)

```bash
# Save your GitHub App private key to:
keys/github-private-key.pem
```

### Running locally

Start Redis:

```bash
docker run --name ai-review-redis -p 6379:6379 -d redis:7-alpine
```

Start the webhook server:

```bash
npm run dev
```

Start the worker (separate terminal):

```bash
npm run dev:worker
```

Expose locally with ngrok:

```bash
ngrok http 3000
# Set webhook URL in GitHub App settings to: https://<id>.ngrok.io/webhook
```

### Running with Docker

```bash
docker-compose up
```

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start server with nodemon + tsx (no build needed) |
| `npm run dev:worker` | Start worker with nodemon + tsx |
| `npm start` | Start server from compiled `dist/` |
| `npm run worker` | Start worker from compiled `dist/` |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run typecheck` | Type-check without emitting |

### Triggering a review

**Automatic**: Open or push to a pull request — bot reviews automatically.

**Manual**: Comment on any PR:

```
/polite-review
```

### GitHub App configuration

In your GitHub App settings:

- **Webhook URL**: `https://your-domain.example.com/webhook`
- **Webhook secret**: Same value as `WEBHOOK_SECRET`
- **Permissions**: Pull requests (Read & write), Contents (Read-only), Issues (Read & write)
- **Events**: Pull request, Issue comment
