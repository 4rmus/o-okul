import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { HttpException, HttpStatus } from "@nestjs/common";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { SocketRedisCommandClient, type RedisCommandClient } from "../auth/login-attempt-limiter.js";

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<number>;
}

interface RateLimitState {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  enabled?: boolean;
  maxRequests?: number;
  windowMs?: number;
  store?: RateLimitStore;
}

const defaultWindowMs = 60_000;
const defaultMaxRequests = 300;
const excludedPathPrefixes = ["/health", "/metrics"];

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly requests = new Map<string, RateLimitState>();

  constructor(private readonly now = () => Date.now()) {}

  async increment(key: string, windowMs: number): Promise<number> {
    const existing = this.requests.get(key);
    if (!existing || existing.resetAt <= this.now()) {
      this.requests.set(key, { count: 1, resetAt: this.now() + windowMs });
      return 1;
    }

    existing.count += 1;
    return existing.count;
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisCommandClient = new SocketRedisCommandClient()) {}

  async increment(key: string, windowMs: number): Promise<number> {
    try {
      const count = await this.redis.command(["INCR", key]);
      const numericCount = typeof count === "number" ? count : Number(count);
      if (numericCount <= 1) {
        await this.redis.command(["PEXPIRE", key, String(windowMs)]);
      }
      return numericCount;
    } catch {
      throw new HttpException("RATE_LIMITER_UNAVAILABLE", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}

export function createApiRateLimitMiddleware(env = process.env, options: RateLimitOptions = {}) {
  const enabled = options.enabled ?? isApiRateLimitEnabled(env);
  const maxRequests = readPositiveInteger(env.API_RATE_LIMIT_MAX, options.maxRequests ?? defaultMaxRequests);
  const windowMs = readPositiveInteger(env.API_RATE_LIMIT_WINDOW_MS, options.windowMs ?? defaultWindowMs);
  const store = options.store ?? createRateLimitStore(env);

  return async (request: Request, response: Response, next: NextFunction) => {
    if (!enabled || shouldSkipRateLimit(request)) {
      next();
      return;
    }

    try {
      const count = await store.increment(rateLimitKey(request, env), windowMs);
      if (count <= maxRequests) {
        next();
        return;
      }

      response.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      response.status(HttpStatus.TOO_MANY_REQUESTS).json({
        error: {
          code: "RATE_LIMITED",
          message: "Çok fazla istek yapıldı.",
        },
      });
    } catch (error) {
      next(error);
    }
  };
}

export function createRateLimitStore(env = process.env): RateLimitStore {
  const explicit = env.API_RATE_LIMIT_STORE;
  if (env.NODE_ENV === "production" && explicit === "memory") {
    throw new Error('API_RATE_LIMIT_STORE must be "redis" in production.');
  }

  const useRedis =
    explicit === "redis" ||
    (explicit === undefined && resolvePersistenceDriver(env.PERSISTENCE_DRIVER, env) === "postgres");
  return useRedis ? new RedisRateLimitStore() : new InMemoryRateLimitStore();
}

export function isApiRateLimitEnabled(env = process.env): boolean {
  if (env.API_RATE_LIMIT_ENABLED === "true") return true;
  if (env.API_RATE_LIMIT_ENABLED === "false") return false;
  if (env.NODE_ENV === "test") return false;
  return resolvePersistenceDriver(env.PERSISTENCE_DRIVER, env) === "postgres";
}

export function rateLimitKey(request: Request, env = process.env): string {
  const ip = readClientIp(request);
  const prefix = env.API_RATE_LIMIT_KEY_PREFIX || env.QUEUE_PREFIX || "uzman_hocam";
  const digest = createHash("sha256").update(ip).digest("hex");
  return `${prefix}:api-rate-limit:${digest}`;
}

function shouldSkipRateLimit(request: Request): boolean {
  if (request.method === "OPTIONS") return true;
  const path = request.path || request.url || "/";
  return excludedPathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function readClientIp(request: Request): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const forwardedIp = firstForwarded?.split(",")[0]?.trim();
  if (forwardedIp) return forwardedIp;

  const realIp = request.headers["x-real-ip"];
  if (Array.isArray(realIp)) return realIp[0] ?? "unknown";
  return realIp?.trim() || request.ip || request.socket.remoteAddress || "unknown";
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
