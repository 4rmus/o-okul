import { createTenantPgPool, type TenantQueryable } from "@uzman-hocam/db";
import { type QueueJob } from "../queue/queues.js";
import {
  processAnnouncementDeliveryJob,
  type AnnouncementDeliveryJobPayload,
  type AnnouncementDeliveryJobResult,
  type AnnouncementDeliveryReporter,
} from "./announcement-delivery-job.js";
import { PostgresAnnouncementDeliveryReporter } from "./postgres-announcement-delivery-reporter.js";

export interface AnnouncementDeliveryProcessorOptions {
  pool?: TenantQueryable;
  reporter?: AnnouncementDeliveryReporter;
}

export type AnnouncementDeliveryProcessor = (
  job: QueueJob<AnnouncementDeliveryJobPayload>,
) => Promise<AnnouncementDeliveryJobResult>;

export function createAnnouncementDeliveryProcessor(
  options: AnnouncementDeliveryProcessorOptions = {},
): AnnouncementDeliveryProcessor {
  const reporter = options.reporter
    ?? new PostgresAnnouncementDeliveryReporter(options.pool ?? createTenantPgPool());
  return (job) => processAnnouncementDeliveryJob(job, reporter);
}
