import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { UnprocessableEntityException } from "@nestjs/common";

const defaultTestEncryptionKey = "11111111111111111111111111111111";
const defaultTestHashKey = "22222222222222222222222222222222";

export function normalizeTcIdentity(value: string): string {
  const normalized = value.replace(/\D/g, "");
  if (!isValidTcIdentity(normalized)) {
    throw new UnprocessableEntityException("STUDENT_NATIONAL_ID_INVALID");
  }
  return normalized;
}

export function isValidTcIdentity(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;

  const digits = value.split("").map(Number);
  const digit = (index: number) => digits[index] ?? 0;
  const oddSum = digit(0) + digit(2) + digit(4) + digit(6) + digit(8);
  const evenSum = digit(1) + digit(3) + digit(5) + digit(7);
  const tenth = ((oddSum * 7) - evenSum) % 10;
  const total = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return digit(9) === tenth && digit(10) === total;
}

export function encryptTcIdentity(value: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptTcIdentity(value: string): string {
  const [, iv, tag, encrypted] = value.split(":");
  if (!iv || !tag || !encrypted) {
    throw new Error("STUDENT_NATIONAL_ID_ENCRYPTION_FORMAT_INVALID");
  }

  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

export function hashTcIdentity(value: string): string {
  return createHmac("sha256", getHashKey()).update(value).digest("hex");
}

export function maskTcIdentity(value: string): string {
  return `*******${value.slice(-4)}`;
}

function getEncryptionKey(): Buffer {
  return keyFromEnv("STUDENT_PII_ENCRYPTION_KEY", defaultTestEncryptionKey);
}

function getHashKey(): Buffer {
  return keyFromEnv("STUDENT_PII_HASH_KEY", defaultTestHashKey);
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
