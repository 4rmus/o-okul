import { afterEach, describe, expect, it } from "vitest";
import { createLoginMfaChallenge } from "./totp-mfa.js";

const previousEnv = {
  ADMIN_MFA_CHALLENGE_SECRET: process.env.ADMIN_MFA_CHALLENGE_SECRET,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  NODE_ENV: process.env.NODE_ENV,
};

describe("Admin MFA TOTP helpers", () => {
  afterEach(() => {
    restoreEnv("ADMIN_MFA_CHALLENGE_SECRET", previousEnv.ADMIN_MFA_CHALLENGE_SECRET);
    restoreEnv("JWT_ACCESS_SECRET", previousEnv.JWT_ACCESS_SECRET);
    restoreEnv("NODE_ENV", previousEnv.NODE_ENV);
  });

  it("production'da challenge secret olmadan JWT secret'a düşmez", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "jwt-access-secret-123456789";
    delete process.env.ADMIN_MFA_CHALLENGE_SECRET;

    expect(() => createLoginMfaChallenge("admin-a")).toThrow("ADMIN_MFA_CHALLENGE_SECRET_REQUIRED");
  });

  it("production'da challenge secret JWT secret ile aynı olamaz", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "shared-secret-123456789";
    process.env.ADMIN_MFA_CHALLENGE_SECRET = "shared-secret-123456789";

    expect(() => createLoginMfaChallenge("admin-a")).toThrow("ADMIN_MFA_CHALLENGE_SECRET_MUST_DIFFER");
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
