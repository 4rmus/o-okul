import { createTenantPgPool, type TenantQueryable } from "@uzman-hocam/db";
import { type QueueJob } from "../queue/queues.js";
import { PostgresReportGenerationAdapter } from "./postgres-report-generation-adapter.js";
import {
  type ReportGenerationJobPayload,
  type ReportGenerationJobResult,
  processReportGenerationJob,
} from "./report-generation-job.js";

export interface ReportGenerationProcessorOptions {
  pool?: TenantQueryable;
  now?: () => string;
}

export type ReportGenerationProcessor = (
  job: QueueJob<ReportGenerationJobPayload>,
) => Promise<ReportGenerationJobResult>;

export function createReportGenerationProcessor(
  options: ReportGenerationProcessorOptions = {},
): ReportGenerationProcessor {
  const adapter = new PostgresReportGenerationAdapter(options.pool ?? createTenantPgPool());

  return (job) => processReportGenerationJob(job, adapter, options.now);
}
