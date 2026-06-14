import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authenticator } from "otplib";

const defaultTestEncryptionKey = "33333333333333333333333333333333";
const defaultTestHashKey = "44444444444444444444444444444444";
const defaultTestChallengeSecret = "55555555555555555555555555555555";
const tokenStepSeconds = 30;
const tokenWindow = 1;
const loginChallengeTtlSeconds = 5 * 60;
const setupChallengeTtlSeconds = 10 * 60;

export type AdminMfaMode = "off" | "optional" | "required";
export type AdminMfaTokenType = "admin-mfa-login" | "admin-mfa-setup";
type AuthenticatorOptionOverrides = {
  epoch?: number;
  step?: number;
  window?: number | [number, number];
};

export interface LoginMfaChallenge {
  status: "MFA_REQUIRED";
  challengeToken: string;
  expiresAt: string;
  methods: Array<"totp" | "recovery_code">;
}

export interface TotpEnrollmentDraft {
  secret: string;
  secretEncrypted: string;
  keyUri: string;
  recoveryCodes: string[];
  recoveryCodeHashes: string[];
  setupToken: string;
  setupExpiresAt: string;
}

export interface AdminMfaTokenPayload {
  type: AdminMfaTokenType;
  userId: string;
  exp: number;
  secret?: string;
  recoveryCodeHashes?: string[];
}

export function resolveAdminMfaMode(): AdminMfaMode {
  const value = process.env.ADMIN_MFA_MODE?.trim().toLowerCase();
  if (value === "required" || value === "optional" || value === "off") return value;
  return "off";
}

export function isAdminMfaRole(roles: readonly string[]): boolean {
  return roles.includes("SYSTEM_ADMIN") || roles.includes("TENANT_ADMIN");
}

export function createLoginMfaChallenge(userId: string, now = Date.now()): LoginMfaChallenge {
  const expiresAtMs = now + loginChallengeTtlSeconds * 1000;
  return {
    status: "MFA_REQUIRED",
    challengeToken: signAdminMfaToken({
      type: "admin-mfa-login",
      userId,
      exp: Math.floor(expiresAtMs / 1000),
    }),
    expiresAt: new Date(expiresAtMs).toISOString(),
    methods: ["totp", "recovery_code"],
  };
}

export function createTotpEnrollmentDraft(email: string, userId: string, now = Date.now()): TotpEnrollmentDraft {
  const secret = withAuthenticatorOptions({ step: tokenStepSeconds, window: tokenWindow }, () => authenticator.generateSecret());
  const recoveryCodes = Array.from({ length: 8 }, () => createRecoveryCode());
  const recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);
  const setupExpiresAtMs = now + setupChallengeTtlSeconds * 1000;
  const setupToken = signAdminMfaToken({
    type: "admin-mfa-setup",
    userId,
    secret,
    recoveryCodeHashes,
    exp: Math.floor(setupExpiresAtMs / 1000),
  });

  return {
    secret,
    secretEncrypted: encryptAdminMfaSecret(secret),
    keyUri: withAuthenticatorOptions({ step: tokenStepSeconds, window: tokenWindow }, () =>
      authenticator.keyuri(email, process.env.ADMIN_MFA_ISSUER ?? "Uzman Hocam", secret),
    ),
    recoveryCodes,
    recoveryCodeHashes,
    setupToken,
    setupExpiresAt: new Date(setupExpiresAtMs).toISOString(),
  };
}

export function verifyAdminMfaToken(token: string, expectedType: AdminMfaTokenType): AdminMfaTokenPayload {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("ADMIN_MFA_TOKEN_INVALID");
  }

  const expectedSignature = sign(encodedPayload, getChallengeSecret());
  if (!safeEqual(signature, expectedSignature)) {
    throw new Error("ADMIN_MFA_TOKEN_INVALID");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AdminMfaTokenPayload;
  if (payload.type !== expectedType) {
    throw new Error("ADMIN_MFA_TOKEN_TYPE_INVALID");
  }
  if (!payload.userId || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("ADMIN_MFA_TOKEN_EXPIRED");
  }
  return payload;
}

export function encryptAdminMfaSecret(secret: string): string {
  const key = keyFromEnv("ADMIN_MFA_SECRET_ENCRYPTION_KEY", defaultTestEncryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptAdminMfaSecret(value: string): string {
  const [, iv, tag, encrypted] = value.split(":");
  if (!iv || !tag || !encrypted) {
    throw new Error("ADMIN_MFA_SECRET_ENCRYPTION_FORMAT_INVALID");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFromEnv("ADMIN_MFA_SECRET_ENCRYPTION_KEY", defaultTestEncryptionKey),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

export function resolveTotpCounter(secret: string, token: string, now = Date.now()): string | null {
  const normalized = normalizeTotpCode(token);
  if (!normalized) return null;

  const currentCounter = Math.floor(now / (tokenStepSeconds * 1000));
  for (let offset = -tokenWindow; offset <= tokenWindow; offset += 1) {
    const counter = currentCounter + offset;
    const valid = withAuthenticatorOptions({
      epoch: counter * tokenStepSeconds * 1000,
      step: tokenStepSeconds,
      window: 0,
    }, () => authenticator.check(normalized, secret));
    if (valid) {
      return String(counter);
    }
  }

  return null;
}

export function resolveEncryptedTotpCounter(secretEncrypted: string, token: string, now = Date.now()): string | null {
  return resolveTotpCounter(decryptAdminMfaSecret(secretEncrypted), token, now);
}

export function hashRecoveryCode(code: string): string {
  return createHmac("sha256", keyFromEnv("ADMIN_MFA_RECOVERY_HASH_KEY", defaultTestHashKey))
    .update(normalizeRecoveryCode(code))
    .digest("hex");
}

export function createTotpCodeForTest(secret: string, now = Date.now()): string {
  return withAuthenticatorOptions({ epoch: now, step: tokenStepSeconds, window: tokenWindow }, () => authenticator.generate(secret));
}

function createRecoveryCode(): string {
  const raw = randomBytes(8).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

function normalizeTotpCode(token: string): string | null {
  const normalized = token.trim().replace(/\s/g, "");
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

function normalizeRecoveryCode(code: string): string {
  return code.trim().replace(/[\s-]/g, "").toUpperCase();
}

function signAdminMfaToken(payload: AdminMfaTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, getChallengeSecret())}`;
}

function withAuthenticatorOptions<T>(options: AuthenticatorOptionOverrides, callback: () => T): T {
  const previousOptions = authenticator.options;
  authenticator.options = options;
  try {
    return callback();
  } finally {
    authenticator.options = previousOptions;
  }
}

function getChallengeSecret(): Buffer {
  const value = process.env.ADMIN_MFA_CHALLENGE_SECRET ?? process.env.JWT_ACCESS_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ADMIN_MFA_CHALLENGE_SECRET_REQUIRED");
    }
    return Buffer.from(defaultTestChallengeSecret);
  }
  return Buffer.from(value);
}

function keyFromEnv(name: string, fallback: string): Buffer {
  const value = process.env[name];
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${name}_REQUIRED`);
    }
    return Buffer.from(fallback);
  }

  const key = decodeKey(value);
  if (key.length !== 32) {
    throw new Error(`${name}_INVALID_LENGTH`);
  }
  return key;
}

function decodeKey(value: string): Buffer {
  if (value.startsWith("base64:")) {
    return Buffer.from(value.slice("base64:".length), "base64");
  }
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }
  return Buffer.from(value);
}

function sign(payload: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
