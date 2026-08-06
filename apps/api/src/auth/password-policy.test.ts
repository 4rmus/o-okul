import { describe, expect, it } from "vitest";
import { passwordPolicyViolation } from "./password-policy.js";

describe("password policy", () => {
  it("8-128 karakter ile büyük ve küçük harf kombinasyonunu kabul eder", () => {
    expect(passwordPolicyViolation("Guvenli8")).toBeUndefined();
    expect(passwordPolicyViolation(`A${"x".repeat(127)}`)).toBeUndefined();
    expect(passwordPolicyViolation("Şifreabc")).toBeUndefined();
  });

  it("kısa, aşırı uzun, tek harf boyutlu ve yaygın parolaları reddeder", () => {
    expect(passwordPolicyViolation("Kisa123")).toBe("PASSWORD_MIN_8_REQUIRED");
    expect(passwordPolicyViolation(`A${"x".repeat(128)}`)).toBe("PASSWORD_MAX_128_EXCEEDED");
    expect(passwordPolicyViolation("kucuk123")).toBe("PASSWORD_UPPERCASE_REQUIRED");
    expect(passwordPolicyViolation("BUYUK123")).toBe("PASSWORD_LOWERCASE_REQUIRED");
    expect(passwordPolicyViolation("PasswordPassword")).toBe("PASSWORD_COMMON_REJECTED");
  });
});
