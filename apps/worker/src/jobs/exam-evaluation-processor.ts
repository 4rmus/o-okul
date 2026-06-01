import { createTenantPgPool, type TenantQueryable } from "@uzman-hocam/db";
import { type QueueJob } from "../queue/queues.js";
import {
  type ExamEvaluationJobPayload,
  type ExamEvaluationJobResult,
  processExamEvaluationJob,
} from "./exam-evaluation-job.js";
import { PostgresExamEvaluationAdapter } from "./postgres-exam-evaluation-adapter.js";

export interface ExamEvaluationProcessorOptions {
  pool?: TenantQueryable;
  now?: () => string;
}

export type ExamEvaluationProcessor = (
  job: QueueJob<ExamEvaluationJobPayload>,
) => Promise<ExamEvaluationJobResult>;

export function createExamEvaluationProcessor(
  options: ExamEvaluationProcessorOptions = {},
): ExamEvaluationProcessor {
  const adapter = new PostgresExamEvaluationAdapter(
    options.pool ?? createTenantPgPool(),
    options.now,
  );

  return (job) => processExamEvaluationJob(job, adapter);
}
