import { describe, expect, it } from "vitest";
import {
  createNoopNotificationAdapter,
  createNotificationAdapterFromEnv,
  HttpNotificationAdapter,
} from "./index.js";

describe("createNoopNotificationAdapter", () => {
  it("lokalde e-posta ve push sonucunu başarılı döndürür", async () => {
    const adapter = createNoopNotificationAdapter();

    await expect(adapter.sendBatch([
      { channel: "EMAIL", to: "veli@example.test", subject: "Duyuru", body: "Toplantı var" },
      { channel: "PUSH", to: "device-token", body: "Yeni duyuru" },
    ])).resolves.toEqual([
      {
        channel: "EMAIL",
        to: "veli@example.test",
        status: "sent",
        providerMessageId: "noop-1",
      },
      {
        channel: "PUSH",
        to: "device-token",
        status: "sent",
        providerMessageId: "noop-2",
      },
    ]);
  });
});

describe("createNotificationAdapterFromEnv", () => {
  it("lokalde no-op adapter üretir", async () => {
    const adapter = createNotificationAdapterFromEnv({
      NODE_ENV: "development",
      NOTIFICATION_PROVIDER: "noop",
    });

    await expect(adapter.sendBatch([{ channel: "EMAIL", to: "veli@example.test", body: "test" }]))
      .resolves.toEqual([expect.objectContaining({ providerMessageId: "noop-1" })]);
  });

  it("prod ortamında açık izin yoksa no-op adapter'ı reddeder", () => {
    expect(() => createNotificationAdapterFromEnv({
      NODE_ENV: "production",
      NOTIFICATION_PROVIDER: "noop",
    })).toThrow("NOTIFICATION_PROVIDER_REQUIRED");
  });

  it("desteklenmeyen sağlayıcı adını reddeder", () => {
    expect(() => createNotificationAdapterFromEnv({
      NODE_ENV: "development",
      NOTIFICATION_PROVIDER: "smtp",
    })).toThrow("NOTIFICATION_PROVIDER_UNSUPPORTED");
  });

  it("HTTP sağlayıcı seçildiğinde endpoint ister", () => {
    expect(() => createNotificationAdapterFromEnv({
      NODE_ENV: "development",
      NOTIFICATION_PROVIDER: "http",
    })).toThrow("NOTIFICATION_HTTP_ENDPOINT_MISSING");
  });
});

describe("HttpNotificationAdapter", () => {
  it("HTTP sağlayıcıya Bearer token ve mesaj listesi ile gönderir", async () => {
    const calls: Array<{ input: string; init: { body: string; headers: Record<string, string>; method: "POST" } }> = [];
    const adapter = new HttpNotificationAdapter({
      bearerToken: "secret-token",
      endpoint: "https://notify.example/send",
      fetch: async (input, init) => {
        calls.push({ input, init });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              results: [
                {
                  channel: "EMAIL",
                  to: "veli@example.test",
                  status: "sent",
                  providerMessageId: "mail-1",
                },
                {
                  channel: "PUSH",
                  to: "device-token",
                  status: "failed",
                  errorCode: "DEVICE_TOKEN_INVALID",
                },
              ],
            });
          },
        };
      },
    });

    await expect(adapter.sendBatch([
      { channel: "EMAIL", to: "veli@example.test", subject: "Duyuru", body: "Toplantı var" },
      { channel: "PUSH", to: "device-token", body: "Yeni duyuru" },
    ])).resolves.toEqual([
      {
        channel: "EMAIL",
        to: "veli@example.test",
        status: "sent",
        providerMessageId: "mail-1",
        errorCode: undefined,
      },
      {
        channel: "PUSH",
        to: "device-token",
        status: "failed",
        providerMessageId: undefined,
        errorCode: "DEVICE_TOKEN_INVALID",
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://notify.example/send");
    expect(calls[0]?.init.headers).toEqual({
      authorization: "Bearer secret-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
      messages: [
        {
          channel: "EMAIL",
          to: "veli@example.test",
          subject: "Duyuru",
          body: "Toplantı var",
        },
        {
          channel: "PUSH",
          to: "device-token",
          body: "Yeni duyuru",
        },
      ],
    });
  });

  it("mesaj bazlı idempotency anahtarını HTTP sağlayıcıya iletir", async () => {
    const calls: Array<{ init: { body: string } }> = [];
    const adapter = new HttpNotificationAdapter({
      endpoint: "https://notify.example/send",
      fetch: async (_input, init) => {
        calls.push({ init });
        return { ok: true, status: 200, async text() { return JSON.stringify({ results: [{ status: "sent" }] }); } };
      },
    });

    await adapter.sendBatch([{ channel: "EMAIL", to: "recipient", body: "message", idempotencyKey: "secret-delivery:outbox-1" }]);
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
      messages: [{ channel: "EMAIL", to: "recipient", body: "message", idempotencyKey: "secret-delivery:outbox-1" }],
    });
  });

  it("HTTP hata durumunda tüm mesajları başarısız işaretler", async () => {
    const adapter = new HttpNotificationAdapter({
      endpoint: "https://notify.example/send",
      fetch: async () => ({
        ok: false,
        status: 503,
        async text() {
          return JSON.stringify({});
        },
      }),
    });

    await expect(adapter.sendBatch([
      { channel: "EMAIL", to: "veli@example.test", body: "Mesaj" },
      { channel: "PUSH", to: "device-token", body: "Bildirim" },
    ])).resolves.toEqual([
      expect.objectContaining({ status: "failed", errorCode: "NOTIFICATION_HTTP_503" }),
      expect.objectContaining({ status: "failed", errorCode: "NOTIFICATION_HTTP_503" }),
    ]);
  });

  it("sağlayıcı hata kodunu HTTP hata sonucunda korur", async () => {
    const adapter = new HttpNotificationAdapter({
      endpoint: "https://notify.example/send",
      fetch: async () => ({
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({ errorCode: "PROVIDER_PAYLOAD_INVALID" });
        },
      }),
    });

    await expect(adapter.sendBatch([{ channel: "EMAIL", to: "veli@example.test", body: "Mesaj" }]))
      .resolves.toEqual([expect.objectContaining({
        status: "failed",
        errorCode: "PROVIDER_PAYLOAD_INVALID",
      })]);
  });

  it("geçersiz JSON cevabını reddeder", async () => {
    const adapter = new HttpNotificationAdapter({
      endpoint: "https://notify.example/send",
      fetch: async () => ({
        ok: true,
        status: 200,
        async text() {
          return "not-json";
        },
      }),
    });

    await expect(adapter.sendBatch([{ channel: "EMAIL", to: "veli@example.test", body: "Mesaj" }]))
      .rejects.toThrow("NOTIFICATION_HTTP_RESPONSE_INVALID");
  });

  it("eksik sonuç listesini reddeder", async () => {
    const adapter = new HttpNotificationAdapter({
      endpoint: "https://notify.example/send",
      fetch: async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ results: [] });
        },
      }),
    });

    await expect(adapter.sendBatch([{ channel: "EMAIL", to: "veli@example.test", body: "Mesaj" }]))
      .rejects.toThrow("NOTIFICATION_HTTP_RESPONSE_INVALID");
  });
});
