import { describe, expect, it } from "vitest";
import { decryptTcIdentity, encryptTcIdentity, hashTcIdentity, isValidTcIdentity, maskTcIdentity, normalizeTcIdentity } from "./tc-identity.js";

describe("TC kimlik helper", () => {
  it("TC algoritmasını doğrular ve formatı normalize eder", () => {
    expect(normalizeTcIdentity("10000000146")).toBe("10000000146");
    expect(isValidTcIdentity("10000000145")).toBe(false);
    expect(() => normalizeTcIdentity("10000000145")).toThrow("STUDENT_NATIONAL_ID_INVALID");
  });

  it("AES-GCM şifreleme deterministik değildir, hash ise benzersizlik için deterministiktir", () => {
    const nationalId = "10000000146";
    const firstEncrypted = encryptTcIdentity(nationalId);
    const secondEncrypted = encryptTcIdentity(nationalId);

    expect(firstEncrypted).not.toBe(secondEncrypted);
    expect(decryptTcIdentity(firstEncrypted)).toBe(nationalId);
    expect(decryptTcIdentity(secondEncrypted)).toBe(nationalId);
    expect(hashTcIdentity(nationalId)).toBe(hashTcIdentity(nationalId));
    expect(maskTcIdentity(nationalId)).toBe("*******0146");
  });
});
