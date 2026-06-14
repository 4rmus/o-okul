import { lstat, readFile } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
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
const restoreDrillTopLevelKeys = [
  "result",
  "environment",
  "drillDate",
  "sourceBackup",
  "targetDatabase",
  "tableCounts",
  "errors",
] as const;
const tableCountsKeys = [...criticalTables];

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
    await assertBackupTargetReference(payload.targetReference);
    return { checkedTables: [...criticalTables] };
  }

  const url = parseFileUrl(payload.targetReference);
  const report = parseJson(await readRestoreDrillEvidenceFile(url));
  const failures = validateRestoreDrillReport(report);
  if (failures.length > 0) {
    throw new Error(`BACKUP_RESTORE_EVIDENCE_INVALID: ${failures.join("; ")}`);
  }
  return { checkedTables: [...criticalTables] };
}

async function assertBackupTargetReference(targetReference: string): Promise<void> {
  const url = parseBackupTargetUrl(targetReference);
  if (url.protocol === "s3:") {
    const prefix = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.hostname || !prefix) {
      throw new Error("BACKUP_RESTORE_BACKUP_TARGET_URL_REQUIRED");
    }
    return;
  }

  const directoryPath = fileURLToPath(url);
  const resolvedPath = resolve(directoryPath);
  if (isLocalTempOrRootPath(resolvedPath)) {
    throw new Error("BACKUP_RESTORE_BACKUP_TARGET_TEMP_PATH_DISALLOWED");
  }
  await assertBackupDirectoryTargetIfVisible(resolvedPath);
}

function parseBackupTargetUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BACKUP_RESTORE_BACKUP_TARGET_URL_REQUIRED");
  }
  if (url.protocol !== "file:" && url.protocol !== "s3:") {
    throw new Error("BACKUP_RESTORE_BACKUP_TARGET_URL_REQUIRED");
  }
  return url;
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

async function readRestoreDrillEvidenceFile(url: URL): Promise<string> {
  const filePath = fileURLToPath(url);
  await assertEvidenceFilePath(filePath);
  return readFile(filePath, "utf8");
}

async function assertEvidenceFilePath(filePath: string): Promise<void> {
  const resolvedPath = resolve(filePath);
  if (isLocalTempEvidencePath(resolvedPath)) {
    throw new Error("BACKUP_RESTORE_EVIDENCE_FILE_TEMP_PATH_DISALLOWED");
  }

  await assertEvidenceFileParentPath(resolvedPath);

  let stat;
  try {
    stat = await lstat(resolvedPath);
  } catch {
    throw new Error("BACKUP_RESTORE_EVIDENCE_FILE_REQUIRED");
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("BACKUP_RESTORE_EVIDENCE_FILE_SYMLINK_DISALLOWED");
  }
}

async function assertBackupDirectoryTargetIfVisible(directoryPath: string): Promise<void> {
  await assertBackupTargetParentPath(directoryPath);

  let stat;
  try {
    stat = await lstat(directoryPath);
  } catch {
    return;
  }

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("BACKUP_RESTORE_BACKUP_TARGET_SYMLINK_DISALLOWED");
  }
}

async function assertBackupTargetParentPath(directoryPath: string): Promise<void> {
  const root = parse(directoryPath).root;
  const parentPath = dirname(directoryPath);
  const segments = relative(root, parentPath).split(sep).filter(Boolean);
  let currentPath = root;

  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    let stat;
    try {
      stat = await lstat(currentPath);
    } catch {
      return;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("BACKUP_RESTORE_BACKUP_TARGET_PARENT_SYMLINK_DISALLOWED");
    }
  }
}

async function assertEvidenceFileParentPath(filePath: string): Promise<void> {
  const root = parse(filePath).root;
  const parentPath = dirname(filePath);
  const segments = relative(root, parentPath).split(sep).filter(Boolean);
  let currentPath = root;

  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    let stat;
    try {
      stat = await lstat(currentPath);
    } catch {
      throw new Error("BACKUP_RESTORE_EVIDENCE_FILE_REQUIRED");
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("BACKUP_RESTORE_EVIDENCE_FILE_PARENT_SYMLINK_DISALLOWED");
    }
  }
}

function isLocalTempEvidencePath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalizedPath === "/tmp" ||
    normalizedPath.startsWith("/tmp/") ||
    normalizedPath === "/var/tmp" ||
    normalizedPath.startsWith("/var/tmp/")
  );
}

function isLocalTempOrRootPath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\/+$/g, "") || "/";
  return normalizedPath === "/" || isLocalTempEvidencePath(normalizedPath);
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
    return ["restoreDrill nesnesi zorunlu"];
  }
  if (!requireObjectKeySet(report, failures, "restoreDrill", restoreDrillTopLevelKeys)) return failures;

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "drillDate");
  requireDateNotInFuture(report, failures, "drillDate");
  requireString(report, failures, "sourceBackup");
  requireNonPlaceholderString(report, failures, "sourceBackup");
  requireString(report, failures, "targetDatabase");
  requireNonPlaceholderString(report, failures, "targetDatabase");

  const tableCounts = report.tableCounts;
  if (!isObjectRecord(tableCounts)) {
    failures.push("tableCounts nesnesi zorunlu");
  } else if (requireObjectKeySet(tableCounts, failures, "tableCounts", tableCountsKeys)) {
    for (const tableName of criticalTables) {
      requireCount(tableCounts, failures, tableName);
    }
  }

  requireEmptyArray(report, failures, "errors");
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

function requireDateNotInFuture(report: Record<string, unknown>, failures: string[], key: string): void {
  const value = report[key];
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${key} gelecekte olamaz`);
  }
}

function requireString(report: Record<string, unknown>, failures: string[], key: string): void {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} boş olmayan metin olmalı`);
  }
}

function requireNonPlaceholderString(report: Record<string, unknown>, failures: string[], key: string): void {
  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") return;

  if (hasPlaceholderToken(value)) {
    failures.push(`${key} production kanıtı için örnek/placeholder/redacted değer olmamalı`);
  }
}

function requireCount(tableCounts: Record<string, unknown>, failures: string[], key: string): void {
  const value = tableCounts[key];
  if (!Number.isInteger(value) || Number(value) < 1) {
    failures.push(`tableCounts.${key} en az 1 tam sayı olmalı`);
  }
}

function requireEmptyArray(report: Record<string, unknown>, failures: string[], key: string): void {
  const value = report[key];
  if (!Array.isArray(value) || value.length > 0) {
    failures.push(`${key} boş olmalı`);
  }
}

function requireObjectKeySet(
  value: Record<string, unknown>,
  failures: string[],
  label: string,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan içermeli`);
    return false;
  }

  for (const expectedKey of expectedKeys) {
    if (!Object.hasOwn(value, expectedKey)) {
      failures.push(`${label}.${expectedKey} alanı zorunlu`);
    }
  }

  return true;
}

function hasPlaceholderToken(value: string): boolean {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "redacted",
    "example",
    ".test",
    ".invalid",
    "localhost",
    "127.0.0.1",
    "backup-bucket",
  ].some((token) => normalized.includes(token));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
