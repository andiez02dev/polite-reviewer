import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  geminiApiKey: required("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  githubAppId: required("GITHUB_APP_ID"),
  githubInstallationId: process.env.GITHUB_INSTALLATION_ID || null,
  webhookSecret: process.env.WEBHOOK_SECRET || null,
  githubPrivateKeyPath:
    process.env.GITHUB_PRIVATE_KEY_PATH || "./keys/github-private-key.pem",
  redis: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
  },
};

export function logStructured(message, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    msg: message,
    ...details,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

