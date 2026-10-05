import { describe, expect, it } from "vitest";
import type { AnnouncementDeliveryReportInput } from "./announcement-delivery-job.js";
import { processAnnouncementDeliveryJob } from "./announcement-delivery-job.js";
import {
  createWebPushSenderFromEnv,
  type AnnouncementPushSendJobPayload,
  type AnnouncementPushStore,
  type PushDevice,
  type PushSender,
  type PushSendOutcome,
} from "./announcement-push-delivery.js";

const vapidEnv = {
  VAPID_PUBLIC_KEY: "public-key",
  VAPID_PRIVATE_KEY: "private-key",
  VAPID_SUBJECT: "mailto:ops@example.test",
};

const subscription = JSON.stringify({
  endpoint: "https://push.example.test/sub-1",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
});

function pushJob(payload: Partial<AnnouncementPushSendJobPayload> = {}) {
  return {
    id: "announcement_announcement-a_PUSH_aaaaaaaaaaaaaaaaaaaaaaaa_0",
    name: "announcement-delivery" as const,
    payload: {
      tenantId: "tenant-a",
      userId: "admin-a",
      entityId: "announcement-a",
      contentHash: "push-0",
      channel: "PUSH" as const,
      mode: "PUSH_SEND" as const,
      chunkIndex: 0,
      deviceIds: ["device-1", "device-2", "device-3"],
      title: "Veli toplantısı",
      ...payload,
    },
  };
}

describe("announcement push delivery", () => {
  it("cihazlara yalnız başlık + iç link gönderir; gövde ve PII taşımaz", async () => {
    const store = new FakePushStore([
      { id: "device-1", token: subscription, subjectType: "GUARDIAN" },
      { id: "device-2", token: subscription, subjectType: "STUDENT" },
      { id: "device-3", token: subscription, subjectType: null },
    ]);
    const sender = new FakeSender(() => "sent");

    const result = await processAnnouncementDeliveryJob(pushJob(), noReporter, { sender, store });

    expect(result).toMatchObject({ channel: "PUSH", recipientCount: 3, deliveredCount: 3, failedCount: 0, status: "completed" });
    expect(sender.payloads.map((payload) => JSON.parse(payload))).toEqual([
      { title: "Veli toplantısı", url: "/veli/duyurular" },
      { title: "Veli toplantısı", url: "/ogrenci/duyurular" },
      { title: "Veli toplantısı", url: "/kurum/duyurular" },
    ]);
    for (const payload of sender.payloads) {
      expect(Object.keys(JSON.parse(payload) as object).sort()).toEqual(["title", "url"]);
      expect(payload).not.toMatch(/Cuma günü|10000000|555|500\d|Ayşe|Yılmaz/);
    }
    expect(store.reports).toEqual([expect.objectContaining({ recipientCount: 3, deliveredCount: 3, failedCount: 0, status: "completed" })]);
  });

  it("404/410 yanıtında aboneliği pasifleştirir, diğer hatayı failed sayar", async () => {
    const store = new FakePushStore([
      { id: "device-1", token: subscription },
      { id: "device-2", token: subscription },
      { id: "device-3", token: subscription },
    ]);
    const outcomes: PushSendOutcome[] = ["gone", "failed", "sent"];
    const sender = new FakeSender(() => outcomes.shift()!);

    const result = await processAnnouncementDeliveryJob(pushJob(), noReporter, { sender, store });

    expect(store.disabled).toEqual(["device-1"]);
    expect(result).toMatchObject({ recipientCount: 3, deliveredCount: 1, failedCount: 2, status: "completed" });
    expect(store.reports[0]).toMatchObject({ providerErrorCode: "PUSH_SUBSCRIPTION_GONE" });
  });

  it("VAPID env yoksa push kanalını fail-closed atlar ve sent yazmaz", async () => {
    expect(createWebPushSenderFromEnv({})).toBeUndefined();
    expect(createWebPushSenderFromEnv({ ...vapidEnv, VAPID_PRIVATE_KEY: " " })).toBeUndefined();
    expect(createWebPushSenderFromEnv({ ...vapidEnv, VAPID_SUBJECT: "ops@example.test" })).toBeUndefined();
    const store = new FakePushStore([{ id: "device-1", token: subscription }]);

    const result = await processAnnouncementDeliveryJob(pushJob(), noReporter, { sender: undefined, store });

    expect(store.listCalls).toBe(0);
    expect(result).toMatchObject({ deliveredCount: 0, failedCount: 3, status: "failed" });
    expect(store.reports).toEqual([expect.objectContaining({ deliveredCount: 0, status: "failed", providerErrorCode: "PUSH_VAPID_NOT_CONFIGURED" })]);
  });

  it("web-push yanıtlarını sent/gone/failed olarak eşler ve VAPID ayrıntısını iletir", async () => {
    const calls: unknown[][] = [];
    const responses: Array<() => Promise<never> | Promise<{ statusCode: number; body: string; headers: Record<string, string> }>> = [
      async () => ({ statusCode: 201, body: "", headers: {} }),
      async () => { throw Object.assign(new Error("gone"), { statusCode: 410 }); },
      async () => { throw Object.assign(new Error("not found"), { statusCode: 404 }); },
      async () => { throw Object.assign(new Error("server"), { statusCode: 500 }); },
      async () => { throw new Error("ETIMEDOUT"); },
    ];
    const sender = createWebPushSenderFromEnv(vapidEnv, (async (...args: unknown[]) => {
      calls.push(args);
      return responses.shift()!();
    }) as never)!;

    const outcomes = [];
    for (let index = 0; index < 5; index += 1) outcomes.push(await sender.send(subscription, "{}"));

    expect(outcomes).toEqual(["sent", "gone", "gone", "failed", "failed"]);
    expect(calls[0]?.[2]).toMatchObject({ vapidDetails: { subject: "mailto:ops@example.test", publicKey: "public-key", privateKey: "private-key" } });
    await expect(sender.send("not-json", "{}")).resolves.toBe("failed");
    await expect(sender.send(JSON.stringify({ endpoint: "http://insecure.test", keys: { p256dh: "a", auth: "b" } }), "{}")).resolves.toBe("failed");
    expect(calls).toHaveLength(5);
  });

  it("gönderim sonrası rapor yazılamazsa tekrar denenmeyen hata verir", async () => {
    const store = new FakePushStore([{ id: "device-1", token: subscription }]);
    store.failReport = true;

    await expect(processAnnouncementDeliveryJob(pushJob(), noReporter, { sender: new FakeSender(() => "sent"), store }))
      .rejects.toThrow("ANNOUNCEMENT_PUSH_REPORT_FAILED");
  });

  it("25'ten büyük chunk'ı reddeder", async () => {
    const deviceIds = Array.from({ length: 26 }, (_, index) => `device-${index}`);
    await expect(processAnnouncementDeliveryJob(pushJob({ deviceIds }), noReporter, { sender: new FakeSender(() => "sent"), store: new FakePushStore([]) }))
      .rejects.toThrow("ANNOUNCEMENT_PUSH_PAYLOAD_INVALID");
  });
});

const noReporter = {
  async upsert() {
    throw new Error("report-only path must not be used for push chunks");
  },
};

class FakeSender implements PushSender {
  payloads: string[] = [];
  constructor(private readonly outcome: () => PushSendOutcome) {}
  async send(_subscription: string, payload: string): Promise<PushSendOutcome> {
    this.payloads.push(payload);
    return this.outcome();
  }
}

class FakePushStore implements AnnouncementPushStore {
  disabled: string[] = [];
  reports: AnnouncementDeliveryReportInput[] = [];
  listCalls = 0;
  failReport = false;
  constructor(private readonly devices: PushDevice[]) {}

  async listActiveDevices(_tenantId: string, deviceIds: string[]): Promise<PushDevice[]> {
    this.listCalls += 1;
    return this.devices.filter((device) => deviceIds.includes(device.id));
  }

  async disableDevices(_tenantId: string, deviceIds: string[]): Promise<void> {
    this.disabled.push(...deviceIds);
  }

  async addDeliveryCounts(input: AnnouncementDeliveryReportInput): Promise<void> {
    if (this.failReport) throw new Error("db down");
    this.reports.push(input);
  }
}
