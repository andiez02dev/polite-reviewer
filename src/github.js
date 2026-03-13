import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config, logStructured } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadPrivateKey() {
  // Preferred: read private key from env (better for platforms like Railway)
  if (process.env.GITHUB_PRIVATE_KEY) {
    // Support both plain multiline PEM and \n-escaped single-line form
    return process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  const keyPath = path.isAbsolute(config.githubPrivateKeyPath)
    ? config.githubPrivateKeyPath
    : path.join(__dirname, "..", config.githubPrivateKeyPath);

  return fs.readFileSync(keyPath, "utf8");
}

export async function createGitHubClientForInstallation(installationId) {
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

export async function getInstallationIdFromPayload(payload) {
  if (payload?.installation?.id) {
    return payload.installation.id;
  }
  if (config.githubInstallationId) {
    return Number(config.githubInstallationId);
  }
  throw new Error("Missing installation id in payload and GITHUB_INSTALLATION_ID is not set");
}


