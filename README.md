## PR Police Bot

An AI-powered GitHub App that automatically reviews pull requests using Gemini. It receives GitHub webhooks, enqueues background jobs with BullMQ + Redis, and posts inline review comments back to the PR.

### Project structure

- **`src/server.js`**: Express webhook server (`POST /webhook`) for `pull_request` and `issue_comment` events.
- **`src/worker.js`**: BullMQ worker that processes review jobs, calls Gemini, and posts comments.
- **`src/queue.js`**: BullMQ queue setup and Redis connection.
- **`src/github.js`**: GitHub App authentication and installation client helpers.
- **`src/ai.js`**: Gemini integration and review logic.
- **`src/diff.js`**: Diff parsing and filtering utilities.
- **`src/config.js`**: Environment configuration and structured logging helper.
- **`keys/github-private-key.pem`**: GitHub App private key (PEM).
- **`.env.example`**: Example environment configuration.

### Requirements

- Node.js 20+
- Redis (local or remote)
- A GitHub App with:
  - Webhook configured
  - Permissions for pull requests and contents
  - Installed on the target repository or organization
  - Private key downloaded as a `.pem` file

### Setup

1. **Install dependencies**

```bash
cd polite-reviewer
npm install
```

2. **Configure environment**

- Copy the example env and fill in values:

```bash
cp .env.example .env
```

Required variables:

- **`PORT`**: Port for the Express server (default `3000`).
- **`GITHUB_APP_ID`**: Your GitHub App ID.
- **`GITHUB_INSTALLATION_ID`** (optional): Default installation id if not provided in payloads.
- **`GITHUB_PRIVATE_KEY`** or **`GITHUB_PRIVATE_KEY_PATH`**:
  - `GITHUB_PRIVATE_KEY` (recommended for cloud providers like Railway): the full PEM content as an env var (use `\n` for newlines if required by the platform).
  - `GITHUB_PRIVATE_KEY_PATH` (for local dev): path to the GitHub App private key PEM (default `./keys/github-private-key.pem`).
- **`WEBHOOK_SECRET`**: Shared secret for webhook signatures.
- **Redis**:
  - Local dev: `REDIS_HOST` (default `127.0.0.1`), `REDIS_PORT` (default `6379`).
  - Managed Redis (e.g. Railway): `REDIS_URL` such as `redis://default:password@host:6379`.
- **`GEMINI_API_KEY`**: Your Gemini API key.
- **`GEMINI_MODEL`**: Gemini model to use (e.g. `gemini-2.5-flash`).

3. **Add GitHub private key**

Save your GitHub App private key as `keys/github-private-key.pem` (or update `GITHUB_PRIVATE_KEY_PATH` to match your location).

### GitHub App configuration

In your GitHub App settings:

- **Webhook URL**: `https://your-domain.example.com/webhook`
- **Webhook secret**: Set to the same value as `WEBHOOK_SECRET` in `.env`.
- **Permissions (minimum)**:
  - Pull requests: **Read & write**
  - Contents: **Read-only**
  - Issues: **Read & write** (for comments)
- **Events**:
  - `Pull request`
  - `Issue comment`

Install the app on the repositories or organizations you want the bot to monitor.

### Running Redis

Locally via Docker:

```bash
docker run --name ai-review-redis -p 6379:6379 -d redis:7-alpine
```

Or use a managed Redis instance and point `REDIS_HOST` / `REDIS_PORT` at it.

### Running the server and worker

Start the webhook server:

```bash
npm run dev
# or
npm start
```

Start the worker (in a separate terminal):

```bash
npm run worker
```

Both processes require access to the same Redis instance.

### Testing webhooks with ngrok

Expose your local server using ngrok:

```bash
ngrok http 3000
```

Copy the HTTPS URL from ngrok (e.g. `https://abc123.ngrok.io`) and set your GitHub App webhook URL to:

```text
https://abc123.ngrok.io/webhook
```

Trigger events by opening or updating a pull request, or by commenting `/polite-review` on an existing pull request.

### How it works

- **Webhook flow**
  - GitHub sends a `pull_request` or `issue_comment` webhook.
  - The server verifies the signature (if `WEBHOOK_SECRET` is set) and enqueues a `review-pr` job.
- **Worker flow**
  - The worker pulls jobs from the `ai-pr-reviews` queue.
  - For each job, it:
    - Authenticates as the GitHub App installation.
    - Fetches PR files via `GET /repos/{owner}/{repo}/pulls/{pull_number}/files`.
    - Filters and truncates diffs via `src/diff.js`.
    - Sends file diffs to Gemini (`src/ai.js`).
    - Parses structured JSON responses and posts inline review comments via:
      - `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments`.

### Commands

- Automatic review:
  - Open or update a pull request; the bot will enqueue a review job.
- Manual review:
  - Add a comment on a pull request with the body:

```text
/polite-review
```

This triggers a manual review job for that PR.
