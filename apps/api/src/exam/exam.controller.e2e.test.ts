import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExamParticipantRecord, ExamRecord } from "@o-okul/shared-types";
import { AppModule } from "../app.module.js";
import {
  examParticipantRepositoryToken,
  examRepositoryToken,
  type CreateExamParticipantRepositoryInput,
  type CreateExamRepositoryInput,
  type ExamParticipantRepository,
  type ExamRepository,
  type UpdateExamRepositoryInput,
} from "./exam.service.js";

describe("ExamController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let repository: FakeExamRepository;
  let participants: FakeExamParticipantRepository;

  beforeAll(async () => {
    repository = new FakeExamRepository();
    participants = new FakeExamParticipantRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(examRepositoryToken)
      .useValue(repository)
      .overrideProvider(examParticipantRepositoryToken)
      .useValue(participants)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    repository.exams.clear();
    participants.participants.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it("TENANT_ADMIN deneme sınavı oluşturur", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ title: "Mart Genel Deneme", startsAt: "2026-03-15T09:00:00.000Z" })
      .expect(201);

    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      title: "Mart Genel Deneme",
      status: "DRAFT",
      startsAt: "2026-03-15T09:00:00.000Z",
    });
    expect(typeof response.body.id).toBe("string");
    expect(repository.exams.size).toBe(1);
  });

  it("TENANT_ADMIN sınav oluşturmayı Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "exam-create-idempotency-a";
    const body = { title: "Idempotent Deneme", startsAt: "2026-03-15T09:00:00.000Z" };

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
      .send({ name: "8-B", level: "8" })
      .expect(201);
    const extraStudent = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ firstName: "Ece", lastName: "B", classId: extraClass.body.id, status: "ACTIVE" })
      .expect(201);

    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ title: "8. Sınıflar Genel Deneme", startsAt: "2026-03-15T09:00:00.000Z", classIds: ["class-a", extraClass.body.id] })
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
      .send({ title: "Düzeltilecek Deneme" })
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
      .send({ title: "  " })
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
      .send({ title: "Geçersiz tarihli deneme", startsAt: "2026-02-29T09:00" })
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
      .send({ title: "Nisan Deneme" })
      .expect(201);

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .send({ title: "Yetkisiz" })
      .expect(403);

    const list = await request(server)
      .get("/exams")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ title: "Nisan Deneme", status: "DRAFT" });
  });

  it("auth yoksa reddeder", async () => {
    await request(server).post("/exams").send({ title: "X" }).expect(401);
    await request(server).get("/exams").expect(401);
  });

  it("olmayan sınav için 404 döner", async () => {
    const issued = await login("admin-a@example.test");
    await request(server)
      .get(`/exams/${randomUUID()}`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(404);
  });

  it("TENANT_ADMIN sınavı yayınlar", async () => {
    const issued = await login("admin-a@example.test");
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ title: "Yayınlanacak" })
      .expect(201);

    const published = await request(server)
      .post(`/exams/${created.body.id}/publish`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(201);

    expect(published.body).toMatchObject({ id: created.body.id, status: "PUBLISHED" });
  });

  it("TENANT_ADMIN sınav yayınlamayı Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "exam-publish-idempotency-a";
    const created = await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ title: "Idempotent Yayın" })
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
      .send({ title: "Silinecek Deneme" })
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
      .send({ title: "Yetkisiz Silme Denemesi" })
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
      .send({ title: "Katılımcılı Deneme" })
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
      .send({ title: "Idempotent Katılımcı" })
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
      .send({ title: "Yetki Denemesi" })
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
      .send({ title: "Tekil Katılımcı" })
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
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return response.body as { accessToken: string };
  }
});

class FakeExamRepository implements ExamRepository {
  exams = new Map<string, ExamRecord>();

  async create(input: CreateExamRepositoryInput): Promise<ExamRecord> {
    const now = "2026-03-01T00:00:00.000Z";
    const exam: ExamRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
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
