import { createSmsAdapterFromEnv, type SmsAdapter, type SmsAdapterEnvironment } from "@uzman-hocam/sms-adapter";
import { type QueueJob } from "../queue/queues.js";
import { processSmsBatchJob, type SmsBatchJobPayload, type SmsBatchJobResult } from "./sms-batch-job.js";

export interface SmsBatchProcessorOptions {
  adapter?: SmsAdapter;
  env?: SmsAdapterEnvironment;
}

export type SmsBatchProcessor = (
  job: QueueJob<SmsBatchJobPayload>,
) => Promise<SmsBatchJobResult>;

export function createSmsBatchProcessor(
  options: SmsBatchProcessorOptions = {},
): SmsBatchProcessor {
  const adapter = options.adapter ?? createSmsAdapterFromEnv(options.env ?? process.env);

  return (job) => processSmsBatchJob(job, adapter);
}
