import { createTenantPgPool, type TenantQueryable } from "@o-okul/db";
import { type QueueJob } from "../queue/queues.js";
import {
  processBackupRestoreJob,
  type BackupRestoreJobReporter,
  type BackupRestoreJobPayload,
  type BackupRestoreJobResult,
} from "./backup-restore-job.js";
import { PostgresBackupRestoreJobReporter } from "./postgres-backup-restore-job-reporter.js";

export interface BackupRestoreProcessorOptions {
  pool?: TenantQueryable;
  reporter?: BackupRestoreJobReporter;
}

export type BackupRestoreProcessor = (
  job: QueueJob<BackupRestoreJobPayload>,
) => Promise<BackupRestoreJobResult>;

export function createBackupRestoreProcessor(
  options: BackupRestoreProcessorOptions = {},
): BackupRestoreProcessor {
  const reporter = options.reporter ?? new PostgresBackupRestoreJobReporter(options.pool ?? createTenantPgPool());
  return (job) => processBackupRestoreJob(job, reporter);
}
