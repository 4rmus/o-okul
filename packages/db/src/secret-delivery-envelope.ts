import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface SecretDeliveryPayload {
  channel: "EMAIL";
  to: string;
  subject: string;
  body: string;
}

export type SecretDeliveryPurpose = "IDENTITY_INVITATION" | "PASSWORD_RESET";

export interface SecretDeliveryOutboxInput {
  tenantId?: string;
  purpose: SecretDeliveryPurpose;
  payloadEncrypted: string;
  expiresAt: string;
}

const algorithm = "aes-256-gcm";
const aad = Buffer.from("o-okul-secret-delivery:v1", "utf8");
const testKey = "o-okul-secret-delivery-test-key-32";

export function assertSecretDeliveryEncryptionConfig(env: NodeJS.ProcessEnv = process.env): void {
  masterKey(env);
}

export function encryptSecretDeliveryPayload(
  payload: SecretDeliveryPayload,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dataKey = randomBytes(32);
  const wrappedKey = encryptBuffer(dataKey, masterKey(env));
  const encryptedPayload = encryptBuffer(Buffer.from(JSON.stringify(payload), "utf8"), dataKey);
  return ["v1", ...wrappedKey, ...encryptedPayload].join(":");
}

export function decryptSecretDeliveryPayload(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): SecretDeliveryPayload {
  const [version, keyIv, keyTag, wrappedKey, payloadIv, payloadTag, encryptedPayload] = value.split(":");
  if (version !== "v1" || !keyIv || !keyTag || !wrappedKey || !payloadIv || !payloadTag || !encryptedPayload) {
    throw new Error("SECRET_DELIVERY_ENVELOPE_INVALID");
  }
  const dataKey = decryptBuffer([keyIv, keyTag, wrappedKey], masterKey(env));
  const payload = JSON.parse(decryptBuffer([payloadIv, payloadTag, encryptedPayload], dataKey).toString("utf8")) as Partial<SecretDeliveryPayload>;
  if (payload.channel !== "EMAIL" || !payload.to || !payload.subject || !payload.body) {
    throw new Error("SECRET_DELIVERY_PAYLOAD_INVALID");
  }
  return payload as SecretDeliveryPayload;
}

function encryptBuffer(value: Buffer, key: Buffer): [string, string, string] {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")];
}

function decryptBuffer(parts: [string, string, string], key: Buffer): Buffer {
  const [iv, tag, encrypted] = parts;
  const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, "base64url"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]);
}

function masterKey(env: NodeJS.ProcessEnv): Buffer {
  const value = env.SECRET_DELIVERY_ENCRYPTION_KEY || (isProductionLikeEnvironment(env) ? "" : testKey);
  if (value.length < 32) throw new Error("SECRET_DELIVERY_ENCRYPTION_KEY_REQUIRED");
  return createHash("sha256").update(value, "utf8").digest();
}

function isProductionLikeEnvironment(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" || env.NODE_ENV === "staging";
}
