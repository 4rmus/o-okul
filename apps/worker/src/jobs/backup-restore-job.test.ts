import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { processBackupRestoreJob } from "./backup-restore-job.js";

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
        targetReference: "file:///mnt/backups/tenant-a",
        reason: "Panelden korumalı yedek alma",
      },
    })).resolves.toEqual({
      tenantId: "tenant-a",
      jobId: "backup-restore-a_hash-a",
      operationType: "BACKUP",
      targetReference: "file:///mnt/backups/tenant-a",
      reason: "Panelden korumalı yedek alma",
      result: "PASS",
      status: "completed",
      checkedTables: ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"],
    });
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

async function createRestoreDrillEvidence(): Promise<string> {
  const filePath = join(tmpdir(), `restore-drill-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(filePath, JSON.stringify({
    result: "PASS",
    environment: "staging",
    drillDate: "2026-05-30",
    sourceBackup: "s3://backup-bucket/base/2026-05-30.dump",
    targetDatabase: "uzman_hocam_restore_20260530",
    tableCounts: {
      Tenant: 5,
      AuditLog: 0,
      ReportSnapshot: 7,
      _prisma_migrations: 13,
    },
    errors: [],
  }));
  return pathToFileURL(filePath).toString();
}
