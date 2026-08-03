import { HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  LoginAttemptLimiter,
  RedisLoginAttemptLimiter,
  createLoginAttemptLimiter,
  mfaAttemptKey,
  type RedisCommandClient,
  type RedisReply,
  loginAttemptKey,
} from "./login-attempt-limiter.js";

describe("LoginAttemptLimiter", () => {
  it("beş hatalı denemeden sonra girişleri kilitler ve süre dolunca açar", async () => {
    let now = 1_000;
    const limiter = new LoginAttemptLimiter(5, 60_000, () => now);
    const key = loginAttemptKey(" Admin-A@Example.Test ", " 127.0.0.1 ");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limiter.assertAllowed(key);
      await limiter.recordFailure(key);
    }

    await expect(limiter.assertAllowed(key)).rejects.toThrow(HttpException);
    try {
      await limiter.assertAllowed(key);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    now += 60_001;

    await expect(limiter.assertAllowed(key)).resolves.toBeUndefined();
  });

  it("başarılı giriş sonrası hatalı denemeleri sıfırlar", async () => {
    const limiter = new LoginAttemptLimiter(2, 60_000, () => 1_000);
    const key = loginAttemptKey("admin-a@example.test", "127.0.0.1");

    await limiter.recordFailure(key);
    await limiter.recordSuccess(key);
    await limiter.recordFailure(key);

    await expect(limiter.assertAllowed(key)).resolves.toBeUndefined();
  });

  it("aynı e-posta farklı IP'den ayrı takip edilir", async () => {
    const limiter = new LoginAttemptLimiter(1, 60_000, () => 1_000);
    const firstIpKey = loginAttemptKey("admin-a@example.test", "127.0.0.1");
    const secondIpKey = loginAttemptKey("admin-a@example.test", "127.0.0.2");

    await limiter.recordFailure(firstIpKey);

    await expect(limiter.assertAllowed(firstIpKey)).rejects.toThrow(HttpException);
    await expect(limiter.assertAllowed(secondIpKey)).resolves.toBeUndefined();
  });

  it("Redis store kilidi yeni limiter instance'ında korur", async () => {
    const redis = new FakeRedisCommandClient();
    const firstLimiter = new RedisLoginAttemptLimiter(redis, 2, 60_000);
    const secondLimiter = new RedisLoginAttemptLimiter(redis, 2, 60_000);
    const key = loginAttemptKey("admin-a@example.test", "127.0.0.1");

    await firstLimiter.recordFailure(key);
    await firstLimiter.recordFailure(key);

    await expect(secondLimiter.assertAllowed(key)).rejects.toThrow(HttpException);
  });

  it("Redis store başarılı giriş sonrası sayaç ve kilidi siler", async () => {
    const redis = new FakeRedisCommandClient();
    const limiter = new RedisLoginAttemptLimiter(redis, 1, 60_000);
    const key = loginAttemptKey("admin-a@example.test", "127.0.0.1");

    await limiter.recordFailure(key);
    await limiter.recordSuccess(key);

    await expect(limiter.assertAllowed(key)).resolves.toBeUndefined();
  });

  it("production ortamında memory limiter override'ını reddeder", () => {
    expect(() =>
      createLoginAttemptLimiter({
        NODE_ENV: "production",
        LOGIN_ATTEMPT_LIMITER_STORE: "memory",
      } as NodeJS.ProcessEnv),
    ).toThrow('LOGIN_ATTEMPT_LIMITER_STORE must be "redis"');
  });

  it("MFA anahtarında ham kullanıcı kimliğini saklamaz ve amacı ayırır", () => {
    const key = mfaAttemptKey("user-secret-value", "login");

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("user-secret-value");
    expect(mfaAttemptKey("user-secret-value", "disable")).not.toBe(key);
  });
});

class FakeRedisCommandClient implements RedisCommandClient {
  private readonly values = new Map<string, string>();

  async command(parts: string[]): Promise<RedisReply> {
    const [command, key, value, ...rest] = parts;
    if (!command || !key) throw new Error("REDIS_COMMAND_INVALID");

    switch (command) {
      case "GET":
        return this.values.get(key) ?? null;
      case "INCR": {
        const next = Number(this.values.get(key) ?? "0") + 1;
        this.values.set(key, String(next));
        return next;
      }
      case "PEXPIRE":
        return this.values.has(key) ? 1 : 0;
      case "SET":
        if (!value || rest[0] !== "PX" || !rest[1]) throw new Error("REDIS_SET_INVALID");
        this.values.set(key, value);
        return "OK";
      case "DEL": {
        let deleted = 0;
        for (const deleteKey of parts.slice(1)) {
          if (this.values.delete(deleteKey)) deleted += 1;
        }
        return deleted;
      }
      default:
        throw new Error(`REDIS_COMMAND_UNSUPPORTED:${command}`);
    }
  }
}
