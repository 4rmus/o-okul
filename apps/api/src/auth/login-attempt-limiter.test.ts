import { HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { LoginAttemptLimiter, loginAttemptKey } from "./login-attempt-limiter.js";

describe("LoginAttemptLimiter", () => {
  it("beş hatalı denemeden sonra girişleri kilitler ve süre dolunca açar", () => {
    let now = 1_000;
    const limiter = new LoginAttemptLimiter(5, 60_000, () => now);
    const key = loginAttemptKey(" Admin-A@Example.Test ");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.assertAllowed(key);
      limiter.recordFailure(key);
    }

    expect(() => limiter.assertAllowed(key)).toThrow(HttpException);
    try {
      limiter.assertAllowed(key);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    now += 60_001;

    expect(() => limiter.assertAllowed(key)).not.toThrow();
  });

  it("başarılı giriş sonrası hatalı denemeleri sıfırlar", () => {
    const limiter = new LoginAttemptLimiter(2, 60_000, () => 1_000);
    const key = loginAttemptKey("admin-a@example.test");

    limiter.recordFailure(key);
    limiter.recordSuccess(key);
    limiter.recordFailure(key);

    expect(() => limiter.assertAllowed(key)).not.toThrow();
  });
});
