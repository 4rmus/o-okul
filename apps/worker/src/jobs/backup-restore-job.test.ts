import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { processBackupRestoreJob } from "./backup-restore-job.js";

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("processBackupRestoreJob", () => {
  it("backup payload'ını denetlenebilir sonuca çevirir", async () => {
    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "BACKUP",
        targetReference: "s3://o-okul-prod-backups/tenant-a",
        reason: "Panelden korumalı yedek alma",
      },
    })).resolves.toEqual({
      tenantId: "tenant-a",
      jobId: "backup-restore-a_hash-a",
      operationType: "BACKUP",
      targetReference: "s3://o-okul-prod-backups/tenant-a",
      reason: "Panelden korumalı yedek alma",
      result: "PASS",
      status: "completed",
      checkedTables: ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"],
    });
  });

  it("backup hedefi off-host URL değilse işi başlatmaz", async () => {
    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "BACKUP",
        targetReference: "offsite-backup",
      },
    })).rejects.toThrow("BACKUP_RESTORE_BACKUP_TARGET_URL_REQUIRED");
  });

  it("backup hedefi lokal temp/root path ise işi başlatmaz", async () => {
    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "BACKUP",
        targetReference: "file:///tmp/tenant-a-backups",
      },
    })).rejects.toThrow("BACKUP_RESTORE_BACKUP_TARGET_TEMP_PATH_DISALLOWED");
  });

  it("backup hedefi symlink dizin ise işi başlatmaz", async () => {
    const directory = await createTestDirectory();
    const realDirectory = join(directory, "real-backups");
    const linkDirectory = join(directory, "linked-backups");
    await mkdir(realDirectory, { recursive: true });
    await symlink(realDirectory, linkDirectory, "dir");

    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "BACKUP",
        targetReference: pathToFileURL(linkDirectory).toString(),
      },
    })).rejects.toThrow("BACKUP_RESTORE_BACKUP_TARGET_SYMLINK_DISALLOWED");
  });

  it("backup hedefi symlink parent altında ise işi başlatmaz", async () => {
    const directory = await createTestDirectory();
    const realDirectory = join(directory, "real");
    const realNestedDirectory = join(realDirectory, "nested-backups");
    const linkDirectory = join(directory, "linked");
    await mkdir(realNestedDirectory, { recursive: true });
    await symlink(realDirectory, linkDirectory, "dir");

    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "BACKUP",
        targetReference: pathToFileURL(join(linkDirectory, "nested-backups")).toString(),
      },
    })).rejects.toThrow("BACKUP_RESTORE_BACKUP_TARGET_PARENT_SYMLINK_DISALLOWED");
  });

  it("restore drill payload'ını denetlenebilir sonuca çevirir", async () => {
    const evidenceUrl = await createRestoreDrillEvidence();

    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "RESTORE_DRILL",
        targetReference: evidenceUrl,
        reason: "Aylık restore kanıtı",
      },
    })).resolves.toEqual({
      tenantId: "tenant-a",
      jobId: "backup-restore-a_hash-a",
      operationType: "RESTORE_DRILL",
      targetReference: evidenceUrl,
      reason: "Aylık restore kanıtı",
      result: "PASS",
      status: "completed",
      checkedTables: ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"],
    });
  });

  it("restore drill kanıtı file URL değilse işi başlatmaz", async () => {
    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "RESTORE_DRILL",
        targetReference: "staging-drill-2026-06",
      },
    })).rejects.toThrow("BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED");
  });

  it("restore drill kanıtı lokal temp path ise işi başlatmaz", async () => {
    const filePath = join(tmpdir(), `restore-drill-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await writeRestoreDrillEvidence(filePath);

    try {
      await expect(processBackupRestoreJob({
        id: "backup-restore-a_hash-a",
        name: "backup-restore",
        payload: {
          tenantId: "tenant-a",
          userId: "user-a",
          entityId: "backup-restore-a",
          contentHash: "hash-a",
          operationType: "RESTORE_DRILL",
          targetReference: pathToFileURL(filePath).toString(),
        },
      })).rejects.toThrow("BACKUP_RESTORE_EVIDENCE_FILE_TEMP_PATH_DISALLOWED");
    } finally {
      await rm(filePath, { force: true });
    }
  });

  it("restore drill kanıtı symlink dosya ise işi başlatmaz", async () => {
    const directory = await createTestDirectory();
    const filePath = join(directory, "restore-drill.json");
    const linkPath = join(directory, "restore-drill-link.json");
    await writeRestoreDrillEvidence(filePath);
    await symlink(filePath, linkPath);

    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "RESTORE_DRILL",
        targetReference: pathToFileURL(linkPath).toString(),
      },
    })).rejects.toThrow("BACKUP_RESTORE_EVIDENCE_FILE_SYMLINK_DISALLOWED");
  });

  it("restore drill kanıtı symlink parent altında ise işi başlatmaz", async () => {
    const directory = await createTestDirectory();
    const realDirectory = join(directory, "real");
    const realNestedDirectory = join(realDirectory, "nested");
    const linkDirectory = join(directory, "linked");
    await mkdir(realNestedDirectory, { recursive: true });
    await symlink(realDirectory, linkDirectory, "dir");
    await writeRestoreDrillEvidence(join(realNestedDirectory, "restore-drill.json"));

    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "RESTORE_DRILL",
        targetReference: pathToFileURL(join(linkDirectory, "nested", "restore-drill.json")).toString(),
      },
    })).rejects.toThrow("BACKUP_RESTORE_EVIDENCE_FILE_PARENT_SYMLINK_DISALLOWED");
  });

  it("restore drill kanıtında kritik tablo sayısı sıfırsa işi başlatmaz", async () => {
    const evidenceUrl = await createRestoreDrillEvidence({ AuditLog: 0 });

    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "RESTORE_DRILL",
        targetReference: evidenceUrl,
      },
    })).rejects.toThrow("BACKUP_RESTORE_EVIDENCE_INVALID");
  });

  it("hedef referansı boşsa işi başlatmaz", async () => {
    await expect(processBackupRestoreJob({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "BACKUP",
        targetReference: "",
      },
    })).rejects.toThrow("BACKUP_RESTORE_TARGET_REQUIRED");
  });
});

async function createRestoreDrillEvidence(tableCounts: Partial<Record<"Tenant" | "AuditLog" | "ReportSnapshot" | "_prisma_migrations", number>> = {}): Promise<string> {
  const directory = await createTestDirectory();
  const filePath = join(directory, "restore-drill.json");
  await writeRestoreDrillEvidence(filePath, tableCounts);
  return pathToFileURL(filePath).toString();
}

async function writeRestoreDrillEvidence(
  filePath: string,
  tableCounts: Partial<Record<"Tenant" | "AuditLog" | "ReportSnapshot" | "_prisma_migrations", number>> = {},
): Promise<void> {
  await writeFile(filePath, JSON.stringify({
    result: "PASS",
    environment: "staging",
    drillDate: "2026-05-30",
    sourceBackup: "s3://o-okul-prod-backups/base/2026-05-30.dump",
    targetDatabase: "o_okul_restore_20260530",
    tableCounts: {
      Tenant: 5,
      AuditLog: 3,
      ReportSnapshot: 7,
      _prisma_migrations: 13,
      ...tableCounts,
    },
    errors: [],
  }));
}

async function createTestDirectory(): Promise<string> {
  const root = join(process.cwd(), "artifacts", "worker-backup-restore-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "case-"));
  testDirectories.push(directory);
  return directory;
}
