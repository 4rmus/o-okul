import { describe, expect, it } from "vitest";
import { assertSecretDeliveryEncryptionConfig, decryptSecretDeliveryPayload, encryptSecretDeliveryPayload } from "./secret-delivery-envelope.js";

describe("secret delivery envelope", () => {
  const env = { NODE_ENV: "production", SECRET_DELIVERY_ENCRYPTION_KEY: "secret-delivery-key-32-characters-minimum" } as NodeJS.ProcessEnv;
  const payload = {
    channel: "EMAIL" as const,
    to: "user@example.test",
    subject: "Parola sıfırlama",
    body: "secret-link",
  };

  it("payload ve data key'i ayrı AES-GCM katmanlarıyla şifreler", () => {
    const first = encryptSecretDeliveryPayload(payload, env);
    const second = encryptSecretDeliveryPayload(payload, env);

    expect(first).not.toBe(second);
    expect(first).not.toContain(payload.to);
    expect(first).not.toContain(payload.body);
    expect(decryptSecretDeliveryPayload(first, env)).toEqual(payload);
  });

  it.each(["production", "staging"])("%s ortamında anahtar eksikse fail-closed olur", (nodeEnv) => {
    expect(() => assertSecretDeliveryEncryptionConfig({ NODE_ENV: nodeEnv } as NodeJS.ProcessEnv))
      .toThrow("SECRET_DELIVERY_ENCRYPTION_KEY_REQUIRED");
  });

  it.each(["development", "test"])("%s ortamında test fallbackini korur", (nodeEnv) => {
    expect(() => assertSecretDeliveryEncryptionConfig({ NODE_ENV: nodeEnv } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
