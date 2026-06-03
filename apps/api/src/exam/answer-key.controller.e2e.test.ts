import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AnswerKeyRecord } from "@uzman-hocam/shared-types";
import { AppModule } from "../app.module.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "../report/report-snapshot-store.js";
import {
  answerKeyRepositoryToken,
  type AnswerKeyRepository,
  type SaveAnswerKeyInput,
} from "./answer-key.service.js";

describe("AnswerKeyController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let repository: FakeAnswerKeyRepository;
  let snapshots: FakeReportSnapshotStore;

  beforeAll(async () => {
    repository = new FakeAnswerKeyRepository();
    snapshots = new FakeReportSnapshotStore();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(answerKeyRepositoryToken)
      .useValue(repository)
      .overrideProvider(reportSnapshotStoreToken)
      .useValue(snapshots)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    repository.records = [];
    snapshots.markStaleInputs = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it("TENANT_ADMIN cevap anahtarı oluşturur ve tenant context body yerine oturumdan gelir", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/answer-keys")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        tenantId: "tenant-b",
        version: "v1",
        questions: [
          { questionNo: 2, correctAnswer: "b", branch: "Türkçe", outcomeCode: "SÖZCÜKTE ANLAM" },
          { questionNo: 1, correctAnswer: "A", branch: "Matematik" },
        ],
        scoringConfig: { wrongPenalty: 0.333333 },
      })
      .expect(201);

    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "v1",
      scoringConfig: { wrongPenalty: 0.333333 },
    });
    expect(repository.records[0]?.questions).toEqual([
      { questionNo: 1, correctAnswer: "A", branch: "Matematik" },
      { questionNo: 2, correctAnswer: "B", branch: "Türkçe", outcomeCode: "SÖZCÜKTE ANLAM" },
    ]);
    expect(snapshots.markStaleInputs).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      reason: "answer_key.created",
    }]);
    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "v1",
      questionCount: 2,
      status: "DRAFT",
    });
  });

  it("TEACHER cevap anahtarı oluşturamaz ama listeleyebilir", async () => {
    const admin = await login("admin-a@example.test");
    await request(server)
      .post("/exams/exam-a/answer-keys")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ version: "v1", questions: createQuestions(), scoringConfig: { wrongPenalty: 0.25 } })
      .expect(201);

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .post("/exams/exam-a/answer-keys")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .send({ version: "v2", questions: createQuestions(), scoringConfig: { wrongPenalty: 0.25 } })
      .expect(403);

    const list = await request(server)
      .get("/exams/exam-a/answer-keys")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200);

    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ version: "v1", questionCount: 1 });
  });

  it("dryRun isteği geçerli anahtarı özetler ama DB'ye yazmaz", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/answer-keys")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        version: "v1",
        questions: createQuestions(),
        scoringConfig: { wrongPenalty: 0.25 },
        dryRun: true,
      })
      .expect(201);

    expect(repository.records).toHaveLength(0);
    expect(snapshots.markStaleInputs).toEqual([]);
    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "v1",
      questionCount: 1,
      status: "DRY_RUN",
    });
  });

  it("cevap anahtarı Excel dry-run isteği B kitapçığı permütasyonunu özetler ve DB'ye yazmaz", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/answer-keys/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        version: "v1",
        fileBase64: await createAnswerKeyWorkbookBase64(),
        scoringConfig: { wrongPenalty: 0.333333 },
      })
      .expect(201);

    expect(repository.records).toHaveLength(0);
    expect(snapshots.markStaleInputs).toEqual([]);
    expect(response.body).toMatchObject({
      dryRun: true,
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "v1",
      questionCount: 90,
      bookletVariants: [{ code: "B", questionCount: 90 }],
      wouldImport: true,
    });
  });

  it("cevap anahtarı Excel import isteği AnswerKey ve B variant kaydını yazar", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/answer-keys/imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        version: "v1",
        fileBase64: await createAnswerKeyWorkbookBase64(),
        scoringConfig: { wrongPenalty: 0.333333 },
      })
      .expect(201);

    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]?.questions).toHaveLength(90);
    expect(repository.records[0]?.questions[0]).toEqual({
      questionNo: 1,
      correctAnswer: "A",
      branch: "LGS TÜRKÇE",
      outcomeCode: "KAZANIM 1",
      topic: "KONU 1",
    });
    expect(repository.records[0]?.bookletVariants).toEqual([
      { code: "B", permutation: Array.from({ length: 90 }, (_unused, index) => 90 - index) },
    ]);
    expect(snapshots.markStaleInputs).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      reason: "answer_key.created",
    }]);
    expect(response.body).toMatchObject({
      imported: true,
      answerKey: { version: "v1", questionCount: 90 },
      bookletVariants: [{ code: "B", questionCount: 90 }],
    });
  });

  it("TENANT_ADMIN cevap anahtarını yayınlar", async () => {
    const issued = await login("admin-a@example.test");
    await request(server)
      .post("/exams/exam-a/answer-keys")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ version: "v1", questions: createQuestions(), scoringConfig: { wrongPenalty: 0.25 } })
      .expect(201);

    const response = await request(server)
      .post("/exams/exam-a/answer-keys/v1/publish")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(201);

    expect(response.body).toMatchObject({ version: "v1", status: "PUBLISHED" });
    expect(response.body.publishedAt).toBeTruthy();
    expect(snapshots.markStaleInputs).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", reason: "answer_key.created" },
      { tenantId: "tenant-a", examId: "exam-a", reason: "answer_key.published" },
    ]);
  });

  it("geçersiz soru DB'ye gitmeden 400 döner", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/exams/exam-a/answer-keys")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ version: "v1", questions: [{ questionNo: 1, correctAnswer: "X", branch: "Matematik" }] })
      .expect(400);

    expect(repository.records).toHaveLength(0);
    expect(snapshots.markStaleInputs).toEqual([]);
  });

  it("auth yoksa reddeder", async () => {
    await request(server)
      .post("/exams/exam-a/answer-keys")
      .send({ version: "v1", questions: createQuestions() })
      .expect(401);
    await request(server).get("/exams/exam-a/answer-keys").expect(401);
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return response.body as { accessToken: string };
  }
});

function createQuestions() {
  return [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }];
}

async function createAnswerKeyWorkbookBase64(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Detaylı Cevap Anahtarı");
  worksheet.addRow(["BÖLÜM", "SORU NO", "B KARŞILIĞI", "CEVAP", "KAZANIM", "KONU", "BRANŞ"]);
  for (let questionNo = 1; questionNo <= 90; questionNo += 1) {
    worksheet.addRow([
      "TÜRKÇE",
      questionNo,
      91 - questionNo,
      "A",
      `KAZANIM ${questionNo}`,
      `KONU ${questionNo}`,
      "LGS TÜRKÇE",
    ]);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

class FakeAnswerKeyRepository implements AnswerKeyRepository {
  records: SaveAnswerKeyInput[] = [];

  async create(input: SaveAnswerKeyInput): Promise<AnswerKeyRecord> {
    if (this.records.some((record) => record.tenantId === input.tenantId && record.examId === input.examId && record.version === input.version)) {
      throw new Error("ANSWER_KEY_VERSION_CONFLICT");
    }
    this.records.push(input);
    return toRecord(input);
  }

  async list(tenantId: string, examId: string): Promise<AnswerKeyRecord[]> {
    return this.records
      .filter((record) => record.tenantId === tenantId && record.examId === examId)
      .map((record) => toRecord(record));
  }

  async publish(tenantId: string, examId: string, version: string): Promise<AnswerKeyRecord | undefined> {
    const record = this.records.find((item) => item.tenantId === tenantId && item.examId === examId && item.version === version);
    return record ? toRecord(record, true) : undefined;
  }
}

class FakeReportSnapshotStore implements ReportSnapshotStore {
  markStaleInputs: Array<{ tenantId: string; examId: string; reason: string }> = [];

  async listByExam() {
    return [];
  }

  async findById() {
    return undefined;
  }

  async markStaleByExam(tenantId: string, examId: string, reason: string) {
    this.markStaleInputs.push({ tenantId, examId, reason });
    return 1;
  }
}

function toRecord(input: SaveAnswerKeyInput, published = false): AnswerKeyRecord {
  const now = "2026-06-02T00:00:00.000Z";
  return {
    id: `${input.examId}-${input.version}`,
    tenantId: input.tenantId,
    examId: input.examId,
    version: input.version,
    questionCount: input.questions.length,
    branches: [{ branch: input.questions[0]?.branch ?? "Genel", questionCount: input.questions.length }],
    scoringConfig: input.scoringConfig,
    status: published ? "PUBLISHED" : "DRAFT",
    ...(published ? { publishedAt: now } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
