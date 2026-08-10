import { decryptTcIdentity, encryptTcIdentity, hashTcIdentity } from "./tc-identity.js";

export function encryptStudentContactValue(value: string): string {
  return encryptTcIdentity(value);
}

export function decryptStudentContactValue(value: string): string {
  return decryptTcIdentity(value);
}

export function hashStudentContactValue(kind: "email" | "phone", value: string): string {
  return hashTcIdentity(`student-contact:${kind}:${value}`);
}
