import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type BackupRestoreOperationType = "BACKUP" | "RESTORE_DRILL";
export type BackupRestoreJobStatus = "queued" | "completed" | "failed";

export interface BackupRestoreJobRecord {
  id: string;
  tenantId: string;
  requestedByUserId: string;
  operationType: BackupRestoreOperationType;
  targetReference: string;
  reason?: string;
  queueName: "backup-restore";
  jobId: string;
  status: BackupRestoreJobStatus;
  result?: "PASS";
  checkedTables: string[];
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBackupRestoreJobRecordInput {
  tenantId: string;
  requestedByUserId: string;
  operationType: BackupRestoreOperationType;
  targetReference: string;
  reason?: string;
  jobId: string;
}

export interface BackupRestoreJobStore {
  create(input: CreateBackupRestoreJobRecordInput): Promise<BackupRestoreJobRecord>;
  listByTenant(tenantId: string): Promise<BackupRestoreJobRecord[]>;
}

export const backupRestoreJobStoreToken = Symbol("backupRestoreJobStore");

export function createBackupRestoreJobStore(): BackupRestoreJobStore {
  return resolvePersistenceDriver(process.env.BACKUP_RESTORE_JOB_STORE) === "postgres"
    ? new PostgresBackupRestoreJobStore()
    : new InMemoryBackupRestoreJobStore();
}

class InMemoryBackupRestoreJobStore implements BackupRestoreJobStore {
  private readonly records: BackupRestoreJobRecord[] = [];

  async create(input: CreateBackupRestoreJobRecordInput): Promise<BackupRestoreJobRecord> {
    const now = new Date().toISOString();
    const record: BackupRestoreJobRecord = {
      id: `backup-restore-job-${this.records.length + 1}`,
      tenantId: input.tenantId,
      requestedByUserId: input.requestedByUserId,
      operationType: input.operationType,
      targetReference: input.targetReference,
      reason: input.reason,
      queueName: "backup-restore",
      jobId: input.jobId,
      status: "queued",
      checkedTables: [],
      createdAt: now,
      updatedAt: now,
    };
    this.records.unshift(record);
    return record;
  }

  async listByTenant(tenantId: string): Promise<BackupRestoreJobRecord[]> {
    return this.records.filter((record) => record.tenantId === tenantId);
  }
}

export class PostgresBackupRestoreJobStore implements BackupRestoreJobStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/uzman_hocam",
    }),
  ) {}

  async create(input: CreateBackupRestoreJobRecordInput): Promise<BackupRestoreJobRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<BackupRestoreJobRow>(
        `INSERT INTO "BackupRestoreJob" (
           "id", "tenantId", "requestedByUserId", "operationType", "targetReference", "reason", "queueName", "jobId", "status", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'backup-restore', $7, 'queued', now())
         ON CONFLICT ("tenantId", "jobId") DO UPDATE
         SET "requestedByUserId" = EXCLUDED."requestedByUserId",
             "operationType" = EXCLUDED."operationType",
             "targetReference" = EXCLUDED."targetReference",
             "reason" = EXCLUDED."reason",
             "status" = 'queued',
             "result" = NULL,
             "checkedTables" = ARRAY[]::TEXT[],
             "errorCode" = NULL,
             "updatedAt" = now()
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.requestedByUserId,
          input.operationType,
          input.targetReference,
          input.reason ?? null,
          input.jobId,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("BACKUP_RESTORE_JOB_CREATE_FAILED");
      }
      return toBackupRestoreJobRecord(record);
    });
  }

  async listByTenant(tenantId: string): Promise<BackupRestoreJobRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<BackupRestoreJobRow>(
        `SELECT * FROM "BackupRestoreJob"
         WHERE "tenantId" = $1
         ORDER BY "updatedAt" DESC
         LIMIT 20`,
        [tenantId],
      );
      return result.rows.map(toBackupRestoreJobRecord);
    });
  }
}

interface BackupRestoreJobRow {
  id: string;
  tenantId: string;
  requestedByUserId: string;
  operationType: BackupRestoreOperationType;
  targetReference: string;
  reason: string | null;
  queueName: "backup-restore";
  jobId: string;
  status: BackupRestoreJobStatus;
  result: "PASS" | null;
  checkedTables: string[];
  errorCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toBackupRestoreJobRecord(row: BackupRestoreJobRow): BackupRestoreJobRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    requestedByUserId: row.requestedByUserId,
    operationType: row.operationType,
    targetReference: row.targetReference,
    reason: row.reason ?? undefined,
    queueName: row.queueName,
    jobId: row.jobId,
    status: row.status,
    result: row.result ?? undefined,
    checkedTables: row.checkedTables,
    errorCode: row.errorCode ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
