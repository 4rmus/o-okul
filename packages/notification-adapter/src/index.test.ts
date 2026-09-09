import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  createNoopNotificationAdapter,
  createNotificationAdapterFromEnv,
  HttpNotificationAdapter,
  lookupNotificationReceiptFromEnv,
} from "./index.js";

const httpIdentity = {
  fromEmail: "bildirim@o-okul.com",
  replyToEmail: "destek@o-okul.com",
};

describe("read-only stored receipt lookup", () => {
  const env = { NOTIFICATION_PROVIDER: "http", NOTIFICATION_HTTP_ENDPOINT: "https://notify.example.test/send", NOTIFICATION_HTTP_BEARER_TOKEN: "private-token" };
  const key = "secret-delivery:outbox-1";
  const keyHash = createHash("sha256").update(key).digest("hex");
  const createdAt = new Date(Date.now() - 1000).toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + 30 * 86400000).toISOString();
  const accepted = { status: "PROVIDER_ACCEPTED", keyHash, createdAt, expiresAt, providerReceiptHash: "a".repeat(64) };
  it("uses only GET at trusted origin without redirects, cache or send payload", async () => {
    const fetch = vi.fn(async () => Response.json(accepted));
    expect(await lookupNotificationReceiptFromEnv(env, key, fetch)).toEqual(accepted);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual([`https://notify.example.test/receipts?key=secret-delivery%3Aoutbox-1`, expect.objectContaining({ method: "GET", redirect: "error", cache: "no-store" })]);
  });
  it.each([
    { ...accepted, keyHash: "b".repeat(64) }, { ...accepted, providerReceiptHash: "raw-id" },
    { ...accepted, createdAt: null }, { ...accepted, expiresAt: createdAt },
    { ...accepted, status: "DELIVERED" }, { ...accepted, status: "NOT_FOUND" },
    { ...accepted, to: "private@example.test" }, { ...accepted, createdAt: new Date(createdAt).toUTCString() },
  ])("fails closed for malformed or mismatched 200: %j", async (body) => {
    expect((await lookupNotificationReceiptFromEnv(env, key, async () => Response.json(body))).status).toBe("UNVERIFIED");
  });
  it("keeps expired acceptance expired and missing distinct from unavailable", async () => {
    const old = Date.now() - 31 * 86400000;
    expect((await lookupNotificationReceiptFromEnv(env, key, async () => Response.json({ ...accepted, createdAt: new Date(old).toISOString(), expiresAt: new Date(old + 30 * 86400000).toISOString() }))).status).toBe("EXPIRED");
    expect((await lookupNotificationReceiptFromEnv(env, key, async () => Response.json({ keyHash, status: "NOT_FOUND", createdAt: null, expiresAt: null, providerReceiptHash: null }))).status).toBe("NOT_FOUND");
    expect((await lookupNotificationReceiptFromEnv(env, key, async () => new Response("", { status: 503 }))).status).toBe("UNAVAILABLE");
  });
  it("does not call anything for missing config/noop or invalid keys", async () => {
    const fetch = vi.fn();
    expect((await lookupNotificationReceiptFromEnv({}, key, fetch)).status).toBe("UNAVAILABLE");
    await expect(lookupNotificationReceiptFromEnv(env, "arbitrary-provider-key", fetch)).rejects.toThrow("INVALID_RECEIPT_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });
});

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

  it("WhatsApp için sahte teslim üretmez", async () => {
    const adapter = createNoopNotificationAdapter();

    await expect(adapter.sendBatch([{
      channel: "WHATSAPP",
      to: "+905000000001",
      templateName: "school_announcement_v1",
      languageCode: "tr",
      idempotencyKey: "whatsapp:test-1",
    }])).resolves.toEqual([{
      channel: "WHATSAPP",
      to: "+905000000001",
      status: "failed",
      errorCode: "NOTIFICATION_WHATSAPP_DISABLED",
    }]);
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

  it("HTTP sağlayıcı gönderici ve yanıt adreslerini zorunlu tutar", () => {
    expect(() => createNotificationAdapterFromEnv({
      NODE_ENV: "production",
      NOTIFICATION_PROVIDER: "http",
      NOTIFICATION_HTTP_ENDPOINT: "https://notify.example/send",
    })).toThrow("NOTIFICATION_FROM_EMAIL_MISSING");

    expect(() => createNotificationAdapterFromEnv({
      NODE_ENV: "production",
      NOTIFICATION_PROVIDER: "http",
      NOTIFICATION_HTTP_ENDPOINT: "https://notify.example/send",
      NOTIFICATION_FROM_EMAIL: "gecersiz",
      NOTIFICATION_REPLY_TO_EMAIL: "destek@o-okul.com",
    })).toThrow("NOTIFICATION_FROM_EMAIL_INVALID");
  });
});

describe("HttpNotificationAdapter", () => {
  it("HTTP sağlayıcıya Bearer token ve mesaj listesi ile gönderir", async () => {
    const calls: Array<{ input: string; init: { body: string; headers: Record<string, string>; method: "POST" } }> = [];
    const adapter = new HttpNotificationAdapter({
      ...httpIdentity,
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
          from: "bildirim@o-okul.com",
          replyTo: "destek@o-okul.com",
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
      ...httpIdentity,
      endpoint: "https://notify.example/send",
      fetch: async (_input, init) => {
        calls.push({ init });
        return { ok: true, status: 200, async text() { return JSON.stringify({ results: [{ status: "sent" }] }); } };
      },
    });

    await adapter.sendBatch([{ channel: "EMAIL", to: "recipient", body: "message", idempotencyKey: "secret-delivery:outbox-1" }]);
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
      messages: [{ channel: "EMAIL", to: "recipient", from: "bildirim@o-okul.com", replyTo: "destek@o-okul.com", body: "message", idempotencyKey: "secret-delivery:outbox-1" }],
    });
  });

  it("WhatsApp utility şablonunu serbest mesaj gövdesi olmadan iletir", async () => {
    const calls: Array<{ init: { body: string } }> = [];
    const adapter = new HttpNotificationAdapter({
      ...httpIdentity,
      endpoint: "https://notify.example/send",
      fetch: async (_input, init) => {
        calls.push({ init });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              results: [{
                channel: "WHATSAPP",
                to: "+905000000001",
                status: "sent",
                providerMessageId: "wamid.test-1",
              }],
            });
          },
        };
      },
    });

    await expect(adapter.sendBatch([{
      channel: "WHATSAPP",
      to: "+905000000001",
      templateName: "school_announcement_v1",
      languageCode: "tr",
      idempotencyKey: "whatsapp:test-1",
    }])).resolves.toEqual([{
      channel: "WHATSAPP",
      to: "+905000000001",
      status: "sent",
      providerMessageId: "wamid.test-1",
      errorCode: undefined,
    }]);
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
      messages: [{
        channel: "WHATSAPP",
        to: "+905000000001",
        templateName: "school_announcement_v1",
        languageCode: "tr",
        idempotencyKey: "whatsapp:test-1",
      }],
    });
  });

  it("HTTP hata durumunda tüm mesajları başarısız işaretler", async () => {
    const adapter = new HttpNotificationAdapter({
      ...httpIdentity,
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
      ...httpIdentity,
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
      ...httpIdentity,
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
      ...httpIdentity,
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
