import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExamRecord } from "@uzman-hocam/shared-types";
import { AppModule } from "../app.module.js";
import {
  examRepositoryToken,
  type CreateExamRepositoryInput,
  type ExamRepository,
} from "./exam.service.js";

describe("ExamController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let repository: FakeExamRepository;

  beforeAll(async () => {
    repository = new FakeExamRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(examRepositoryToken)
      .useValue(repository)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    repository.exams.clear();
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
