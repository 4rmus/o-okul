import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AnswerKeyRecord, ExamParticipantRecord, ExamRecord } from "@o-okul/shared-types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { AnswerKeyExcelImportService } from "../exam/answer-key-excel-import.service.js";
import {
  answerKeyRepositoryToken,
  type AnswerKeyRepository,
  type SaveAnswerKeyInput,
} from "../exam/answer-key.service.js";
import {
  type CreateExamParticipantRepositoryInput,
  type CreateExamRepositoryInput,
  type ExamParticipantRepository,
  examParticipantRepositoryToken,
  type ExamRepository,
  examRepositoryToken,
  type UpdateExamRepositoryInput,
} from "../exam/exam.service.js";
import { InMemorySupportTicketStore, supportTicketStoreToken } from "../support-ticket/support-ticket-store.js";

describe("Capability access matrix", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAdminToken: string;
  let assistantToken: string;
  let teacherToken: string;
  let answerKeys: FakeAnswerKeyRepository;

  beforeAll(async () => {
    answerKeys = new FakeAnswerKeyRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(examRepositoryToken)
      .useValue(new FakeExamRepository())
      .overrideProvider(examParticipantRepositoryToken)
      .useValue(new FakeExamParticipantRepository())
      .overrideProvider(supportTicketStoreToken)
      .useValue(new InMemorySupportTicketStore())
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

    tenantAdminToken = await login("admin-a@example.test");
    assistantToken = await login("assistant-a@example.test");
    teacherToken = await login("teacher-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("ASSISTANT_ADMIN finans endpoint'lerine giremez", async () => {
    await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(403);
  });

  it("ASSISTANT_ADMIN operasyon, kullanıcı ve KVKK endpoint'lerine giremez", async () => {
    await request(server)
      .get("/tenant-users")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(403);

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(403);

    await request(server)
      .post("/students/student-a/purge-pii")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(403);
  });

  it("TENANT_ADMIN menüdeki operasyon yetkili alanları açar", async () => {
    await request(server)
      .get("/tenant-users")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200);

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200);

    await request(server)
      .get("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200);
  });

  it("tenant profilini TENANT_ADMIN günceller, ASSISTANT_ADMIN güncelleyemez", async () => {
    await request(server)
      .patch("/me/tenant")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({ name: "Yardımcı Güncelleme Denemesi" })
      .expect(403);

    await request(server)
      .patch("/me/tenant")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .send({ name: "DNA EĞİTİM KURUMU" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "tenant-a", name: "DNA EĞİTİM KURUMU" });
      });
  });

  it("ASSISTANT_ADMIN menüde görünen akademik ve destek işlemlerini yapar", async () => {
    await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        title: "Md.Yrd Ders Programı",
        startsAt: "2026-06-01T12:00:00.000Z",
        endsAt: "2026-06-01T13:00:00.000Z",
      })
      .expect(201);

    await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({ status: "IN_PROGRESS", priority: "HIGH" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "support-ticket-a", status: "IN_PROGRESS", priority: "HIGH" });
      });

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({
        title: "Md.Yrd Duyuru",
        body: "Veli bilgilendirme duyurusu.",
        audience: "GUARDIANS",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
      })
      .expect(201);

    await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({
        name: "Md.Yrd SMS Şablonu",
        channel: "SMS",
        body: "Sayın veli, öğrencimiz için bilgilendirme mesajıdır.",
      })
      .expect(201);
  });

  it("ASSISTANT_ADMIN akademik yönetim yapar, TEACHER yapamaz", async () => {
    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send(examCreateBody("Md.Yrd Yetki Denemesi"))
      .expect(201);

    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send(examCreateBody("Öğretmen Yetki Denemesi"))
      .expect(403);
  });

  function examCreateBody(title: string) {
    return {
      title,
      answerKey: {
        version: "rbac-answer-key-v1",
        fileBase64: Buffer.from("fake-xlsx").toString("base64"),
      },
    };
  }
});

class FakeAnswerKeyRepository implements AnswerKeyRepository {
  private readonly records = new Map<string, AnswerKeyRecord>();

  add(input: Pick<SaveAnswerKeyInput, "tenantId" | "examId" | "version">): AnswerKeyRecord {
    const now = "2026-03-01T00:00:00.000Z";
    const record: AnswerKeyRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      examId: input.examId,
      version: input.version,
      questionCount: 1,
      branches: [{ branch: "Matematik", questionCount: 1 }],
      scoringConfig: { wrongPenalty: 0.25 },
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(`${record.tenantId}:${record.examId}:${record.version}`, record);
    return record;
  }

  async create(input: SaveAnswerKeyInput): Promise<AnswerKeyRecord> {
    return this.add(input);
  }

  async list(tenantId: string, examId: string): Promise<AnswerKeyRecord[]> {
    return [...this.records.values()].filter((record) => record.tenantId === tenantId && record.examId === examId);
  }

  async publish(tenantId: string, examId: string, version: string): Promise<AnswerKeyRecord | undefined> {
    const record = this.records.get(`${tenantId}:${examId}:${version}`);
    if (!record) {
      return undefined;
    }
    const updated: AnswerKeyRecord = { ...record, status: "PUBLISHED", publishedAt: "2026-03-01T00:00:00.000Z" };
    this.records.set(`${tenantId}:${examId}:${version}`, updated);
    return updated;
  }
}

class FakeExamRepository implements ExamRepository {
  private readonly exams = new Map<string, ExamRecord>();

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
  private readonly participants = new Map<string, ExamParticipantRecord>();

  async list(tenantId: string, examId: string): Promise<ExamParticipantRecord[]> {
    return [...this.participants.values()].filter(
      (participant) => participant.tenantId === tenantId && participant.examId === examId,
    );
  }

  async create(input: CreateExamParticipantRepositoryInput): Promise<ExamParticipantRecord> {
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
