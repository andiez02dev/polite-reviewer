import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config, logStructured } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadPrivateKey(): string {
  if (process.env.GITHUB_PRIVATE_KEY) {
    return process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  const keyPath = path.isAbsolute(config.githubPrivateKeyPath)
    ? config.githubPrivateKeyPath
    : path.join(__dirname, "..", config.githubPrivateKeyPath);

  return fs.readFileSync(keyPath, "utf8");
}

export async function createGitHubClientForInstallation(installationId: number): Promise<Octokit> {
  logStructured("github.installationToken.created", { installationId });

  const privateKey = loadPrivateKey();

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.githubAppId,
      privateKey,
      installationId,
    },
  });
}

export async function getInstallationIdFromPayload(payload: unknown): Promise<number> {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "installation" in payload &&
    payload.installation !== null &&
    typeof payload.installation === "object" &&
    "id" in payload.installation &&
    typeof payload.installation.id === "number"
  ) {
    return payload.installation.id;
  }
  if (config.githubInstallationId) {
    return Number(config.githubInstallationId);
  }
  throw new Error("Missing installation id in payload and GITHUB_INSTALLATION_ID is not set");
}
