import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  createApiRateLimitMiddleware,
  createRateLimitStore,
  InMemoryRateLimitStore,
  isApiRateLimitEnabled,
  rateLimitKey,
  RedisRateLimitStore,
  type RateLimitStore,
} from "./rate-limit.js";

describe("API rate limit", () => {
  it("keeps fixed-window counts and resets after the window", async () => {
    let now = 1_000;
    const store = new InMemoryRateLimitStore(() => now);

    await expect(store.increment("k", 1_000)).resolves.toBe(1);
    await expect(store.increment("k", 1_000)).resolves.toBe(2);

    now = 2_001;
    await expect(store.increment("k", 1_000)).resolves.toBe(1);
  });

  it("blocks requests over the configured limit", async () => {
    const middleware = createApiRateLimitMiddleware(
      { API_RATE_LIMIT_ENABLED: "true", API_RATE_LIMIT_MAX: "2", API_RATE_LIMIT_WINDOW_MS: "60000" },
      { store: new InMemoryRateLimitStore(() => 1_000) },
    );
    const request = createRequest({ path: "/api/v1/students", ip: "10.0.0.5" });
    const firstNext = vi.fn();
    const secondNext = vi.fn();
    const thirdNext = vi.fn();
    const response = createResponse();

    await middleware(request, createResponse(), firstNext);
    await middleware(request, createResponse(), secondNext);
    await middleware(request, response, thirdNext);

    expect(firstNext).toHaveBeenCalledOnce();
    expect(secondNext).toHaveBeenCalledOnce();
    expect(thirdNext).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "60");
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: "RATE_LIMITED",
        message: "Çok fazla istek yapıldı.",
      },
    });
  });

  it("skips health, metrics and preflight requests", async () => {
    const store: RateLimitStore = { increment: vi.fn() };
    const middleware = createApiRateLimitMiddleware({ API_RATE_LIMIT_ENABLED: "true" }, { store });
    const next = vi.fn();

    await middleware(createRequest({ method: "GET", path: "/health" }), createResponse(), next);
    await middleware(createRequest({ method: "GET", path: "/metrics" }), createResponse(), next);
    await middleware(createRequest({ method: "OPTIONS", path: "/api/v1/students" }), createResponse(), next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(store.increment).not.toHaveBeenCalled();
  });

  it("uses Redis by default for durable deployments and rejects production memory store", () => {
    expect(isApiRateLimitEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isApiRateLimitEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(createRateLimitStore({ PERSISTENCE_DRIVER: "postgres" })).toBeInstanceOf(RedisRateLimitStore);
    expect(() => createRateLimitStore({ NODE_ENV: "production", API_RATE_LIMIT_STORE: "memory" })).toThrow(
      'API_RATE_LIMIT_STORE must be "redis" in production.',
    );
  });

  it("hashes client IPs in rate limit keys", () => {
    const key = rateLimitKey(createRequest({ ip: "203.0.113.12" }), { API_RATE_LIMIT_KEY_PREFIX: "test" });

    expect(key.startsWith("test:api-rate-limit:")).toBe(true);
    expect(key).not.toContain("203.0.113.12");
  });

  it("raw forwarded headers yerine Express'in çözdüğü istemci IP'sini kullanır", () => {
    const env = { API_RATE_LIMIT_KEY_PREFIX: "test" };
    const first = rateLimitKey(createRequest({ ip: "10.0.0.9", forwardedFor: "198.51.100.10" }), env);
    const second = rateLimitKey(createRequest({ ip: "10.0.0.9", forwardedFor: "198.51.100.11" }), env);

    expect(first).toBe(second);
  });

  it("maps Redis failures to a generic rate limiter error", async () => {
    const store = new RedisRateLimitStore({
      command: async () => {
        throw new Error("redis down");
      },
    });

    await expect(store.increment("k", 1_000)).rejects.toMatchObject({
      message: "RATE_LIMITER_UNAVAILABLE",
    } satisfies Partial<HttpException>);
  });
});

function createRequest(input: { method?: string; path?: string; ip?: string; forwardedFor?: string } = {}): Request {
  return {
    headers: input.forwardedFor ? { "x-forwarded-for": input.forwardedFor } : {},
    ip: input.ip ?? "127.0.0.1",
    method: input.method ?? "GET",
    path: input.path ?? "/api/v1/students",
    socket: {},
    url: input.path ?? "/api/v1/students",
  } as Request;
}

function createResponse(): Response {
  const response = {
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
  return response as unknown as Response;
}
