import { describe, expect, it } from "vitest";
import {
  createNoopSmsAdapter,
  createSmsAdapterFromEnv,
  estimateSmsSegments,
  NetgsmSmsAdapter,
} from "./index.js";

describe("estimateSmsSegments", () => {
  it("GSM-7 tek segment sınırını hesaplar", () => {
    expect(estimateSmsSegments("A".repeat(160))).toMatchObject({
      encoding: "GSM_7",
      characterCount: 160,
      messageUnits: 160,
      segments: 1,
      singleSegmentLimit: 160,
      multipartSegmentLimit: 153,
    });
  });

  it("GSM-7 çoklu segment sınırını hesaplar", () => {
    expect(estimateSmsSegments("A".repeat(161))).toMatchObject({
      encoding: "GSM_7",
      characterCount: 161,
      messageUnits: 161,
      segments: 2,
    });
  });

  it("GSM-7 extension karakterlerini iki birim sayar", () => {
    expect(estimateSmsSegments("^".repeat(80))).toMatchObject({
      encoding: "GSM_7",
      characterCount: 80,
      messageUnits: 160,
      segments: 1,
    });
    expect(estimateSmsSegments("^".repeat(81))).toMatchObject({
      encoding: "GSM_7",
      characterCount: 81,
      messageUnits: 162,
      segments: 2,
    });
  });

  it("Türkçe GSM-7 dışı karakterlerde Unicode segment sınırını kullanır", () => {
    expect(estimateSmsSegments("ğ".repeat(70))).toMatchObject({
      encoding: "UNICODE",
      characterCount: 70,
      messageUnits: 70,
      segments: 1,
      singleSegmentLimit: 70,
      multipartSegmentLimit: 67,
    });
    expect(estimateSmsSegments("ğ".repeat(71))).toMatchObject({
      encoding: "UNICODE",
      characterCount: 71,
      messageUnits: 71,
      segments: 2,
    });
  });
});

describe("createNoopSmsAdapter", () => {
  it("gönderim sonucuna segment tahminini ekler", async () => {
    const adapter = createNoopSmsAdapter();

    await expect(adapter.sendBatch([{ to: "5000000001", body: "ğ".repeat(71) }]))
      .resolves.toEqual([{
        to: "5000000001",
        status: "sent",
        providerMessageId: "noop-1",
        segmentEstimate: expect.objectContaining({
          encoding: "UNICODE",
          segments: 2,
        }),
      }]);
  });
});

describe("createSmsAdapterFromEnv", () => {
  it("lokalde no-op adapter üretir", async () => {
    const adapter = createSmsAdapterFromEnv({ NODE_ENV: "development", SMS_PROVIDER: "noop" });

    await expect(adapter.sendBatch([{ to: "5000000001", body: "test" }]))
      .resolves.toEqual([expect.objectContaining({ providerMessageId: "noop-1" })]);
  });

  it("prod ortamında açık izin yoksa no-op adapter'ı reddeder", () => {
    expect(() => createSmsAdapterFromEnv({ NODE_ENV: "production", SMS_PROVIDER: "noop" }))
      .toThrow("SMS_PROVIDER_REQUIRED");
  });

  it("SMS kapalı prod ortamında no-op adapter ile başlayabilir", async () => {
    const adapter = createSmsAdapterFromEnv({ NODE_ENV: "production", SMS_ENABLED: "false", SMS_PROVIDER: "noop" });

    await expect(adapter.sendBatch([{ to: "5000000001", body: "test" }]))
      .resolves.toEqual([expect.objectContaining({ providerMessageId: "noop-1" })]);
  });

  it("Netgsm seçildiğinde credential ister", () => {
    expect(() => createSmsAdapterFromEnv({ NODE_ENV: "development", SMS_PROVIDER: "netgsm" }))
      .toThrow("NETGSM_USERCODE_MISSING");
  });
});

describe("NetgsmSmsAdapter", () => {
  it("Netgsm JSON API'ye Basic Auth ve mesaj listesi ile gönderir", async () => {
    const calls: Array<{ input: string; init: { body: string; headers: Record<string, string>; method: "POST" } }> = [];
    const adapter = new NetgsmSmsAdapter({
      endpoint: "https://api.netgsm.example/sms/rest/v2/send",
      fetch: async (input, init) => {
        calls.push({ input, init });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ code: "00", jobid: "123456" });
          },
        };
      },
      msgHeader: "OOKUL",
      password: "secret",
      usercode: "8500000000",
    });

    await expect(adapter.sendBatch([{ to: "905000000001", body: "Deneme mesajı" }]))
      .resolves.toEqual([expect.objectContaining({
        providerMessageId: "123456",
        status: "sent",
        to: "905000000001",
      })]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://api.netgsm.example/sms/rest/v2/send");
    expect(calls[0]?.init.headers).toEqual({
      authorization: "Basic ODUwMDAwMDAwMDpzZWNyZXQ=",
      "content-type": "application/json",
    });
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
      msgheader: "OOKUL",
      messages: [{ msg: "Deneme mesajı", no: "905000000001" }],
      encoding: "TR",
      iysfilter: "0",
    });
  });

  it("Netgsm hata kodunu mesaj sonuçlarına taşır", async () => {
    const adapter = new NetgsmSmsAdapter({
      fetch: async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ code: "30", description: "Geçersiz kullanıcı" });
        },
      }),
      msgHeader: "OOKUL",
      password: "secret",
      usercode: "8500000000",
    });

    await expect(adapter.sendBatch([{ to: "905000000001", body: "Mesaj" }]))
      .resolves.toEqual([expect.objectContaining({
        errorCode: "NETGSM_30",
        status: "failed",
      })]);
  });

  it("Netgsm HTTP hata gövdesindeki sağlayıcı kodunu korur", async () => {
    const adapter = new NetgsmSmsAdapter({
      fetch: async () => ({
        ok: false,
        status: 406,
        async text() {
          return JSON.stringify({ code: "70", description: "Parametre hatalı" });
        },
      }),
      msgHeader: "OOKUL",
      password: "secret",
      usercode: "8500000000",
    });

    await expect(adapter.sendBatch([{ to: "905000000001", body: "Mesaj" }]))
      .resolves.toEqual([expect.objectContaining({
        errorCode: "NETGSM_70",
        status: "failed",
      })]);
  });

  it("env ile Netgsm adapter üretir ve eksik credential'ı reddeder", () => {
    expect(createSmsAdapterFromEnv({
      SMS_PROVIDER: "netgsm",
      NETGSM_USERCODE: "8500000000",
      NETGSM_PASSWORD: "secret",
      NETGSM_MSG_HEADER: "OOKUL",
    })).toBeInstanceOf(NetgsmSmsAdapter);

    expect(() => createSmsAdapterFromEnv({ SMS_PROVIDER: "netgsm" }))
      .toThrow("NETGSM_USERCODE_MISSING");
  });

  it("desteklenmeyen sağlayıcı adını reddeder", () => {
    expect(() => createSmsAdapterFromEnv({ NODE_ENV: "development", SMS_PROVIDER: "iletimerkezi" }))
      .toThrow("SMS_PROVIDER_UNSUPPORTED");
  });
});
