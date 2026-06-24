import { Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Socket } from "node:net";
import pg from "pg";
import { parseRedisUrl } from "../config/env.js";

export interface HealthStatus {
  status: "ok";
}

export interface ReadyStatus {
  status: "ready";
  dependencies: {
    postgres: "ok";
    redis: "ok";
  };
}

export interface ReadinessChecker {
  postgres(): Promise<boolean>;
  redis(): Promise<boolean>;
}

export const READINESS_CHECKER = Symbol("READINESS_CHECKER");

@Injectable()
export class HealthService {
  private readonly checker: ReadinessChecker;

  constructor(@Optional() @Inject(READINESS_CHECKER) checker?: ReadinessChecker) {
    this.checker = checker ?? new DefaultReadinessChecker();
  }

  health(): HealthStatus {
    return { status: "ok" };
  }

  async ready(): Promise<ReadyStatus> {
    const [postgresOk, redisOk] = await Promise.all([
      this.checker.postgres(),
      this.checker.redis(),
    ]);

    if (!postgresOk || !redisOk) {
      throw new ServiceUnavailableException({
        error: {
          code: "DEPENDENCY_NOT_READY",
          message: "Postgres veya Redis hazır değil.",
          details: {
            postgres: postgresOk ? "ok" : "down",
            redis: redisOk ? "ok" : "down",
          },
        },
      });
    }

    return {
      status: "ready",
      dependencies: {
        postgres: "ok",
        redis: "ok",
      },
    };
  }
}

class DefaultReadinessChecker implements ReadinessChecker {
  async postgres(): Promise<boolean> {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
      connectionTimeoutMillis: 500,
    });

    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  async redis(): Promise<boolean> {
    return pingRedis(parseRedisUrl());
  }
}

type RedisConfig = ReturnType<typeof parseRedisUrl>;

function pingRedis(redis: RedisConfig): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let response = "";
    let settled = false;

    const done = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.write(buildRedisPingCommand(redis));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");

      if (response.startsWith("-") || response.includes("\r\n-")) {
        done(false);
        return;
      }

      if (response.includes("+PONG")) {
        done(true);
      }
    });
    socket.once("timeout", () => {
      done(false);
    });
    socket.once("error", () => {
      done(false);
    });
    socket.connect(redis.port, redis.host);
  });
}

function buildRedisPingCommand(redis: RedisConfig): string {
  const commands: string[][] = [];

  if (redis.password) {
    commands.push(redis.username ? ["AUTH", redis.username, redis.password] : ["AUTH", redis.password]);
  }

  if (redis.db !== undefined) {
    commands.push(["SELECT", String(redis.db)]);
  }

  commands.push(["PING"]);

  return commands.map(encodeRedisCommand).join("");
}

function encodeRedisCommand(parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}
