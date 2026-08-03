import { createHash } from "node:crypto";
import { Socket, connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import { HttpException, HttpStatus } from "@nestjs/common";
import { parseRedisUrl } from "../config/env.js";
import { resolvePersistenceDriver } from "../config/persistence.js";

interface LoginAttemptState {
  count: number;
  lockedUntil: number;
}

const defaultMaxAttempts = 5;
const defaultLockMs = 15 * 60 * 1000;
const defaultRedisTimeoutMs = 500;

export interface LoginAttemptLimiterStore {
  assertAllowed(key: string): Promise<void>;
  recordFailure(key: string): Promise<void>;
  recordSuccess(key: string): Promise<void>;
}

export const loginAttemptLimiterToken = Symbol("LoginAttemptLimiter");

export class LoginAttemptLimiter implements LoginAttemptLimiterStore {
  private readonly attempts = new Map<string, LoginAttemptState>();

  constructor(
    private readonly maxAttempts = defaultMaxAttempts,
    private readonly lockMs = defaultLockMs,
    private readonly now = () => Date.now(),
  ) {}

  async assertAllowed(key: string): Promise<void> {
    const state = this.attempts.get(key);
    if (!state) return;

    if (state.lockedUntil > this.now()) {
      throw new HttpException("LOGIN_LOCKED", HttpStatus.TOO_MANY_REQUESTS);
    }

    if (state.lockedUntil > 0) {
      this.attempts.delete(key);
    }
  }

  async recordFailure(key: string): Promise<void> {
    const current = this.attempts.get(key);
    const count = (current?.count ?? 0) + 1;
    this.attempts.set(key, {
      count,
      lockedUntil: count >= this.maxAttempts ? this.now() + this.lockMs : 0,
    });
  }

  async recordSuccess(key: string): Promise<void> {
    this.attempts.delete(key);
  }
}

export interface RedisCommandClient {
  command(parts: string[]): Promise<RedisReply>;
}

export class RedisLoginAttemptLimiter implements LoginAttemptLimiterStore {
  constructor(
    private readonly redis: RedisCommandClient = new SocketRedisCommandClient(),
    private readonly maxAttempts = defaultMaxAttempts,
    private readonly lockMs = defaultLockMs,
  ) {}

  async assertAllowed(key: string): Promise<void> {
    const locked = await this.redis.command(["GET", lockKey(key)]);
    if (locked !== null) {
      throw new HttpException("LOGIN_LOCKED", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async recordFailure(key: string): Promise<void> {
    const failures = await this.redis.command(["INCR", failureKey(key)]);
    const count = typeof failures === "number" ? failures : Number(failures);

    if (count <= 1) {
      await this.redis.command(["PEXPIRE", failureKey(key), String(this.lockMs)]);
    }

    if (count >= this.maxAttempts) {
      await this.redis.command(["SET", lockKey(key), "1", "PX", String(this.lockMs)]);
      await this.redis.command(["PEXPIRE", failureKey(key), String(this.lockMs)]);
    }
  }

  async recordSuccess(key: string): Promise<void> {
    await this.redis.command(["DEL", failureKey(key), lockKey(key)]);
  }
}

export function createLoginAttemptLimiter(env = process.env): LoginAttemptLimiterStore {
  const explicit = env.LOGIN_ATTEMPT_LIMITER_STORE;
  if (env.NODE_ENV === "production" && explicit === "memory") {
    throw new Error('LOGIN_ATTEMPT_LIMITER_STORE must be "redis" in production.');
  }
  const useRedis =
    explicit === "redis" ||
    (explicit === undefined && resolvePersistenceDriver(env.PERSISTENCE_DRIVER, env) === "postgres");
  return useRedis ? new RedisLoginAttemptLimiter() : new LoginAttemptLimiter();
}

export function loginAttemptKey(identifier: string, ip = "unknown"): string {
  const normalized = identifier.trim().toLowerCase();
  const normalizedIp = ip.trim().toLowerCase() || "unknown";
  const material = `login:${normalized || "unknown"}|ip:${normalizedIp}`;
  return createHash("sha256").update(material).digest("hex");
}

export function mfaAttemptKey(userId: string, purpose: string): string {
  return createHash("sha256").update(`mfa:${purpose}:${userId}`).digest("hex");
}

function failureKey(key: string): string {
  return `auth:login-attempt:${key}:failures`;
}

function lockKey(key: string): string {
  return `auth:login-attempt:${key}:lock`;
}

export type RedisReply = string | number | null;
type RedisConfig = ReturnType<typeof parseRedisUrl>;

export class SocketRedisCommandClient implements RedisCommandClient {
  constructor(
    private readonly redis: RedisConfig = parseRedisUrl(),
    private readonly timeoutMs = defaultRedisTimeoutMs,
  ) {}

  command(parts: string[]): Promise<RedisReply> {
    const commands = buildRedisCommandBatch(this.redis, parts);
    const expectedReplies = commands.length;

    return new Promise((resolve, reject) => {
      const socket = this.redis.tls
        ? connectTls({ host: this.redis.host, port: this.redis.port, ...this.redis.tls })
        : connectTcp({ host: this.redis.host, port: this.redis.port });
      let buffer = "";
      const replies: RedisReply[] = [];
      let settled = false;

      const done = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) {
          reject(new HttpException("LOGIN_LIMITER_UNAVAILABLE", HttpStatus.SERVICE_UNAVAILABLE));
          return;
        }
        resolve(replies[replies.length - 1] ?? null);
      };

      socket.setTimeout(this.timeoutMs);
      socket.once("connect", () => {
        socket.write(commands.map(encodeRedisCommand).join(""));
      });
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        try {
          let parsed: ParsedReply | undefined;
          do {
            parsed = parseReply(buffer);
            if (parsed) {
              replies.push(parsed.value);
              buffer = buffer.slice(parsed.nextOffset);
            }
          } while (parsed);

          if (replies.length >= expectedReplies) {
            done();
          }
        } catch (error) {
          done(error instanceof Error ? error : new Error("REDIS_REPLY_INVALID"));
        }
      });
      socket.once("timeout", () => done(new Error("REDIS_TIMEOUT")));
      socket.once("error", (error) => done(error));
    });
  }
}

function buildRedisCommandBatch(redis: RedisConfig, command: string[]): string[][] {
  const commands: string[][] = [];
  if (redis.password) {
    commands.push(redis.username ? ["AUTH", redis.username, redis.password] : ["AUTH", redis.password]);
  }
  if (redis.db !== undefined) {
    commands.push(["SELECT", String(redis.db)]);
  }
  commands.push(command);
  return commands;
}

function encodeRedisCommand(parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}

interface ParsedReply {
  value: RedisReply;
  nextOffset: number;
}

function parseReply(buffer: string): ParsedReply | undefined {
  if (buffer.length === 0) return undefined;
  const marker = buffer[0];
  if (marker === "+" || marker === "-" || marker === ":") {
    const end = buffer.indexOf("\r\n");
    if (end === -1) return undefined;
    const payload = buffer.slice(1, end);
    if (marker === "-") throw new Error(payload || "REDIS_ERROR");
    return { value: marker === ":" ? Number(payload) : payload, nextOffset: end + 2 };
  }

  if (marker === "$") {
    const headerEnd = buffer.indexOf("\r\n");
    if (headerEnd === -1) return undefined;
    const length = Number(buffer.slice(1, headerEnd));
    if (length === -1) return { value: null, nextOffset: headerEnd + 2 };
    const valueStart = headerEnd + 2;
    const valueEnd = valueStart + length;
    if (buffer.length < valueEnd + 2) return undefined;
    return { value: buffer.slice(valueStart, valueEnd), nextOffset: valueEnd + 2 };
  }

  throw new Error("REDIS_REPLY_INVALID");
}
