import { createTenantPgPool } from "@o-okul/db";
import { istanbulDate } from "@o-okul/shared-types";
import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { workerLogger } from "../observability/logging.js";
import type { GuardianNotifyJobPayload } from "./guardian-auto-notification.js";
import { PostgresGuardianNotificationStore } from "./postgres-guardian-notification-store.js";

/**
 * KV-8 payment due reminders (DEC-20261005-04): during business hours the worker scans for PENDING installments due
 * today or in 3 days and enqueues one announcement-delivery job per installment and day. Deterministic jobId plus the
 * PaymentInstallment.notifiedOn claim keep it to one reminder per installment and day, however often the scan runs.
 * ponytail: an in-process timer, not a BullMQ job scheduler; the fresh-reset worker refuses repeatable jobs on tenant
 * queues, and every replica scanning is harmless because the jobId and the claim dedupe.
 */
export interface PaymentDueScanStore {
  listEnabledTenants(): Promise<Array<{ id: string; lifecycleVersion: number }>>;
  listDueInstallmentIds(tenantId: string, day: string): Promise<string[]>;
}

export interface GuardianNotifyQueue {
  add(name: string, data: GuardianNotifyJobPayload, options: JobsOptions): Promise<unknown>;
  close(): Promise<void>;
}

/** 09:00-18:00 Europe/Istanbul, every day: a due date on a weekend still gets its reminder. */
export const guardianNotifyBusinessHours = { start: 9, end: 18 } as const;
export const paymentDueScanIntervalMs = 30 * 60 * 1000;
const scannerUserId = "kv8-payment-due-scanner";
const jobRetentionSeconds = 2 * 24 * 60 * 60;

export function isGuardianNotifyBusinessHour(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= guardianNotifyBusinessHours.start && hour < guardianNotifyBusinessHours.end;
}

/** Same shape as the API's guardianNotifyJobId (apps/api/src/queue/job-producer.ts). */
export function paymentDueJobId(installmentId: string, day: string): string {
  return `guardian-notify_PAYMENT_DUE_${installmentId}_${day}`;
}

export async function scanPaymentDueReminders(store: PaymentDueScanStore, queue: GuardianNotifyQueue, now: Date): Promise<number> {
  if (!isGuardianNotifyBusinessHour(now)) return 0;
  const day = istanbulDate(now);
  let enqueued = 0;
  for (const tenant of await store.listEnabledTenants()) {
    for (const installmentId of await store.listDueInstallmentIds(tenant.id, day)) {
      await queue.add("announcement-delivery", {
        tenantId: tenant.id,
        lifecycleVersion: tenant.lifecycleVersion,
        userId: scannerUserId,
        entityId: installmentId,
        contentHash: day,
        mode: "GUARDIAN_NOTIFY",
        kind: "PAYMENT_DUE",
      }, {
        jobId: paymentDueJobId(installmentId, day),
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: jobRetentionSeconds },
        removeOnFail: { age: jobRetentionSeconds },
      });
      enqueued += 1;
    }
  }
  return enqueued;
}

export function createGuardianPaymentDueScanner(options: {
  connection: ConnectionOptions;
  prefix?: string;
  store?: PaymentDueScanStore;
  queue?: GuardianNotifyQueue;
  intervalMs?: number;
}): { close(): Promise<void> } {
  const store = options.store ?? new PostgresGuardianNotificationStore(createTenantPgPool());
  const queue = options.queue ?? new Queue("announcement-delivery", { connection: options.connection, prefix: options.prefix }) as unknown as GuardianNotifyQueue;
  const intervalMs = options.intervalMs ?? paymentDueScanIntervalMs;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();

  const tick = async () => {
    try {
      const enqueued = await scanPaymentDueReminders(store, queue, new Date());
      if (enqueued > 0) workerLogger.info({ component: "guardian-payment-due-scanner", enqueued }, "guardian_payment_due_scan_completed");
    } catch {
      workerLogger.error({ component: "guardian-payment-due-scanner" }, "guardian_payment_due_scan_failed");
    } finally {
      if (!closed) timer = setTimeout(() => { running = tick(); }, intervalMs);
    }
  };
  running = tick();

  return {
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await running;
      await queue.close();
    },
  };
}
