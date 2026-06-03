import { createSmsAdapterFromEnv, type SmsAdapter, type SmsAdapterEnvironment } from "@uzman-hocam/sms-adapter";
import { createTenantPgPool, type TenantQueryable } from "@uzman-hocam/db";
import { type QueueJob } from "../queue/queues.js";
import { PostgresSmsBatchDeliveryReporter } from "./postgres-sms-batch-delivery-reporter.js";
import {
  processSmsBatchJob,
  type SmsBatchDeliveryReporter,
  type SmsBatchJobPayload,
  type SmsBatchJobResult,
} from "./sms-batch-job.js";

export interface SmsBatchProcessorOptions {
  adapter?: SmsAdapter;
  deliveryReporter?: SmsBatchDeliveryReporter;
  env?: SmsAdapterEnvironment;
  pool?: TenantQueryable;
}

export type SmsBatchProcessor = (
  job: QueueJob<SmsBatchJobPayload>,
) => Promise<SmsBatchJobResult>;

export function createSmsBatchProcessor(
  options: SmsBatchProcessorOptions = {},
): SmsBatchProcessor {
  const adapter = options.adapter ?? createSmsAdapterFromEnv(options.env ?? process.env);
  const deliveryReporter = options.deliveryReporter
    ?? new PostgresSmsBatchDeliveryReporter(options.pool ?? createTenantPgPool());

  return (job) => processSmsBatchJob(job, adapter, deliveryReporter);
}
