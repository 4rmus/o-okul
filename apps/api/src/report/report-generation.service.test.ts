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
import { InMemoryReportSnapshotStore, type ReportSnapshotStore } from "./report-snapshot-store.js";

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
    const store = new FakeReportSnapshotStore([{
      ...fakeMixedSnapshot,
      snapshotData: {
        ...fakeMixedSnapshot.snapshotData,
        schemaVersion: 2,
        scoreAverages: [{ type: "LGS", calculatedCount: 2, practiceScore: 420 }],
      },
    }]);
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
    expect(serialized).not.toContain("scoreAverages");
    expect(serialized).not.toContain("\"questions\"");
    expect(serialized).not.toContain("\"answer\"");
    expect(serialized).not.toContain("\"correctAnswer\"");
  });

  it("yalnız öğrenci ataması olan öğretmene bütün sınıf özetini göstermez", async () => {
    const service = new ReportGenerationService(
      new FakeProducer(),
      new FakeReportSnapshotStore([fakeSnapshot]),
      undefined,
      undefined,
      new FakeStudentStore() as unknown as StudentStore,
      new FakeTeacherAssignmentStore([
        { id: "assignment-student-a", tenantId: "tenant-a", teacherId: "teacher-a", studentId: "student-a", role: "MENTOR" },
      ]) as unknown as TeacherAssignmentStore,
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
        { id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A", classId: "class-z", status: "ACTIVE" },
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
          startsAt: "2026-01-01",
          endsAt: "2026-06-10",
        },
      ]) as unknown as TeacherAssignmentStore,
    );
    const teacherContext: RequestContext = {
      tenantId: "tenant-a",
      userId: "teacher-tenant-a",
      roles: ["TEACHER"],
      activePersona: "TEACHER",
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-a"] },
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

  it("kampüs sınırlı personel tenant-geneli rapor kuyruğu ve snapshot listesini kullanamaz", async () => {
    const producer = new FakeProducer();
    const store = new FakeReportSnapshotStore([fakeSnapshot]);
    const service = new ReportGenerationService(producer, store);
    const context: RequestContext = {
      ...adminContext(),
      activePersona: "STAFF",
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-a"] },
    };

    await expect(service.enqueueGeneration(context, {
      examId: "exam-a",
      reportType: examResultSummaryReportType,
    })).rejects.toThrow(ForbiddenException);
    await expect(service.listSnapshots(context, "exam-a")).rejects.toThrow(ForbiddenException);

    expect(producer.inputs).toHaveLength(0);
    expect(store.inputs).toHaveLength(0);
  });

  it("hazır snapshotı Excel dosyasına dönüştürür", async () => {
    const producer = new FakeProducer();
    const firstStudent = (fakeSnapshot.snapshotData?.students as Array<Record<string, unknown>> | undefined)?.[0];
    const store = new FakeReportSnapshotStore([{
      ...fakeSnapshot,
      snapshotData: {
        ...fakeSnapshot.snapshotData,
        resultCount: 2,
        students: [
          firstStudent!,
          {
            ...firstStudent!,
            studentId: "student-b",
            displayName: "Bora B",
            studentNo: "1002",
            resultKey: "result-b",
            branches: [
              { branch: "Fen", correct: 8, wrong: 1, blank: 1, net: 7.75 },
              { branch: "Türkçe", correct: 7, wrong: 2, blank: 1, net: 6.5 },
            ],
            outcomes: [
              { outcomeCode: "FEN.8.1.1", branch: "Fen", correct: 4, wrong: 1, blank: 0, net: 3.75 },
              { outcomeCode: "TUR.8.1.1", branch: "Türkçe", correct: 3, wrong: 1, blank: 1, net: 2.75 },
            ],
            questions: [
              { questionNo: 1, branch: "Fen", outcomeCode: "FEN.8.1.1", answer: "A", correctAnswer: "A", status: "CORRECT" },
              { questionNo: 2, branch: "Türkçe", outcomeCode: "TUR.8.1.1", answer: "B", correctAnswer: "C", status: "WRONG" },
            ],
          },
        ],
      },
    }]);
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
    expect(result.rowCount).toBe(2);

    const workbook = new ExcelJS.Workbook();
    const bytes = Buffer.from(result.fileBase64, "base64");
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "Özet",
      "Öğrenciler",
      "Öğrenci Branşları",
      "Sınıf-Branş",
      "Kazanımlar",
      "Soru Detayı",
    ]);
    expect(workbook.getWorksheet("Özet")?.getCell("B1").value).toBe("exam-a");
    expect(workbook.getWorksheet("Sınıf-Branş")?.getCell("F1").value).toBe("Başarı %");
    expect(workbook.getWorksheet("Sınıf-Branş")?.getCell("D2").value).toBe("Matematik");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("G1").value).toBe("Başarı %");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("N1").value).toBe("LGS Deneme puanı");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("A2").value).toBe("Ada A");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("B2").value).toBe("1001");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("C2").value).toBe("student-a");
    expect(workbook.getWorksheet("Öğrenciler")?.getCell("E2").value).toBe("8-A");
    expect(workbook.getWorksheet("Özet")?.getCell("A13").value).toBe("Eski hesaplama");
    expect(workbook.getWorksheet("Özet")?.getCell("B13").value).toBe(101.5);
    expect(workbook.getWorksheet("Öğrenci Branşları")?.actualRowCount).toBe(4);
    expect(workbook.getWorksheet("Öğrenci Branşları")?.getCell("A4").value).toBe("student-b");
    expect(workbook.getWorksheet("Öğrenci Branşları")?.getCell("E4").value).toBe("Türkçe");
    expect(workbook.getWorksheet("Kazanımlar")?.actualRowCount).toBe(4);
    expect(workbook.getWorksheet("Kazanımlar")?.getCell("E4").value).toBe("TUR.8.1.1");
    expect(workbook.getWorksheet("Soru Detayı")?.actualRowCount).toBe(6);
    expect(workbook.getWorksheet("Soru Detayı")?.getCell("A6").value).toBe("student-b");
    expect(workbook.getWorksheet("Soru Detayı")?.getCell("E6").value).toBe(2);
    expect(workbook.getWorksheet("Soru Detayı")?.getCell("J6").value).toBe("WRONG");
  });

  it("schemaVersion 2 puan görünümlerini öğrenci, Excel ve fallback PDF'de aynı snapshot değerleriyle taşır", async () => {
    const v2Snapshot: ReportSnapshotRecord = {
      ...fakeSnapshot,
      id: "snapshot-v2",
      snapshotData: {
        schemaVersion: 2,
        examType: "AYT",
        examYear: 2026,
        scoringProfileId: "TR-YKS-2026-NOSD-V1",
        examTitle: "Örnek AYT 2026",
        examStartsAt: "2026-06-21T07:15:00.000Z",
        generatedAt: "2026-07-27T10:15:00.000Z",
        resultCount: 1,
        averages: { correct: 80, wrong: 20, blank: 60, net: 75, questionCount: 160, successRate: 46.875 },
        scoreAverages: [
          { type: "SAY", calculatedCount: 1, practiceScore: 410 },
          { type: "EA", calculatedCount: 1, practiceScore: 390 },
        ],
        branches: [
          { branch: "AYT Matematik", resultCount: 1, correct: 30, wrong: 8, blank: 2, net: 28, questionCount: 40, successRate: 70 },
          { branch: "Edebiyat", resultCount: 1, correct: 18, wrong: 3, blank: 3, net: 17.25, questionCount: 24, successRate: 71.875 },
        ],
        students: [{
          studentId: "student-a",
          displayName: "Ada A",
          participantNo: "ÖR-001",
          bookletType: "A",
          resultKey: "result-v2",
          total: { correct: 80, wrong: 20, blank: 60, net: 75, questionCount: 160, successRate: 46.875 },
          branches: [
            { branch: "AYT Matematik", correct: 30, wrong: 8, blank: 2, net: 28, questionCount: 40, successRate: 70 },
            { branch: "Edebiyat", correct: 18, wrong: 3, blank: 3, net: 17.25, questionCount: 24, successRate: 71.875 },
          ],
          scoreViews: [
            {
              type: "SAY",
              status: "CALCULATED",
              metrics: { correct: 50, wrong: 10, blank: 20, net: 47.5, questionCount: 80, successRate: 59.375 },
              practiceScore: 410,
              profileId: "TR-YKS-2026-NOSD-V1",
              officialComparable: false,
            },
            {
              type: "EA",
              status: "CALCULATED",
              metrics: { correct: 45, wrong: 15, blank: 20, net: 41.25, questionCount: 80, successRate: 51.5625 },
              practiceScore: 390,
              profileId: "TR-YKS-2026-NOSD-V1",
              officialComparable: false,
            },
            {
              type: "SOZ",
              status: "MISSING_TYT",
              metrics: { correct: 30, wrong: 10, blank: 40, net: 27.5, questionCount: 80, successRate: 34.375 },
              profileId: "TR-YKS-2026-NOSD-V1",
              officialComparable: false,
            },
          ],
          scoreRankings: [
            { type: "SAY", institution: { rank: 2, outOf: 30 }, class: { rank: 1, outOf: 15 } },
            { type: "EA", institution: { rank: 4, outOf: 30 }, class: { rank: 2, outOf: 15 } },
          ],
          statistics: {
            standardScore: 99,
            general: { rank: 1, outOf: 1, percentile: 100 },
            branches: [],
          },
        }],
      },
      generatedAt: "2026-07-27T10:15:00.000Z",
    };
    const service = new ReportGenerationService(new FakeProducer(), new FakeReportSnapshotStore([v2Snapshot]));
    const context = {
      tenantId: "tenant-a",
      userId: "user-a",
      roles: ["TENANT_ADMIN"],
      bypassRls: false,
    };

    const student = await service.getStudentReport(context, "exam-a", "snapshot-v2", "student-a");
    expect(student).toMatchObject({
      examType: "AYT",
      examYear: 2026,
      scoringProfileId: "TR-YKS-2026-NOSD-V1",
      examTitle: "Örnek AYT 2026",
      examStartsAt: "2026-06-21T07:15:00.000Z",
      participantNo: "ÖR-001",
      bookletType: "A",
      scoreViews: [
        { type: "SAY", practiceScore: 410, officialComparable: false },
        { type: "EA", practiceScore: 390, officialComparable: false },
        { type: "SOZ", status: "MISSING_TYT", officialComparable: false },
      ],
      scoreRankings: [
        { type: "SAY", institution: { rank: 2, outOf: 30 }, class: { rank: 1, outOf: 15 } },
        { type: "EA", institution: { rank: 4, outOf: 30 }, class: { rank: 2, outOf: 15 } },
      ],
    });
    expect(student.statistics).toBeUndefined();

    const excel = await service.exportSnapshotExcel(context, "exam-a", "snapshot-v2");
    const workbook = new ExcelJS.Workbook();
    const excelBytes = Buffer.from(excel.fileBase64, "base64");
    const excelFile = excelBytes.buffer.slice(excelBytes.byteOffset, excelBytes.byteOffset + excelBytes.byteLength);
    await workbook.xlsx.load(excelFile as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    expect(workbook.created?.toISOString()).toBe("2026-07-27T10:15:00.000Z");
    const studentsSheet = workbook.getWorksheet("Öğrenciler")!;
    const headerValues = studentsSheet.getRow(1).values as Array<unknown>;
    const valueForHeader = (header: string) => studentsSheet.getRow(2).getCell(headerValues.indexOf(header)).value;
    expect(valueForHeader("Sayısal Durum")).toBe("Hesaplandı");
    expect(valueForHeader("Sayısal Deneme puanı")).toBe(410);
    expect(valueForHeader("Sayısal · Mat net")).toBe(28);
    expect(valueForHeader("Sayısal Kurum başarı sırası")).toBe("2/30");
    expect(valueForHeader("Sayısal Sınıf başarı sırası")).toBe("1/15");
    expect(valueForHeader("EA Durum")).toBe("Hesaplandı");
    expect(valueForHeader("EA Deneme puanı")).toBe(390);
    expect(valueForHeader("EA · Mat net")).toBe(28);
    expect(valueForHeader("EA · Edb net")).toBe(17.25);
    expect(valueForHeader("EA Kurum başarı sırası")).toBe("4/30");
    expect(valueForHeader("Sözel Durum")).toBe("Bağlı TYT deneme puanı yok");
    expect(valueForHeader("Sözel · Edb net")).toBe(17.25);
    expect(workbook.getWorksheet("Özet")?.getCell("B13").value).toBe(410);
    expect(workbook.getWorksheet("Özet")?.getCell("B14").value).toBe(390);
    expect(workbook.getWorksheet("Özet")?.getColumn(1).values).not.toContain("Uyarı");
    expect(JSON.stringify(workbook.getWorksheet("Özet")?.getColumn(2).values)).not.toContain("MEB/ÖSYM");
    expect(workbook.getWorksheet("Özet")?.getColumn(1).values).toContain("Ders başarı grafiği");
    expect(workbook.getWorksheet("Özet")?.getColumn(1).values).toContain("Puan türü grafiği");

    const pdf = await service.exportSnapshotKarnelerPdf(context, "exam-a", "snapshot-v2");
    const pdfText = Buffer.from(pdf.fileBase64, "base64").toString("utf8");
    expect(pdfText).toContain("SAY deneme puani 410");
    expect(pdfText).toContain("EA deneme puani 390");
    expect(pdfText).toContain("SAY kurum 2/30");
    expect(pdfText).not.toContain("MEB/ÖSYM");
    expect(pdfText).not.toContain("LGS puani");
    expect(pdfText).not.toContain("Standart puan");
    expect(pdfText).not.toContain("yüzdelik");
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
    expect(result.fileName).toBe("exam-a-snapshot-a-kurum-ozeti.pdf");
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
        pdfMode: "INSTITUTION_SUMMARY",
        students: [expect.objectContaining({ studentId: "student-a" })],
      }),
    });

    const packet = await service.exportSnapshotKarnelerPdf(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      "exam-a",
      "snapshot-a",
    );
    expect(packet.fileName).toBe("exam-a-snapshot-a-toplu-karneler.pdf");
    expect(pdfRenderer.inputs.at(-1)?.snapshot.snapshotData).toMatchObject({
      pdfMode: "STUDENT_CARDS",
      students: [expect.objectContaining({ studentId: "student-a" })],
    });

    const single = await service.exportStudentPdf(
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
    expect(single.fileName).toBe("exam-a-snapshot-a-student-a-karne.pdf");
    expect(pdfRenderer.inputs.at(-1)?.snapshot.snapshotData).toMatchObject({
      pdfMode: "STUDENT_CARDS",
      students: [expect.objectContaining({ studentId: "student-a" })],
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
    expect(store.findInputs).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-a",
    }]);
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

  it("tek sınav kapsamında aynı sınavın snapshotlarından tek gelişim noktası döner", async () => {
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

    expect(store.studentInputs).toEqual([{ tenantId: "tenant-a", studentId: "student-a", examId: "exam-a" }]);
    // snapshot-a and snapshot-previous have the same scope width; the more recently generated one is kept.
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      studentId: "student-a",
      points: [
        {
          snapshotId: "snapshot-a",
          examId: "exam-a",
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
      successRateDelta: 0,
      netDelta: 0,
      standardScoreDelta: 0,
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
    expect(store.tenantInputs).toEqual([]);
    expect(store.studentInputs).toEqual([{ tenantId: "tenant-a", studentId: "student-a" }]);
    expect(result.examId).toBe("exam-a");
    expect(result.points.map((point) => [point.examId, point.snapshotId])).toEqual([
      ["exam-a", "snapshot-a"],
      ["exam-b", "snapshot-other-exam"],
    ]);
    expect(result.points.map((point) => point.total.net)).toEqual([17.5, 20]);
    expect(result.successRateDelta).toBe(12.5);
    expect(result.netDelta).toBe(2.5);
    expect(result.standardScoreDelta).toBe(2.5);
  });

  it("gelişim noktaları snapshot'ta saklanan sınav tarihine göre sıralanır; sınav tarihi yoksa sınav kaydının tarihine, o da yoksa rapor tarihine düşer", async () => {
    const producer = new FakeProducer();
    // exam-b is generated first but held later; exam-a is generated later but held earlier; exam-c stored no exam date
    // (legacy snapshot) and its Exam row holds the date; exam-d stored none and its Exam row cannot be read.
    const examBSnapshot: ReportSnapshotRecord = {
      ...fakeOtherExamSnapshot,
      generatedAt: "2026-06-02T09:00:00.000Z",
      snapshotData: { ...fakeOtherExamSnapshot.snapshotData, examStartsAt: "2026-05-20T07:00:00.000Z", examTitle: "Deneme 2" },
    };
    const examASnapshot: ReportSnapshotRecord = {
      ...fakeSnapshot,
      generatedAt: "2026-06-06T09:00:00.000Z",
      snapshotData: { ...fakeSnapshot.snapshotData, examStartsAt: "2026-05-10T07:00:00.000Z", examTitle: " Deneme 1 " },
    };
    const examCSnapshot: ReportSnapshotRecord = {
      ...fakePreviousSnapshot,
      id: "snapshot-exam-c",
      examId: "exam-c",
      generatedAt: "2026-05-15T09:00:00.000Z",
    };
    const examDSnapshot: ReportSnapshotRecord = {
      ...fakePreviousSnapshot,
      id: "snapshot-exam-d",
      examId: "exam-d",
      generatedAt: "2026-05-12T09:00:00.000Z",
    };
    const store = new InMemoryReportSnapshotStore({ snapshots: [examASnapshot, examBSnapshot, examCSnapshot, examDSnapshot] });
    // exam-c was held after exam-b although its report came out before exam-b's report.
    const exams = new FakeExamDirectory([{ id: "exam-c", startsAt: "2026-05-25T07:00:00.000Z" }]);
    const service = new ReportGenerationService(
      producer,
      store,
      undefined,
      undefined,
      undefined,
      undefined,
      exams as unknown as ExamRepository,
    );

    const result = await service.getStudentProgress(
      { tenantId: "tenant-a", userId: "user-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      "exam-a",
      "student-a",
      { scope: "all" },
    );

    // Only the legacy exams are read, in one tenant-scoped batch.
    expect(exams.calls).toEqual([{ tenantId: "tenant-a", examIds: ["exam-c", "exam-d"] }]);
    expect(result.points.map((point) => [point.examId, point.examTitle, point.examStartsAt, point.generatedAt])).toEqual([
      ["exam-a", "Deneme 1", "2026-05-10T07:00:00.000Z", "2026-06-06T09:00:00.000Z"],
      ["exam-d", undefined, undefined, "2026-05-12T09:00:00.000Z"],
      ["exam-b", "Deneme 2", "2026-05-20T07:00:00.000Z", "2026-06-02T09:00:00.000Z"],
      ["exam-c", undefined, "2026-05-25T07:00:00.000Z", "2026-05-15T09:00:00.000Z"],
    ]);
    expect(result.points[1]).not.toHaveProperty("examStartsAt");
    expect(result.points[3]).not.toHaveProperty("examTitle");
    // Deltas run first-to-last over the date-ordered points: exam-a (net 17.5) -> exam-c (net 14).
    expect(result.netDelta).toBe(-3.5);
  });

  it("sınav kaydı eski snapshot'ın rapor tarihinden önce tutulduğunda nokta o sınav tarihine göre öne alınır", async () => {
    const producer = new FakeProducer();
    // E1's legacy snapshot was generated after E2's exam date; E1 was still held before E2, so it sorts first and the
    // delta runs E1 -> E2 (net 14 -> 20) instead of flipping sign on the mixed time axis.
    const e1Legacy: ReportSnapshotRecord = {
      ...fakePreviousSnapshot,
      id: "snapshot-e1-legacy",
      examId: "exam-e1",
      generatedAt: "2026-06-10T09:00:00.000Z",
    };
    const e2: ReportSnapshotRecord = {
      ...fakeOtherExamSnapshot,
      id: "snapshot-e2",
      examId: "exam-e2",
      generatedAt: "2026-06-03T09:00:00.000Z",
      snapshotData: { ...fakeOtherExamSnapshot.snapshotData, examStartsAt: "2026-06-01T07:00:00.000Z", examTitle: "Deneme E2" },
    };
    const exams = new FakeExamDirectory([{ id: "exam-e1", startsAt: "2026-05-18T07:00:00.000Z" }]);
    const service = new ReportGenerationService(
      producer,
      new InMemoryReportSnapshotStore({ snapshots: [e2, e1Legacy] }),
      undefined,
      undefined,
      undefined,
      undefined,
      exams as unknown as ExamRepository,
    );

    const result = await service.getStudentProgress(adminContext(), "exam-e1", "student-a", { scope: "all" });

    expect(result.points.map((point) => [point.examId, point.examStartsAt])).toEqual([
      ["exam-e1", "2026-05-18T07:00:00.000Z"],
      ["exam-e2", "2026-06-01T07:00:00.000Z"],
    ]);
    expect(result.netDelta).toBe(6);

    // Without the batch read the repository's findById is used per legacy exam; the order is the same.
    const findOnly = new ReportGenerationService(
      producer,
      new InMemoryReportSnapshotStore({ snapshots: [e2, e1Legacy] }),
      undefined,
      undefined,
      undefined,
      undefined,
      { findById: exams.findById.bind(exams) } as unknown as ExamRepository,
    );
    const viaFindById = await findOnly.getStudentProgress(adminContext(), "exam-e1", "student-a", { scope: "all" });
    expect(viaFindById.points.map((point) => point.examId)).toEqual(["exam-e1", "exam-e2"]);

    // No exam access at all: the legacy point keeps its generation time as the ordering key (E2 first).
    const withoutExams = new ReportGenerationService(producer, new InMemoryReportSnapshotStore({ snapshots: [e2, e1Legacy] }));
    const fallback = await withoutExams.getStudentProgress(adminContext(), "exam-e1", "student-a", { scope: "all" });
    expect(fallback.points.map((point) => point.examId)).toEqual(["exam-e2", "exam-e1"]);
  });

  it("aynı sınavın kurum geneli, seviye ve sınıf snapshotlarından en geniş kapsamlı olanı tek nokta olarak seçer", async () => {
    const producer = new FakeProducer();
    const tenantWide: ReportSnapshotRecord = {
      ...fakeSnapshot,
      id: "snapshot-tenant-wide",
      campusId: undefined,
      gradeLevelId: undefined,
      classId: undefined,
      courseId: undefined,
      termId: undefined,
      generatedAt: "2026-06-01T09:00:00.000Z",
      createdAt: "2026-06-01T09:00:00.000Z",
    };
    const level: ReportSnapshotRecord = {
      ...tenantWide,
      id: "snapshot-level",
      gradeLevelId: "grade-8",
      generatedAt: "2026-06-03T09:00:00.000Z",
      createdAt: "2026-06-03T09:00:00.000Z",
    };
    const levelRegenerated: ReportSnapshotRecord = { ...level, id: "snapshot-level-2", generatedAt: "2026-06-04T09:00:00.000Z" };
    const classScoped: ReportSnapshotRecord = {
      ...fakeSnapshot,
      id: "snapshot-class",
      generatedAt: "2026-06-05T09:00:00.000Z",
      createdAt: "2026-06-05T09:00:00.000Z",
    };
    const service = new ReportGenerationService(
      producer,
      new FakeReportSnapshotStore([classScoped, level, levelRegenerated, tenantWide, fakeOtherExamSnapshot]),
    );

    const all = await service.getStudentProgress(adminContext(), "exam-a", "student-a", { scope: "all" });
    expect(all.points.map((point) => [point.examId, point.snapshotId])).toEqual([
      ["exam-a", "snapshot-tenant-wide"],
      ["exam-b", "snapshot-other-exam"],
    ]);

    const single = await service.getStudentProgress(adminContext(), "exam-a", "student-a");
    expect(single.points.map((point) => point.snapshotId)).toEqual(["snapshot-tenant-wide"]);

    // Without the tenant-wide snapshot the level snapshot (one filter) beats the class one; the newer level wins.
    const withoutTenantWide = new ReportGenerationService(
      producer,
      new FakeReportSnapshotStore([classScoped, level, levelRegenerated]),
    );
    const levelOnly = await withoutTenantWide.getStudentProgress(adminContext(), "exam-a", "student-a");
    expect(levelOnly.points.map((point) => point.snapshotId)).toEqual(["snapshot-level-2"]);
  });

  it("öğretmen yalnız erişebildiği sınıf snapshotını gelişim noktası olarak alır", async () => {
    const producer = new FakeProducer();
    const tenantWide: ReportSnapshotRecord = {
      ...fakeSnapshot,
      id: "snapshot-tenant-wide",
      campusId: undefined,
      gradeLevelId: undefined,
      classId: undefined,
      courseId: undefined,
      termId: undefined,
      generatedAt: "2026-06-07T09:00:00.000Z",
      createdAt: "2026-06-07T09:00:00.000Z",
    };
    const service = new ReportGenerationService(
      producer,
      new FakeReportSnapshotStore([tenantWide, fakeSnapshot]),
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
          startsAt: "2026-01-01",
          endsAt: "2026-06-10",
        },
      ]) as unknown as TeacherAssignmentStore,
    );
    const teacherContext: RequestContext = {
      tenantId: "tenant-a",
      userId: "teacher-tenant-a",
      roles: ["TEACHER"],
      activePersona: "TEACHER",
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
      subjectType: "TEACHER",
      subjectId: "teacher-a",
      bypassRls: false,
    };

    const teacherProgress = await service.getStudentProgress(teacherContext, "exam-a", "student-a", { scope: "all" });
    expect(teacherProgress.points.map((point) => point.snapshotId)).toEqual(["snapshot-a"]);

    const adminProgress = await service.getStudentProgress(adminContext(), "exam-a", "student-a", { scope: "all" });
    expect(adminProgress.points.map((point) => point.snapshotId)).toEqual(["snapshot-tenant-wide"]);
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

    expect(store.studentInputs).toEqual([{ tenantId: "tenant-a", studentId: "student-c", examId: "exam-a" }]);
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

class FakeExamDirectory {
  readonly calls: Array<{ tenantId: string; examIds: string[] }> = [];

  constructor(private readonly exams: Array<{ id: string; startsAt?: string }>) {}

  async findById(tenantId: string, examId: string) {
    const exam = this.exams.find((candidate) => candidate.id === examId);
    return tenantId === "tenant-a" && exam ? this.toRecord(tenantId, exam) : undefined;
  }

  async listByIds(tenantId: string, examIds: string[]) {
    this.calls.push({ tenantId, examIds });
    if (tenantId !== "tenant-a") return [];
    return this.exams.filter((exam) => examIds.includes(exam.id)).map((exam) => this.toRecord(tenantId, exam));
  }

  private toRecord(tenantId: string, exam: { id: string; startsAt?: string }) {
    return {
      id: exam.id,
      tenantId,
      title: `Sınav ${exam.id}`,
      status: "PUBLISHED",
      ...(exam.startsAt ? { startsAt: exam.startsAt } : {}),
      createdAt: "2026-05-01T09:00:00.000Z",
      updatedAt: "2026-05-01T09:00:00.000Z",
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
  readonly studentInputs: Array<{ tenantId: string; studentId: string; examId?: string }> = [];
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

  async listReadyByStudent(tenantId: string, studentId: string, examId?: string): Promise<ReportSnapshotRecord[]> {
    this.studentInputs.push({ tenantId, studentId, ...(examId ? { examId } : {}) });
    return this.records.filter((snapshot) =>
      snapshot.tenantId === tenantId
      && snapshot.status === "READY"
      && !snapshot.deletedAt
      && (!examId || snapshot.examId === examId)
      && Array.isArray(snapshot.snapshotData?.students)
      && snapshot.snapshotData.students.some(
        (student) => Boolean(student) && typeof student === "object" && !Array.isArray(student) && student.studentId === studentId,
      ));
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
