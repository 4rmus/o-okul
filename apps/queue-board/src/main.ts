import { createHash, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Queue, type ConnectionOptions, type QueueOptions } from "bullmq";
import express, { type NextFunction, type Request, type Response } from "express";

const queueNames = [
  "announcement-delivery",
  "backup-restore",
  "exam-evaluation",
  "excel-import",
  "report-generation",
  "report-pdf-render",
  "sms-batch",
];

interface QueueBoardConfig {
  authPassword: string;
  authUser: string;
  basePath: string;
  bindHost: string;
  port: number;
  queuePrefix?: string;
  redisUrl: string;
}

const config = readConfig(process.env);
const queues = createQueues(config);
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(config.basePath);

createBullBoard({
  queues: queues.map((queue) => new BullMQAdapter(queue)),
  serverAdapter,
});

const app = express();

app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});
app.use(config.basePath, requireBasicAuth(config), serverAdapter.getRouter());

const server = app.listen(config.port, config.bindHost, () => {
  console.log(`Queue board listening on http://${config.bindHost}:${config.port}${config.basePath}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(server, queues);
  });
}

function readConfig(env: NodeJS.ProcessEnv): QueueBoardConfig {
  const authUser = env.QUEUE_BOARD_BASIC_AUTH_USER?.trim();
  const authPassword = env.QUEUE_BOARD_BASIC_AUTH_PASSWORD ?? "";
  if (!authUser) {
    throw new Error("QUEUE_BOARD_BASIC_AUTH_USER is required.");
  }
  if (!authPassword) {
    throw new Error("QUEUE_BOARD_BASIC_AUTH_PASSWORD is required.");
  }
  if (env.NODE_ENV === "production" && authPassword.length < 16) {
    throw new Error("QUEUE_BOARD_BASIC_AUTH_PASSWORD must be at least 16 characters in production.");
  }

  return {
    authPassword,
    authUser,
    basePath: normalizeBasePath(env.QUEUE_BOARD_BASE_PATH ?? "/admin/queues"),
    bindHost: env.QUEUE_BOARD_BIND_HOST ?? "0.0.0.0",
    port: readPort(env.PORT ?? env.QUEUE_BOARD_PORT ?? "3200"),
    queuePrefix: env.QUEUE_PREFIX || undefined,
    redisUrl: env.REDIS_URL ?? "redis://redis:6379",
  };
}

function createQueues(config: QueueBoardConfig): Array<Queue<unknown, unknown, string>> {
  const options: QueueOptions = {
    connection: parseRedisUrl(config.redisUrl),
    prefix: config.queuePrefix,
  };
  return queueNames.map((queueName) => new Queue(queueName, options));
}

function parseRedisUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }

  return {
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    host: url.hostname,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    port: url.port ? Number(url.port) : 6379,
    tls: url.protocol === "rediss:" ? {} : undefined,
    username: url.username ? decodeURIComponent(url.username) : undefined,
  };
}

function requireBasicAuth(config: QueueBoardConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    const credentials = parseBasicAuth(request.headers.authorization);
    if (
      credentials &&
      safeEqual(credentials.user, config.authUser) &&
      safeEqual(credentials.password, config.authPassword)
    ) {
      next();
      return;
    }

    response.setHeader("WWW-Authenticate", 'Basic realm="o-okul Queue Board"');
    response.status(401).send("Unauthorized");
  };
}

function parseBasicAuth(header: string | undefined): { password: string; user: string } | undefined {
  if (!header?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return undefined;
  return {
    password: decoded.slice(separator + 1),
    user: decoded.slice(0, separator),
  };
}

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(hashSecret(left), hashSecret(right));
}

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/admin/queues";
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") : `/${trimmed.replace(/\/+$/, "")}`;
}

function readPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("QUEUE_BOARD_PORT must be a valid TCP port.");
  }
  return port;
}

async function shutdown(server: Server, queues: Array<Queue<unknown, unknown, string>>): Promise<void> {
  await Promise.allSettled(queues.map((queue) => queue.close()));
  server.close(() => {
    process.exit(0);
  });
}
