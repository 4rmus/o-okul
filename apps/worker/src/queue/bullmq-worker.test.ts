import { describe, expect, it } from "vitest";
import {
  createAnnouncementDeliveryBullWorker,
  createBackupRestoreBullWorker,
  createExcelImportBullWorker,
  createExamEvaluationBullWorker,
  createReportPdfRenderBullWorker,
  createReportGenerationBullWorker,
  createRedisConnectionOptions,
  createSmsBatchBullWorker,
  type BullAnnouncementDeliveryJob,
  type BullBackupRestoreJob,
  type BullExcelImportJob,
  type BullExamEvaluationJob,
  type BullReportPdfRenderJob,
  type BullReportGenerationJob,
  type BullSmsBatchJob,
  type BullWorkerFactory,
} from "./bullmq-worker.js";
import type { AnnouncementDeliveryJobPayload, AnnouncementDeliveryJobResult } from "../jobs/announcement-delivery-job.js";
import type { BackupRestoreJobPayload, BackupRestoreJobResult } from "../jobs/backup-restore-job.js";
import type { ExcelImportJobResult } from "../jobs/excel-import-job.js";
import type { ExamEvaluationJobPayload, ExamEvaluationJobResult } from "../jobs/exam-evaluation-job.js";
import { examResultSummaryReportType, type ReportGenerationJobPayload, type ReportGenerationJobResult } from "../jobs/report-generation-job.js";
import type { ReportPdfRenderJobResult } from "../jobs/report-pdf-render-job.js";
import type { SmsBatchJobPayload, SmsBatchJobResult } from "../jobs/sms-batch-job.js";
import type { QueueJob, TenantJobPayload } from "./queues.js";

describe("BullMQ exam evaluation worker", () => {
  it("BullMQ job'unu exam evaluation processor imzasına çevirir", async () => {
    const calls: Array<{
      name: string;
      processor: (job: BullExamEvaluationJob) => Promise<ExamEvaluationJobResult>;
      options: unknown;
    }> = [];
    const createWorker: BullWorkerFactory = (name, processor, options) => {
      calls.push({ name, processor, options });
      return { close: async () => undefined };
    };
    const processedJobs: Array<QueueJob<ExamEvaluationJobPayload>> = [];
    const result = createResult();

    createExamEvaluationBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker,
      workerOptions: { prefix: "uzman-hocam-test" },
      processor: async (job) => {
        processedJobs.push(job);
        return result;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("exam-evaluation");
    expect(calls[0]?.options).toEqual({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "uzman-hocam-test",
    });
    await expect(calls[0]?.processor(createBullJob())).resolves.toBe(result);
    expect(processedJobs).toEqual([{
      id: "raw-import-a_hash-a",
      name: "exam-evaluation",
      payload: createPayload(),
    }]);
  });

  it("BullMQ job id yoksa işi başlatmaz", async () => {
    let processor: ((job: BullExamEvaluationJob) => Promise<ExamEvaluationJobResult>) | undefined;
    createExamEvaluationBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker: (_name, createdProcessor) => {
        processor = createdProcessor;
        return { close: async () => undefined };
      },
      processor: async () => createResult(),
    });

    await expect(processor?.({ ...createBullJob(), id: undefined })).rejects.toThrow("BULLMQ_JOB_ID_MISSING");
  });

  it("Redis URL'ini BullMQ connection options'a çevirir", () => {
    expect(createRedisConnectionOptions("redis://user:pass@redis.local:6380/2")).toEqual({
      host: "redis.local",
      port: 6380,
      username: "user",
      password: "pass",
      db: 2,
      tls: undefined,
    });
  });
});

describe("BullMQ excel import worker", () => {
  it("BullMQ job'unu optical parse processor imzasına çevirir", async () => {
    const calls: Array<{
      name: string;
      processor: (job: BullExcelImportJob) => Promise<ExcelImportJobResult>;
      options: unknown;
    }> = [];
    const createWorker: BullWorkerFactory<BullExcelImportJob, ExcelImportJobResult> = (name, processor, options) => {
      calls.push({ name, processor, options });
      return { close: async () => undefined };
    };
    const processedJobs: Array<QueueJob<TenantJobPayload>> = [];
    const result: ExcelImportJobResult = {
      tenantId: "tenant-a",
      importId: "raw-import-a",
      contentHash: "hash-a",
      processedRows: 3,
      errorRows: 1,
      status: "completed",
    };

    createExcelImportBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker,
      workerOptions: { prefix: "uzman-hocam-test" },
      processor: async (job) => {
        processedJobs.push(job);
        return result;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("excel-import");
    expect(calls[0]?.options).toEqual({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "uzman-hocam-test",
    });
    await expect(calls[0]?.processor(createExcelImportBullJob())).resolves.toBe(result);
    expect(processedJobs).toEqual([{
      id: "raw-import-a_hash-a",
      name: "excel-import",
      payload: createExcelImportPayload(),
    }]);
  });

  it("excel-import BullMQ job adı yanlışsa işi başlatmaz", async () => {
    let processor: ((job: BullExcelImportJob) => Promise<ExcelImportJobResult>) | undefined;
    createExcelImportBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker: (_name, createdProcessor) => {
        processor = createdProcessor;
        return { close: async () => undefined };
      },
      processor: async () => ({
        tenantId: "tenant-a",
        importId: "raw-import-a",
        contentHash: "hash-a",
        processedRows: 0,
        errorRows: 0,
        status: "completed",
      }),
    });

    await expect(processor?.({ ...createExcelImportBullJob(), name: "exam-evaluation" }))
      .rejects.toThrow("BULLMQ_EXCEL_IMPORT_JOB_NAME_INVALID");
  });

  it("excel-import BullMQ job id yoksa işi başlatmaz", async () => {
    let processor: ((job: BullExcelImportJob) => Promise<ExcelImportJobResult>) | undefined;
    createExcelImportBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker: (_name, createdProcessor) => {
        processor = createdProcessor;
        return { close: async () => undefined };
      },
      processor: async () => ({
        tenantId: "tenant-a",
        importId: "raw-import-a",
        contentHash: "hash-a",
        processedRows: 0,
        errorRows: 0,
        status: "completed",
      }),
    });

    await expect(processor?.({ ...createExcelImportBullJob(), id: undefined }))
      .rejects.toThrow("BULLMQ_JOB_ID_MISSING");
  });
});

describe("BullMQ report generation worker", () => {
  it("BullMQ job'unu report generation processor imzasına çevirir", async () => {
    const calls: Array<{
      name: string;
      processor: (job: BullReportGenerationJob) => Promise<ReportGenerationJobResult>;
      options: unknown;
    }> = [];
    const createWorker: BullWorkerFactory<BullReportGenerationJob, ReportGenerationJobResult> = (name, processor, options) => {
      calls.push({ name, processor, options });
      return { close: async () => undefined };
    };
    const processedJobs: Array<QueueJob<ReportGenerationJobPayload>> = [];
    const result = createReportGenerationResult();

    createReportGenerationBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker,
      workerOptions: { prefix: "uzman-hocam-test" },
      processor: async (job) => {
        processedJobs.push(job);
        return result;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("report-generation");
    expect(calls[0]?.options).toEqual({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "uzman-hocam-test",
    });
    await expect(calls[0]?.processor(createReportGenerationBullJob())).resolves.toBe(result);
    expect(processedJobs).toEqual([{
      id: "exam-a_results-v1",
      name: "report-generation",
      payload: createReportGenerationPayload(),
    }]);
  });

  it("report-generation BullMQ job adı yanlışsa işi başlatmaz", async () => {
    let processor: ((job: BullReportGenerationJob) => Promise<ReportGenerationJobResult>) | undefined;
    createReportGenerationBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker: (_name, createdProcessor) => {
        processor = createdProcessor;
        return { close: async () => undefined };
      },
      processor: async () => createReportGenerationResult(),
    });

    await expect(processor?.({ ...createReportGenerationBullJob(), name: "excel-import" }))
      .rejects.toThrow("BULLMQ_REPORT_GENERATION_JOB_NAME_INVALID");
  });
});

describe("BullMQ report PDF render worker", () => {
  it("BullMQ job'unu report PDF renderer imzasına çevirir", async () => {
    const calls: Array<{
      name: string;
      processor: (job: BullReportPdfRenderJob) => Promise<ReportPdfRenderJobResult>;
      options: unknown;
    }> = [];
    const createWorker: BullWorkerFactory<BullReportPdfRenderJob, ReportPdfRenderJobResult> = (name, processor, options) => {
      calls.push({ name, processor, options });
      return { close: async () => undefined };
    };

    createReportPdfRenderBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker,
      workerOptions: { prefix: "uzman-hocam-test" },
      renderer: {
        async render() {
          return Buffer.from("%PDF-1.4\nworker\n%%EOF", "utf8");
        },
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("report-pdf-render");
    expect(calls[0]?.options).toEqual({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "uzman-hocam-test",
    });
    await expect(calls[0]?.processor(createReportPdfRenderBullJob())).resolves.toMatchObject({
      contentType: "application/pdf",
      fileName: "exam-a-snapshot-a.pdf",
      pageCount: 1,
    });
  });
});

describe("BullMQ SMS batch worker", () => {
  it("BullMQ job'unu SMS batch processor imzasına çevirir", async () => {
    const calls: Array<{
      name: string;
      processor: (job: BullSmsBatchJob) => Promise<SmsBatchJobResult>;
      options: unknown;
    }> = [];
    const createWorker: BullWorkerFactory<BullSmsBatchJob, SmsBatchJobResult> = (name, processor, options) => {
      calls.push({ name, processor, options });
      return { close: async () => undefined };
    };
    const processedJobs: Array<QueueJob<SmsBatchJobPayload>> = [];
    const result = createSmsBatchResult();

    createSmsBatchBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker,
      workerOptions: { prefix: "uzman-hocam-test" },
      processor: async (job) => {
        processedJobs.push(job);
        return result;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("sms-batch");
    expect(calls[0]?.options).toEqual({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "uzman-hocam-test",
    });
    await expect(calls[0]?.processor(createSmsBatchBullJob())).resolves.toBe(result);
    expect(processedJobs).toEqual([{
      id: "message-template-a_sms-hash-a",
      name: "sms-batch",
      payload: createSmsBatchPayload(),
    }]);
  });

  it("sms-batch BullMQ job adı yanlışsa işi başlatmaz", async () => {
    let processor: ((job: BullSmsBatchJob) => Promise<SmsBatchJobResult>) | undefined;
    createSmsBatchBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker: (_name, createdProcessor) => {
        processor = createdProcessor;
        return { close: async () => undefined };
      },
      processor: async () => createSmsBatchResult(),
    });

    await expect(processor?.({ ...createSmsBatchBullJob(), name: "report-generation" }))
      .rejects.toThrow("BULLMQ_SMS_BATCH_JOB_NAME_INVALID");
  });
});

describe("BullMQ announcement delivery worker", () => {
  it("BullMQ job'unu announcement delivery processor imzasına çevirir", async () => {
    const calls: Array<{
      name: string;
      processor: (job: BullAnnouncementDeliveryJob) => Promise<AnnouncementDeliveryJobResult>;
      options: unknown;
    }> = [];
    const createWorker: BullWorkerFactory<BullAnnouncementDeliveryJob, AnnouncementDeliveryJobResult> = (name, processor, options) => {
      calls.push({ name, processor, options });
      return { close: async () => undefined };
    };
    const processedJobs: Array<QueueJob<AnnouncementDeliveryJobPayload>> = [];
    const result = createAnnouncementDeliveryResult();

    createAnnouncementDeliveryBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker,
      workerOptions: { prefix: "uzman-hocam-test" },
      processor: async (job) => {
        processedJobs.push(job);
        return result;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("announcement-delivery");
    expect(calls[0]?.options).toEqual({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "uzman-hocam-test",
    });
    await expect(calls[0]?.processor(createAnnouncementDeliveryBullJob())).resolves.toBe(result);
    expect(processedJobs).toEqual([{
      id: "announcement-a_email-report-v1",
      name: "announcement-delivery",
      payload: createAnnouncementDeliveryPayload(),
    }]);
  });

  it("announcement-delivery BullMQ job adı yanlışsa işi başlatmaz", async () => {
    let processor: ((job: BullAnnouncementDeliveryJob) => Promise<AnnouncementDeliveryJobResult>) | undefined;
    createAnnouncementDeliveryBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker: (_name, createdProcessor) => {
        processor = createdProcessor;
        return { close: async () => undefined };
      },
      processor: async () => createAnnouncementDeliveryResult(),
    });

    await expect(processor?.({ ...createAnnouncementDeliveryBullJob(), name: "sms-batch" }))
      .rejects.toThrow("BULLMQ_ANNOUNCEMENT_DELIVERY_JOB_NAME_INVALID");
  });
});

describe("BullMQ backup restore worker", () => {
  it("BullMQ job'unu backup restore processor imzasına çevirir", async () => {
    const calls: Array<{
      name: string;
      processor: (job: BullBackupRestoreJob) => Promise<BackupRestoreJobResult>;
      options: unknown;
    }> = [];
    const createWorker: BullWorkerFactory<BullBackupRestoreJob, BackupRestoreJobResult> = (name, processor, options) => {
      calls.push({ name, processor, options });
      return { close: async () => undefined };
    };
    const processedJobs: Array<QueueJob<BackupRestoreJobPayload>> = [];
    const result = createBackupRestoreResult();

    createBackupRestoreBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker,
      workerOptions: { prefix: "uzman-hocam-test" },
      processor: async (job) => {
        processedJobs.push(job);
        return result;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("backup-restore");
    expect(calls[0]?.options).toEqual({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "uzman-hocam-test",
    });
    await expect(calls[0]?.processor(createBackupRestoreBullJob())).resolves.toBe(result);
    expect(processedJobs).toEqual([{
      id: "backup-restore-a_hash-a",
      name: "backup-restore",
      payload: createBackupRestorePayload(),
    }]);
  });

  it("backup-restore BullMQ job adı yanlışsa işi başlatmaz", async () => {
    let processor: ((job: BullBackupRestoreJob) => Promise<BackupRestoreJobResult>) | undefined;
    createBackupRestoreBullWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      createWorker: (_name, createdProcessor) => {
        processor = createdProcessor;
        return { close: async () => undefined };
      },
      processor: async () => createBackupRestoreResult(),
    });

    await expect(processor?.({ ...createBackupRestoreBullJob(), name: "announcement-delivery" }))
      .rejects.toThrow("BULLMQ_BACKUP_RESTORE_JOB_NAME_INVALID");
  });
});

function createBullJob(): BullExamEvaluationJob {
  return {
    id: "raw-import-a_hash-a",
    name: "exam-evaluation",
    data: createPayload(),
  };
}

function createReportGenerationBullJob(): BullReportGenerationJob {
  return {
    id: "exam-a_results-v1",
    name: "report-generation",
    data: createReportGenerationPayload(),
  };
}

function createExcelImportBullJob(): BullExcelImportJob {
  return {
    id: "raw-import-a_hash-a",
    name: "excel-import",
    data: createExcelImportPayload(),
  };
}

function createSmsBatchBullJob(): BullSmsBatchJob {
  return {
    id: "message-template-a_sms-hash-a",
    name: "sms-batch",
    data: createSmsBatchPayload(),
  };
}

function createReportPdfRenderBullJob(): BullReportPdfRenderJob {
  return {
    id: "pdf-job-a",
    name: "report-pdf-render",
    data: {
      institution: { institutionName: "DNA Egitim" },
      snapshot: {
        id: "snapshot-a",
        tenantId: "tenant-a",
        examId: "exam-a",
        reportType: examResultSummaryReportType,
        status: "READY",
        snapshotData: {
          resultCount: 1,
          averages: { net: 17.5, standardScore: 123.4 },
          students: [{ studentId: "student-a", total: { net: 17.5, standardScore: 123.4 } }],
        },
      },
    },
  };
}

function createAnnouncementDeliveryBullJob(): BullAnnouncementDeliveryJob {
  return {
    id: "announcement-a_email-report-v1",
    name: "announcement-delivery",
    data: createAnnouncementDeliveryPayload(),
  };
}

function createBackupRestoreBullJob(): BullBackupRestoreJob {
  return {
    id: "backup-restore-a_hash-a",
    name: "backup-restore",
    data: createBackupRestorePayload(),
  };
}

function createPayload(): ExamEvaluationJobPayload {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "raw-import-a",
    contentHash: "hash-a",
    participantId: "participant-a",
    rawImportId: "raw-import-a",
    answerKeyId: "answer-key-a",
  };
}

function createExcelImportPayload(): TenantJobPayload {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "raw-import-a",
    contentHash: "hash-a",
  };
}

function createReportGenerationPayload(): ReportGenerationJobPayload {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "exam-a",
    contentHash: "results-v1",
    reportType: examResultSummaryReportType,
  };
}

function createAnnouncementDeliveryPayload(): AnnouncementDeliveryJobPayload {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "announcement-a",
    contentHash: "email-report-v1",
    channel: "EMAIL",
    recipientCount: 3,
    deliveredCount: 2,
    failedCount: 1,
    status: "completed",
    providerErrorCode: "EMAIL_PROVIDER_RETRY",
  };
}

function createBackupRestorePayload(): BackupRestoreJobPayload {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "backup-restore-a",
    contentHash: "hash-a",
    operationType: "RESTORE_DRILL",
    targetReference: "staging-drill-2026-06",
    reason: "Aylık restore kanıtı",
  };
}

function createSmsBatchPayload(): SmsBatchJobPayload {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "message-template-a",
    contentHash: "sms-hash-a",
    templateId: "message-template-a",
    messageBody: "Sayın veli, deneme sınavı Pazartesi günü yapılacaktır.",
    recipients: [{ to: "5000000001" }],
  };
}

function createResult(): ExamEvaluationJobResult {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    studentId: "student-a",
    participantId: "participant-a",
    rawImportId: "raw-import-a",
    answerKeyId: "answer-key-a",
    parserConfigVersion: "parser-v1",
    answerKeyVersion: "answer-key-v1",
    engineVersion: "scoring-v1",
    resultKey: "participant-a_answer-key-v1_parser-v1_scoring-v1",
    score: {
      total: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
      branches: [{ branch: "Matematik", correct: 1, wrong: 0, blank: 0, net: 1 }],
      questions: [{ questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" }],
      _meta: {
        answerKeyVersion: "answer-key-v1",
        engineVersion: "scoring-v1",
        computedAt: "2026-05-30T03:00:00.000Z",
      },
    },
    status: "completed",
  };
}

function createReportGenerationResult(): ReportGenerationJobResult {
  return {
    id: "snapshot-a",
    tenantId: "tenant-a",
    examId: "exam-a",
    reportType: examResultSummaryReportType,
    status: "READY",
    inputRefs: {
      resultKeys: ["result-a"],
      answerKeyVersions: ["answer-key-v1"],
      parserConfigVersions: ["parser-v1"],
      engineVersions: ["engine-v1"],
    },
    snapshotData: {
      reportType: examResultSummaryReportType,
      generatedAt: "2026-05-30T08:00:00.000Z",
      resultCount: 1,
      averages: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
      branches: [{ branch: "Matematik", resultCount: 1, correct: 1, wrong: 0, blank: 0, net: 1 }],
      classes: [{
        classId: "class-a",
        className: "8-A",
        resultCount: 1,
        averages: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
        branches: [{ branch: "Matematik", resultCount: 1, correct: 1, wrong: 0, blank: 0, net: 1 }],
      }],
      statistics: {
        count: 1,
        total: { meanNet: 1, sdNet: 0, meanRawScore: 1, sdRawScore: 0 },
        branches: [{ branch: "Matematik", count: 1, meanNet: 1, sdNet: 0 }],
        standardScore: { mean: 50, sd: 10 },
        version: "2026.06.cohort-v1",
      },
      students: [{
        studentId: "student-a",
        classId: "class-a",
        className: "8-A",
        resultKey: "result-a",
        total: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
        branches: [{ branch: "Matematik", correct: 1, wrong: 0, blank: 0, net: 1 }],
        questions: [{ questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" }],
        statistics: {
          standardScore: 50,
          general: { rank: 1, outOf: 1, percentile: 50 },
          class: { rank: 1, outOf: 1, percentile: 50 },
          branches: [{ branch: "Matematik", standardScore: 50, general: { rank: 1, outOf: 1, percentile: 50 }, class: { rank: 1, outOf: 1, percentile: 50 } }],
        },
      }],
    },
    generatedAt: "2026-05-30T08:00:00.000Z",
  };
}

function createSmsBatchResult(): SmsBatchJobResult {
  return {
    tenantId: "tenant-a",
    templateId: "message-template-a",
    sentCount: 1,
    failedCount: 0,
    billableSegments: 1,
    status: "completed",
  };
}

function createAnnouncementDeliveryResult(): AnnouncementDeliveryJobResult {
  return {
    tenantId: "tenant-a",
    announcementId: "announcement-a",
    channel: "EMAIL",
    recipientCount: 3,
    deliveredCount: 2,
    failedCount: 1,
    status: "completed",
  };
}

function createBackupRestoreResult(): BackupRestoreJobResult {
  return {
    tenantId: "tenant-a",
    jobId: "backup-restore-a_hash-a",
    operationType: "RESTORE_DRILL",
    targetReference: "staging-drill-2026-06",
    reason: "Aylık restore kanıtı",
    result: "PASS",
    status: "completed",
    checkedTables: ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"],
  };
}
