import crypto from "crypto";
import express, { type Request, type Response } from "express";
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function verifySignature(req: Request): boolean {
  if (!config.webhookSecret) return true;

  const signature = req.headers["x-hub-signature-256"];
  if (!signature || typeof signature !== "string") return false;

  const hmac = crypto.createHmac("sha256", config.webhookSecret);
  hmac.update(req.body as Buffer);
  const digest = `sha256=${hmac.digest("hex")}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

function parseJsonBody(req: Request): unknown {
  try {
    if (typeof req.body === "string") {
      return JSON.parse(req.body) as unknown;
    }
    if (Buffer.isBuffer(req.body)) {
      return JSON.parse(req.body.toString("utf8")) as unknown;
    }
    return req.body as unknown;
  } catch (err) {
    throw new Error(`Invalid JSON body: ${String(err)}`);
  }
}

const queue = createQueue();

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/webhook", async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    logStructured("webhook.signature.invalid", {});
    return res.status(401).json({ error: "invalid_signature" });
  }

  const event = req.headers["x-github-event"];
  const id = req.headers["x-github-delivery"];

  let payload: unknown;
  try {
    payload = parseJsonBody(req);
  } catch (err) {
    logStructured("webhook.payload.parse_error", { error: String(err) });
    return res.status(400).json({ error: "invalid_payload" });
  }

  logStructured("webhook.received", { event, id });

  if (!isRecord(payload)) {
    return res.status(200).json({ skipped: true, reason: "unsupported_event" });
  }

  if (event === "issue_comment" && payload["action"] === "created") {
    const comment = isRecord(payload["comment"]) ? payload["comment"] : null;
    const issue = isRecord(payload["issue"]) ? payload["issue"] : null;
    const commentBody = (typeof comment?.["body"] === "string" ? comment["body"] : "")
      .trim()
      .toLowerCase();

    const isCommand =
      commentBody === "/polite-review" ||
      commentBody === "polite-review" ||
      commentBody.startsWith("/polite-review ");

    if (!isCommand || !issue?.["pull_request"]) {
      return res.status(200).json({ skipped: true, reason: "not a polite-review command" });
    }

    try {
      const installationId = await getInstallationIdFromPayload(payload);

      const repository = isRecord(payload["repository"]) ? payload["repository"] : null;
      const owner = isRecord(repository?.["owner"]) ? repository["owner"] : null;
      const commentUser = isRecord(comment?.["user"]) ? comment["user"] : null;

      await queue.add("review-pr", {
        installationId,
        repository: {
          owner: typeof owner?.["login"] === "string" ? owner["login"] : "",
          name: typeof repository?.["name"] === "string" ? repository["name"] : "",
        },
        pullRequestNumber: typeof issue["number"] === "number" ? issue["number"] : 0,
        manualTrigger: true,
        triggeredBy: typeof commentUser?.["login"] === "string" ? commentUser["login"] : undefined,
      });

      logStructured("webhook.issue_comment.enqueued", {
        installationId,
        repo: `${owner?.["login"] ?? ""}/${repository?.["name"] ?? ""}`,
        pullRequestNumber: issue["number"],
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
