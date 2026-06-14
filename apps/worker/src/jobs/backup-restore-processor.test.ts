import { describe, expect, it } from "vitest";
import type { BackupRestoreJobFailedInput, BackupRestoreJobReporter, BackupRestoreJobResult } from "./backup-restore-job.js";
import { createBackupRestoreProcessor } from "./backup-restore-processor.js";

describe("createBackupRestoreProcessor", () => {
  it("backup-restore job'unu process eder", async () => {
    const reporter = new FakeBackupRestoreJobReporter();
    const processor = createBackupRestoreProcessor({ reporter });

    const result = await processor({
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "hash-a",
        operationType: "BACKUP",
        targetReference: "s3://uzman-hocam-prod-backups/tenant-a",
      },
    });

    expect(result).toMatchObject({
      tenantId: "tenant-a",
      operationType: "BACKUP",
      targetReference: "s3://uzman-hocam-prod-backups/tenant-a",
      status: "completed",
    });
    expect(reporter.completed).toEqual([result]);
  });

  it("backup-restore hatasını reporter'a failed olarak yazar", async () => {
    const reporter = new FakeBackupRestoreJobReporter();
    const processor = createBackupRestoreProcessor({ reporter });

    await expect(processor({
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

    expect(reporter.failed).toEqual([{
      tenantId: "tenant-a",
      jobId: "backup-restore-a_hash-a",
      operationType: "RESTORE_DRILL",
      targetReference: "staging-drill-2026-06",
      errorCode: "BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED",
    }]);
  });
});

class FakeBackupRestoreJobReporter implements BackupRestoreJobReporter {
  completed: BackupRestoreJobResult[] = [];
  failed: BackupRestoreJobFailedInput[] = [];

  async markCompleted(input: BackupRestoreJobResult): Promise<void> {
    this.completed.push(input);
  }

  async markFailed(input: BackupRestoreJobFailedInput): Promise<void> {
    this.failed.push(input);
  }
}
