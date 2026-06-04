import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runWithJobContext } from "../context/job-context.js";
import { assertTenantJobPayload, type QueueJob, type TenantJobPayload } from "../queue/queues.js";

export type BackupRestoreOperationType = "BACKUP" | "RESTORE_DRILL";

export interface BackupRestoreJobPayload extends TenantJobPayload {
  operationType: BackupRestoreOperationType;
  targetReference: string;
  reason?: string;
}

export interface BackupRestoreJobResult {
  tenantId: string;
  jobId: string;
  operationType: BackupRestoreOperationType;
  targetReference: string;
  result: "PASS";
  status: "completed";
  checkedTables: string[];
  reason?: string;
}

export interface BackupRestoreJobFailedInput {
  tenantId: string;
  jobId: string;
  operationType: BackupRestoreOperationType;
  targetReference: string;
  errorCode: string;
  reason?: string;
}

export interface BackupRestoreJobReporter {
  markCompleted(input: BackupRestoreJobResult): Promise<void>;
  markFailed(input: BackupRestoreJobFailedInput): Promise<void>;
}

const criticalTables = ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"] as const;

export async function processBackupRestoreJob(
  job: QueueJob<BackupRestoreJobPayload>,
  reporter?: BackupRestoreJobReporter,
): Promise<BackupRestoreJobResult> {
  if (job.name !== "backup-restore") {
    throw new Error("BACKUP_RESTORE_JOB_NAME_INVALID");
  }
  assertTenantJobPayload(job.payload);
  assertBackupRestorePayload(job.payload);

  return runWithJobContext(
    {
      tenantId: job.payload.tenantId,
      userId: job.payload.userId,
      jobId: job.id,
    },
    async () => {
      try {
        const evidence = await resolveEvidence(job.payload);
        const result: BackupRestoreJobResult = {
          tenantId: job.payload.tenantId,
          jobId: job.id,
          operationType: job.payload.operationType,
          targetReference: job.payload.targetReference,
          reason: job.payload.reason,
          result: "PASS",
          status: "completed",
          checkedTables: evidence.checkedTables,
        };
        await reporter?.markCompleted(result);
        return result;
      } catch (error) {
        await reporter?.markFailed({
          tenantId: job.payload.tenantId,
          jobId: job.id,
          operationType: job.payload.operationType,
          targetReference: job.payload.targetReference,
          reason: job.payload.reason,
          errorCode: resolveErrorCode(error),
        });
        throw error;
      }
    },
  );
}

function assertBackupRestorePayload(payload: BackupRestoreJobPayload): void {
  if (payload.operationType !== "BACKUP" && payload.operationType !== "RESTORE_DRILL") {
    throw new Error("BACKUP_RESTORE_OPERATION_INVALID");
  }
  if (!payload.targetReference.trim()) {
    throw new Error("BACKUP_RESTORE_TARGET_REQUIRED");
  }
}

async function resolveEvidence(payload: BackupRestoreJobPayload): Promise<{ checkedTables: string[] }> {
  if (payload.operationType === "BACKUP") {
    return { checkedTables: [...criticalTables] };
  }

  const url = parseFileUrl(payload.targetReference);
  const report = parseJson(await readFile(fileURLToPath(url), "utf8"));
  const failures = validateRestoreDrillReport(report);
  if (failures.length > 0) {
    throw new Error(`BACKUP_RESTORE_EVIDENCE_INVALID: ${failures.join("; ")}`);
  }
  return { checkedTables: [...criticalTables] };
}

function parseFileUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED");
  }
  if (url.protocol !== "file:") {
    throw new Error("BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED");
  }
  return url;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("BACKUP_RESTORE_EVIDENCE_JSON_INVALID");
  }
}

function resolveErrorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "BACKUP_RESTORE_FAILED";
}

function validateRestoreDrillReport(report: unknown): string[] {
  const failures: string[] = [];
  if (!isObjectRecord(report)) {
    return ["report nesnesi zorunlu"];
  }
  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "drillDate");
  requireString(report, failures, "sourceBackup");
  requireString(report, failures, "targetDatabase");

  const tableCounts = report.tableCounts;
  if (!isObjectRecord(tableCounts)) {
    failures.push("tableCounts nesnesi zorunlu");
  } else {
    for (const tableName of criticalTables) {
      requireCount(tableCounts, failures, tableName);
    }
  }

  if (Array.isArray(report.errors) && report.errors.length > 0) {
    failures.push("errors boş olmalı");
  }
  return failures;
}

function requireEqual(report: Record<string, unknown>, failures: string[], key: string, expected: string): void {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmalı`);
  }
}

function requireOneOf(report: Record<string, unknown>, failures: string[], key: string, expectedValues: string[]): void {
  if (!expectedValues.includes(String(report[key]))) {
    failures.push(`${key} ${expectedValues.join(" veya ")} olmalı`);
  }
}

function requireDate(report: Record<string, unknown>, failures: string[], key: string): void {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} geçerli tarih olmalı`);
  }
}

function requireString(report: Record<string, unknown>, failures: string[], key: string): void {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} boş olmayan metin olmalı`);
  }
}

function requireCount(tableCounts: Record<string, unknown>, failures: string[], key: string): void {
  const value = tableCounts[key];
  if (!Number.isInteger(value) || Number(value) < 0) {
    failures.push(`tableCounts.${key} sıfır veya daha büyük tam sayı olmalı`);
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
