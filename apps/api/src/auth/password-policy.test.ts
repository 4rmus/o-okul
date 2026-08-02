import { describe, expect, it } from "vitest";
import { passwordPolicyViolation } from "./password-policy.js";

describe("password policy", () => {
  it("15-128 karakteri composition zorunluluğu olmadan kabul eder", () => {
    expect(passwordPolicyViolation("yalnızcauzunbirparola")).toBeUndefined();
    expect(passwordPolicyViolation("x".repeat(128))).toBeUndefined();
  });

  it("kısa, aşırı uzun ve yaygın parolaları reddeder", () => {
    expect(passwordPolicyViolation("kısa")).toBe("PASSWORD_MIN_15_REQUIRED");
    expect(passwordPolicyViolation("x".repeat(129))).toBe("PASSWORD_MAX_128_EXCEEDED");
    expect(passwordPolicyViolation("PasswordPassword")).toBe("PASSWORD_COMMON_REJECTED");
  });
});
