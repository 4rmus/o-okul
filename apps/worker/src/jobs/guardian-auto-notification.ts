import type { NotificationAdapter } from "@o-okul/notification-adapter";
import { addCalendarDays, isPaymentInstallmentOverdue, type PaymentInstallmentRecord } from "@o-okul/shared-types";
import type { TenantJobPayload } from "../queue/queues.js";
import type { PushDevice, PushSender, PushSendOutcome } from "./announcement-push-delivery.js";

/**
 * KV-8 (DEC-20261005-04, basis DEC-20261005-02): automatic guardian notifications.
 * A job names one source row (entityId). The worker first claims that row's "notified" marker in a transaction and
 * only then sends, so a second run of the same job (or a same-day correction) finds nothing to claim: at most once.
 * Gates applied at send time: institution switch, guardian's own preference (GuardianStudent.canReceiveAutoNotifications),
 * finance visibility (canViewFinance, payment only), device disabledAt. Push payload = title + internal link, no PII.
 */
export type GuardianNotifyKind = "ABSENCE" | "PAYMENT_DUE" | "GRADE_PUBLISHED";

export interface GuardianNotifyJobPayload extends TenantJobPayload {
  mode: "GUARDIAN_NOTIFY";
  kind: GuardianNotifyKind;
}

export interface GuardianNotifySettings {
  absenceEnabled: boolean;
  paymentDueEnabled: boolean;
  gradePublishEnabled: boolean;
  absenceThreshold: number;
}

export interface GuardianRecipient {
  userId: string;
  email?: string | null;
}

export interface AbsenceClaim {
  studentId: string;
  /** Set when the daily notice was claimed by this run (YYYY-MM-DD). */
  notifiedDate?: string;
  /** True when this run claimed the one-time term threshold warning. */
  thresholdReached: boolean;
}

export interface GuardianNotificationStore {
  /** undefined: tenant missing or not ACTIVE. */
  loadSettings(tenantId: string): Promise<GuardianNotifySettings | undefined>;
  claimAbsence(tenantId: string, attendanceId: string, threshold: number): Promise<AbsenceClaim | undefined>;
  claimPaymentDue(tenantId: string, installmentId: string, day: string): Promise<{ studentId: string; dueDate: string } | undefined>;
  /** Published entries after the assessment's watermark; moves the watermark. version > 1 means a correction. */
  claimGradePublished(tenantId: string, assessmentId: string): Promise<Array<{ studentId: string; version: number }>>;
  listRecipients(tenantId: string, studentIds: string[], requireFinance: boolean): Promise<GuardianRecipient[]>;
  listActiveDevices(tenantId: string, userIds: string[]): Promise<PushDevice[]>;
  disableDevices(tenantId: string, deviceIds: string[]): Promise<void>;
}

export interface GuardianNotifyDeps {
  store: GuardianNotificationStore;
  /** undefined when VAPID env is missing: push is skipped fail-closed, e-mail still goes. */
  pushSender: PushSender | undefined;
  email: NotificationAdapter | undefined;
}

export interface GuardianNotifyJobResult {
  tenantId: string;
  kind: GuardianNotifyKind;
  entityId: string;
  notificationCount: number;
  recipientCount: number;
  pushSentCount: number;
  emailSentCount: number;
  skipped?: "DISABLED";
}

interface GuardianNotice {
  studentIds: string[];
  title: string;
  url: string;
  requireFinance: boolean;
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export function isGuardianNotifyPayload(payload: object): payload is GuardianNotifyJobPayload {
  return (payload as { mode?: unknown }).mode === "GUARDIAN_NOTIFY";
}

export function assertGuardianNotifyPayload(payload: GuardianNotifyJobPayload): void {
  if (!["ABSENCE", "PAYMENT_DUE", "GRADE_PUBLISHED"].includes(payload.kind)) throw new Error("GUARDIAN_NOTIFY_PAYLOAD_INVALID");
  // PAYMENT_DUE: contentHash is the reminder day (idempotency key installment + day).
  if (payload.kind === "PAYMENT_DUE" && !dayPattern.test(payload.contentHash)) throw new Error("GUARDIAN_NOTIFY_PAYLOAD_INVALID");
}

/** A PENDING installment gets a reminder 3 days before its due date and on the due date; overdue/paid/canceled none. */
export function isPaymentDueReminderDay(
  installment: Pick<PaymentInstallmentRecord, "dueDate" | "status" | "deletedAt">,
  day: string,
): boolean {
  return installment.status === "PENDING" &&
    !installment.deletedAt &&
    !isPaymentInstallmentOverdue(installment, day) &&
    (installment.dueDate === day || installment.dueDate === addCalendarDays(day, 3));
}

export async function processGuardianNotifyJob(
  payload: GuardianNotifyJobPayload,
  deps: GuardianNotifyDeps,
): Promise<GuardianNotifyJobResult> {
  const result: GuardianNotifyJobResult = {
    tenantId: payload.tenantId,
    kind: payload.kind,
    entityId: payload.entityId,
    notificationCount: 0,
    recipientCount: 0,
    pushSentCount: 0,
    emailSentCount: 0,
  };
  const settings = await deps.store.loadSettings(payload.tenantId);
  if (!settings || !isEnabled(settings, payload.kind)) return { ...result, skipped: "DISABLED" };

  const notices = await claimNotices(payload, settings, deps.store);
  for (const notice of notices) {
    const sent = await sendNotice(payload.tenantId, notice, deps);
    result.notificationCount += 1;
    result.recipientCount += sent.recipientCount;
    result.pushSentCount += sent.pushSentCount;
    result.emailSentCount += sent.emailSentCount;
  }
  return result;
}

function isEnabled(settings: GuardianNotifySettings, kind: GuardianNotifyKind): boolean {
  if (kind === "ABSENCE") return settings.absenceEnabled;
  if (kind === "PAYMENT_DUE") return settings.paymentDueEnabled;
  return settings.gradePublishEnabled;
}

async function claimNotices(
  payload: GuardianNotifyJobPayload,
  settings: GuardianNotifySettings,
  store: GuardianNotificationStore,
): Promise<GuardianNotice[]> {
  if (payload.kind === "ABSENCE") {
    const claim = await store.claimAbsence(payload.tenantId, payload.entityId, settings.absenceThreshold);
    if (!claim) return [];
    const notices: GuardianNotice[] = [];
    if (claim.notifiedDate) {
      notices.push({
        studentIds: [claim.studentId],
        title: `Devamsızlık: öğrenciniz ${formatDay(claim.notifiedDate)} günü okula gelmedi olarak işaretlendi.`,
        url: "/veli/ogrenci",
        requireFinance: false,
      });
    }
    if (claim.thresholdReached) {
      notices.push({
        studentIds: [claim.studentId],
        title: `Devamsızlık uyarısı: öğrencinizin bu dönemki devamsızlığı ${settings.absenceThreshold} güne ulaştı.`,
        url: "/veli/ogrenci",
        requireFinance: false,
      });
    }
    return notices;
  }

  if (payload.kind === "PAYMENT_DUE") {
    const day = payload.contentHash;
    const claim = await store.claimPaymentDue(payload.tenantId, payload.entityId, day);
    if (!claim) return [];
    return [{
      studentIds: [claim.studentId],
      title: claim.dueDate === day
        ? "Ödeme hatırlatması: bugün vadesi gelen bir taksitiniz var."
        : `Ödeme hatırlatması: ${formatDay(claim.dueDate)} vadeli bir taksitiniz var.`,
      url: "/veli/odemeler",
      requireFinance: true,
    }];
  }

  const entries = await store.claimGradePublished(payload.tenantId, payload.entityId);
  const published = [...new Set(entries.filter((entry) => entry.version === 1).map((entry) => entry.studentId))];
  const corrected = [...new Set(entries.filter((entry) => entry.version > 1).map((entry) => entry.studentId))]
    .filter((studentId) => !published.includes(studentId));
  const notices: GuardianNotice[] = [];
  if (published.length > 0) {
    notices.push({ studentIds: published, title: "Not bildirimi: öğrencinizin yeni okul notu yayımlandı.", url: "/veli/ogrenci", requireFinance: false });
  }
  if (corrected.length > 0) {
    notices.push({ studentIds: corrected, title: "Not bildirimi: öğrencinizin bir okul notu düzeltildi.", url: "/veli/ogrenci", requireFinance: false });
  }
  return notices;
}

async function sendNotice(
  tenantId: string,
  notice: GuardianNotice,
  deps: GuardianNotifyDeps,
): Promise<{ recipientCount: number; pushSentCount: number; emailSentCount: number }> {
  const recipients = await deps.store.listRecipients(tenantId, notice.studentIds, notice.requireFinance);
  const userIds = [...new Set(recipients.map((recipient) => recipient.userId))];
  if (userIds.length === 0) return { recipientCount: 0, pushSentCount: 0, emailSentCount: 0 };

  // The marker is already claimed: a send failure is counted, never retried (a retry could send twice).
  let pushSentCount = 0;
  if (deps.pushSender) {
    const sender = deps.pushSender;
    const devices = await deps.store.listActiveDevices(tenantId, userIds);
    const payload = JSON.stringify({ title: notice.title, url: notice.url });
    const outcomes = await Promise.all(devices.map(async (device) => ({
      id: device.id,
      outcome: await sender.send(device.token, payload).catch((): PushSendOutcome => "failed"),
    })));
    pushSentCount = outcomes.filter((entry) => entry.outcome === "sent").length;
    const goneIds = outcomes.filter((entry) => entry.outcome === "gone").map((entry) => entry.id);
    if (goneIds.length > 0) await deps.store.disableDevices(tenantId, goneIds).catch(() => undefined);
  }

  let emailSentCount = 0;
  const emails = [...new Set(recipients.map((recipient) => recipient.email?.trim()).filter((email): email is string => Boolean(email)))];
  if (deps.email && emails.length > 0) {
    const results = await deps.email.sendBatch(emails.map((to) => ({
      channel: "EMAIL" as const,
      to,
      subject: notice.title,
      body: `${notice.title}\n\nAyrıntılar O-Okul veli panelinizde. Otomatik bildirimleri veli panelindeki Bildirim Tercihleri bölümünden kapatabilirsiniz.`,
    }))).catch(() => []);
    emailSentCount = results.filter((entry) => entry.status === "sent").length;
  }

  return { recipientCount: userIds.length, pushSentCount, emailSentCount };
}

function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}
