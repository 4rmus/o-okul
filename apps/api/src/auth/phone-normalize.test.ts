import { describe, expect, it } from "vitest";
import { normalizeTurkishMobilePhone, optionalTurkishMobilePhone } from "./phone-normalize.js";

describe("phone normalize", () => {
  it("Türkiye cep telefonu formatını baştaki 0 olmadan 10 haneye indirger", () => {
    expect(normalizeTurkishMobilePhone("0555 123 45 67")).toBe("5551234567");
    expect(normalizeTurkishMobilePhone("+90 555 123 45 67")).toBe("5551234567");
    expect(normalizeTurkishMobilePhone("0090 555 123 45 67")).toBe("5551234567");
    expect(optionalTurkishMobilePhone("   ")).toBeUndefined();
  });

  it("cep telefonu olmayan formatı reddeder", () => {
    expect(() => normalizeTurkishMobilePhone("0212 123 45 67")).toThrow("PHONE_INVALID");
    expect(() => normalizeTurkishMobilePhone("555123456")).toThrow("PHONE_INVALID");
  });
});
