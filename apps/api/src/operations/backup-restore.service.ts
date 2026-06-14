import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import type { ProducedJob, TenantQueueJobInput } from "../queue/job-producer.js";
import {
  backupRestoreJobStoreToken,
  type BackupRestoreJobRecord,
  type BackupRestoreJobStore,
  type BackupRestoreOperationType,
} from "./backup-restore-store.js";

export const backupRestoreQueueProducerToken = Symbol("backupRestoreQueueProducer");

export interface BackupRestoreQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export interface CreateBackupRestoreJobInput {
  confirmationText?: string;
  operationType?: string;
  reason?: string;
  targetReference?: string;
}

@Injectable()
export class BackupRestoreService {
  constructor(
    @Inject(backupRestoreJobStoreToken)
    private readonly store: BackupRestoreJobStore,
    @Inject(backupRestoreQueueProducerToken)
    private readonly producer: BackupRestoreQueueProducer,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async list(context: RequestContext): Promise<BackupRestoreJobRecord[]> {
    if (!context.tenantId || context.bypassRls) {
      throw new ForbiddenException("TENANT_CONTEXT_REQUIRED");
    }
    return this.store.listByTenant(context.tenantId);
  }

  async enqueue(
    context: RequestContext,
    input: CreateBackupRestoreJobInput,
    idempotencyKey?: string,
  ): Promise<BackupRestoreJobRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "backup-restore.enqueue", request: input },
        () => this.enqueueJob(context, input),
      );
    }

    return this.enqueueJob(context, input);
  }

  private async enqueueJob(
    context: RequestContext,
    input: CreateBackupRestoreJobInput,
  ): Promise<BackupRestoreJobRecord> {
    if (!context.tenantId || context.bypassRls) {
      throw new ForbiddenException("TENANT_CONTEXT_REQUIRED");
    }

    const operationType = parseOperationType(input.operationType);
    const targetReference = required(input.targetReference, "BACKUP_RESTORE_TARGET_REQUIRED");
    assertTargetReference(operationType, targetReference);
    const expectedConfirmation = confirmationFor(operationType);
    if (input.confirmationText !== expectedConfirmation) {
      throw new BadRequestException("BACKUP_RESTORE_CONFIRMATION_REQUIRED");
    }

    const entityId = `backup-restore-${Date.now()}`;
    const contentHash = createContentHash({
      operationType,
      reason: input.reason,
      targetReference,
      tenantId: context.tenantId,
      userId: context.userId,
    });
    const job = await this.producer.enqueue({
      queueName: "backup-restore",
      tenantId: context.tenantId,
      userId: context.userId,
      entityId,
      contentHash,
      operationType,
      targetReference,
      reason: input.reason,
    });
    const record = await this.store.create({
      tenantId: context.tenantId,
      requestedByUserId: context.userId,
      operationType,
      targetReference,
      reason: input.reason,
      jobId: job.options.jobId,
    });

    await this.auditLogs?.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      entityType: "BackupRestoreJob",
      entityId: record.id,
      action: "backup_restore.queued",
      diff: {
        operationType,
        targetReference,
        reason: input.reason,
        jobId: job.options.jobId,
      },
    });

    return record;
  }
}

function parseOperationType(value: string | undefined): BackupRestoreOperationType {
  if (value === "BACKUP" || value === "RESTORE_DRILL") return value;
  throw new BadRequestException("BACKUP_RESTORE_OPERATION_UNSUPPORTED");
}

function confirmationFor(operationType: BackupRestoreOperationType): string {
  return operationType === "BACKUP" ? "YEDEK AL" : "RESTORE DRILL";
}

function assertTargetReference(operationType: BackupRestoreOperationType, targetReference: string): void {
  if (operationType === "BACKUP") return;
  let url: URL;
  try {
    url = new URL(targetReference);
  } catch {
    throw new BadRequestException("BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED");
  }
  if (url.protocol !== "file:") {
    throw new BadRequestException("BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED");
  }

  let filePath: string;
  try {
    filePath = fileURLToPath(url);
  } catch {
    throw new BadRequestException("BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED");
  }
  if (isLocalTempEvidencePath(filePath)) {
    throw new BadRequestException("BACKUP_RESTORE_EVIDENCE_FILE_TEMP_PATH_DISALLOWED");
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

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function createContentHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
}
