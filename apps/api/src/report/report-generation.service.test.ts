import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
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
  createReportPdfRenderer,
  createReportGenerationContentHash,
  examResultSummaryReportType,
  ReportGenerationService,
  type ReportGenerationJobStatusReader,
  type ReportGenerationQueuedJobStatus,
  type ReportGenerationQueueProducer,
  type ReportPdfRenderer,
  type ReportSnapshotRecord,
} from "./report-generation.service.js";
import type { ReportSnapshotStore } from "./report-snapshot-store.js";

describe("ReportGenerationService", () => {
  it("production ortamında API içi PDF renderer'ı reddeder", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRenderer = process.env.REPORT_PDF_RENDERER;
    try {
      process.env.NODE_ENV = "production";
      process.env.REPORT_PDF_RENDERER = "memory";

      expect(() => createReportPdfRenderer()).toThrow('REPORT_PDF_RENDERER must be "worker" in production.');
    } finally {
      restoreEnv("NODE_ENV", previousNodeEnv);
      restoreEnv("REPORT_PDF_RENDERER", previousRenderer);
    }
  });

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
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
      },
    );

    const contentHash = createReportGenerationContentHash({
      tenantId: "tenant-a",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    });
    expect(producer.inputs).toEqual([{
      queueName: "report-generation",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "exam-a",
      contentHash,
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
      jobId: `exam-a_${contentHash}`,
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
        contentHash,
        jobId: `exam-a_${contentHash}`,
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
      },
    )).rejects.toThrow(BadRequestException);
    expect(producer.inputs).toHaveLength(0);
  });

  it("aynı kapsamı tekrar kullanır, farklı sınavı farklı snapshot kimliğine bağlar", () => {
    const common = {
      tenantId: "tenant-a",
      reportType: examResultSummaryReportType,
      classId: "class-a",
    } as const;
    const first = createReportGenerationContentHash({ ...common, examId: "exam-a" });
    const retry = createReportGenerationContentHash({ ...common, examId: "exam-a" });
    const secondExam = createReportGenerationContentHash({ ...common, examId: "exam-b" });

    expect(retry).toBe(first);
    expect(secondExam).not.toBe(first);
  });

  it("rapor üretim işinin queue durumunu snapshot durumundan ayrı döndürür", async () => {
    const contentHash = createReportGenerationContentHash({
      tenantId: "tenant-a",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
    });
    const jobId = `exam-a_${contentHash}`;
    const statuses = new FakeReportGenerationJobStatusReader({
      tenantId: "tenant-a",
      examId: "exam-a",
      jobId,
      status: "RUNNING",
      updatedAt: "2026-06-06T09:01:00.000Z",
    });
    const service = new ReportGenerationService(
      new FakeProducer(),
      new FakeReportSnapshotStore(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      statuses,
    );

    await expect(service.getGenerationJobStatus(adminContext(), "exam-a", jobId)).resolves.toEqual({
      jobId,
      status: "RUNNING",
      updatedAt: "2026-06-06T09:01:00.000Z",
    });
  });

  it("tamamlanan upsert işini snapshot sayısı artmasa da generation hash ile bulur", async () => {
    const contentHash = createReportGenerationContentHash({
      tenantId: "tenant-a",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
    });
    const jobId = `exam-a_${contentHash}`;
    const snapshot = {
      ...fakeSnapshot,
      inputRefs: { ...fakeSnapshot.inputRefs, generationContentHash: contentHash },
      updatedAt: "2026-06-06T09:02:00.000Z",
    };
    const service = new ReportGenerationService(
      new FakeProducer(),
      new FakeReportSnapshotStore([snapshot]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new FakeReportGenerationJobStatusReader(),
    );

    await expect(service.getGenerationJobStatus(adminContext(), "exam-a", jobId)).resolves.toEqual({
      jobId,
      status: "COMPLETED",
      snapshotId: "snapshot-a",
      updatedAt: "2026-06-06T09:02:00.000Z",
    });
  });

  it("başka tenantın queue işini jobId bilinse bile göstermez", async () => {
    const contentHash = createReportGenerationContentHash({
      tenantId: "tenant-b",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
    });
    const jobId = `exam-a_${contentHash}`;
    const service = new ReportGenerationService(
      new FakeProducer(),
      new FakeReportSnapshotStore(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new FakeReportGenerationJobStatusReader({
        tenantId: "tenant-b",
        examId: "exam-a",
        jobId,
        status: "FAILED",
        errorCode: "REPORT_GENERATION_FAILED",
        updatedAt: "2026-06-06T09:03:00.000Z",
      }),
    );

    await expect(service.getGenerationJobStatus(adminContext(), "exam-a", jobId)).rejects.toThrow(NotFoundException);
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
    expect(result.map((snapshot) => snapshot.id)).toEqual(["snapshot-a", "snapshot-previous"]);
    expect(result[0]?.snapshotData).toEqual(expect.objectContaining({
      reportType: examResultSummaryReportType,
      generatedAt: "2026-06-06T09:00:00.000Z",
      resultCount: 1,
      averages: expect.objectContaining({ net: 17.5 }),
      branches: [
        expect.objectContaining({ branch: "Matematik", net: 17.5 }),
      ],
      classes: [
        expect.objectContaining({
          classId: "class-a",
          className: "8-A",
          averages: expect.objectContaining({ net: 17.5 }),
        }),
      ],
      students: [
        expect.objectContaining({
          studentId: "student-a",
          resultKey: "result-a",
          total: expect.objectContaining({ net: 17.5 }),
        }),
      ],
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("\"questions\"");
    expect(serialized).not.toContain("\"answer\"");
    expect(serialized).not.toContain("\"correctAnswer\"");
    expect(serialized).not.toContain("\"outcomes\"");
    expect(serialized).not.toContain("\"statistics\"");
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

    expect(result.map((snapshot) => snapshot.id)).toEqual(["snapshot-a"]);
    expect(JSON.stringify(result)).not.toContain("\"questions\"");
    expect(JSON.stringify(result)).not.toContain("\"correctAnswer\"");
  });

  it("öğrenci snapshot listesini sadece öğrenci özet metadata'sı ile döner", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore([createMixedStudentSnapshot(), fakePreviousSnapshot]);
    const service = new ReportGenerationService(producer, store);

    const result = await service.listStudentSnapshots(
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
    expect(result).toHaveLength(2);
    expect(result[0]?.snapshotData).toEqual({
      reportType: examResultSummaryReportType,
      generatedAt: "2026-06-06T09:00:00.000Z",
      resultCount: 1,
      students: [
        expect.objectContaining({
          studentId: "student-a",
          classId: "class-a",
          className: "8-A",
          resultKey: "result-a",
          total: expect.objectContaining({ net: 17.5 }),
        }),
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("student-b");
    expect(serialized).not.toContain("correctAnswer");
    expect(serialized).not.toContain("\"questions\"");
    expect(serialized).not.toContain("\"outcomes\"");
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
    expect(result[0]?.snapshotData).toEqual(expect.objectContaining({
      reportType: examResultSummaryReportType,
      generatedAt: "2026-06-06T09:00:00.000Z",
      resultCount: 1,
      classes: [
        expect.objectContaining({ classId: "class-a", className: "8-A" }),
      ],
      students: [
        expect.objectContaining({
          studentId: "student-a",
          classId: "class-a",
          total: expect.objectContaining({ net: 17.5 }),
        }),
      ],
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("student-c");
    expect(serialized).not.toContain("class-c");
    expect(serialized).not.toContain("Genel Matematik");
    expect(serialized).not.toContain("\"questions\"");
    expect(serialized).not.toContain("\"answer\"");
    expect(serialized).not.toContain("\"correctAnswer\"");
  });

  it("sadece sorumlu veya öğrenci kapsamı olan öğretmene bütün sınıf özetini göstermez", async () => {
    const service = new ReportGenerationService(
      new FakeProducer(),
      new FakeReportSnapshotStore([fakeSnapshot]),
      undefined,
      undefined,
      new FakeStudentStore() as unknown as StudentStore,
      new FakeTeacherAssignmentStore([]) as unknown as TeacherAssignmentStore,
    );

    const [snapshot] = await service.listSnapshots(
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

    expect(snapshot?.snapshotData?.students).toEqual([
      expect.objectContaining({ studentId: "student-a" }),
    ]);
    expect(snapshot?.snapshotData).not.toHaveProperty("classes");
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
    expect(JSON.stringify(snapshots)).not.toContain("\"questions\"");
    expect(JSON.stringify(snapshots)).not.toContain("\"correctAnswer\"");
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

    expect(workbook.getWorksheet("Özet")?.getCell("B1").value).toBe("exam-a");
    expect(workbook.getWorksheet("Branşlar")?.getCell("C1").value).toBe("Başarı %");
    expect(workbook.getWorksheet("Branşlar")?.getCell("A2").value).toBe("Matematik");
    expect(workbook.getWorksheet("Sınıflar")?.getCell("D1").value).toBe("Başarı %");
    expect(workbook.getWorksheet("Sınıflar")?.getCell("B2").value).toBe("8-A");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("G1").value).toBe("Başarı %");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("A2").value).toBe("Ada A");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("B2").value).toBe("1001");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("C2").value).toBe("student-a");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("E2").value).toBe("8-A");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("O2").value).toBe(3);
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("Q2").value).toBe(92.5);
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("R2").value).toBe(1);
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("T2").value).toBe(97.5);
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("U2").value).toBe(123.4);
    expect(workbook.getWorksheet("Sınıflar")?.getCell("L2").value).toBe(96.7);
    expect(workbook.getWorksheet("Özet")?.getCell("B12").value).toBe(101.5);
    expect(workbook.getWorksheet("Branş İstatistikleri")?.getCell("A2").value).toBe("student-a");
    expect(workbook.getWorksheet("Branş İstatistikleri")?.getCell("B2").value).toBe("Matematik");
    expect(workbook.getWorksheet("Branş İstatistikleri")?.getCell("D2").value).toBe(3);
  });

  it("hazır snapshotı PDF dosyasına dönüştürür", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore();
    const pdfRenderer = new FakePdfRenderer();
    const service = new ReportGenerationService(
      producer,
      store,
      pdfRenderer,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new FakeTenantStore() as unknown as TenantStore,
    );

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
    expect(pdfRenderer.inputs[0]?.institution).toEqual({
      institutionLogoUrl: "https://cdn.example.test/dna-logo.png",
      institutionName: "DNA EĞİTİM KURUMU",
    });
    expect(pdfRenderer.inputs[0]?.snapshot).toMatchObject({
      id: "snapshot-a",
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotData: expect.objectContaining({
        resultCount: 1,
        students: [expect.objectContaining({ studentId: "student-a" })],
      }),
    });
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
      institutionLogoUrl: "https://cdn.example.test/dna-logo.png",
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
        questionCount: 20,
        rawScore: 87.5,
        standardScore: 87.5,
        estimatedRawScore: 123.4,
        successRate: 87.5,
      },
      branches: [
        {
          branch: "Matematik",
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
          questionCount: 20,
          classNetAverage: 16.75,
          schoolNetAverage: 17.5,
          generalNetAverage: 15.5,
          successRate: 87.5,
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
          questionCount: 20,
          successRate: 87.5,
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
            questionCount: 20,
            rawScore: 70,
            standardScore: 80,
            successRate: 70,
          },
          branches: [
            {
              branch: "Matematik",
              correct: 15,
              wrong: 4,
              blank: 1,
              net: 14,
              questionCount: 20,
              successRate: 70,
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
            questionCount: 20,
            rawScore: 87.5,
            standardScore: 87.5,
            estimatedRawScore: 123.4,
            successRate: 87.5,
          },
          branches: [
            {
              branch: "Matematik",
              correct: 18,
              wrong: 2,
              blank: 0,
              net: 17.5,
              questionCount: 20,
              successRate: 87.5,
            },
          ],
        },
      ],
      successRateDelta: 17.5,
      netDelta: 3.5,
      standardScoreDelta: 7.5,
    });
  });

  it("öğrenci gelişim raporunu tüm sınav snapshotları üzerinden döner", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore([fakeSnapshot, fakeOtherExamSnapshot, fakePreviousSnapshot]);
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
      { scope: "all" },
    );

    expect(store.inputs).toEqual([]);
    expect(store.tenantInputs).toEqual(["tenant-a"]);
    expect(result.examId).toBe("exam-a");
    expect(result.points.map((point) => point.snapshotId)).toEqual(["snapshot-previous", "snapshot-a", "snapshot-other-exam"]);
    expect(result.points.map((point) => point.total.net)).toEqual([14, 17.5, 20]);
    expect(result.successRateDelta).toBe(30);
    expect(result.netDelta).toBe(6);
    expect(result.standardScoreDelta).toBe(10);
  });

  it("öğrenciye ait hazır snapshot yoksa gelişim raporunu boş döner", async () => {
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
      "student-c",
    );

    expect(store.inputs).toEqual([{ tenantId: "tenant-a", examId: "exam-a" }]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      studentId: "student-c",
      points: [],
    });
  });
});

function adminContext(): RequestContext {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}

class FakeReportGenerationJobStatusReader implements ReportGenerationJobStatusReader {
  constructor(private readonly result?: ReportGenerationQueuedJobStatus) {}

  async get(): Promise<ReportGenerationQueuedJobStatus | undefined> {
    return this.result;
  }
}

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

  async render(input: Parameters<ReportPdfRenderer["render"]>[0]): ReturnType<ReportPdfRenderer["render"]> {
    this.inputs.push(input);
    return {
      fileName: `${input.snapshot.examId}-${input.snapshot.id}.pdf`,
      contentType: "application/pdf",
      fileBase64: Buffer.from("%PDF-1.4\nrich\n%%EOF", "utf8").toString("base64"),
      pageCount: 1,
    };
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
    return { id, name: "DNA EĞİTİM KURUMU", logoUrl: "https://cdn.example.test/dna-logo.png" };
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
        displayName: "Ada A",
        studentNo: "1001",
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

function createMixedStudentSnapshot(): ReportSnapshotRecord {
  return {
    ...fakeSnapshot,
    snapshotData: {
      ...fakeSnapshot.snapshotData,
      students: [
        ...((fakeSnapshot.snapshotData?.students as Record<string, unknown>[] | undefined) ?? []),
        {
          studentId: "student-b",
          classId: "class-a",
          className: "8-A",
          resultKey: "result-b",
          total: {
            correct: 10,
            wrong: 8,
            blank: 2,
            net: 8,
            rawScore: 40,
            standardScore: 55,
          },
          outcomes: [{ outcomeCode: "M.8.1", branch: "Matematik", correct: 1, wrong: 1, blank: 0, net: 0.75 }],
          questions: [{ questionNo: 1, branch: "Matematik", answer: "D", correctAnswer: "A", status: "WRONG" }],
        },
      ],
    },
  };
}

class FakeReportSnapshotStore implements ReportSnapshotStore {
  readonly inputs: Array<{ tenantId: string; examId: string }> = [];
  readonly tenantInputs: string[] = [];
  readonly findInputs: Array<{ tenantId: string; examId: string; snapshotId: string }> = [];

  constructor(private readonly records: ReportSnapshotRecord[] = [fakeSnapshot, fakePreviousSnapshot]) {}

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
    return this.records.find(
      (snapshot) => snapshot.tenantId === tenantId && snapshot.examId === examId && snapshot.id === snapshotId,
    );
  }

  async markStaleByExam(): Promise<number> {
    return 0;
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
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
