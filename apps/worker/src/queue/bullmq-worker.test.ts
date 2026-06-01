import { describe, expect, it } from "vitest";
import {
  createExcelImportBullWorker,
  createExamEvaluationBullWorker,
  createReportGenerationBullWorker,
  createRedisConnectionOptions,
  createSmsBatchBullWorker,
  type BullExcelImportJob,
  type BullExamEvaluationJob,
  type BullReportGenerationJob,
  type BullSmsBatchJob,
  type BullWorkerFactory,
} from "./bullmq-worker.js";
import type { ExcelImportJobResult } from "../jobs/excel-import-job.js";
import type { ExamEvaluationJobPayload, ExamEvaluationJobResult } from "../jobs/exam-evaluation-job.js";
import { examResultSummaryReportType, type ReportGenerationJobPayload, type ReportGenerationJobResult } from "../jobs/report-generation-job.js";
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
