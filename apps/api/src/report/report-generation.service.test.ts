import { BadRequestException, ForbiddenException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { ProducedJob } from "../queue/job-producer.js";
import {
  examResultSummaryReportType,
  ReportGenerationService,
  type ReportGenerationQueueProducer,
  type ReportPdfRenderer,
  type ReportSnapshotRecord,
} from "./report-generation.service.js";
import type { ReportSnapshotStore } from "./report-snapshot-store.js";

describe("ReportGenerationService", () => {
  it("rapor üretim isteğini report-generation queue job'una çevirir", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const auditLogs = new FakeAuditLogService();
    const service = new ReportGenerationService(producer, store, undefined, auditLogs as unknown as AuditLogService);

    const result = await service.enqueueGeneration(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      {
        examId: "exam-a",
        reportType: examResultSummaryReportType,
        contentHash: "results-v1",
      },
    );

    expect(producer.inputs).toEqual([{
      queueName: "report-generation",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "exam-a",
      contentHash: "results-v1",
      reportType: examResultSummaryReportType,
    }]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
      queueName: "report-generation",
      jobId: "exam-a_results-v1",
      status: "queued",
    });
    expect(auditLogs.records).toEqual([{
      tenantId: "tenant-a",
      actorUserId: "user-a",
      entityType: "ReportGeneration",
      entityId: "exam-a",
      action: "report_generation.queued",
      diff: {
        reportType: examResultSummaryReportType,
        contentHash: "results-v1",
        jobId: "exam-a_results-v1",
      },
    }]);
  });

  it("tenant context yoksa queue'ya iş göndermez", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(producer, store);

    await expect(service.enqueueGeneration(
      {
        tenantId: null,
        userId: "user-a",
        roles: ["SYSTEM_ADMIN"],
        bypassRls: true,
      },
      {
        examId: "exam-a",
        reportType: examResultSummaryReportType,
        contentHash: "results-v1",
      },
    )).rejects.toThrow(ForbiddenException);
    expect(producer.inputs).toHaveLength(0);
  });

  it("desteklenmeyen rapor tipinde queue'ya iş göndermez", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(producer, store);

    await expect(service.enqueueGeneration(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      {
        examId: "exam-a",
        reportType: "CLASS_SUCCESS",
        contentHash: "results-v1",
      },
    )).rejects.toThrow(BadRequestException);
    expect(producer.inputs).toHaveLength(0);
  });

  it("tenant içindeki sınav snapshotlarını listeler", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(producer, store);

    const result = await service.listSnapshots(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      "exam-a",
    );

    expect(store.inputs).toEqual([{ tenantId: "tenant-a", examId: "exam-a" }]);
    expect(result).toEqual([fakeSnapshot, fakePreviousSnapshot]);
    expect(producer.inputs).toHaveLength(0);
  });

  it("tenant context olmadan snapshot listelemez", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(producer, store);

    await expect(service.listSnapshots(
      {
        tenantId: null,
        userId: "user-a",
        roles: ["SYSTEM_ADMIN"],
        bypassRls: true,
      },
      "exam-a",
    )).rejects.toThrow(ForbiddenException);
    expect(store.inputs).toHaveLength(0);
  });

  it("hazır snapshotı Excel dosyasına dönüştürür", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(producer, store);

    const result = await service.exportSnapshotExcel(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      "exam-a",
      "snapshot-a",
    );

    expect(store.findInputs).toEqual([{ tenantId: "tenant-a", examId: "exam-a", snapshotId: "snapshot-a" }]);
    expect(result.fileName).toBe("exam-a-snapshot-a.xlsx");
    expect(result.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(result.rowCount).toBe(1);

    const workbook = new ExcelJS.Workbook();
    const bytes = Buffer.from(result.fileBase64, "base64");
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);

    expect(workbook.getWorksheet("Summary")?.getCell("B1").value).toBe("exam-a");
    expect(workbook.getWorksheet("Branches")?.getCell("A2").value).toBe("Matematik");
    expect(workbook.getWorksheet("Classes")?.getCell("B2").value).toBe("8-A");
    expect(workbook.getWorksheet("Students")?.getCell("A2").value).toBe("student-a");
    expect(workbook.getWorksheet("Students")?.getCell("C2").value).toBe("8-A");
  });

  it("hazır snapshotı PDF dosyasına dönüştürür", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const pdfRenderer = new FakePdfRenderer();
    const service = new ReportGenerationService(producer, store, pdfRenderer);

    const result = await service.exportSnapshotPdf(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      "exam-a",
      "snapshot-a",
    );

    expect(store.findInputs).toEqual([{ tenantId: "tenant-a", examId: "exam-a", snapshotId: "snapshot-a" }]);
    expect(result.fileName).toBe("exam-a-snapshot-a.pdf");
    expect(result.contentType).toBe("application/pdf");
    expect(result.pageCount).toBe(1);

    const text = Buffer.from(result.fileBase64, "base64").toString("utf8");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(pdfRenderer.inputs).toHaveLength(1);
    expect(pdfRenderer.inputs[0]?.html).toContain("Sınav Raporu");
    expect(pdfRenderer.inputs[0]?.html).toContain("Branş Başarı");
    expect(pdfRenderer.inputs[0]?.html).toContain("Sınıf Başarı");
    expect(pdfRenderer.inputs[0]?.html).toContain("Öğrenci Özeti");
    expect(pdfRenderer.inputs[0]?.html).toContain("Matematik");
    expect(pdfRenderer.inputs[0]?.html).toContain("student-a");
    expect(pdfRenderer.inputs[0]?.fallbackLines).toContain("Uzman Hocam - Sinav Raporu");
  });

  it("hazır snapshot içinden öğrenci sınav raporu döner", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(producer, store);

    const result = await service.getStudentReport(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      "exam-a",
      "snapshot-a",
      "student-a",
    );

    expect(store.findInputs).toEqual([{ tenantId: "tenant-a", examId: "exam-a", snapshotId: "snapshot-a" }]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      classId: "class-a",
      className: "8-A",
      resultKey: "result-a",
      total: {
        correct: 18,
        wrong: 2,
        blank: 0,
        net: 17.5,
        rawScore: 87.5,
        standardScore: 87.5,
      },
      branches: [
        {
          branch: "Matematik",
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
        },
      ],
      outcomes: [
        {
          outcomeCode: "MAT.8.1.1",
          branch: "Matematik",
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
        },
      ],
      statistics: {
        standardScore: 72.5,
        general: { rank: 3, outOf: 40, percentile: 92.5 },
        class: { rank: 1, outOf: 20, percentile: 97.5 },
        branches: [
          { branch: "Matematik", standardScore: 72.5, general: { rank: 3, outOf: 40, percentile: 92.5 }, class: { rank: 1, outOf: 20, percentile: 97.5 } },
        ],
      },
      generatedAt: "2026-06-06T09:00:00.000Z",
    });
  });

  it("hazır snapshot içinden öğrenci hata kitapçığı döner", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(producer, store);

    const result = await service.getStudentErrorBooklet(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      "exam-a",
      "snapshot-a",
      "student-a",
    );

    expect(store.findInputs).toEqual([{ tenantId: "tenant-a", examId: "exam-a", snapshotId: "snapshot-a" }]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      items: [
        {
          questionNo: 2,
          branch: "Matematik",
          outcomeCode: "MAT.8.1.1",
          answer: "C",
          correctAnswer: "B",
          status: "WRONG",
        },
        {
          questionNo: 3,
          branch: "Matematik",
          outcomeCode: "MAT.8.1.1",
          answer: "",
          correctAnswer: "D",
          status: "BLANK",
        },
      ],
      generatedAt: "2026-06-06T09:00:00.000Z",
    });
  });

  it("hazır snapshot geçmişinden öğrenci gelişim raporu döner", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(producer, store);

    const result = await service.getStudentProgress(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      "exam-a",
      "student-a",
    );

    expect(store.inputs).toEqual([{ tenantId: "tenant-a", examId: "exam-a" }]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      studentId: "student-a",
      points: [
        {
          snapshotId: "snapshot-previous",
          generatedAt: "2026-06-05T09:00:00.000Z",
          total: {
            correct: 15,
            wrong: 4,
            blank: 1,
            net: 14,
            rawScore: 70,
            standardScore: 80,
          },
        },
        {
          snapshotId: "snapshot-a",
          generatedAt: "2026-06-06T09:00:00.000Z",
          total: {
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 17.5,
            rawScore: 87.5,
            standardScore: 87.5,
          },
        },
      ],
      netDelta: 3.5,
      standardScoreDelta: 7.5,
    });
  });
});

class FakeProducer implements ReportGenerationQueueProducer {
  readonly inputs: Parameters<ReportGenerationQueueProducer["enqueue"]>[0][] = [];

  async enqueue(input: Parameters<ReportGenerationQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
    this.inputs.push(input);
    const { queueName: _queueName, ...payload } = input;
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload,
      options: {
        attempts: 5 as const,
        backoff: { type: "exponential" as const, delay: 1000 },
        jobId: `${input.entityId}_${input.contentHash}`,
        removeOnFail: false as const,
      },
    };
  }
}

class FakePdfRenderer implements ReportPdfRenderer {
  readonly inputs: Parameters<ReportPdfRenderer["render"]>[0][] = [];

  async render(input: Parameters<ReportPdfRenderer["render"]>[0]): Promise<Buffer> {
    this.inputs.push(input);
    return Buffer.from("%PDF-1.4\nrich\n%%EOF", "utf8");
  }
}

class FakeAuditLogService {
  readonly records: CreateAuditLogInput[] = [];

  async record(input: CreateAuditLogInput) {
    this.records.push(input);
    return { id: "audit-a", createdAt: "2026-06-06T09:00:00.000Z", ...input };
  }
}

const fakeSnapshot: ReportSnapshotRecord = {
  id: "snapshot-a",
  tenantId: "tenant-a",
  examId: "exam-a",
  reportType: examResultSummaryReportType,
  status: "READY",
  inputRefs: { resultKeys: ["result-a"] },
  snapshotData: {
    resultCount: 1,
    averages: {
      net: 17.5,
      rawScore: 87.5,
      standardScore: 87.5,
    },
    branches: [
      {
        branch: "Matematik",
        resultCount: 1,
        correct: 18,
        wrong: 2,
        blank: 0,
        net: 17.5,
      },
    ],
    outcomes: [
      {
        outcomeCode: "MAT.8.1.1",
        branch: "Matematik",
        resultCount: 1,
        correct: 18,
        wrong: 2,
        blank: 0,
        net: 17.5,
      },
    ],
    classes: [
      {
        classId: "class-a",
        className: "8-A",
        resultCount: 1,
        averages: {
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
          rawScore: 87.5,
          standardScore: 87.5,
        },
      },
    ],
    students: [
      {
        studentId: "student-a",
        classId: "class-a",
        className: "8-A",
        resultKey: "result-a",
        total: {
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
          rawScore: 87.5,
          standardScore: 87.5,
        },
        branches: [
          {
            branch: "Matematik",
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 17.5,
          },
        ],
        outcomes: [
          {
            outcomeCode: "MAT.8.1.1",
            branch: "Matematik",
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 17.5,
          },
        ],
        questions: [
          { questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" },
          {
            questionNo: 2,
            branch: "Matematik",
            outcomeCode: "MAT.8.1.1",
            answer: "C",
            correctAnswer: "B",
            status: "WRONG",
          },
          {
            questionNo: 3,
            branch: "Matematik",
            outcomeCode: "MAT.8.1.1",
            answer: "",
            correctAnswer: "D",
            status: "BLANK",
          },
        ],
        statistics: {
          standardScore: 72.5,
          general: { rank: 3, outOf: 40, percentile: 92.5 },
          class: { rank: 1, outOf: 20, percentile: 97.5 },
          branches: [
            { branch: "Matematik", standardScore: 72.5, general: { rank: 3, outOf: 40, percentile: 92.5 }, class: { rank: 1, outOf: 20, percentile: 97.5 } },
          ],
        },
      },
    ],
  },
  generatedAt: "2026-06-06T09:00:00.000Z",
  createdAt: "2026-06-06T09:00:00.000Z",
  updatedAt: "2026-06-06T09:00:00.000Z",
};

const fakePreviousSnapshot: ReportSnapshotRecord = {
  ...fakeSnapshot,
  id: "snapshot-previous",
  inputRefs: { resultKeys: ["result-previous"] },
  snapshotData: {
    resultCount: 1,
    averages: {
      net: 14,
      rawScore: 70,
      standardScore: 80,
    },
    students: [
      {
        studentId: "student-a",
        classId: "class-a",
        className: "8-A",
        resultKey: "result-previous",
        total: {
          correct: 15,
          wrong: 4,
          blank: 1,
          net: 14,
          rawScore: 70,
          standardScore: 80,
        },
        branches: [
          {
            branch: "Matematik",
            correct: 15,
            wrong: 4,
            blank: 1,
            net: 14,
          },
        ],
      },
    ],
  },
  generatedAt: "2026-06-05T09:00:00.000Z",
  createdAt: "2026-06-05T09:00:00.000Z",
  updatedAt: "2026-06-05T09:00:00.000Z",
};

class FakeReportSnapshotStore implements ReportSnapshotStore {
  readonly inputs: Array<{ tenantId: string; examId: string }> = [];
  readonly findInputs: Array<{ tenantId: string; examId: string; snapshotId: string }> = [];

  async listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]> {
    this.inputs.push({ tenantId, examId });
    return tenantId === fakeSnapshot.tenantId && examId === fakeSnapshot.examId ? [fakeSnapshot, fakePreviousSnapshot] : [];
  }

  async findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined> {
    this.findInputs.push({ tenantId, examId, snapshotId });
    return [fakeSnapshot, fakePreviousSnapshot].find(
      (snapshot) => snapshot.tenantId === tenantId && snapshot.examId === examId && snapshot.id === snapshotId,
    );
  }
}
