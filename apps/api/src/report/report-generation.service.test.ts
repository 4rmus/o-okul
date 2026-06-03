import { BadRequestException, ForbiddenException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import type { ExamParticipantRepository, ExamRepository } from "../exam/exam.service.js";
import type { ProducedJob } from "../queue/job-producer.js";
import type { TeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import type { StudentStore } from "../student/student-store.js";
import type { TenantStore } from "../tenant/tenant-store.js";
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
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
      },
    );

    expect(producer.inputs).toEqual([{
      queueName: "report-generation",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "exam-a",
      contentHash: "results-v1",
      reportType: examResultSummaryReportType,
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
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
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
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
    const service = new ReportGenerationService(
      producer,
      store,
      undefined,
      undefined,
      new FakeStudentStore() as unknown as StudentStore,
      undefined,
      new FakeExamRepository() as unknown as ExamRepository,
      new FakeExamParticipantRepository() as unknown as ExamParticipantRepository,
      new FakeTenantStore() as unknown as TenantStore,
    );

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

  it("snapshot listesini akademik bağlam filtresiyle daraltır", async () => {
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
      { courseId: "course-math", termId: "term-2026-spring" },
    );

    expect(result).toEqual([fakeSnapshot]);
  });

  it("teacher snapshot listesini kendi sınıf ve öğrencileriyle sınırlar", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore([fakeMixedSnapshot]);
    const service = new ReportGenerationService(
      producer,
      store,
      undefined,
      undefined,
      new FakeStudentStore() as unknown as StudentStore,
      new FakeTeacherAssignmentStore() as unknown as TeacherAssignmentStore,
    );

    const result = await service.listSnapshots(
      {
        tenantId: "tenant-a",
        userId: "teacher-tenant-a",
        roles: ["TEACHER"],
        subjectType: "TEACHER",
        subjectId: "teacher-a",
        bypassRls: false,
      },
      "exam-a",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.snapshotData).toEqual({
      reportType: examResultSummaryReportType,
      generatedAt: "2026-06-06T09:00:00.000Z",
      resultCount: 1,
      classes: [
        expect.objectContaining({ classId: "class-a", className: "8-A" }),
      ],
      students: [
        expect.objectContaining({ studentId: "student-a", classId: "class-a" }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("student-c");
    expect(JSON.stringify(result)).not.toContain("class-c");
    expect(JSON.stringify(result)).not.toContain("Genel Matematik");
  });

  it("teacher ders ve dönem sınırlı assignment ile başka bağlamdaki rapor öğrencisini okuyamaz", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore([fakeSnapshot, fakePreviousSnapshot]);
    const service = new ReportGenerationService(
      producer,
      store,
      undefined,
      undefined,
      new FakeStudentStore([
        { id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A", classId: "class-a", status: "ACTIVE" },
      ]) as unknown as StudentStore,
      new FakeTeacherAssignmentStore([
        {
          id: "teacher-assignment-math",
          tenantId: "tenant-a",
          teacherId: "teacher-a",
          classId: "class-a",
          courseId: "course-math",
          termId: "term-2026-spring",
          role: "BRANCH_TEACHER",
        },
      ]) as unknown as TeacherAssignmentStore,
    );
    const teacherContext: RequestContext = {
      tenantId: "tenant-a",
      userId: "teacher-tenant-a",
      roles: ["TEACHER"],
      subjectType: "TEACHER",
      subjectId: "teacher-a",
      bypassRls: false,
    };

    await expect(service.getStudentReport(teacherContext, "exam-a", "snapshot-a", "student-a")).resolves.toMatchObject({
      studentId: "student-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    });
    await expect(service.getStudentReport(teacherContext, "exam-a", "snapshot-previous", "student-a")).rejects.toThrow(ForbiddenException);

    const progress = await service.getStudentProgress(teacherContext, "exam-a", "student-a");
    expect(progress.points.map((point) => point.snapshotId)).toEqual(["snapshot-a"]);

    const snapshots = await service.listSnapshots(teacherContext, "exam-a");
    expect(snapshots.find((snapshot) => snapshot.id === "snapshot-a")?.snapshotData?.resultCount).toBe(1);
    expect(snapshots.find((snapshot) => snapshot.id === "snapshot-previous")?.snapshotData?.resultCount).toBe(0);
    expect(JSON.stringify(snapshots.find((snapshot) => snapshot.id === "snapshot-previous"))).not.toContain("student-a");
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
    expect(workbook.getWorksheet("Students")?.getCell("K2").value).toBe(3);
    expect(workbook.getWorksheet("Students")?.getCell("M2").value).toBe(92.5);
    expect(workbook.getWorksheet("Students")?.getCell("N2").value).toBe(1);
    expect(workbook.getWorksheet("Students")?.getCell("P2").value).toBe(97.5);
    expect(workbook.getWorksheet("Students")?.getCell("Q2").value).toBe(123.4);
    expect(workbook.getWorksheet("Classes")?.getCell("J2").value).toBe(96.7);
    expect(workbook.getWorksheet("Summary")?.getCell("B10").value).toBe(101.5);
    expect(workbook.getWorksheet("BranchStatistics")?.getCell("A2").value).toBe("student-a");
    expect(workbook.getWorksheet("BranchStatistics")?.getCell("B2").value).toBe("Matematik");
    expect(workbook.getWorksheet("BranchStatistics")?.getCell("D2").value).toBe(3);
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
    expect(pdfRenderer.inputs[0]?.html).toContain("Öğrenci Karnesi");
    expect(pdfRenderer.inputs[0]?.html).toContain("BÖLÜM ANALİZİ");
    expect(pdfRenderer.inputs[0]?.html).toContain("Soru sayısı");
    expect(pdfRenderer.inputs[0]?.html).toContain("Sınıf net ort");
    expect(pdfRenderer.inputs[0]?.html).toContain("PUAN - SIRA ANALİZİ");
    expect(pdfRenderer.inputs[0]?.html).toContain("Tahmini ham puan");
    expect(pdfRenderer.inputs[0]?.html).toContain("BÖLÜM BAŞARI YÜZDELERİ");
    expect(pdfRenderer.inputs[0]?.html).toContain("SON SINAV NETLERİ");
    expect(pdfRenderer.inputs[0]?.html).toContain("Matematik");
    expect(pdfRenderer.inputs[0]?.html).toContain("student-a");
    expect(pdfRenderer.inputs[0]?.html).toContain("Genel sıra");
    expect(pdfRenderer.inputs[0]?.html).toContain("3/40 (%92.5)");
    expect(pdfRenderer.inputs[0]?.html).toContain("Sınıf sıra");
    expect(pdfRenderer.inputs[0]?.html).toContain("1/20 (%97.5)");
    expect(pdfRenderer.inputs[0]?.fallbackLines).toContain("Uzman Hocam - Sinav Raporu");
    expect(pdfRenderer.inputs[0]?.fallbackLines).toContain("Ogrenci Karnesi");
    expect(pdfRenderer.inputs[0]?.fallbackLines).toContain("student-a 8-A: 17.5 net, genel 3/40 (%92.5), sinif 1/20 (%97.5)");
  });

  it("hazır snapshot içinden öğrenci sınav raporu döner", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(
      producer,
      store,
      undefined,
      undefined,
      new FakeStudentStore() as unknown as StudentStore,
      undefined,
      new FakeExamRepository() as unknown as ExamRepository,
      new FakeExamParticipantRepository() as unknown as ExamParticipantRepository,
      new FakeTenantStore() as unknown as TenantStore,
    );

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
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-a",
      examTitle: "İSEM - LGS - 1",
      examStartsAt: "2026-06-06T09:00:00.000Z",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      studentName: "Ada A",
      participantNo: "331",
      bookletType: "B",
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
        estimatedRawScore: 123.4,
      },
      branches: [
        {
          branch: "Matematik",
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
          classNetAverage: 16.75,
          schoolNetAverage: 17.5,
          generalNetAverage: 15.5,
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

  it("teacher kapsam dışı öğrenci raporunu okuyamaz", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const service = new ReportGenerationService(
      producer,
      store,
      undefined,
      undefined,
      new FakeStudentStore() as unknown as StudentStore,
      new FakeTeacherAssignmentStore() as unknown as TeacherAssignmentStore,
    );

    await expect(service.getStudentReport(
      {
        tenantId: "tenant-a",
        userId: "teacher-tenant-a",
        roles: ["TEACHER"],
        subjectType: "TEACHER",
        subjectId: "teacher-a",
        bypassRls: false,
      },
      "exam-a",
      "snapshot-a",
      "student-c",
    )).rejects.toThrow(ForbiddenException);
    expect(store.findInputs).toEqual([]);
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
            estimatedRawScore: 123.4,
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

class FakeStudentStore {
  constructor(private readonly records = [
    { id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A", classId: "class-a", responsibleTeacherId: "teacher-a", status: "ACTIVE" },
    { id: "student-c", tenantId: "tenant-a", firstName: "Can", lastName: "C", classId: "class-c", status: "ACTIVE" },
  ]) {}

  async list() {
    return this.records;
  }

  async findById(id: string) {
    return (await this.list()).find((student) => student.id === id);
  }
}

class FakeExamRepository {
  async findById(tenantId: string, examId: string) {
    if (tenantId !== "tenant-a" || examId !== "exam-a") return undefined;
    return {
      id: "exam-a",
      tenantId,
      title: "İSEM - LGS - 1",
      status: "PUBLISHED",
      startsAt: "2026-06-06T09:00:00.000Z",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    };
  }
}

class FakeExamParticipantRepository {
  async list(tenantId: string, examId: string) {
    if (tenantId !== "tenant-a" || examId !== "exam-a") return [];
    return [{
      id: "participant-a",
      tenantId,
      examId,
      studentId: "student-a",
      participantNo: "331",
      bookletType: "B",
      status: "REGISTERED",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    }];
  }
}

class FakeTenantStore {
  async findById(id: string) {
    if (id !== "tenant-a") return undefined;
    return { id, name: "DNA EĞİTİM KURUMU" };
  }
}

class FakeTeacherAssignmentStore {
  constructor(private readonly records: FakeTeacherAssignment[] = [
    { id: "teacher-assignment-a", tenantId: "tenant-a", teacherId: "teacher-a", classId: "class-a", role: "CLASS_TEACHER" },
  ]) {}

  async listByTeacher(teacherId: string) {
    return this.records.filter((assignment) => assignment.teacherId === teacherId);
  }
}

interface FakeTeacherAssignment {
  id: string;
  tenantId: string;
  teacherId: string;
  role: string;
  studentId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  startsAt?: string;
  endsAt?: string;
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
      estimatedRawScore: 101.5,
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
          estimatedRawScore: 96.7,
        },
        branches: [
          {
            branch: "Matematik",
            resultCount: 1,
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 16.75,
          },
        ],
      },
    ],
    statistics: {
      branches: [{ branch: "Matematik", count: 1, meanNet: 15.5, sdNet: 0 }],
    },
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
          estimatedRawScore: 123.4,
        },
        branches: [
          {
            branch: "Matematik",
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
          classNetAverage: 16.75,
          schoolNetAverage: 17.5,
          generalNetAverage: 15.5,
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

class FakeReportSnapshotStore implements ReportSnapshotStore {
  readonly inputs: Array<{ tenantId: string; examId: string }> = [];
  readonly findInputs: Array<{ tenantId: string; examId: string; snapshotId: string }> = [];

  constructor(private readonly records: ReportSnapshotRecord[] = [fakeSnapshot, fakePreviousSnapshot]) {}

  async listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]> {
    this.inputs.push({ tenantId, examId });
    return this.records.filter((snapshot) => snapshot.tenantId === tenantId && snapshot.examId === examId);
  }

  async findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined> {
    this.findInputs.push({ tenantId, examId, snapshotId });
    return this.records.find(
      (snapshot) => snapshot.tenantId === tenantId && snapshot.examId === examId && snapshot.id === snapshotId,
    );
  }

  async markStaleByExam(): Promise<number> {
    return 0;
  }
}

const fakeMixedSnapshot: ReportSnapshotRecord = {
  ...fakeSnapshot,
  snapshotData: {
    ...fakeSnapshot.snapshotData,
    resultCount: 2,
    averages: {
      net: 16,
      standardScore: 80,
    },
    branches: [
      {
        branch: "Genel Matematik",
        resultCount: 2,
        net: 16,
      },
    ],
    classes: [
      ...((fakeSnapshot.snapshotData?.classes as Record<string, unknown>[] | undefined) ?? []),
      {
        classId: "class-c",
        className: "9-C",
        resultCount: 1,
        averages: {
          correct: 12,
          wrong: 4,
          blank: 4,
          net: 11,
          standardScore: 70,
        },
      },
    ],
    students: [
      ...((fakeSnapshot.snapshotData?.students as Record<string, unknown>[] | undefined) ?? []),
      {
        studentId: "student-c",
        classId: "class-c",
        className: "9-C",
        resultKey: "result-c",
        total: {
          correct: 12,
          wrong: 4,
          blank: 4,
          net: 11,
          standardScore: 70,
        },
      },
    ],
  },
};
