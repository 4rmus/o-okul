import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReenrollmentCode,
  hashReenrollmentCode,
  isReenrollmentExpired,
  normalizeReenrollmentCode,
  reenrollmentResetVersion,
  verifyReenrollmentCode,
} from "./mfa-reenrollment-code.js";
import { mfaSecurityNoticePayload } from "./mfa-security-notice.js";
import { hashRecoveryCode } from "./totp-mfa.js";

const binding = { userId: "user-1", tenantId: "tenant-a", resetVersion: 4 };

describe("MFA re-enrollment code (DEC-20261021-01)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("issues 8 digits in two groups and accepts them with or without separators", () => {
    const codes = new Set(Array.from({ length: 200 }, () => createReenrollmentCode()));
    for (const code of codes) expect(code).toMatch(/^\d{4}-\d{4}$/);
    expect(codes.size).toBeGreaterThan(190);
    expect(normalizeReenrollmentCode("1234-5678")).toBe("12345678");
    expect(normalizeReenrollmentCode(" 1234 5678 ")).toBe("12345678");
    expect(normalizeReenrollmentCode("1234-567")).toBeNull();
    expect(normalizeReenrollmentCode("abcd-efgh")).toBeNull();
    expect(normalizeReenrollmentCode(undefined)).toBeNull();
  });

  it("stores only a keyed hash bound to tenant, user and reset version", () => {
    const stored = hashReenrollmentCode(binding, "1234-5678");
    expect(stored).toMatch(/^v1:4:[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toContain("12345678");
    expect(reenrollmentResetVersion(stored)).toBe(4);
    expect(verifyReenrollmentCode(stored, { userId: "user-1", tenantId: "tenant-a" }, "12345678")).toBe(true);
    expect(verifyReenrollmentCode(stored, { userId: "user-1", tenantId: "tenant-a" }, "1234-5679")).toBe(false);
    expect(verifyReenrollmentCode(stored, { userId: "user-2", tenantId: "tenant-a" }, "1234-5678")).toBe(false);
    expect(verifyReenrollmentCode(stored, { userId: "user-1", tenantId: "tenant-b" }, "1234-5678")).toBe(false);
    expect(verifyReenrollmentCode(stored.replace("v1:4:", "v1:5:"), { userId: "user-1", tenantId: "tenant-a" }, "1234-5678")).toBe(false);
    expect(verifyReenrollmentCode("garbage", { userId: "user-1", tenantId: "tenant-a" }, "1234-5678")).toBe(false);
    expect(() => hashReenrollmentCode({ ...binding, resetVersion: 0 }, "1234-5678")).toThrow("MFA_REENROLLMENT_BINDING_INVALID");
  });

  it("derives its key with HKDF from ADMIN_MFA_RECOVERY_HASH_KEY, separate from recovery-code hashes", () => {
    vi.stubEnv("ADMIN_MFA_RECOVERY_HASH_KEY", "a".repeat(32));
    const first = hashReenrollmentCode(binding, "1234-5678");
    const mac = first.split(":")[2];
    // Not a plain HMAC under the raw key, and not the recovery-code digest of the same digits.
    expect(mac).not.toBe(createHmac("sha256", "a".repeat(32)).update(JSON.stringify(["tenant-a", "user-1", 4, "12345678"])).digest("base64url"));
    expect(hashRecoveryCode("12345678")).not.toContain(mac!);
    vi.stubEnv("ADMIN_MFA_RECOVERY_HASH_KEY", "b".repeat(32));
    expect(verifyReenrollmentCode(first, { userId: "user-1", tenantId: "tenant-a" }, "1234-5678")).toBe(false);
  });

  it("refuses to hash in production without the MFA hash key", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_MFA_RECOVERY_HASH_KEY", "");
    expect(() => hashReenrollmentCode(binding, "1234-5678")).toThrow("ADMIN_MFA_RECOVERY_HASH_KEY_REQUIRED");
  });

  it("treats a missing or past expiry as expired", () => {
    expect(isReenrollmentExpired(undefined)).toBe(true);
    expect(isReenrollmentExpired(new Date(Date.now() - 1).toISOString())).toBe(true);
    expect(isReenrollmentExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });

  it("notice mails are Turkish, carry the 'not you' warning and no code, link or secret", () => {
    for (const kind of ["MFA_RESET_BY_SUPPORT", "MFA_REENROLLED"] as const) {
      const payload = mfaSecurityNoticePayload({ kind, to: "owner@example.test", tenantName: "DNA Eğitim" });
      expect(payload).toMatchObject({ channel: "EMAIL", to: "owner@example.test" });
      expect(payload.body).toContain("Bu işlemi siz yapmadıysanız");
      expect(payload.body).toContain("DNA Eğitim");
      expect(`${payload.subject} ${payload.body}`).not.toMatch(/\d{4}-?\d{4}|https?:|otpauth:|token/i);
    }
  });
});
