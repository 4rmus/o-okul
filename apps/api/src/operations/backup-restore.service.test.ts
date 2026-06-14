import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import type { ProducedJob } from "../queue/job-producer.js";
import { BackupRestoreService, type BackupRestoreQueueProducer } from "./backup-restore.service.js";
import { createBackupRestoreJobStore } from "./backup-restore-store.js";

describe("BackupRestoreService", () => {
  it("çift onaylı restore drill isteğini queue job ve audit kaydına çevirir", async () => {
    const producer = new FakeProducer();
    const auditLogs = new FakeAuditLogService();
    const service = new BackupRestoreService(createBackupRestoreJobStore(), producer, auditLogs as unknown as AuditLogService);

    const targetReference = "file:///mnt/restore-drills/staging-drill-2026-06.json";
    const record = await service.enqueue(tenantAdminContext, {
      operationType: "RESTORE_DRILL",
      targetReference,
      confirmationText: "RESTORE DRILL",
      reason: "Aylık restore kanıtı",
    });

    expect(producer.inputs).toEqual([expect.objectContaining({
      queueName: "backup-restore",
      tenantId: "tenant-a",
      userId: "user-a",
      operationType: "RESTORE_DRILL",
      targetReference,
      reason: "Aylık restore kanıtı",
    })]);
    expect(record).toMatchObject({
      tenantId: "tenant-a",
      requestedByUserId: "user-a",
      operationType: "RESTORE_DRILL",
      targetReference,
      queueName: "backup-restore",
      status: "queued",
    });
    expect(auditLogs.records).toEqual([expect.objectContaining({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      entityType: "BackupRestoreJob",
      action: "backup_restore.queued",
      diff: expect.objectContaining({
        operationType: "RESTORE_DRILL",
        targetReference,
      }),
    })]);
    await expect(service.list(tenantAdminContext)).resolves.toEqual([record]);
  });

  it("çift onaylı yedek alma isteğini queue job'a çevirir", async () => {
    const producer = new FakeProducer();
    const service = new BackupRestoreService(createBackupRestoreJobStore(), producer);

    const record = await service.enqueue(tenantAdminContext, {
      operationType: "BACKUP",
      targetReference: "file:///mnt/backups/tenant-a",
      confirmationText: "YEDEK AL",
      reason: "Panelden korumalı yedek alma",
    });

    expect(producer.inputs).toEqual([expect.objectContaining({
      queueName: "backup-restore",
      tenantId: "tenant-a",
      userId: "user-a",
      operationType: "BACKUP",
      targetReference: "file:///mnt/backups/tenant-a",
      reason: "Panelden korumalı yedek alma",
    })]);
    expect(record).toMatchObject({
      tenantId: "tenant-a",
      requestedByUserId: "user-a",
      operationType: "BACKUP",
      targetReference: "file:///mnt/backups/tenant-a",
      queueName: "backup-restore",
      status: "queued",
    });
  });

  it("onay metni yanlışsa job oluşturmaz", async () => {
    const producer = new FakeProducer();
    const service = new BackupRestoreService(createBackupRestoreJobStore(), producer);

    await expect(service.enqueue(tenantAdminContext, {
      operationType: "BACKUP",
      targetReference: "offsite",
      confirmationText: "backup",
    })).rejects.toThrow(BadRequestException);
    expect(producer.inputs).toHaveLength(0);
  });

  it("restore drill hedefi file URL değilse job oluşturmaz", async () => {
    const producer = new FakeProducer();
    const service = new BackupRestoreService(createBackupRestoreJobStore(), producer);

    await expect(service.enqueue(tenantAdminContext, {
      operationType: "RESTORE_DRILL",
      targetReference: "staging-drill-2026-06",
      confirmationText: "RESTORE DRILL",
    })).rejects.toThrow(BadRequestException);
    expect(producer.inputs).toHaveLength(0);
  });

  it("restore drill hedefi lokal temp file URL ise job oluşturmaz", async () => {
    const producer = new FakeProducer();
    const service = new BackupRestoreService(createBackupRestoreJobStore(), producer);

    await expect(service.enqueue(tenantAdminContext, {
      operationType: "RESTORE_DRILL",
      targetReference: "file:///tmp/staging-drill-2026-06.json",
      confirmationText: "RESTORE DRILL",
    })).rejects.toThrow("BACKUP_RESTORE_EVIDENCE_FILE_TEMP_PATH_DISALLOWED");
    expect(producer.inputs).toHaveLength(0);
  });

  it("tenant context yoksa job listelemez veya oluşturmaz", async () => {
    const producer = new FakeProducer();
    const service = new BackupRestoreService(createBackupRestoreJobStore(), producer);

    await expect(service.list(systemContext)).rejects.toThrow(ForbiddenException);
    await expect(service.enqueue(systemContext, {
      operationType: "RESTORE_DRILL",
      targetReference: "staging",
      confirmationText: "RESTORE DRILL",
    })).rejects.toThrow(ForbiddenException);
    expect(producer.inputs).toHaveLength(0);
  });
});

const tenantAdminContext: RequestContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};

const systemContext: RequestContext = {
  tenantId: null,
  userId: "system-a",
  roles: ["SYSTEM_ADMIN"],
  bypassRls: true,
};

class FakeProducer implements BackupRestoreQueueProducer {
  inputs: Parameters<BackupRestoreQueueProducer["enqueue"]>[0][] = [];

  async enqueue(input: Parameters<BackupRestoreQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
    this.inputs.push(input);
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload: input,
      options: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        jobId: `${input.entityId}_${input.contentHash}`,
        removeOnFail: false,
      },
    } as ProducedJob;
  }
}

class FakeAuditLogService {
  records: CreateAuditLogInput[] = [];

  async record(input: CreateAuditLogInput) {
    this.records.push(input);
    return { id: "audit-a", createdAt: "2026-06-06T09:00:00.000Z", ...input };
  }
}
