import { afterEach, describe, expect, it } from "vitest";
import { createAdminMfaStepUpProof, createLoginMfaChallenge, resolveAdminMfaMode, verifyAdminMfaStepUpProof, verifyAdminMfaToken } from "./totp-mfa.js";

const previousEnv = {
  ADMIN_MFA_CHALLENGE_SECRET: process.env.ADMIN_MFA_CHALLENGE_SECRET,
  ADMIN_MFA_MODE: process.env.ADMIN_MFA_MODE,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  NODE_ENV: process.env.NODE_ENV,
};

describe("Admin MFA TOTP helpers", () => {
  afterEach(() => {
    restoreEnv("ADMIN_MFA_CHALLENGE_SECRET", previousEnv.ADMIN_MFA_CHALLENGE_SECRET);
    restoreEnv("ADMIN_MFA_MODE", previousEnv.ADMIN_MFA_MODE);
    restoreEnv("JWT_ACCESS_SECRET", previousEnv.JWT_ACCESS_SECRET);
    restoreEnv("NODE_ENV", previousEnv.NODE_ENV);
  });

  it("production'da challenge secret olmadan JWT secret'a düşmez", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "jwt-access-secret-123456789";
    delete process.env.ADMIN_MFA_CHALLENGE_SECRET;

    expect(() => createLoginMfaChallenge("admin-a")).toThrow("ADMIN_MFA_CHALLENGE_SECRET_REQUIRED");
  });

  it.each(["production", "staging"])("%s ortamında MFA modunu zorunlu tutar", (nodeEnv) => {
    process.env.NODE_ENV = nodeEnv;
    process.env.ADMIN_MFA_MODE = "optional";

    expect(resolveAdminMfaMode()).toBe("required");
  });

  it("test ortamında açıkça seçilen MFA modunu korur", () => {
    process.env.NODE_ENV = "test";
    process.env.ADMIN_MFA_MODE = "optional";

    expect(resolveAdminMfaMode()).toBe("optional");
  });

  it("production'da challenge secret JWT secret ile aynı olamaz", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "shared-secret-123456789";
    process.env.ADMIN_MFA_CHALLENGE_SECRET = "shared-secret-123456789";

    expect(() => createLoginMfaChallenge("admin-a")).toThrow("ADMIN_MFA_CHALLENGE_SECRET_MUST_DIFFER");
  });

  it("step-up kanıtını kullanıcı, session, üyelik sürümü ve amaca bağlar", () => {
    const binding = {
      userId: "admin-a",
      sessionId: "session-a",
      membershipVersion: 7,
      purpose: "OWNER_ADMIN_CHANGE" as const,
    };
    const proof = createAdminMfaStepUpProof(binding);

    expect(() => verifyAdminMfaStepUpProof(proof.stepUpToken, binding)).not.toThrow();
    expect(() => verifyAdminMfaStepUpProof(proof.stepUpToken, { ...binding, sessionId: "session-b" }))
      .toThrow("ADMIN_MFA_STEP_UP_CONTEXT_INVALID");
    expect(() => verifyAdminMfaStepUpProof(proof.stepUpToken, { ...binding, membershipVersion: 8 }))
      .toThrow("ADMIN_MFA_STEP_UP_CONTEXT_INVALID");

    const expired = createAdminMfaStepUpProof(binding, Date.now() - 6 * 60 * 1000);
    expect(() => verifyAdminMfaStepUpProof(expired.stepUpToken, binding)).toThrow("ADMIN_MFA_TOKEN_EXPIRED");
  });

  it("login MFA challenge'ına benzersiz bir kimlik ekler", () => {
    const now = Date.now();
    const first = createLoginMfaChallenge("admin-a", now);
    const second = createLoginMfaChallenge("admin-a", now);

    expect(first.challengeToken).not.toBe(second.challengeToken);
    expect(verifyAdminMfaToken(first.challengeToken, "admin-mfa-login").challengeId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
