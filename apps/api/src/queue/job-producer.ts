import { fileURLToPath } from "node:url";

export type TenantQueueName =
  | "announcement-delivery"
  | "backup-restore"
  | "exam-evaluation"
  | "excel-import"
  | "report-generation"
  | "sms-batch";

interface BaseTenantQueueJobInput {
  queueName: TenantQueueName;
  tenantId: string;
  lifecycleVersion?: number;
  userId: string;
  entityId: string;
  contentHash: string;
}

export interface ExamEvaluationQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "exam-evaluation";
  participantId: string;
  rawImportId: string;
  answerKeyId: string;
}

export interface ReportGenerationQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "report-generation";
  reportType: "EXAM_RESULT_SUMMARY";
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
}

export interface SmsBatchQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "sms-batch";
  templateId: string;
  messageBody: string;
  recipients: Array<{ to: string }>;
}

export interface AnnouncementDeliveryReportQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "announcement-delivery";
  channel: "EMAIL" | "PUSH";
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  status: "completed" | "failed";
  providerErrorCode?: string;
}

/** Worker sends web push to these devices; payload carries only the title, never body or PII. */
export interface AnnouncementPushSendQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "announcement-delivery";
  channel: "PUSH";
  mode: "PUSH_SEND";
  /** Per send request (hash of its Idempotency-Key): a new send reaches new devices, a retried send dedupes. */
  sendKey: string;
  chunkIndex: number;
  deviceIds: string[];
  title: string;
}

export type AnnouncementDeliveryQueueJobInput = AnnouncementDeliveryReportQueueJobInput | AnnouncementPushSendQueueJobInput;

export const announcementPushChunkSize = 25;

export function chunkAnnouncementPushDevices(deviceIds: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < deviceIds.length; index += announcementPushChunkSize) {
    chunks.push(deviceIds.slice(index, index + announcementPushChunkSize));
  }
  return chunks;
}

// ponytail: BullMQ rejects custom ids containing ":" (beyond 3 parts), so the
// sourceType:sourceId:channel:sendKey:chunkIndex key uses "_" as separator.
export function announcementPushJobId(announcementId: string, sendKey: string, chunkIndex: number): string {
  return `announcement_${announcementId}_PUSH_${sendKey}_${chunkIndex}`;
}

/** Dedupe window for push sends: a retried send within this window is a BullMQ no-op. */
export const announcementPushJobRetentionSeconds = 30 * 24 * 60 * 60;

const announcementPushSendKeyPattern = /^[a-f0-9]{16,64}$/;

export interface BackupRestoreQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "backup-restore";
  operationType: "BACKUP" | "RESTORE_DRILL";
  targetReference: string;
  reason?: string;
}

export type TenantQueueJobInput =
  | AnnouncementDeliveryQueueJobInput
  | BackupRestoreQueueJobInput
  | ExamEvaluationQueueJobInput
  | ReportGenerationQueueJobInput
  | SmsBatchQueueJobInput
  | (BaseTenantQueueJobInput & {
      queueName: Exclude<TenantQueueName, "announcement-delivery" | "backup-restore" | "exam-evaluation" | "report-generation" | "sms-batch">;
    });

export interface ProducedJob<TInput extends TenantQueueJobInput = TenantQueueJobInput> {
  queueName: TInput["queueName"];
  name: TInput["queueName"];
  payload: Omit<TInput, "queueName">;
  options: {
    attempts: 5;
    backoff: {
      type: "exponential";
      delay: 1000;
    };
    jobId: string;
    removeOnFail: false | { age: number };
    removeOnComplete?: true | { age: number };
  };
}

export function createTenantQueueJob(input: TenantQueueJobInput): ProducedJob {
  if (!input.tenantId || !input.userId || !input.entityId || !input.contentHash) {
    throw new Error("TENANT_JOB_PAYLOAD_INVALID");
  }
  if (
    input.queueName === "exam-evaluation" &&
    (!input.participantId || !input.rawImportId || !input.answerKeyId)
  ) {
    throw new Error("EXAM_EVALUATION_JOB_PAYLOAD_INVALID");
  }
  if (input.queueName === "report-generation" && input.reportType !== "EXAM_RESULT_SUMMARY") {
    throw new Error("REPORT_GENERATION_JOB_PAYLOAD_INVALID");
  }
  if (
    input.queueName === "sms-batch" &&
    (!input.templateId || !input.messageBody || input.recipients.length === 0)
  ) {
    throw new Error("SMS_BATCH_JOB_PAYLOAD_INVALID");
  }
  if (input.queueName === "announcement-delivery" && !isAnnouncementDeliveryInputValid(input)) {
    throw new Error("ANNOUNCEMENT_DELIVERY_JOB_PAYLOAD_INVALID");
  }
  if (input.queueName === "backup-restore" && !isBackupRestoreInputValid(input)) {
    throw new Error("BACKUP_RESTORE_JOB_PAYLOAD_INVALID");
  }

  if (input.queueName === "announcement-delivery" && "mode" in input) {
    // Push jobs are kept for 30 days so re-adding the same send's chunk jobId is a BullMQ no-op (no second send).
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload: createPayload(input),
      options: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        jobId: announcementPushJobId(input.entityId, input.sendKey, input.chunkIndex),
        removeOnFail: { age: announcementPushJobRetentionSeconds },
        removeOnComplete: { age: announcementPushJobRetentionSeconds },
      },
    };
  }

  return {
    queueName: input.queueName,
    name: input.queueName,
    payload: createPayload(input),
    options: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      jobId: `${input.entityId}_${input.contentHash}`,
      removeOnFail: false,
      removeOnComplete: true,
    },
  };
}

function isAnnouncementDeliveryInputValid(input: AnnouncementDeliveryQueueJobInput): boolean {
  if ("mode" in input) {
    return input.mode === "PUSH_SEND" &&
      input.channel === "PUSH" &&
      typeof input.sendKey === "string" && announcementPushSendKeyPattern.test(input.sendKey) &&
      Number.isInteger(input.chunkIndex) && input.chunkIndex >= 0 &&
      input.deviceIds.length > 0 && input.deviceIds.length <= announcementPushChunkSize &&
      input.deviceIds.every((id) => typeof id === "string" && id.length > 0) &&
      typeof input.title === "string" && input.title.trim().length > 0;
  }
  if (input.channel !== "EMAIL" && input.channel !== "PUSH") return false;
  if (input.status !== "completed" && input.status !== "failed") return false;
  const counts = [input.recipientCount, input.deliveredCount, input.failedCount];
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) return false;
  return input.deliveredCount + input.failedCount <= input.recipientCount;
}

function isBackupRestoreInputValid(input: BackupRestoreQueueJobInput): boolean {
  if (input.operationType !== "BACKUP" && input.operationType !== "RESTORE_DRILL") return false;
  const targetReference = input.targetReference.trim();
  if (!targetReference) return false;
  if (input.operationType === "BACKUP") return isBackupTargetReferenceValid(targetReference);
  return isRestoreDrillTargetReferenceValid(targetReference);
}

function isBackupTargetReferenceValid(targetReference: string): boolean {
  const url = parseTargetUrl(targetReference);
  if (!url) return false;
  if (url.protocol === "s3:") {
    const prefix = url.pathname.replace(/^\/+|\/+$/g, "");
    return Boolean(url.hostname && prefix);
  }
  if (url.protocol !== "file:") return false;
  const filePath = filePathFromUrl(url);
  return Boolean(filePath && !isLocalTempOrRootPath(filePath));
}

function isRestoreDrillTargetReferenceValid(targetReference: string): boolean {
  const url = parseTargetUrl(targetReference);
  if (!url || url.protocol !== "file:") return false;
  const filePath = filePathFromUrl(url);
  return Boolean(filePath && !isLocalTempPath(filePath));
}

function parseTargetUrl(targetReference: string): URL | null {
  try {
    return new URL(targetReference);
  } catch {
    return null;
  }
}

function filePathFromUrl(url: URL): string | null {
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

function isLocalTempPath(filePath: string): boolean {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/")
  );
}

function isLocalTempOrRootPath(filePath: string): boolean {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return normalized === "/" || isLocalTempPath(normalized);
}

function createPayload<TInput extends TenantQueueJobInput>(input: TInput): Omit<TInput, "queueName"> {
  const { queueName: _queueName, ...payload } = input;
  return payload;
}
