import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import type { ProducedJob } from "../queue/job-producer.js";
import {
  examResultSummaryReportType,
  reportGenerationQueueProducerToken,
  type ReportGenerationQueueProducer,
  type ReportPdfRenderer,
  reportPdfRendererToken,
  type ReportSnapshotRecord,
} from "./report-generation.service.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "./report-snapshot-store.js";

describe("ReportGenerationController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let producer: FakeProducer;
  let pdfRenderer: FakePdfRenderer;
  let snapshotStore: FakeReportSnapshotStore;

  beforeAll(async () => {
    producer = new FakeProducer();
    pdfRenderer = new FakePdfRenderer();
    snapshotStore = new FakeReportSnapshotStore();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(reportGenerationQueueProducerToken)
      .useValue(producer)
      .overrideProvider(reportSnapshotStoreToken)
      .useValue(snapshotStore)
      .overrideProvider(reportPdfRendererToken)
      .useValue(pdfRenderer)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it("TENANT_ADMIN rapor üretim işini report-generation queue'ya bağlar", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/reports/generation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        reportType: examResultSummaryReportType,
        contentHash: "results-v1",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
      })
      .expect(201);

    expect(producer.inputs).toEqual([{
      queueName: "report-generation",
      tenantId: "tenant-a",
      userId: "user-tenant-a",
      entityId: "exam-a",
      contentHash: "results-v1",
      reportType: examResultSummaryReportType,
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    }]);
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
      queueName: "report-generation",
      jobId: "exam-a_results-v1",
      status: "queued",
    });
  });

  it("TENANT_ADMIN rapor üretim işini Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "report-generation-idempotency-a";
    const body = {
      reportType: examResultSummaryReportType,
      contentHash: "results-idempotent-v1",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    };
    producer.inputs = [];

    const first = await request(server)
      .post("/exams/exam-a/reports/generation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/exams/exam-a/reports/generation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(producer.inputs).toHaveLength(1);
    expect(producer.inputs[0]).toMatchObject({
      queueName: "report-generation",
      tenantId: "tenant-a",
      entityId: "exam-a",
      contentHash: "results-idempotent-v1",
      reportType: examResultSummaryReportType,
    });

    await request(server)
      .post("/exams/exam-a/reports/generation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, contentHash: "results-idempotent-v2" })
      .expect(409);
    expect(producer.inputs).toHaveLength(1);
  });

  it("TENANT_ADMIN hazır rapor snapshotlarını listeler", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/reports/snapshots")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(snapshotStore.inputs).toContainEqual({ tenantId: "tenant-a", examId: "exam-a" });
    expect(response.body).toEqual([fakeSnapshot, fakePreviousSnapshot]);
  });

  it("TENANT_ADMIN rapor snapshotlarını akademik bağlam filtresiyle listeler", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/reports/snapshots?courseId=course-math&termId=term-2026-spring")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(response.body).toEqual([fakeSnapshot]);
  });

  it("TEACHER hazır rapor snapshotlarını okuyabilir", async () => {
    const issued = await login("teacher-a@example.test");

    await request(server)
      .get("/exams/exam-a/reports/snapshots")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);
  });

  it("TEACHER hazır rapor snapshotını Excel olarak alabilir", async () => {
    const issued = await login("teacher-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/reports/snapshots/snapshot-a/export.xlsx")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(snapshotStore.findInputs).toContainEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-a",
    });
    expect(response.body.fileName).toBe("exam-a-snapshot-a.xlsx");
    expect(response.body.rowCount).toBe(1);

    const workbook = new ExcelJS.Workbook();
    const bytes = Buffer.from(response.body.fileBase64 as string, "base64");
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    expect(workbook.getWorksheet("Students")?.getCell("A2").value).toBe("student-a");
    expect(workbook.getWorksheet("Classes")?.getCell("B2").value).toBe("8-A");
    expect(workbook.getWorksheet("Students")?.getCell("K2").value).toBe(3);
    expect(workbook.getWorksheet("Students")?.getCell("M2").value).toBe(92.5);
    expect(workbook.getWorksheet("BranchStatistics")?.getCell("D2").value).toBe(3);
  });

  it("TEACHER hazır rapor snapshotını PDF olarak alabilir", async () => {
    const issued = await login("teacher-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/reports/snapshots/snapshot-a/export.pdf")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(snapshotStore.findInputs).toContainEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-a",
    });
    expect(response.body.fileName).toBe("exam-a-snapshot-a.pdf");
    expect(response.body.contentType).toBe("application/pdf");
    expect(response.body.pageCount).toBe(1);
    expect(Buffer.from(response.body.fileBase64 as string, "base64").toString("utf8")).toContain("%PDF-1.4");
    const pdfInput = pdfRenderer.inputs.at(-1);
    expect(pdfInput?.snapshot.id).toBe("snapshot-a");
    expect(pdfInput?.snapshot.snapshotData).toMatchObject({
      resultCount: 1,
      students: [expect.objectContaining({ studentId: "student-a" })],
    });
  });

  it("TEACHER hazır snapshot içinden öğrenci sınav raporu okuyabilir", async () => {
    const issued = await login("teacher-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/reports/snapshots/snapshot-a/students/student-a")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(snapshotStore.findInputs).toContainEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-a",
    });
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-a",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      studentName: "Ada A",
      classId: "class-a",
      className: "8-A",
      courseId: "course-math",
      resultKey: "result-a",
      termId: "term-2026-spring",
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
          schoolNetAverage: 17.5,
        },
      ],
      questions: [
        { questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" },
        { questionNo: 2, branch: "Matematik", answer: "C", correctAnswer: "B", status: "WRONG" },
        { questionNo: 3, branch: "Matematik", answer: "", correctAnswer: "D", status: "BLANK" },
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

  it("TEACHER hazır snapshot içinden öğrenci hata kitapçığı okuyabilir", async () => {
    const issued = await login("teacher-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/reports/snapshots/snapshot-a/students/student-a/error-booklet")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(snapshotStore.findInputs).toContainEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-a",
    });
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      items: [
        { questionNo: 2, branch: "Matematik", answer: "C", correctAnswer: "B", status: "WRONG" },
        { questionNo: 3, branch: "Matematik", answer: "", correctAnswer: "D", status: "BLANK" },
      ],
      generatedAt: "2026-06-06T09:00:00.000Z",
    });
  });

  it("TEACHER hazır snapshot geçmişinden öğrenci gelişim raporu okuyabilir", async () => {
    const issued = await login("teacher-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/reports/students/student-a/progress")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(snapshotStore.inputs).toContainEqual({ tenantId: "tenant-a", examId: "exam-a" });
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      studentId: "student-a",
      points: [
        {
          snapshotId: "snapshot-previous",
          courseId: "course-turkish",
          generatedAt: "2026-06-05T09:00:00.000Z",
          termId: "term-2026-spring",
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
        {
          snapshotId: "snapshot-a",
          courseId: "course-math",
          generatedAt: "2026-06-06T09:00:00.000Z",
          termId: "term-2026-spring",
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
        },
      ],
      netDelta: 3.5,
      standardScoreDelta: 7.5,
    });
  });

  it("TEACHER öğrenci gelişim raporunu tüm sınav snapshotlarıyla okuyabilir", async () => {
    const issued = await login("teacher-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/reports/students/student-a/progress?scope=all")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(snapshotStore.tenantInputs).toContain("tenant-a");
    expect(response.body.points.map((point: { snapshotId: string }) => point.snapshotId)).toEqual([
      "snapshot-previous",
      "snapshot-a",
      "snapshot-other-exam",
    ]);
    expect(response.body.netDelta).toBe(6);
    expect(response.body.standardScoreDelta).toBe(10);
  });

  it("başka tenant snapshot export edemez", async () => {
    const issued = await login("admin-b@example.test");

    await request(server)
      .get("/exams/exam-a/reports/snapshots/snapshot-a/export.xlsx")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(404);
  });

  it("TEACHER rapor üretim işi başlatamaz", async () => {
    const issued = await login("teacher-a@example.test");
    producer.inputs = [];

    await request(server)
      .post("/exams/exam-a/reports/generation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        reportType: examResultSummaryReportType,
        contentHash: "results-v1",
      })
      .expect(403);

    expect(producer.inputs).toHaveLength(0);
  });

  it("contentHash eksikse queue'ya iş göndermez", async () => {
    const issued = await login("admin-a@example.test");
    producer.inputs = [];

    const response = await request(server)
      .post("/exams/exam-a/reports/generation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ reportType: examResultSummaryReportType })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "contentHash" })],
      },
    });
    expect(producer.inputs).toHaveLength(0);
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return response.body as { accessToken: string };
  }
});

class FakeProducer implements ReportGenerationQueueProducer {
  inputs: Parameters<ReportGenerationQueueProducer["enqueue"]>[0][] = [];

  async enqueue(input: Parameters<ReportGenerationQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
    this.inputs.push(input);
    const { queueName: _queueName, ...payload } = input;
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload,
      options: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        jobId: `${input.entityId}_${input.contentHash}`,
        removeOnFail: false,
      },
    };
  }
}

class FakePdfRenderer implements ReportPdfRenderer {
  readonly inputs: Parameters<ReportPdfRenderer["render"]>[0][] = [];

  async render(input: Parameters<ReportPdfRenderer["render"]>[0]): ReturnType<ReportPdfRenderer["render"]> {
    this.inputs.push(input);
    return {
      fileName: `${input.snapshot.examId}-${input.snapshot.id}.pdf`,
      contentType: "application/pdf",
      fileBase64: Buffer.from("%PDF-1.4\ncontroller\n%%EOF", "utf8").toString("base64"),
      pageCount: 1,
    };
  }
}

const fakeSnapshot: ReportSnapshotRecord = {
  id: "snapshot-a",
  tenantId: "tenant-a",
  examId: "exam-a",
  campusId: "campus-main",
  gradeLevelId: "grade-8",
  classId: "class-a",
  courseId: "course-math",
  termId: "term-2026-spring",
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
        questions: [
          { questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" },
          { questionNo: 2, branch: "Matematik", answer: "C", correctAnswer: "B", status: "WRONG" },
          { questionNo: 3, branch: "Matematik", answer: "", correctAnswer: "D", status: "BLANK" },
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
  classId: "class-b",
  courseId: "course-turkish",
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

const fakeOtherExamSnapshot: ReportSnapshotRecord = {
  ...fakeSnapshot,
  id: "snapshot-other-exam",
  examId: "exam-b",
  courseId: "course-fen",
  inputRefs: { resultKeys: ["result-other-exam"] },
  snapshotData: {
    resultCount: 1,
    averages: {
      net: 20,
      rawScore: 100,
      standardScore: 90,
    },
    students: [
      {
        studentId: "student-a",
        classId: "class-a",
        className: "8-A",
        resultKey: "result-other-exam",
        total: {
          correct: 20,
          wrong: 0,
          blank: 0,
          net: 20,
          rawScore: 100,
          standardScore: 90,
        },
        branches: [
          {
            branch: "Fen",
            correct: 20,
            wrong: 0,
            blank: 0,
            net: 20,
          },
        ],
      },
    ],
  },
  generatedAt: "2026-06-07T09:00:00.000Z",
  createdAt: "2026-06-07T09:00:00.000Z",
  updatedAt: "2026-06-07T09:00:00.000Z",
};

class FakeReportSnapshotStore implements ReportSnapshotStore {
  readonly inputs: Array<{ tenantId: string; examId: string }> = [];
  readonly tenantInputs: string[] = [];
  readonly findInputs: Array<{ tenantId: string; examId: string; snapshotId: string }> = [];
  private readonly records = [fakeSnapshot, fakePreviousSnapshot, fakeOtherExamSnapshot];

  async listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]> {
    this.inputs.push({ tenantId, examId });
    return this.records.filter((snapshot) => snapshot.tenantId === tenantId && snapshot.examId === examId);
  }

  async listByTenant(tenantId: string): Promise<ReportSnapshotRecord[]> {
    this.tenantInputs.push(tenantId);
    return this.records.filter((snapshot) => snapshot.tenantId === tenantId);
  }

  async findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined> {
    this.findInputs.push({ tenantId, examId, snapshotId });
    return this.records.find((snapshot) => snapshot.tenantId === tenantId && snapshot.examId === examId && snapshot.id === snapshotId);
  }

  async markStaleByExam(): Promise<number> {
    return 0;
  }
}
