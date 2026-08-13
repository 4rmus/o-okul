import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AnswerKeyRecord, ExamParticipantRecord, ExamRecord } from "@o-okul/shared-types";
import { AppModule } from "../app.module.js";
import { AnswerKeyExcelImportService } from "./answer-key-excel-import.service.js";
import {
  answerKeyRepositoryToken,
  type AnswerKeyRepository,
  type SaveAnswerKeyInput,
} from "./answer-key.service.js";
import {
  examParticipantRepositoryToken,
  examRepositoryToken,
  type CreateExamParticipantRepositoryInput,
  type CreateExamRepositoryInput,
  type ExamParticipantRepository,
  type ExamRepository,
  ExamService,
  type UpdateExamRepositoryInput,
} from "./exam.service.js";

describe("ExamController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let repository: FakeExamRepository;
  let participants: FakeExamParticipantRepository;
  let answerKeys: FakeAnswerKeyRepository;

  beforeAll(async () => {
    repository = new FakeExamRepository();
    participants = new FakeExamParticipantRepository();
    answerKeys = new FakeAnswerKeyRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(examRepositoryToken)
      .useValue(repository)
      .overrideProvider(examParticipantRepositoryToken)
      .useValue(participants)
      .overrideProvider(answerKeyRepositoryToken)
      .useValue(answerKeys)
      .overrideProvider(AnswerKeyExcelImportService)
      .useValue({
        import(context: { tenantId?: string }, input: { examId?: string; version?: string }) {
          const answerKey = answerKeys.add({
            tenantId: context.tenantId ?? "tenant-a",
            examId: input.examId ?? "exam-a",
            version: input.version ?? "answer-key-v1",
          });
          return Promise.resolve({
            imported: true,
            answerKey,
            bookletVariants: [],
          });
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    repository.exams.clear();
    participants.participants.clear();
    answerKeys.records.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it("TENANT_ADMIN cevap anahtarı olmadan sınav oluşturamaz", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ title: "Mart Genel Deneme", startsAt: "2026-03-15T09:00:00.000Z" })
      .expect(422);

    expect(repository.exams.size).toBe(0);
  });

  it("TENANT_ADMIN cevap anahtarıyla tek istekte deneme sınavı oluşturur", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        title: "Anahtarlı Deneme",
        startsAt: "2026-03-15T09:00:00.000Z",
        answerKey: {
          version: "anahtarli-deneme-v1",
          fileBase64: Buffer.from("fake-xlsx").toString("base64"),
        },
      })
      .expect(201);

    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      title: "Anahtarlı Deneme",
      status: "DRAFT",
      answerKeySummary: {
        status: "DRAFT",
        version: "anahtarli-deneme-v1",
        questionCount: 1,
        branchCount: 1,
      },
      startsAt: "2026-03-15T09:00:00.000Z",
    });
    expect(repository.exams.size).toBe(1);
    expect(answerKeys.records.size).toBe(1);
  });

  it("TENANT_ADMIN sınav akademik bağlamını oluşturur ve günceller", async () => {
    const issued = await login("admin-a@example.test");
    let alanId = "";
    let otherGradeLevelId = "";
    try {
      const alan = await request(server)
        .post("/alanlar")
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .send({ name: "LGS Alanı", gradeLevelId: "grade-8", code: "LGS-TEST" })
        .expect(201);
      alanId = (alan.body as { id: string }).id;
      const otherGradeLevel = await request(server)
        .post("/grade-levels")
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .send({ name: "9. Sınıf", code: "9-EXAM-TEST" })
        .expect(201);
      otherGradeLevelId = (otherGradeLevel.body as { id: string }).id;

      const created = await request(server)
        .post("/exams")
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .send(examCreateBody("LGS Bağlamlı Deneme", {
          gradeLevelId: "grade-8",
          alanId,
          examType: "LGS",
          examYear: 2026,
          scoringProfileId: "TR-LGS-2026-NOSD-V1",
        }))
        .expect(201);

      expect(created.body).toMatchObject({
        gradeLevelId: "grade-8",
        alanId,
        examType: "LGS",
      });

      await request(server)
        .patch(`/exams/${created.body.id}`)
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .send({ title: "Uyumsuz Bağlam", gradeLevelId: otherGradeLevelId, alanId, examType: "SCHOOL" })
        .expect(400)
        .expect(({ body }) => {
          expect(body.error).toMatchObject({ code: "ALAN_GRADE_LEVEL_MISMATCH" });
        });

      const updated = await request(server)
        .patch(`/exams/${created.body.id}`)
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .send({
          title: "TYT Bağlamlı Deneme",
          gradeLevelId: "grade-8",
          alanId,
          examType: "TYT",
          examYear: 2026,
          scoringProfileId: "TR-YKS-2026-NOSD-V1",
        })
        .expect(409);

      expect(updated.body.error).toMatchObject({
        code: "EXAM_SCORING_PROFILE_IMMUTABLE",
      });

      const titleOnly = await request(server)
        .patch(`/exams/${created.body.id}`)
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .send({ title: "Yeni Başlık", gradeLevelId: "grade-8", alanId })
        .expect(200);
      expect(titleOnly.body).toMatchObject({ title: "Yeni Başlık", examType: "LGS" });
    } finally {
      if (alanId) {
        await request(server).delete(`/alanlar/${alanId}`).set("Authorization", `Bearer ${issued.accessToken}`);
      }
      if (otherGradeLevelId) {
        await request(server).delete(`/grade-levels/${otherGradeLevelId}`).set("Authorization", `Bearer ${issued.accessToken}`);
      }
    }
  });

  it("resmî profil ve bağlı TYT sınavını aynı tenant/tür/yıl kapsamında doğrular", async () => {
    const issued = await login("admin-a@example.test");
    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Eksik profilli LGS", { examType: "LGS" }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "SCORING_PROFILE_REQUIRED" });
      });

    const tyt = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("TYT Denemesi", {
        examType: "TYT",
        examYear: 2026,
        scoringProfileId: "TR-YKS-2026-NOSD-V1",
      }))
      .expect(201);

    const ayt = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("AYT Denemesi", {
        examType: "AYT",
        examYear: 2026,
        scoringProfileId: "TR-YKS-2026-NOSD-V1",
        linkedTytExamId: tyt.body.id,
      }))
      .expect(201);

    expect(ayt.body).toMatchObject({
      examType: "AYT",
      examYear: 2026,
      scoringProfileId: "TR-YKS-2026-NOSD-V1",
      linkedTytExamId: tyt.body.id,
    });
    await request(server)
      .delete(`/exams/${tyt.body.id}`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(409)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "LINKED_TYT_EXAM_IN_USE" });
      });

    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Uyumsuz LGS", {
        examType: "LGS",
        examYear: 2026,
        scoringProfileId: "TR-YKS-2026-NOSD-V1",
      }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "SCORING_PROFILE_EXAM_TYPE_MISMATCH" });
      });

    const crossTenantTytId = "exam-cross-tenant-tyt";
    repository.exams.set(crossTenantTytId, {
      id: crossTenantTytId,
      tenantId: "tenant-b",
      title: "Başka tenant TYT",
      status: "DRAFT",
      examType: "TYT",
      examYear: 2026,
      scoringProfileId: "TR-YKS-2026-NOSD-V1",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Cross tenant AYT", {
        examType: "AYT",
        examYear: 2026,
        scoringProfileId: "TR-YKS-2026-NOSD-V1",
        linkedTytExamId: crossTenantTytId,
      }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "LINKED_TYT_EXAM_INVALID" });
      });
  });

  it("TENANT_ADMIN sınav oluşturmayı Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "exam-create-idempotency-a";
    const body = examCreateBody("Idempotent Deneme", { startsAt: "2026-03-15T09:00:00.000Z" });

    const first = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, title: "Farklı Deneme" })
      .expect(409);

    expect(repository.exams.size).toBe(1);
  });

  it("TENANT_ADMIN sınıflarla sınav oluşturunca sınıf öğrencilerini katılımcı yapar", async () => {
    const issued = await login("admin-a@example.test");
    const extraClass = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ name: "8-B" })
      .expect(201);
    const extraStudent = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ firstName: "Ece", lastName: "B", classId: extraClass.body.id, status: "ACTIVE" })
      .expect(201);

    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("8. Sınıflar Genel Deneme", { startsAt: "2026-03-15T09:00:00.000Z", classIds: ["class-a", extraClass.body.id] }))
      .expect(201);

    const list = await request(server)
      .get(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(list.body).toHaveLength(2);
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: "tenant-a",
          examId: created.body.id,
          studentId: "student-a",
          status: "REGISTERED",
        }),
        expect.objectContaining({
          tenantId: "tenant-a",
          examId: created.body.id,
          studentId: extraStudent.body.id,
          status: "REGISTERED",
        }),
      ]),
    );
  });

  it("TENANT_ADMIN sınavı düzenler ve seçilen sınıf öğrencilerini ekler", async () => {
    const issued = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Düzeltilecek Deneme"))
      .expect(201);

    const updated = await request(server)
      .patch(`/exams/${created.body.id}`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ title: "Düzeltilmiş Deneme", startsAt: "2026-04-01T10:30:00.000Z", classIds: ["class-a"] })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: created.body.id,
      tenantId: "tenant-a",
      title: "Düzeltilmiş Deneme",
      startsAt: "2026-04-01T10:30:00.000Z",
    });

    const list = await request(server)
      .get(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ studentId: "student-a", status: "REGISTERED" });
  });

  it("başlık yoksa 422 döner ve yazmaz", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("  "))
      .expect(422);

    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ path: "title" }),
          ]),
        },
      },
    });
    expect(repository.exams.size).toBe(0);
  });

  it("takvim dışı sınav başlangıcını 422 ile reddeder ve yazmaz", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Geçersiz tarihli deneme", { startsAt: "2026-02-29T09:00" }))
      .expect(422);

    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({
              message: "EXAM_STARTS_AT_INVALID",
              path: "startsAt",
            }),
          ]),
        },
      },
    });
    expect(repository.exams.size).toBe(0);
  });

  it("TEACHER sınav oluşturamaz ama listeleyebilir", async () => {
    const admin = await login("admin-a@example.test");
    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(examCreateBody("Nisan Deneme", { classIds: ["class-a"] }))
      .expect(201);

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .send(examCreateBody("Yetkisiz"))
      .expect(403);

    const list = await request(server)
      .get("/exams")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ title: "Nisan Deneme", status: "DRAFT" });
  });

  it("TENANT_ADMIN salt okunur sınav workspace paritesini PII olmadan alır", async () => {
    const issued = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Gate C Denemesi", { startsAt: "2026-03-15T09:00:00.000Z" }))
      .expect(201);
    const registered = await participants.create({
      tenantId: "tenant-a",
      examId: created.body.id,
      studentId: "student-a",
      participantNo: "PII-42",
      bookletType: "A",
    });
    participants.participants.set(registered.id, { ...registered, status: "ATTENDED" });
    await request(server)
      .post(`/exams/${created.body.id}/publish`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(201);

    const response = await request(server)
      .get(`/exams/${created.body.id}/workspace`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      exam: {
        id: created.body.id,
        tenantId: "tenant-a",
        title: "Gate C Denemesi",
        status: "PUBLISHED",
        answerKeySummary: { status: "DRAFT", questionCount: 1 },
      },
      participantSummary: { total: 1, registered: 0, attended: 1, absent: 0 },
      nextAction: "OPEN_OPTICAL",
      readiness: expect.arrayContaining([
        { key: "ANSWER_KEY", status: "READY" },
        { key: "PARTICIPANTS", status: "READY" },
        { key: "PUBLISHED", status: "READY" },
        { key: "OPTICAL_ENTRY", status: "READY" },
      ]),
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("student-a");
    expect(serialized).not.toContain("PII-42");
  });

  it("workspace başka tenant sınavını 404 ile gizler", async () => {
    const issued = await login("admin-a@example.test");
    const otherTenantExam = await repository.create({ tenantId: "tenant-b", title: "Başka Kurum Gizli Sınav" });

    const response = await request(server)
      .get(`/exams/${otherTenantExam.id}/workspace`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(404);

    expect(JSON.stringify(response.body)).not.toContain("Başka Kurum Gizli Sınav");
  });

  it("workspace portal, öğretmen ve sistem personalarını reddeder", async () => {
    const created = await repository.create({ tenantId: "tenant-a", title: "Kapsamlı Deneme" });
    for (const email of [
      "teacher-a@example.test",
      "student-a@example.test",
      "guardian-a@example.test",
      "system@example.test",
    ]) {
      const issued = await login(email);
      await request(server)
        .get(`/exams/${created.id}/workspace`)
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .expect(403);
    }
  });

  it("workspace kampüs kapsamlı çalışanı servis sınırında fail-closed reddeder", async () => {
    const created = await repository.create({ tenantId: "tenant-a", title: "Kampüs Dışı Deneme" });
    const exams = app.get(ExamService);

    await expect(exams.workspace({
      userId: "admin-a",
      tenantId: "tenant-a",
      activePersona: "STAFF",
      roles: ["TENANT_ADMIN"],
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-a"] },
      bypassRls: false,
    }, created.id)).rejects.toThrow("EXAM_WORKSPACE_SCOPE_FORBIDDEN");
  });

  it("öğretmen okumasını assignment ve campusScope kesişimiyle sınırlar", async () => {
    const created = await repository.create({ tenantId: "tenant-a", title: "Kampüs Kapsamlı Deneme" });
    await participants.create({
      tenantId: "tenant-a",
      examId: created.id,
      studentId: "student-a",
    });
    const exams = app.get(ExamService);
    const context = {
      userId: "teacher-a",
      tenantId: "tenant-a",
      activePersona: "TEACHER" as const,
      subjectType: "TEACHER" as const,
      subjectId: "teacher-a",
      roles: ["TEACHER"],
      campusScope: { scopeMode: "CAMPUSES" as const, campusIds: ["campus-a"] },
      bypassRls: false,
    };

    await expect(exams.list(context)).resolves.toEqual([]);
    await expect(exams.listParticipants(context, created.id)).resolves.toEqual([]);
    await expect(exams.get(context, created.id)).rejects.toThrow("FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE");
  });

  it("workspace ortak rol-persona kuralını servis sınırında uygular", async () => {
    const created = await repository.create({ tenantId: "tenant-a", title: "Persona Kapsamı Denemesi" });
    const exams = app.get(ExamService);
    const baseContext = {
      userId: "staff-a",
      tenantId: "tenant-a",
      bypassRls: false,
    };

    await expect(exams.workspace({
      ...baseContext,
      activePersona: "STAFF",
      roles: ["OPERATIONS_STAFF"],
    }, created.id)).rejects.toThrow("EXAM_WORKSPACE_SCOPE_FORBIDDEN");
    await expect(exams.workspace({
      ...baseContext,
      activePersona: "TEACHER",
      roles: ["TENANT_ADMIN", "TEACHER"],
    }, created.id)).rejects.toThrow("EXAM_WORKSPACE_SCOPE_FORBIDDEN");
    await expect(exams.workspace({
      ...baseContext,
      roles: ["TENANT_ADMIN"],
    }, created.id)).resolves.toMatchObject({ exam: { id: created.id } });
  });

  it("auth yoksa reddeder", async () => {
    await request(server).post("/exams").send({ title: "X" }).expect(401);
    await request(server).get("/exams").expect(401);
    await request(server).get(`/exams/${randomUUID()}/workspace`).expect(401);
  });

  it("olmayan sınav için 404 döner", async () => {
    const issued = await login("admin-a@example.test");
    await request(server)
      .get(`/exams/${randomUUID()}`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(404);
  });

  it("TENANT_ADMIN cevap anahtarı olmayan sınavı yayınlayamaz", async () => {
    const issued = await login("admin-a@example.test");
    const created = await repository.create({ tenantId: "tenant-a", title: "Cevap Anahtarı Bekleyen" });

    await request(server)
      .post(`/exams/${created.id}/publish`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(400);

    expect(repository.exams.get(created.id)?.status).toBe("DRAFT");
  });

  it("TENANT_ADMIN cevap anahtarı olan sınavı yayınlar", async () => {
    const issued = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Yayınlanacak"))
      .expect(201);

    const published = await request(server)
      .post(`/exams/${created.body.id}/publish`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(201);

    expect(published.body).toMatchObject({
      id: created.body.id,
      status: "PUBLISHED",
      answerKeySummary: {
        status: "DRAFT",
        version: "answer-key-v1",
        questionCount: 1,
        branchCount: 1,
      },
    });
  });

  it("TENANT_ADMIN sınav yayınlamayı Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "exam-publish-idempotency-a";
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Idempotent Yayın"))
      .expect(201);

    const first = await request(server)
      .post(`/exams/${created.body.id}/publish`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .expect(201);
    const second = await request(server)
      .post(`/exams/${created.body.id}/publish`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post(`/exams/${randomUUID()}/publish`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .expect(409);

    expect(repository.exams.get(created.body.id)?.status).toBe("PUBLISHED");
  });

  it("TENANT_ADMIN sınavı siler ve listeden kaldırır", async () => {
    const issued = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send(examCreateBody("Silinecek Deneme"))
      .expect(201);

    await request(server)
      .delete(`/exams/${created.body.id}`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(204);

    expect(repository.exams.has(created.body.id)).toBe(false);
    await request(server)
      .get(`/exams/${created.body.id}`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(404);
  });

  it("TEACHER sınav silemez", async () => {
    const admin = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(examCreateBody("Yetkisiz Silme Denemesi"))
      .expect(201);

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .delete(`/exams/${created.body.id}`)
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);

    expect(repository.exams.has(created.body.id)).toBe(true);
  });

  it("TENANT_ADMIN sınava katılımcı ekler, TEACHER listeleyebilir", async () => {
    const admin = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(examCreateBody("Katılımcılı Deneme"))
      .expect(201);

    const added = await request(server)
      .post(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ studentId: "student-a", participantNo: "42", bookletType: "A" })
      .expect(201);

    expect(added.body).toMatchObject({
      tenantId: "tenant-a",
      examId: created.body.id,
      studentId: "student-a",
      participantNo: "42",
      bookletType: "A",
      status: "REGISTERED",
    });

    const teacher = await login("teacher-a@example.test");
    const list = await request(server)
      .get(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ studentId: "student-a", status: "REGISTERED" });
  });

  it("TENANT_ADMIN sınav katılımcısı eklemeyi Idempotency-Key ile tekilleştirir", async () => {
    const admin = await login("admin-a@example.test");
    const key = "exam-participant-idempotency-a";
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(examCreateBody("Idempotent Katılımcı"))
      .expect(201);
    const body = { studentId: "student-a", participantNo: "43", bookletType: "A" };

    const first = await request(server)
      .post(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, participantNo: "44" })
      .expect(409);

    expect(participants.participants.size).toBe(1);
  });

  it("TEACHER katılımcı ekleyemez", async () => {
    const admin = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(examCreateBody("Yetki Denemesi"))
      .expect(201);

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .post(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .send({ studentId: "student-a" })
      .expect(403);
  });

  it("aynı öğrenci aynı sınava ikinci kez eklenemez", async () => {
    const admin = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(examCreateBody("Tekil Katılımcı"))
      .expect(201);

    await request(server)
      .post(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ studentId: "student-a" })
      .expect(201);
    await request(server)
      .post(`/exams/${created.body.id}/participants`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ studentId: "student-a" })
      .expect(409);

    expect(participants.participants.size).toBe(1);
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return response.body as { accessToken: string };
  }

  function examCreateBody(title: string, extra: Record<string, unknown> = {}) {
    return {
      title,
      answerKey: {
        version: "answer-key-v1",
        fileBase64: Buffer.from("fake-xlsx").toString("base64"),
      },
      ...extra,
    };
  }
});

class FakeExamRepository implements ExamRepository {
  exams = new Map<string, ExamRecord>();

  async create(input: CreateExamRepositoryInput): Promise<ExamRecord> {
    const now = "2026-03-01T00:00:00.000Z";
    const exam: ExamRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      ...(input.gradeLevelId ? { gradeLevelId: input.gradeLevelId } : {}),
      ...(input.alanId ? { alanId: input.alanId } : {}),
      ...(input.examType ? { examType: input.examType } : {}),
      ...(input.examYear !== undefined ? { examYear: input.examYear } : {}),
      ...(input.scoringProfileId ? { scoringProfileId: input.scoringProfileId } : {}),
      ...(input.linkedTytExamId ? { linkedTytExamId: input.linkedTytExamId } : {}),
      title: input.title,
      status: "DRAFT",
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.exams.set(exam.id, exam);
    return exam;
  }

  async list(tenantId: string): Promise<ExamRecord[]> {
    return [...this.exams.values()].filter((exam) => exam.tenantId === tenantId);
  }

  async findById(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    const exam = this.exams.get(examId);
    return exam && exam.tenantId === tenantId ? exam : undefined;
  }

  async publish(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    const exam = this.exams.get(examId);
    if (!exam || exam.tenantId !== tenantId) {
      return undefined;
    }
    const updated: ExamRecord = { ...exam, status: "PUBLISHED" };
    this.exams.set(examId, updated);
    return updated;
  }

  async update(tenantId: string, examId: string, input: UpdateExamRepositoryInput): Promise<ExamRecord | undefined> {
    const exam = this.exams.get(examId);
    if (!exam || exam.tenantId !== tenantId) {
      return undefined;
    }
    const updated: ExamRecord = {
      ...exam,
      title: input.title,
      ...(input.gradeLevelId ? { gradeLevelId: input.gradeLevelId } : { gradeLevelId: undefined }),
      ...(input.alanId ? { alanId: input.alanId } : { alanId: undefined }),
      ...(input.examType ? { examType: input.examType } : { examType: undefined }),
      ...(input.examYear !== undefined ? { examYear: input.examYear } : { examYear: undefined }),
      ...(input.scoringProfileId ? { scoringProfileId: input.scoringProfileId } : { scoringProfileId: undefined }),
      ...(input.linkedTytExamId ? { linkedTytExamId: input.linkedTytExamId } : { linkedTytExamId: undefined }),
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    this.exams.set(examId, updated);
    return updated;
  }

  async delete(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    const exam = this.exams.get(examId);
    if (!exam || exam.tenantId !== tenantId) {
      return undefined;
    }
    this.exams.delete(examId);
    return exam;
  }
}

class FakeExamParticipantRepository implements ExamParticipantRepository {
  participants = new Map<string, ExamParticipantRecord>();

  async list(tenantId: string, examId: string): Promise<ExamParticipantRecord[]> {
    return [...this.participants.values()].filter(
      (participant) => participant.tenantId === tenantId && participant.examId === examId,
    );
  }

  async create(input: CreateExamParticipantRepositoryInput): Promise<ExamParticipantRecord> {
    const exists = [...this.participants.values()].some(
      (participant) =>
        participant.tenantId === input.tenantId &&
        participant.examId === input.examId &&
        participant.studentId === input.studentId,
    );
    if (exists) {
      throw new Error("EXAM_PARTICIPANT_EXISTS");
    }
    const now = "2026-03-01T00:00:00.000Z";
    const participant: ExamParticipantRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      examId: input.examId,
      studentId: input.studentId,
      ...(input.participantNo ? { participantNo: input.participantNo } : {}),
      ...(input.bookletType ? { bookletType: input.bookletType } : {}),
      status: "REGISTERED",
      createdAt: now,
      updatedAt: now,
    };
    this.participants.set(participant.id, participant);
    return participant;
  }
}

class FakeAnswerKeyRepository implements AnswerKeyRepository {
  records = new Map<string, AnswerKeyRecord>();

  add(input: { tenantId: string; examId: string; version: string; published?: boolean }): AnswerKeyRecord {
    const now = "2026-03-01T00:00:00.000Z";
    const record: AnswerKeyRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      examId: input.examId,
      version: input.version,
      questionCount: 1,
      branches: [{ branch: "LGS TÜRKÇE", questionCount: 1 }],
      scoringConfig: { wrongPenalty: 0.25 },
      status: input.published ? "PUBLISHED" : "DRAFT",
      ...(input.published ? { publishedAt: now } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return record;
  }

  async create(input: SaveAnswerKeyInput): Promise<AnswerKeyRecord> {
    if (
      [...this.records.values()].some(
        (record) =>
          record.tenantId === input.tenantId &&
          record.examId === input.examId &&
          record.version === input.version,
      )
    ) {
      throw new Error("ANSWER_KEY_VERSION_CONFLICT");
    }
    return this.add({
      tenantId: input.tenantId,
      examId: input.examId,
      version: input.version,
    });
  }

  async list(tenantId: string, examId: string): Promise<AnswerKeyRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.tenantId === tenantId && record.examId === examId,
    );
  }

  async publish(tenantId: string, examId: string, version: string): Promise<AnswerKeyRecord | undefined> {
    const record = [...this.records.values()].find(
      (item) => item.tenantId === tenantId && item.examId === examId && item.version === version,
    );
    if (!record) return undefined;

    const published: AnswerKeyRecord = {
      ...record,
      status: "PUBLISHED",
      publishedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    this.records.set(record.id, published);
    return published;
  }
}
