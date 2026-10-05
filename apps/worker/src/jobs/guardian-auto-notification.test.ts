import { describe, expect, it } from "vitest";
import type { NotificationAdapter, NotificationMessage } from "@o-okul/notification-adapter";
import type { PushDevice, PushSender, PushSendOutcome } from "./announcement-push-delivery.js";
import {
  isPaymentDueReminderDay,
  processGuardianNotifyJob,
  type AbsenceClaim,
  type GuardianNotificationStore,
  type GuardianNotifyJobPayload,
  type GuardianNotifyKind,
  type GuardianNotifySettings,
  type GuardianRecipient,
} from "./guardian-auto-notification.js";

describe("KV-8 guardian auto notification job", () => {
  it("vade hatırlatması yalnız vadeden 3 gün önce ve vade günü, yalnız PENDING taksit için", () => {
    const day = "2026-10-05";
    expect(isPaymentDueReminderDay({ dueDate: "2026-10-08", status: "PENDING" }, day)).toBe(true);
    expect(isPaymentDueReminderDay({ dueDate: "2026-10-05", status: "PENDING" }, day)).toBe(true);
    expect(isPaymentDueReminderDay({ dueDate: "2026-10-07", status: "PENDING" }, day)).toBe(false);
    expect(isPaymentDueReminderDay({ dueDate: "2026-10-04", status: "PENDING" }, day)).toBe(false);
    expect(isPaymentDueReminderDay({ dueDate: "2026-10-05", status: "PAID" }, day)).toBe(false);
    expect(isPaymentDueReminderDay({ dueDate: "2026-10-05", status: "CANCELED" }, day)).toBe(false);
    expect(isPaymentDueReminderDay({ dueDate: "2026-10-05", status: "PENDING", deletedAt: "2026-10-01" }, day)).toBe(false);
    // Month boundary: 3 days before 2026-11-01.
    expect(isPaymentDueReminderDay({ dueDate: "2026-11-01", status: "PENDING" }, "2026-10-29")).toBe(true);
  });

  it("kapalı tetikleyici claim etmez ve göndermez", async () => {
    const store = new FakeStore({ absenceEnabled: false });
    store.absenceClaim = { studentId: "student-a", notifiedDate: "2026-10-05", thresholdReached: false };
    const deps = createDeps(store);

    const result = await processGuardianNotifyJob(payload("ABSENCE", "attendance-a"), deps);

    expect(result.skipped).toBe("DISABLED");
    expect(store.calls).toEqual([]);
    expect(deps.pushes).toEqual([]);
    expect(deps.emails).toEqual([]);
  });

  it("devamsızlık: günlük bildirim + eşik uyarısı push ve e-postayla gider; payload öğrenci kişisel verisi taşımaz", async () => {
    const store = new FakeStore();
    store.absenceClaim = { studentId: "student-a", notifiedDate: "2026-10-05", thresholdReached: true };
    const deps = createDeps(store);

    const result = await processGuardianNotifyJob(payload("ABSENCE", "attendance-a"), deps);

    expect(store.calls).toContainEqual(["claimAbsence", "tenant-a", "attendance-a", 10]);
    expect(store.calls).toContainEqual(["listRecipients", "tenant-a", ["student-a"], false]);
    // Two notices x two active devices of the one guardian user.
    expect(result).toMatchObject({ notificationCount: 2, recipientCount: 2, pushSentCount: 4, emailSentCount: 2 });
    expect([...new Set(deps.pushes.map((push) => push.payload))].map((body) => JSON.parse(body))).toEqual([
      { title: "Devamsızlık: öğrenciniz 05.10.2026 günü okula gelmedi olarak işaretlendi.", url: "/veli/ogrenci" },
      { title: "Devamsızlık uyarısı: öğrencinizin bu dönemki devamsızlığı 10 güne ulaştı.", url: "/veli/ogrenci" },
    ]);
    expect(deps.emails.map((message) => message.to)).toEqual(["veli-a@example.test", "veli-a@example.test"]);
    expect(JSON.stringify([deps.pushes, deps.emails])).not.toMatch(/Ada|10000000146|555|student-a/);
  });

  it("aynı iş ikinci kez koşunca claim boş döner ve yeni gönderim olmaz", async () => {
    const store = new FakeStore();
    store.absenceClaim = undefined;
    const deps = createDeps(store);

    const result = await processGuardianNotifyJob(payload("ABSENCE", "attendance-a"), deps);

    expect(result.notificationCount).toBe(0);
    expect(store.calls.map((call) => call[0])).toEqual(["claimAbsence"]);
    expect(deps.pushes).toEqual([]);
    expect(deps.emails).toEqual([]);
  });

  it("vade bildirimi yalnız finans görünürlüğü açık veliye sorulur ve vade gününü kullanır", async () => {
    const store = new FakeStore();
    store.paymentClaim = { studentId: "student-a", dueDate: "2026-10-05" };
    const deps = createDeps(store);

    await processGuardianNotifyJob({ ...payload("PAYMENT_DUE", "installment-a"), contentHash: "2026-10-05" }, deps);

    expect(store.calls).toContainEqual(["claimPaymentDue", "tenant-a", "installment-a", "2026-10-05"]);
    expect(store.calls).toContainEqual(["listRecipients", "tenant-a", ["student-a"], true]);
    expect(JSON.parse(deps.pushes[0]!.payload)).toEqual({ title: "Ödeme hatırlatması: bugün vadesi gelen bir taksitiniz var.", url: "/veli/odemeler" });
  });

  it("finans izni olmayan veli listede yoksa vade bildirimi gitmez", async () => {
    const store = new FakeStore();
    store.paymentClaim = { studentId: "student-a", dueDate: "2026-10-08" };
    store.financeRecipients = [];
    const deps = createDeps(store);

    const result = await processGuardianNotifyJob({ ...payload("PAYMENT_DUE", "installment-a"), contentHash: "2026-10-05" }, deps);

    expect(result).toMatchObject({ notificationCount: 1, recipientCount: 0, pushSentCount: 0, emailSentCount: 0 });
    expect(deps.pushes).toEqual([]);
  });

  it("not yayını yeni ve düzeltilmiş notu ayrı başlıkla bildirir", async () => {
    const store = new FakeStore();
    store.gradeClaim = [{ studentId: "student-a", version: 1 }, { studentId: "student-b", version: 2 }];
    const deps = createDeps(store);

    const result = await processGuardianNotifyJob(payload("GRADE_PUBLISHED", "assessment-a"), deps);

    expect(result.notificationCount).toBe(2);
    expect(store.calls).toContainEqual(["listRecipients", "tenant-a", ["student-a"], false]);
    expect(store.calls).toContainEqual(["listRecipients", "tenant-a", ["student-b"], false]);
    expect(deps.pushes.map((push) => JSON.parse(push.payload).title)).toEqual([
      "Not bildirimi: öğrencinizin yeni okul notu yayımlandı.",
      "Not bildirimi: öğrencinizin yeni okul notu yayımlandı.",
      "Not bildirimi: öğrencinizin bir okul notu düzeltildi.",
      "Not bildirimi: öğrencinizin bir okul notu düzeltildi.",
    ]);
  });

  it("410 dönen cihaz pasifleşir; VAPID yoksa e-posta yine gider", async () => {
    const store = new FakeStore();
    store.absenceClaim = { studentId: "student-a", notifiedDate: "2026-10-05", thresholdReached: false };
    const deps = createDeps(store, { "device-2": "gone" });

    await processGuardianNotifyJob(payload("ABSENCE", "attendance-a"), deps);
    expect(store.calls).toContainEqual(["disableDevices", "tenant-a", ["device-2"]]);

    const noPush = createDeps(store);
    noPush.pushSender = undefined;
    const result = await processGuardianNotifyJob(payload("ABSENCE", "attendance-a"), noPush);
    expect(result).toMatchObject({ pushSentCount: 0, emailSentCount: 1 });
  });
});

function payload(kind: GuardianNotifyKind, entityId: string): GuardianNotifyJobPayload {
  return { tenantId: "tenant-a", lifecycleVersion: 0, userId: "user-a", entityId, contentHash: "k1", mode: "GUARDIAN_NOTIFY", kind };
}

class FakeStore implements GuardianNotificationStore {
  readonly calls: unknown[][] = [];
  absenceClaim: AbsenceClaim | undefined;
  paymentClaim: { studentId: string; dueDate: string } | undefined;
  gradeClaim: Array<{ studentId: string; version: number }> = [];
  financeRecipients: GuardianRecipient[] | undefined;
  private readonly settings: GuardianNotifySettings;

  constructor(settings: Partial<GuardianNotifySettings> = {}) {
    this.settings = { absenceEnabled: true, paymentDueEnabled: true, gradePublishEnabled: true, absenceThreshold: 10, ...settings };
  }

  async loadSettings(): Promise<GuardianNotifySettings> {
    return this.settings;
  }

  async claimAbsence(tenantId: string, attendanceId: string, threshold: number): Promise<AbsenceClaim | undefined> {
    this.calls.push(["claimAbsence", tenantId, attendanceId, threshold]);
    return this.absenceClaim;
  }

  async claimPaymentDue(tenantId: string, installmentId: string, day: string) {
    this.calls.push(["claimPaymentDue", tenantId, installmentId, day]);
    return this.paymentClaim;
  }

  async claimGradePublished(tenantId: string, assessmentId: string) {
    this.calls.push(["claimGradePublished", tenantId, assessmentId]);
    return this.gradeClaim;
  }

  async listRecipients(tenantId: string, studentIds: string[], requireFinance: boolean): Promise<GuardianRecipient[]> {
    this.calls.push(["listRecipients", tenantId, studentIds, requireFinance]);
    if (requireFinance && this.financeRecipients) return this.financeRecipients;
    return [{ userId: "user-guardian-a", email: "veli-a@example.test" }];
  }

  async listActiveDevices(tenantId: string, userIds: string[]): Promise<PushDevice[]> {
    this.calls.push(["listActiveDevices", tenantId, userIds]);
    return [{ id: "device-1", token: "token-1" }, { id: "device-2", token: "token-2" }];
  }

  async disableDevices(tenantId: string, deviceIds: string[]): Promise<void> {
    this.calls.push(["disableDevices", tenantId, deviceIds]);
  }
}

function createDeps(store: FakeStore, outcomes: Record<string, PushSendOutcome> = {}) {
  const pushes: Array<{ token: string; payload: string }> = [];
  const emails: NotificationMessage[] = [];
  const pushSender: PushSender = {
    async send(token, body) {
      pushes.push({ token, payload: body });
      const device = token.replace("token", "device");
      return outcomes[device] ?? "sent";
    },
  };
  const email: NotificationAdapter = {
    async sendBatch(messages) {
      emails.push(...messages);
      return messages.map((message) => ({ channel: message.channel, to: message.to, status: "sent" as const, providerMessageId: "noop" }));
    },
  };
  return { store, pushSender: pushSender as PushSender | undefined, email, pushes, emails };
}
