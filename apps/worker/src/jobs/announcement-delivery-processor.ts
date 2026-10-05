import { createTenantPgPool, type TenantQueryable } from "@o-okul/db";
import { type QueueJob } from "../queue/queues.js";
import {
  processAnnouncementDeliveryJob,
  type AnnouncementDeliveryJobPayload,
  type AnnouncementDeliveryJobResult,
  type AnnouncementDeliveryReporter,
} from "./announcement-delivery-job.js";
import { createWebPushSenderFromEnv, type AnnouncementPushStore, type PushSender, type VapidEnvironment } from "./announcement-push-delivery.js";
import { PostgresAnnouncementDeliveryReporter } from "./postgres-announcement-delivery-reporter.js";
import { PostgresAnnouncementPushStore } from "./postgres-announcement-push-store.js";

export interface AnnouncementDeliveryProcessorOptions {
  pool?: TenantQueryable;
  reporter?: AnnouncementDeliveryReporter;
  pushStore?: AnnouncementPushStore;
  /** null forces the "VAPID missing" path; undefined reads VAPID_* from env. */
  pushSender?: PushSender | null;
  env?: VapidEnvironment;
}

export type AnnouncementDeliveryProcessor = (
  job: QueueJob<AnnouncementDeliveryJobPayload>,
) => Promise<AnnouncementDeliveryJobResult>;

export function createAnnouncementDeliveryProcessor(
  options: AnnouncementDeliveryProcessorOptions = {},
): AnnouncementDeliveryProcessor {
  let pool = options.pool;
  const sharedPool = () => (pool ??= createTenantPgPool());
  const reporter = options.reporter ?? new PostgresAnnouncementDeliveryReporter(sharedPool());
  let pushStore = options.pushStore;
  const push = {
    sender: options.pushSender === null ? undefined : options.pushSender ?? createWebPushSenderFromEnv(options.env ?? process.env),
    // Lazy so report-only callers (and tests) never open a pool they do not use.
    get store() {
      return (pushStore ??= new PostgresAnnouncementPushStore(sharedPool()));
    },
  };
  return (job) => processAnnouncementDeliveryJob(job, reporter, push);
}
