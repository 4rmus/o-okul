import { createTenantPgPool, type TenantQueryable } from "@o-okul/db";
import { createNotificationAdapterFromEnv, type NotificationAdapter, type NotificationAdapterEnvironment } from "@o-okul/notification-adapter";
import { type QueueJob } from "../queue/queues.js";
import {
  processAnnouncementDeliveryJob,
  type AnnouncementDeliveryJobPayload,
  type AnnouncementDeliveryQueueJobResult,
  type AnnouncementDeliveryReporter,
} from "./announcement-delivery-job.js";
import { createWebPushSenderFromEnv, type AnnouncementPushStore, type PushSender, type VapidEnvironment } from "./announcement-push-delivery.js";
import type { GuardianNotificationStore } from "./guardian-auto-notification.js";
import { PostgresAnnouncementDeliveryReporter } from "./postgres-announcement-delivery-reporter.js";
import { PostgresAnnouncementPushStore } from "./postgres-announcement-push-store.js";
import { PostgresGuardianNotificationStore } from "./postgres-guardian-notification-store.js";

export interface AnnouncementDeliveryProcessorOptions {
  pool?: TenantQueryable;
  reporter?: AnnouncementDeliveryReporter;
  pushStore?: AnnouncementPushStore;
  /** null forces the "VAPID missing" path; undefined reads VAPID_* from env. */
  pushSender?: PushSender | null;
  guardianStore?: GuardianNotificationStore;
  /** KV-8 guardian e-mail; undefined reads NOTIFICATION_* from env on first use. */
  emailAdapter?: NotificationAdapter;
  env?: VapidEnvironment & NotificationAdapterEnvironment;
}

export type AnnouncementDeliveryProcessor = (
  job: QueueJob<AnnouncementDeliveryJobPayload>,
) => Promise<AnnouncementDeliveryQueueJobResult>;

export function createAnnouncementDeliveryProcessor(
  options: AnnouncementDeliveryProcessorOptions = {},
): AnnouncementDeliveryProcessor {
  let pool = options.pool;
  const sharedPool = () => (pool ??= createTenantPgPool());
  const env = options.env ?? process.env;
  const reporter = options.reporter ?? new PostgresAnnouncementDeliveryReporter(sharedPool());
  let pushStore = options.pushStore;
  const sender = options.pushSender === null ? undefined : options.pushSender ?? createWebPushSenderFromEnv(env);
  const push = {
    sender,
    // Lazy so report-only callers (and tests) never open a pool they do not use.
    get store() {
      return (pushStore ??= new PostgresAnnouncementPushStore(sharedPool()));
    },
  };
  let guardianStore = options.guardianStore;
  let emailAdapter: NotificationAdapter | null | undefined = options.emailAdapter;
  const guardian = {
    pushSender: sender,
    get store() {
      return (guardianStore ??= new PostgresGuardianNotificationStore(sharedPool()));
    },
    // Missing/invalid NOTIFICATION_* config skips the e-mail channel fail-closed (push still goes), like missing VAPID.
    get email() {
      if (emailAdapter === undefined) {
        try {
          emailAdapter = createNotificationAdapterFromEnv(env);
        } catch {
          emailAdapter = null;
        }
      }
      return emailAdapter ?? undefined;
    },
  };
  return (job) => processAnnouncementDeliveryJob(job, reporter, push, guardian);
}
