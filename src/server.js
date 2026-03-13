import crypto from "crypto";
import express from "express";
import { createQueue } from "./queue.js";
import { getInstallationIdFromPayload } from "./github.js";
import { config, logStructured } from "./config.js";

const app = express();

// Capture raw body for signature verification
app.use(
  express.raw({
    type: "*/*",
  }),
);

function verifySignature(req) {
  if (!config.webhookSecret) return true;

  const signature = req.headers["x-hub-signature-256"];
  if (!signature || typeof signature !== "string") return false;

  const hmac = crypto.createHmac("sha256", config.webhookSecret);
  hmac.update(req.body);
  const digest = `sha256=${hmac.digest("hex")}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

function parseJsonBody(req) {
  try {
    if (typeof req.body === "string") {
      return JSON.parse(req.body);
    }
    if (Buffer.isBuffer(req.body)) {
      return JSON.parse(req.body.toString("utf8"));
    }
    return req.body;
  } catch (err) {
    throw new Error(`Invalid JSON body: ${String(err)}`);
  }
}

const queue = createQueue();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    logStructured("webhook.signature.invalid", {});
    return res.status(401).json({ error: "invalid_signature" });
  }

  const event = req.headers["x-github-event"];
  const id = req.headers["x-github-delivery"];

  let payload;
  try {
    payload = parseJsonBody(req);
  } catch (err) {
    logStructured("webhook.payload.parse_error", { error: String(err) });
    return res.status(400).json({ error: "invalid_payload" });
  }

  logStructured("webhook.received", { event, id });

  if (event === "pull_request") {
    const action = payload.action;
    if (!["opened", "synchronize", "reopened"].includes(action)) {
      return res.status(200).json({ skipped: true, reason: "irrelevant pull_request action" });
    }

    try {
      const installationId = await getInstallationIdFromPayload(payload);

      await queue.add("review-pr", {
        installationId,
        repository: {
          owner: payload.repository.owner.login,
          name: payload.repository.name,
        },
        pullRequestNumber: payload.pull_request.number,
      });

      logStructured("webhook.pull_request.enqueued", {
        installationId,
        repo: `${payload.repository.owner.login}/${payload.repository.name}`,
        pullRequestNumber: payload.pull_request.number,
      });

      return res.status(202).json({ queued: true });
    } catch (err) {
      logStructured("webhook.pull_request.error", { error: String(err) });
      return res.status(500).json({ error: "internal_error" });
    }
  }

  if (event === "issue_comment" && payload.action === "created") {
    const commentBody = payload.comment?.body || "";
    const isCommand = commentBody.trim().toLowerCase().startsWith("/polite-review");

    if (!isCommand || !payload.issue?.pull_request) {
      return res.status(200).json({ skipped: true, reason: "not a polite-review command" });
    }

    try {
      const installationId = await getInstallationIdFromPayload(payload);

      await queue.add("review-pr", {
        installationId,
        repository: {
          owner: payload.repository.owner.login,
          name: payload.repository.name,
        },
        pullRequestNumber: payload.issue.number,
        manualTrigger: true,
        triggeredBy: payload.comment.user?.login,
      });

      logStructured("webhook.issue_comment.enqueued", {
        installationId,
        repo: `${payload.repository.owner.login}/${payload.repository.name}`,
        pullRequestNumber: payload.issue.number,
      });

      return res.status(202).json({ queued: true });
    } catch (err) {
      logStructured("webhook.issue_comment.error", { error: String(err) });
      return res.status(500).json({ error: "internal_error" });
    }
  }

  return res.status(200).json({ skipped: true, reason: "unsupported_event" });
});

app.listen(config.port, () => {
  logStructured("server.started", { port: config.port });
});

