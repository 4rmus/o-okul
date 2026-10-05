import type { AnnouncementDeliveryChannel, AnnouncementDeliveryStatus } from "@o-okul/shared-types";
import { runWithJobContext } from "../context/job-context.js";
import { assertTenantJobPayload, type QueueJob, type TenantJobPayload } from "../queue/queues.js";
import {
  assertAnnouncementPushSendPayload,
  isAnnouncementPushSendPayload,
  processAnnouncementPushChunk,
  type AnnouncementPushDeps,
  type AnnouncementPushSendJobPayload,
} from "./announcement-push-delivery.js";

export type AnnouncementDeliveryJobPayload = AnnouncementDeliveryReportJobPayload | AnnouncementPushSendJobPayload;

export interface AnnouncementDeliveryReportJobPayload extends TenantJobPayload {
  channel: AnnouncementDeliveryChannel;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  status: Exclude<AnnouncementDeliveryStatus, "queued">;
  providerErrorCode?: string;
}

export interface AnnouncementDeliveryJobResult {
  tenantId: string;
  announcementId: string;
  channel: AnnouncementDeliveryChannel;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  status: Exclude<AnnouncementDeliveryStatus, "queued">;
}

export type AnnouncementDeliveryReportInput = AnnouncementDeliveryJobResult & {
  providerErrorCode?: string;
};

export interface AnnouncementDeliveryReporter {
  upsert(input: AnnouncementDeliveryReportInput): Promise<void>;
}

export async function processAnnouncementDeliveryJob(
  job: QueueJob<AnnouncementDeliveryJobPayload>,
  reporter: AnnouncementDeliveryReporter,
  push?: AnnouncementPushDeps,
): Promise<AnnouncementDeliveryJobResult> {
  if (job.name !== "announcement-delivery") {
    throw new Error("ANNOUNCEMENT_DELIVERY_JOB_NAME_INVALID");
  }
  const payload = job.payload;
  assertTenantJobPayload(payload);
  if (isAnnouncementPushSendPayload(payload)) {
    assertAnnouncementPushSendPayload(payload);
    if (!push) throw new Error("ANNOUNCEMENT_PUSH_DEPS_MISSING");
    return runWithJobContext(
      { tenantId: payload.tenantId, userId: payload.userId, jobId: job.id },
      () => processAnnouncementPushChunk(payload, push),
    );
  }
  assertAnnouncementDeliveryPayload(payload);

  return runWithJobContext(
    {
      tenantId: job.payload.tenantId,
      userId: job.payload.userId,
      jobId: job.id,
    },
    async () => {
      const result: AnnouncementDeliveryJobResult = {
        tenantId: payload.tenantId,
        announcementId: payload.entityId,
        channel: payload.channel,
        recipientCount: payload.recipientCount,
        deliveredCount: payload.deliveredCount,
        failedCount: payload.failedCount,
        status: payload.status,
      };
      await reporter.upsert({
        ...result,
        providerErrorCode: payload.providerErrorCode,
      });
      return result;
    },
  );
}

function assertAnnouncementDeliveryPayload(payload: AnnouncementDeliveryReportJobPayload): void {
  if (payload.channel !== "EMAIL" && payload.channel !== "PUSH") {
    throw new Error("ANNOUNCEMENT_DELIVERY_CHANNEL_INVALID");
  }
  if (payload.status !== "completed" && payload.status !== "failed") {
    throw new Error("ANNOUNCEMENT_DELIVERY_STATUS_INVALID");
  }
  const counts = [payload.recipientCount, payload.deliveredCount, payload.failedCount];
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("ANNOUNCEMENT_DELIVERY_COUNTS_INVALID");
  }
  if (payload.deliveredCount + payload.failedCount > payload.recipientCount) {
    throw new Error("ANNOUNCEMENT_DELIVERY_COUNTS_INVALID");
  }
}
