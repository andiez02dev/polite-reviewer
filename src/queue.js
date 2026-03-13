import { Queue } from "bullmq";
import IORedis from "ioredis";
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

export function createQueue() {
  logStructured("queue.created", { name: "ai-pr-reviews" });

  return new Queue("ai-pr-reviews", {
    connection,
  });
}

