import { type Queryable, type TenantQueryable, withTenantDb } from "@o-okul/db";
import type { BackupRestoreJobFailedInput, BackupRestoreJobReporter, BackupRestoreJobResult } from "./backup-restore-job.js";

export class PostgresBackupRestoreJobReporter implements BackupRestoreJobReporter {
  constructor(private readonly pool: TenantQueryable) {}

  async markCompleted(input: BackupRestoreJobResult): Promise<void> {
    await withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE "BackupRestoreJob"
         SET "status" = 'completed',
             "result" = $3,
             "targetReference" = $4,
             "reason" = $5,
             "checkedTables" = $6,
             "errorCode" = NULL,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "jobId" = $2
         RETURNING "id"`,
        [
          input.tenantId,
          input.jobId,
          input.result,
          input.targetReference,
          input.reason ?? null,
          input.checkedTables,
        ],
      );
      if (!result.rows[0]) {
        throw new Error("BACKUP_RESTORE_JOB_NOT_FOUND");
      }
    });
  }

  async markFailed(input: BackupRestoreJobFailedInput): Promise<void> {
    await withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE "BackupRestoreJob"
         SET "status" = 'failed',
             "result" = NULL,
             "targetReference" = $3,
             "reason" = $4,
             "checkedTables" = ARRAY[]::TEXT[],
             "errorCode" = $5,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "jobId" = $2
         RETURNING "id"`,
        [
          input.tenantId,
          input.jobId,
          input.targetReference,
          input.reason ?? null,
          input.errorCode,
        ],
      );
      if (!result.rows[0]) {
        throw new Error("BACKUP_RESTORE_JOB_NOT_FOUND");
      }
    });
  }
}
