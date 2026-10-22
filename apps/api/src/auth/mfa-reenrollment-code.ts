import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "node:crypto";
import { adminMfaRecoveryHashKey } from "./totp-mfa.js";

/**
 * DEC-20261021-01: one-time re-enrollment code left by a SYSTEM_ADMIN MFA reset of a tenant OWNER/ADMIN.
 *
 * Format: 8 decimal digits shown as two groups of four ("4821-0397"), read aloud over the phone to the institution's
 * registered number. 10^8 codes (~26.6 bits). Guessing is bounded by the login-attempt limiter: each attempt is
 * reserved atomically before the code is compared (parallel requests cannot outrun the budget), 5 failures lock the
 * attempt key for 15 minutes, and the key is bound to this reset (user, tenant, reset version), not to the current
 * membership version, so a password reset cannot refresh it. Over the 24-hour validity that is at most
 * 96 x 5 = 480 guesses, a success probability of 480 / 10^8 = 4.8e-6 for an attacker who already holds the password.
 *
 * Storage: only `v1:<resetVersion>:<HMAC-SHA256>` is kept. The HMAC key is derived with HKDF-SHA256 from
 * ADMIN_MFA_RECOVERY_HASH_KEY (the MFA keyed-hash secret production and staging already require; recovery codes use
 * it directly) under its own info label, so neither digest can stand in for the other. Rotating that key invalidates
 * pending codes together with recovery codes. `resetVersion` is the membership version the reset statement produces;
 * a later reset writes a new version and hash, which invalidates the earlier code.
 */
export const reenrollmentCodeValidityMs = 24 * 60 * 60 * 1000;
const reenrollmentKeyInfo = "o-okul:mfa-reenrollment-code:v1";
const hashPrefix = "v1";

let cachedKey: { secret: Buffer; key: Buffer } | undefined;

function reenrollmentKey(): Buffer {
  const secret = adminMfaRecoveryHashKey();
  if (!cachedKey || !cachedKey.secret.equals(secret)) {
    cachedKey = { secret, key: Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), reenrollmentKeyInfo, 32)) };
  }
  return cachedKey.key;
}

export interface ReenrollmentBinding {
  userId: string;
  tenantId: string;
  resetVersion: number;
}

export function createReenrollmentCode(): string {
  const digits = String(randomInt(0, 100_000_000)).padStart(8, "0");
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/** Accepts the code with or without the group separator or spaces; anything else is not a code. */
export function normalizeReenrollmentCode(value: string | undefined): string | null {
  const normalized = (value ?? "").replace(/[\s-]/g, "");
  return /^\d{8}$/.test(normalized) ? normalized : null;
}

export function hashReenrollmentCode(binding: ReenrollmentBinding, code: string): string {
  const normalized = normalizeReenrollmentCode(code);
  if (!normalized || !Number.isInteger(binding.resetVersion) || binding.resetVersion < 1 || !binding.userId || !binding.tenantId) {
    throw new Error("MFA_REENROLLMENT_BINDING_INVALID");
  }
  return `${hashPrefix}:${binding.resetVersion}:${digest(binding, normalized)}`;
}

/** The reset version a stored hash is bound to (the limiter key uses it); undefined for an unreadable value. */
export function reenrollmentResetVersion(storedHash: string): number | undefined {
  const [prefix, version, mac] = storedHash.split(":");
  const parsed = Number(version);
  return prefix === hashPrefix && mac && Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

export function verifyReenrollmentCode(storedHash: string, binding: Omit<ReenrollmentBinding, "resetVersion">, code: string | undefined): boolean {
  const resetVersion = reenrollmentResetVersion(storedHash);
  const normalized = normalizeReenrollmentCode(code);
  if (resetVersion === undefined || !normalized) return false;
  const expected = Buffer.from(storedHash.split(":")[2]!, "base64url");
  const actual = Buffer.from(digest({ ...binding, resetVersion }, normalized), "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isReenrollmentExpired(expiresAt: string | undefined, now = Date.now()): boolean {
  const parsed = Date.parse(expiresAt ?? "");
  return !Number.isFinite(parsed) || parsed <= now;
}

function digest(binding: ReenrollmentBinding, normalizedCode: string): string {
  return createHmac("sha256", reenrollmentKey())
    .update(JSON.stringify([binding.tenantId, binding.userId, binding.resetVersion, normalizedCode]))
    .digest("base64url");
}
