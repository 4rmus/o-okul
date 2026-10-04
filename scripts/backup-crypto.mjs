import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { Transform } from "node:stream";

// Nightly database dump envelope (DEC-20261004-02, KF-5): MAGIC | iv(12) | AES-256-GCM ciphertext | tag(16).
// Streamed both ways so the plaintext dump never touches the disk and size has no memory ceiling.
const magic = Buffer.from("OOKULDB1");
const aad = Buffer.from("O_OKUL_PG_DUMP_V1");
const ivLength = 12;
const tagLength = 16;

export function readBackupKey(env = process.env) {
  const raw = env.BACKUP_ENCRYPTION_KEY_BASE64?.trim();
  if (!raw) throw new Error("BACKUP_ENCRYPTION_KEY_BASE64 gerekli.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_BASE64 32 baytlık base64 anahtar olmalı.");
  return key;
}

/** Transform: plaintext in, MAGIC|iv|ciphertext|tag out. */
export function createEncryptStream(key) {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  let headerSent = false;
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (!headerSent) {
        this.push(Buffer.concat([magic, iv]));
        headerSent = true;
      }
      callback(null, cipher.update(chunk));
    },
    flush(callback) {
      if (!headerSent) this.push(Buffer.concat([magic, iv]));
      this.push(cipher.final());
      callback(null, cipher.getAuthTag());
    },
  });
}

/**
 * Reads header and tag from the file, then returns a decipher that streams the ciphertext range.
 * GCM verifies the tag at the end: callers must treat output as untrusted until the stream finishes.
 */
export function openEncryptedBackup(path, key) {
  const size = statSync(path).size;
  const headerLength = magic.length + ivLength;
  if (size < headerLength + tagLength) throw new Error("BACKUP_ENVELOPE_INVALID");
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(headerLength);
    const tag = Buffer.alloc(tagLength);
    readSync(fd, header, 0, headerLength, 0);
    readSync(fd, tag, 0, tagLength, size - tagLength);
    if (!header.subarray(0, magic.length).equals(magic)) throw new Error("BACKUP_ENVELOPE_INVALID");
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(magic.length));
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return { decipher, start: headerLength, end: size - tagLength - 1 };
  } finally {
    closeSync(fd);
  }
}
