import { Worker, type ConnectionOptions, type WorkerOptions } from "bullmq";
import {
  createAnnouncementDeliveryProcessor,
  type AnnouncementDeliveryProcessor,
} from "../jobs/announcement-delivery-processor.js";
import {
  type AnnouncementDeliveryJobPayload,
  type AnnouncementDeliveryJobResult,
} from "../jobs/announcement-delivery-job.js";
import {
  type BackupRestoreJobPayload,
  type BackupRestoreJobResult,
} from "../jobs/backup-restore-job.js";
import {
  createBackupRestoreProcessor,
  type BackupRestoreProcessor,
} from "../jobs/backup-restore-processor.js";
import {
  createExamEvaluationProcessor,
  type ExamEvaluationProcessor,
} from "../jobs/exam-evaluation-processor.js";
import { type ExcelImportJobResult } from "../jobs/excel-import-job.js";
import {
  type ExamEvaluationJobPayload,
  type ExamEvaluationJobResult,
} from "../jobs/exam-evaluation-job.js";
import {
  createOpticalParseProcessor,
  type OpticalParseProcessor,
} from "../jobs/optical-parse-processor.js";
import {
  createReportGenerationProcessor,
  type ReportGenerationProcessor,
} from "../jobs/report-generation-processor.js";
import {
  type ReportGenerationJobPayload,
  type ReportGenerationJobResult,
} from "../jobs/report-generation-job.js";
import {
  type SmsBatchJobPayload,
  type SmsBatchJobResult,
} from "../jobs/sms-batch-job.js";
import {
  createSmsBatchProcessor,
  type SmsBatchProcessor,
} from "../jobs/sms-batch-processor.js";
import { type QueueJob, type TenantJobPayload } from "./queues.js";

const examEvaluationQueueName = "exam-evaluation";
const excelImportQueueName = "excel-import";
const reportGenerationQueueName = "report-generation";
const smsBatchQueueName = "sms-batch";
const announcementDeliveryQueueName = "announcement-delivery";
const backupRestoreQueueName = "backup-restore";

export interface BullExamEvaluationJob {
  id?: string | number;
  name: string;
  data: ExamEvaluationJobPayload;
}

export interface BullExcelImportJob {
  id?: string | number;
  name: string;
  data: TenantJobPayload;
}

export interface BullReportGenerationJob {
  id?: string | number;
  name: string;
  data: ReportGenerationJobPayload;
}

export interface BullSmsBatchJob {
  id?: string | number;
  name: string;
  data: SmsBatchJobPayload;
}

export interface BullAnnouncementDeliveryJob {
  id?: string | number;
  name: string;
  data: AnnouncementDeliveryJobPayload;
}

export interface BullBackupRestoreJob {
  id?: string | number;
  name: string;
  data: BackupRestoreJobPayload;
}

export interface BullWorkerInstance {
  close(): Promise<void>;
}

export type BullWorkerFactory<
  TJob = BullExamEvaluationJob,
  TResult = ExamEvaluationJobResult,
> = (
  name: string,
  processor: (job: TJob) => Promise<TResult>,
  options: WorkerOptions,
) => BullWorkerInstance;

export interface ExamEvaluationBullWorkerOptions {
  connection: ConnectionOptions;
  processor?: ExamEvaluationProcessor;
  workerOptions?: Omit<WorkerOptions, "connection">;
  createWorker?: BullWorkerFactory<BullExamEvaluationJob, ExamEvaluationJobResult>;
}

export interface ExcelImportBullWorkerOptions {
  connection: ConnectionOptions;
  processor?: OpticalParseProcessor;
  workerOptions?: Omit<WorkerOptions, "connection">;
  createWorker?: BullWorkerFactory<BullExcelImportJob, ExcelImportJobResult>;
}

export interface ReportGenerationBullWorkerOptions {
  connection: ConnectionOptions;
  processor?: ReportGenerationProcessor;
  workerOptions?: Omit<WorkerOptions, "connection">;
  createWorker?: BullWorkerFactory<BullReportGenerationJob, ReportGenerationJobResult>;
}

export interface SmsBatchBullWorkerOptions {
  connection: ConnectionOptions;
  processor?: SmsBatchProcessor;
  workerOptions?: Omit<WorkerOptions, "connection">;
  createWorker?: BullWorkerFactory<BullSmsBatchJob, SmsBatchJobResult>;
}

export interface AnnouncementDeliveryBullWorkerOptions {
  connection: ConnectionOptions;
  processor?: AnnouncementDeliveryProcessor;
  workerOptions?: Omit<WorkerOptions, "connection">;
  createWorker?: BullWorkerFactory<BullAnnouncementDeliveryJob, AnnouncementDeliveryJobResult>;
}

export interface BackupRestoreBullWorkerOptions {
  connection: ConnectionOptions;
  processor?: BackupRestoreProcessor;
  workerOptions?: Omit<WorkerOptions, "connection">;
  createWorker?: BullWorkerFactory<BullBackupRestoreJob, BackupRestoreJobResult>;
}

export function createExamEvaluationBullWorker(
  options: ExamEvaluationBullWorkerOptions,
): BullWorkerInstance {
  const processor = options.processor ?? createExamEvaluationProcessor();
  const createWorker = options.createWorker ?? createDefaultExamEvaluationWorker;

  return createWorker(
    examEvaluationQueueName,
    async (job) => processor(toExamEvaluationQueueJob(job)),
    {
      ...options.workerOptions,
      connection: options.connection,
    },
  );
}

export function createExcelImportBullWorker(
  options: ExcelImportBullWorkerOptions,
): BullWorkerInstance {
  const processor = options.processor ?? createOpticalParseProcessor();
  const createWorker = options.createWorker ?? createDefaultExcelImportWorker;

  return createWorker(
    excelImportQueueName,
    async (job) => processor(toExcelImportQueueJob(job)),
    {
      ...options.workerOptions,
      connection: options.connection,
    },
  );
}

export function createReportGenerationBullWorker(
  options: ReportGenerationBullWorkerOptions,
): BullWorkerInstance {
  const processor = options.processor ?? createReportGenerationProcessor();
  const createWorker = options.createWorker ?? createDefaultReportGenerationWorker;

  return createWorker(
    reportGenerationQueueName,
    async (job) => processor(toReportGenerationQueueJob(job)),
    {
      ...options.workerOptions,
      connection: options.connection,
    },
  );
}

export function createSmsBatchBullWorker(
  options: SmsBatchBullWorkerOptions,
): BullWorkerInstance {
  const processor = options.processor ?? createSmsBatchProcessor();
  const createWorker = options.createWorker ?? createDefaultSmsBatchWorker;

  return createWorker(
    smsBatchQueueName,
    async (job) => processor(toSmsBatchQueueJob(job)),
    {
      ...options.workerOptions,
      connection: options.connection,
    },
  );
}

export function createAnnouncementDeliveryBullWorker(
  options: AnnouncementDeliveryBullWorkerOptions,
): BullWorkerInstance {
  const processor = options.processor ?? createAnnouncementDeliveryProcessor();
  const createWorker = options.createWorker ?? createDefaultAnnouncementDeliveryWorker;

  return createWorker(
    announcementDeliveryQueueName,
    async (job) => processor(toAnnouncementDeliveryQueueJob(job)),
    {
      ...options.workerOptions,
      connection: options.connection,
    },
  );
}

export function createBackupRestoreBullWorker(
  options: BackupRestoreBullWorkerOptions,
): BullWorkerInstance {
  const processor = options.processor ?? createBackupRestoreProcessor();
  const createWorker = options.createWorker ?? createDefaultBackupRestoreWorker;

  return createWorker(
    backupRestoreQueueName,
    async (job) => processor(toBackupRestoreQueueJob(job)),
    {
      ...options.workerOptions,
      connection: options.connection,
    },
  );
}

export function createRedisConnectionOptions(
  redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
): ConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL_INVALID");
  }

  const db = parseRedisDb(url.pathname);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

function toExcelImportQueueJob(
  job: BullExcelImportJob,
): QueueJob<TenantJobPayload> {
  if (job.id === undefined || job.id === null || job.id === "") {
    throw new Error("BULLMQ_JOB_ID_MISSING");
  }
  if (job.name !== excelImportQueueName) {
    throw new Error("BULLMQ_EXCEL_IMPORT_JOB_NAME_INVALID");
  }

  return {
    id: String(job.id),
    name: excelImportQueueName,
    payload: job.data,
  };
}

function toExamEvaluationQueueJob(
  job: BullExamEvaluationJob,
): QueueJob<ExamEvaluationJobPayload> {
  if (job.id === undefined || job.id === null || job.id === "") {
    throw new Error("BULLMQ_JOB_ID_MISSING");
  }
  if (job.name !== examEvaluationQueueName) {
    throw new Error("BULLMQ_EXAM_EVALUATION_JOB_NAME_INVALID");
  }

  return {
    id: String(job.id),
    name: examEvaluationQueueName,
    payload: job.data,
  };
}

function toReportGenerationQueueJob(
  job: BullReportGenerationJob,
): QueueJob<ReportGenerationJobPayload> {
  if (job.id === undefined || job.id === null || job.id === "") {
    throw new Error("BULLMQ_JOB_ID_MISSING");
  }
  if (job.name !== reportGenerationQueueName) {
    throw new Error("BULLMQ_REPORT_GENERATION_JOB_NAME_INVALID");
  }

  return {
    id: String(job.id),
    name: reportGenerationQueueName,
    payload: job.data,
  };
}

function toSmsBatchQueueJob(
  job: BullSmsBatchJob,
): QueueJob<SmsBatchJobPayload> {
  if (job.id === undefined || job.id === null || job.id === "") {
    throw new Error("BULLMQ_JOB_ID_MISSING");
  }
  if (job.name !== smsBatchQueueName) {
    throw new Error("BULLMQ_SMS_BATCH_JOB_NAME_INVALID");
  }

  return {
    id: String(job.id),
    name: smsBatchQueueName,
    payload: job.data,
  };
}

function toAnnouncementDeliveryQueueJob(
  job: BullAnnouncementDeliveryJob,
): QueueJob<AnnouncementDeliveryJobPayload> {
  if (job.id === undefined || job.id === null || job.id === "") {
    throw new Error("BULLMQ_JOB_ID_MISSING");
  }
  if (job.name !== announcementDeliveryQueueName) {
    throw new Error("BULLMQ_ANNOUNCEMENT_DELIVERY_JOB_NAME_INVALID");
  }

  return {
    id: String(job.id),
    name: announcementDeliveryQueueName,
    payload: job.data,
  };
}

function toBackupRestoreQueueJob(
  job: BullBackupRestoreJob,
): QueueJob<BackupRestoreJobPayload> {
  if (job.id === undefined || job.id === null || job.id === "") {
    throw new Error("BULLMQ_JOB_ID_MISSING");
  }
  if (job.name !== backupRestoreQueueName) {
    throw new Error("BULLMQ_BACKUP_RESTORE_JOB_NAME_INVALID");
  }

  return {
    id: String(job.id),
    name: backupRestoreQueueName,
    payload: job.data,
  };
}

function parseRedisDb(pathname: string): number | undefined {
  if (!pathname || pathname === "/") {
    return undefined;
  }

  const db = Number(pathname.slice(1));
  if (!Number.isInteger(db) || db < 0) {
    throw new Error("REDIS_URL_DB_INVALID");
  }
  return db;
}

function createDefaultExamEvaluationWorker(
  name: string,
  processor: (job: BullExamEvaluationJob) => Promise<ExamEvaluationJobResult>,
  options: WorkerOptions,
): BullWorkerInstance {
  return new Worker<ExamEvaluationJobPayload, ExamEvaluationJobResult>(
    name,
    processor,
    options,
  );
}

function createDefaultExcelImportWorker(
  name: string,
  processor: (job: BullExcelImportJob) => Promise<ExcelImportJobResult>,
  options: WorkerOptions,
): BullWorkerInstance {
  return new Worker<TenantJobPayload, ExcelImportJobResult>(
    name,
    processor,
    options,
  );
}

function createDefaultReportGenerationWorker(
  name: string,
  processor: (job: BullReportGenerationJob) => Promise<ReportGenerationJobResult>,
  options: WorkerOptions,
): BullWorkerInstance {
  return new Worker<ReportGenerationJobPayload, ReportGenerationJobResult>(
    name,
    processor,
    options,
  );
}

function createDefaultSmsBatchWorker(
  name: string,
  processor: (job: BullSmsBatchJob) => Promise<SmsBatchJobResult>,
  options: WorkerOptions,
): BullWorkerInstance {
  return new Worker<SmsBatchJobPayload, SmsBatchJobResult>(
    name,
    processor,
    options,
  );
}

function createDefaultAnnouncementDeliveryWorker(
  name: string,
  processor: (job: BullAnnouncementDeliveryJob) => Promise<AnnouncementDeliveryJobResult>,
  options: WorkerOptions,
): BullWorkerInstance {
  return new Worker<AnnouncementDeliveryJobPayload, AnnouncementDeliveryJobResult>(
    name,
    processor,
    options,
  );
}

function createDefaultBackupRestoreWorker(
  name: string,
  processor: (job: BullBackupRestoreJob) => Promise<BackupRestoreJobResult>,
  options: WorkerOptions,
): BullWorkerInstance {
  return new Worker<BackupRestoreJobPayload, BackupRestoreJobResult>(
    name,
    processor,
    options,
  );
}
