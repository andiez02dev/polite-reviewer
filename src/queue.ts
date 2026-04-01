import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { JobData } from "./types.js";
import { config, logStructured } from "./config.js";

type RedisConnection = string | { host: string; port: number };

const redisOptions: RedisConnection = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: config.redis.host,
      port: config.redis.port,
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connection = new (IORedis as any)(redisOptions, {
  maxRetriesPerRequest: null,
});

export function createQueue(): Queue<JobData> {
  logStructured("queue.created", { name: "ai-pr-reviews" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Queue<JobData>("ai-pr-reviews", {
    connection,
  });
}
