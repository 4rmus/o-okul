import webPush from "web-push";
import type { TenantJobPayload } from "../queue/queues.js";
import type { AnnouncementDeliveryJobResult, AnnouncementDeliveryReportInput } from "./announcement-delivery-job.js";

export const announcementPushChunkSize = 25;
export const pushVapidNotConfiguredCode = "PUSH_VAPID_NOT_CONFIGURED";

export interface AnnouncementPushSendJobPayload extends TenantJobPayload {
  channel: "PUSH";
  mode: "PUSH_SEND";
  chunkIndex: number;
  deviceIds: string[];
  title: string;
}

export interface PushDevice {
  id: string;
  token: string;
  subjectType?: string | null;
}

export interface AnnouncementPushStore {
  listActiveDevices(tenantId: string, deviceIds: string[]): Promise<PushDevice[]>;
  disableDevices(tenantId: string, deviceIds: string[]): Promise<void>;
  /** Adds this chunk's counts to the per-announcement PUSH report (chunks share one report row). */
  addDeliveryCounts(input: AnnouncementDeliveryReportInput): Promise<void>;
}

/** "gone" = push service answered 404/410, the subscription must be disabled. Anything uncertain is "failed", never "sent". */
export type PushSendOutcome = "sent" | "gone" | "failed";

export interface PushSender {
  send(subscriptionJson: string, payload: string): Promise<PushSendOutcome>;
}

export interface AnnouncementPushDeps {
  /** undefined when VAPID env is missing: the channel is skipped fail-closed. */
  sender: PushSender | undefined;
  store: AnnouncementPushStore;
}

export function isAnnouncementPushSendPayload(payload: object): payload is AnnouncementPushSendJobPayload {
  return (payload as { mode?: unknown }).mode === "PUSH_SEND";
}

export function assertAnnouncementPushSendPayload(payload: AnnouncementPushSendJobPayload): void {
  if (
    payload.channel !== "PUSH" ||
    !Number.isInteger(payload.chunkIndex) || payload.chunkIndex < 0 ||
    !Array.isArray(payload.deviceIds) || payload.deviceIds.length === 0 ||
    payload.deviceIds.length > announcementPushChunkSize ||
    payload.deviceIds.some((id) => typeof id !== "string" || !id) ||
    typeof payload.title !== "string" || !payload.title.trim()
  ) {
    throw new Error("ANNOUNCEMENT_PUSH_PAYLOAD_INVALID");
  }
}

/** Notification payload: title + internal link only. No body, names, TC or phone. */
export function buildAnnouncementPushPayload(title: string, subjectType: string | null | undefined): string {
  return JSON.stringify({ title, url: announcementLinkFor(subjectType) });
}

function announcementLinkFor(subjectType: string | null | undefined): string {
  if (subjectType === "GUARDIAN") return "/veli/duyurular";
  if (subjectType === "STUDENT") return "/ogrenci/duyurular";
  if (subjectType === "TEACHER") return "/ogretmen/duyurular";
  return "/kurum/duyurular";
}

export async function processAnnouncementPushChunk(
  payload: AnnouncementPushSendJobPayload,
  deps: AnnouncementPushDeps,
): Promise<AnnouncementDeliveryJobResult> {
  const base = { tenantId: payload.tenantId, announcementId: payload.entityId, channel: "PUSH" as const };

  if (!deps.sender) {
    const result = { ...base, recipientCount: payload.deviceIds.length, deliveredCount: 0, failedCount: payload.deviceIds.length, status: "failed" as const };
    await deps.store.addDeliveryCounts({ ...result, providerErrorCode: pushVapidNotConfiguredCode });
    return result;
  }

  const devices = await deps.store.listActiveDevices(payload.tenantId, payload.deviceIds);
  const sender = deps.sender;
  const outcomes = await Promise.all(devices.map(async (device) => ({
    id: device.id,
    outcome: await sender.send(device.token, buildAnnouncementPushPayload(payload.title, device.subjectType)).catch((): PushSendOutcome => "failed"),
  })));

  const deliveredCount = outcomes.filter((entry) => entry.outcome === "sent").length;
  const goneIds = outcomes.filter((entry) => entry.outcome === "gone").map((entry) => entry.id);
  const failedCount = outcomes.length - deliveredCount;
  const result = {
    ...base,
    recipientCount: outcomes.length,
    deliveredCount,
    failedCount,
    status: deliveredCount > 0 || failedCount === 0 ? "completed" as const : "failed" as const,
  };

  // Sends already happened: a retry would push twice, so post-send bookkeeping failures are not retried.
  try {
    if (goneIds.length > 0) await deps.store.disableDevices(payload.tenantId, goneIds);
    await deps.store.addDeliveryCounts({
      ...result,
      providerErrorCode: goneIds.length > 0 ? "PUSH_SUBSCRIPTION_GONE" : failedCount > 0 ? "PUSH_PROVIDER_FAILED" : undefined,
    });
  } catch {
    throw new Error("ANNOUNCEMENT_PUSH_REPORT_FAILED");
  }
  return result;
}

export interface VapidEnvironment {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

type SendNotification = typeof webPush.sendNotification;

export function createWebPushSenderFromEnv(
  env: VapidEnvironment = process.env,
  sendNotification: SendNotification = webPush.sendNotification,
): PushSender | undefined {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return undefined;
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) return undefined;

  return {
    async send(subscriptionJson, payload) {
      let subscription: webPush.PushSubscription;
      try {
        subscription = JSON.parse(subscriptionJson) as webPush.PushSubscription;
      } catch {
        return "failed";
      }
      if (!subscription?.endpoint?.startsWith("https://") || !subscription.keys?.p256dh || !subscription.keys?.auth) return "failed";
      try {
        await sendNotification(subscription, payload, {
          TTL: 24 * 60 * 60,
          timeout: 10_000,
          vapidDetails: { subject, publicKey, privateKey },
        });
        return "sent";
      } catch (error) {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        return statusCode === 404 || statusCode === 410 ? "gone" : "failed";
      }
    },
  };
}
