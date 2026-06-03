import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExamParticipantRecord, ExamRecord } from "@uzman-hocam/shared-types";
import { AppModule } from "../app.module.js";
import {
  examParticipantRepositoryToken,
  examRepositoryToken,
  type CreateExamParticipantRepositoryInput,
  type CreateExamRepositoryInput,
  type ExamParticipantRepository,
  type ExamRepository,
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

  it("başlık yoksa 400 döner ve yazmaz", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ title: "  " })
      .expect(400);

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
