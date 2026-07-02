import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import {
  rawImportQuarantineStoreToken,
  type ImportQuarantineRecord,
  type RawImportQuarantineStore,
} from "./raw-import-quarantine-store.js";
import {
  rawImportAnalysisStoreToken,
  type RawImportAnalysisStore,
  type RawImportEvaluationInput,
  type RawImportParseSummary,
} from "./raw-import-analysis-store.js";
import {
  rawImportQueueProducerToken,
  type RawImportQueueProducer,
} from "./raw-import-queue.service.js";
import {
  rawImportArchiveStoreToken,
  rawImportRepositoryToken,
  type CreateRawImportInput,
  type RawImportArchiveStore,
  type RawImportRepository,
} from "./raw-import-upload.service.js";
import type { ProducedJob } from "../queue/job-producer.js";

describe("RawImportController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let archiveStore: FakeArchiveStore;
  let repository: FakeRepository;
  let producer: FakeProducer;
  let quarantineStore: FakeQuarantineStore;
  let analysisStore: FakeAnalysisStore;

  beforeAll(async () => {
    archiveStore = new FakeArchiveStore();
    repository = new FakeRepository();
    producer = new FakeProducer();
    quarantineStore = new FakeQuarantineStore();
    analysisStore = new FakeAnalysisStore();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(rawImportArchiveStoreToken)
      .useValue(archiveStore)
      .overrideProvider(rawImportRepositoryToken)
      .useValue(repository)
      .overrideProvider(rawImportQueueProducerToken)
      .useValue(producer)
      .overrideProvider(rawImportQuarantineStoreToken)
      .useValue(quarantineStore)
      .overrideProvider(rawImportAnalysisStoreToken)
      .useValue(analysisStore)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    archiveStore.puts = [];
    repository.creates = [];
    producer.inputs = [];
    producer.failNext = false;
    quarantineStore.reset();
    analysisStore.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("TENANT_ADMIN RawImport upload isteğini arşiv + DB + excel-import enqueue zincirine bağlar", async () => {
    const issued = await login("admin-a@example.test");
    const file = Buffer.from("ogrenci_no\tcevaplar");

    const response = await request(server)
      .post("/exams/exam-a/raw-imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        sourceType: "OPTICAL_TXT",
        fileName: "../answers.dat",
        fileBase64: file.toString("base64"),
        contentType: "text/plain",
        parserConfigVersion: "parser-v1",
      })
      .expect(201);

    expect(archiveStore.puts).toHaveLength(1);
    expect(repository.creates).toHaveLength(1);
    expect(producer.inputs).toHaveLength(1);
    const expectedS3Key = `raw-imports/tenant-a/exam-a/parser-v1/${repository.creates[0]?.sha256}/source`;
    expect(archiveStore.puts[0]?.s3Key).toBe(expectedS3Key);
    expect(repository.creates[0]?.s3Key).toBe(expectedS3Key);
    expect((response.body as { rawImport: { s3Key: string } }).rawImport.s3Key).toBe(expectedS3Key);
    expect(expectedS3Key).not.toContain("answers.dat");
    expect(response.body).toMatchObject({
      rawImport: {
        id: "raw-import-a",
        tenantId: "tenant-a",
        examId: "exam-a",
        sourceType: "OPTICAL_TXT",
        fileName: "answers.dat",
        parserConfigVersion: "parser-v1",
      },
      parseJob: {
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        queueName: "excel-import",
        status: "queued",
      },
      status: "uploaded",
    });
    expect(producer.inputs[0]?.contentHash).toBe(repository.creates[0]?.sha256);
    expect(producer.inputs[0]).toMatchObject({
      queueName: "excel-import",
      tenantId: "tenant-a",
      userId: "user-tenant-a",
      entityId: "raw-import-a",
    });
  });

  it("TENANT_ADMIN RawImport upload isteğini Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "raw-import-upload-idempotency-a";
    const file = Buffer.from("ogrenci_no\tcevaplar");
    const body = {
      sourceType: "OPTICAL_TXT",
      fileName: "answers.dat",
      fileBase64: file.toString("base64"),
      contentType: "text/plain",
      parserConfigVersion: "parser-v1",
    };

    const first = await request(server)
      .post("/exams/exam-a/raw-imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/exams/exam-a/raw-imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(archiveStore.puts).toHaveLength(1);
    expect(repository.creates).toHaveLength(1);
    expect(producer.inputs).toHaveLength(1);

    await request(server)
      .post("/exams/exam-a/raw-imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        ...body,
        fileBase64: Buffer.from("ogrenci_no\tfarkli-cevaplar").toString("base64"),
      })
      .expect(409);
    expect(archiveStore.puts).toHaveLength(1);
    expect(repository.creates).toHaveLength(1);
    expect(producer.inputs).toHaveLength(1);
  });

  it("eksik dosya gövdesinde 422 döner ve yan etki oluşturmaz", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/raw-imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        sourceType: "OPTICAL_TXT",
        fileName: "answers.dat",
        parserConfigVersion: "parser-v1",
      })
      .expect(422);

    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        details: {
          fields: [expect.objectContaining({ path: "fileBase64" })],
        },
      },
    });
    expect(archiveStore.puts).toHaveLength(0);
    expect(repository.creates).toHaveLength(0);
    expect(producer.inputs).toHaveLength(0);
  });

  it("TENANT_ADMIN raw import karantina satırlarını listeler", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/raw-imports/raw-import-a/quarantines")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(quarantineStore.lists).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", rawImportId: "raw-import-a" },
    ]);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "quarantine-a",
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        rowNumber: 12,
        status: "OPEN",
        reason: "STUDENT_NOT_MATCHED",
      }),
    ]);
  });

  it("TENANT_ADMIN raw import parse özetini görür", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .get("/exams/exam-a/raw-imports/raw-import-a/summary")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(analysisStore.summaryCalls).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", rawImportId: "raw-import-a" },
    ]);
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      matchedCount: 2,
      quarantinedCount: 1,
      totalRows: 3,
      quarantineReasons: [{ reason: "STUDENT_NOT_FOUND", count: 1 }],
    });
  });

  it("TENANT_ADMIN matched optik cevaplar için evaluation işleri üretir", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/evaluation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ answerKeyId: "answer-key-a" })
      .expect(201);

    expect(analysisStore.evaluationCalls).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", rawImportId: "raw-import-a", answerKeyId: "answer-key-a" },
    ]);
    expect(producer.inputs).toEqual([
      {
        queueName: "exam-evaluation",
        tenantId: "tenant-a",
        userId: "user-tenant-a",
        entityId: "parsed-a",
        contentHash: "raw-sha-a-answer-key-a",
        participantId: "participant-a",
        rawImportId: "raw-import-a",
        answerKeyId: "answer-key-a",
      },
      {
        queueName: "exam-evaluation",
        tenantId: "tenant-a",
        userId: "user-tenant-a",
        entityId: "parsed-b",
        contentHash: "raw-sha-a-answer-key-a",
        participantId: "participant-b",
        rawImportId: "raw-import-a",
        answerKeyId: "answer-key-a",
      },
    ]);
    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      answerKeyId: "answer-key-a",
      rawImportSha256: "raw-sha-a",
      matchedCount: 2,
      queuedCount: 2,
      queueName: "exam-evaluation",
    });
  });

  it("TENANT_ADMIN cevap anahtarı göndermeden sınavın mevcut anahtarıyla evaluation işleri üretir", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/evaluation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({})
      .expect(201);

    expect(analysisStore.evaluationCalls).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", rawImportId: "raw-import-a", answerKeyId: undefined },
    ]);
    expect(producer.inputs).toEqual([
      {
        queueName: "exam-evaluation",
        tenantId: "tenant-a",
        userId: "user-tenant-a",
        entityId: "parsed-a",
        contentHash: "raw-sha-a-answer-key-a",
        participantId: "participant-a",
        rawImportId: "raw-import-a",
        answerKeyId: "answer-key-a",
      },
      {
        queueName: "exam-evaluation",
        tenantId: "tenant-a",
        userId: "user-tenant-a",
        entityId: "parsed-b",
        contentHash: "raw-sha-a-answer-key-a",
        participantId: "participant-b",
        rawImportId: "raw-import-a",
        answerKeyId: "answer-key-a",
      },
    ]);
    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      answerKeyId: "answer-key-a",
      rawImportSha256: "raw-sha-a",
      matchedCount: 2,
      queuedCount: 2,
      queueName: "exam-evaluation",
    });
  });

  it("TENANT_ADMIN evaluation işi üretimini Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "raw-import-evaluation-idempotency-a";
    const body = { answerKeyId: "answer-key-a" };

    const first = await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/evaluation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/evaluation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(analysisStore.evaluationCalls).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", rawImportId: "raw-import-a", answerKeyId: "answer-key-a" },
    ]);
    expect(producer.inputs).toHaveLength(2);

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/evaluation-jobs")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ answerKeyId: "answer-key-b" })
      .expect(409);
    expect(analysisStore.evaluationCalls).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", rawImportId: "raw-import-a", answerKeyId: "answer-key-a" },
    ]);
    expect(producer.inputs).toHaveLength(2);
  });

  it("TENANT_ADMIN evaluation tamamlanma durumunu görür", async () => {
    const issued = await login("admin-a@example.test");
    analysisStore.evaluatedCount = 2;

    const response = await request(server)
      .get("/exams/exam-a/raw-imports/raw-import-a/evaluation-status?answerKeyId=answer-key-a")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(analysisStore.evaluationCalls).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", rawImportId: "raw-import-a", answerKeyId: "answer-key-a" },
    ]);
    expect(analysisStore.evaluatedCalls).toEqual([
      { tenantId: "tenant-a", examId: "exam-a", rawImportId: "raw-import-a", answerKeyId: "answer-key-a" },
    ]);
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      answerKeyId: "answer-key-a",
      matchedCount: 2,
      evaluatedCount: 2,
      pendingCount: 0,
      status: "COMPLETED",
    });
  });

  it("TENANT_ADMIN açık karantina özetini görür", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .get("/import-quarantines/summary")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(quarantineStore.counts).toEqual(["tenant-a"]);
    expect(response.body).toEqual({ openCount: 1 });
  });

  it("TENANT_ADMIN karantina satırını öğrenciye bağlayıp çözer", async () => {
    const issued = await login("admin-a@example.test");
    const key = "raw-import-quarantine-resolve-idempotency-a";
    const body = { resolvedStudentId: "student-a" };

    const response = await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-a/resolve")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-a/resolve")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(response.body);
      });

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-a/resolve")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ resolvedStudentId: "student-c" })
      .expect(409);

    expect(quarantineStore.resolves).toEqual([
      {
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        quarantineId: "quarantine-a",
        resolvedStudentId: "student-a",
      },
    ]);
    expect(quarantineStore.markResolvedCalls).toEqual([
      {
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        quarantineId: "quarantine-a",
        resolvedStudentId: "student-a",
      },
    ]);
    expect(response.body).toMatchObject({
      id: "quarantine-a",
      status: "RESOLVED",
      resolvedStudentId: "student-a",
      evaluationJob: {
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        participantId: "participant-a",
        answerKeyId: "answer-key-a",
        queueName: "exam-evaluation",
        jobId: "quarantine-a_raw-sha-a-answer-key-a",
        status: "queued",
      },
    });
    expect(producer.inputs).toEqual([
      {
        queueName: "exam-evaluation",
        tenantId: "tenant-a",
        userId: "user-tenant-a",
        entityId: "quarantine-a",
        contentHash: "raw-sha-a-answer-key-a",
        participantId: "participant-a",
        rawImportId: "raw-import-a",
        answerKeyId: "answer-key-a",
      },
    ]);
  });

  it("TENANT_ADMIN karantina satırlarını bulk çözer ve satır bazlı hata döndürür", async () => {
    const issued = await login("admin-a@example.test");
    quarantineStore.records = [
      createQuarantine(),
      { ...createQuarantine(), id: "quarantine-b", rowNumber: 13, resolvedParticipantId: "participant-b" },
    ];
    const key = "raw-import-quarantine-resolve-bulk-idempotency-a";
    const body = {
      items: [
        { quarantineId: "quarantine-a", resolvedStudentId: "student-a" },
        { quarantineId: "quarantine-missing", resolvedStudentId: "student-b" },
      ],
    };

    const response = await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/resolve-bulk")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/resolve-bulk")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(response.body);
      });

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/resolve-bulk")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ items: [{ quarantineId: "quarantine-b", resolvedStudentId: "student-b" }] })
      .expect(409);

    expect(response.body.results).toEqual([
      expect.objectContaining({
        quarantineId: "quarantine-a",
        status: "RESOLVED",
        quarantine: expect.objectContaining({ id: "quarantine-a", resolvedStudentId: "student-a" }),
      }),
      expect.objectContaining({
        quarantineId: "quarantine-missing",
        status: "FAILED",
        errorCode: "IMPORT_QUARANTINE_NOT_FOUND",
      }),
    ]);
    expect(quarantineStore.markResolvedCalls).toEqual([
      {
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        quarantineId: "quarantine-a",
        resolvedStudentId: "student-a",
      },
    ]);
    expect(producer.inputs).toEqual([
      expect.objectContaining({
        entityId: "quarantine-a",
        participantId: "participant-a",
      }),
    ]);
  });

  it("karantina resolve enqueue patlarsa kaydı açık bırakır", async () => {
    const issued = await login("admin-a@example.test");
    producer.failNext = true;

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-a/resolve")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ resolvedStudentId: "student-a" })
      .expect(500);

    expect(quarantineStore.records[0]?.status).toBe("OPEN");
    expect(quarantineStore.markResolvedCalls).toHaveLength(0);
  });

  it("karantina çözme kaydı yoksa evaluation işi üretmez", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-missing/resolve")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ resolvedStudentId: "student-a" })
      .expect(404);

    expect(producer.inputs).toHaveLength(0);
  });

  it("reprocess referansı eksikse evaluation işi üretmez", async () => {
    const issued = await login("admin-a@example.test");
    quarantineStore.records = [{
      ...createQuarantine(),
      resolvedParticipantId: undefined,
      answerKeyId: undefined,
      rawImportSha256: undefined,
    }];

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-a/resolve")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ resolvedStudentId: "student-a" })
      .expect(404);

    expect(producer.inputs).toHaveLength(0);
  });

  it("öğretmen karantina listesini göremez", async () => {
    const issued = await login("teacher-a@example.test");

    await request(server)
      .get("/exams/exam-a/raw-imports/raw-import-a/quarantines")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(403);

    expect(quarantineStore.lists).toHaveLength(0);
  });

  it("öğrenci id olmadan karantina çözme yan etkisi oluşturmaz", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-a/resolve")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({})
      .expect(422);

    expect(quarantineStore.resolves).toHaveLength(0);
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return response.body as { accessToken: string };
  }
});

class FakeArchiveStore implements RawImportArchiveStore {
  puts: Array<{ s3Key: string; body: Buffer; contentType?: string }> = [];

  async put(input: { s3Key: string; body: Buffer; contentType?: string }): Promise<void> {
    this.puts.push(input);
  }
}

class FakeRepository implements RawImportRepository {
  creates: CreateRawImportInput[] = [];

  async create(input: CreateRawImportInput) {
    this.creates.push(input);
    return { id: "raw-import-a", ...input };
  }
}

class FakeProducer implements RawImportQueueProducer {
  inputs: Array<Parameters<RawImportQueueProducer["enqueue"]>[0]> = [];
  failNext = false;

  async enqueue(input: Parameters<RawImportQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
    this.inputs.push(input);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("QUEUE_DOWN");
    }
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

class FakeQuarantineStore implements RawImportQuarantineStore {
  records: ImportQuarantineRecord[] = [];
  counts: string[] = [];
  lists: Array<{ tenantId: string; examId: string; rawImportId: string }> = [];
  resolves: Array<{
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }> = [];
  markResolvedCalls: Array<{
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }> = [];

  reset(): void {
    this.records = [createQuarantine()];
    this.counts = [];
    this.lists = [];
    this.resolves = [];
    this.markResolvedCalls = [];
  }

  async countOpenByTenant(tenantId: string): Promise<number> {
    this.counts.push(tenantId);
    return this.records.filter((record) => record.tenantId === tenantId && record.status === "OPEN").length;
  }

  async listByRawImport(tenantId: string, examId: string, rawImportId: string): Promise<ImportQuarantineRecord[]> {
    this.lists.push({ tenantId, examId, rawImportId });
    return this.records.filter((record) => (
      record.tenantId === tenantId &&
      record.examId === examId &&
      record.rawImportId === rawImportId
    ));
  }

  async resolve(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }): Promise<ImportQuarantineRecord | undefined> {
    this.resolves.push(input);
    const record = this.records.find((item) => (
      item.tenantId === input.tenantId &&
      item.examId === input.examId &&
      item.rawImportId === input.rawImportId &&
      item.id === input.quarantineId &&
      item.status === "OPEN"
    ));
    if (!record) return undefined;
    return record;
  }

  async markResolved(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }): Promise<ImportQuarantineRecord | undefined> {
    this.markResolvedCalls.push(input);
    const record = this.records.find((item) => (
      item.tenantId === input.tenantId &&
      item.examId === input.examId &&
      item.rawImportId === input.rawImportId &&
      item.id === input.quarantineId &&
      item.status === "OPEN"
    ));
    if (!record) return undefined;
    const resolved = { ...record, status: "RESOLVED", resolvedStudentId: input.resolvedStudentId };
    this.records = this.records.map((item) => item.id === record.id ? resolved : item);
    return resolved;
  }
}

class FakeAnalysisStore implements RawImportAnalysisStore {
  summaryCalls: Array<{ tenantId: string; examId: string; rawImportId: string }> = [];
  evaluationCalls: Array<{ tenantId: string; examId: string; rawImportId: string; answerKeyId?: string }> = [];
  evaluatedCalls: Array<{ tenantId: string; examId: string; rawImportId: string; answerKeyId?: string }> = [];
  evaluatedCount = 0;
  matched: RawImportEvaluationInput[] = [];

  reset(): void {
    this.summaryCalls = [];
    this.evaluationCalls = [];
    this.evaluatedCalls = [];
    this.evaluatedCount = 0;
    this.matched = [
      {
        parsedAnswerId: "parsed-a",
        participantId: "participant-a",
        rawImportId: "raw-import-a",
        rawImportSha256: "raw-sha-a",
        answerKeyId: "answer-key-a",
      },
      {
        parsedAnswerId: "parsed-b",
        participantId: "participant-b",
        rawImportId: "raw-import-a",
        rawImportSha256: "raw-sha-a",
        answerKeyId: "answer-key-a",
      },
    ];
  }

  async getSummary(tenantId: string, examId: string, rawImportId: string): Promise<RawImportParseSummary | undefined> {
    this.summaryCalls.push({ tenantId, examId, rawImportId });
    return {
      tenantId,
      examId,
      rawImportId,
      matchedCount: 2,
      quarantinedCount: 1,
      totalRows: 3,
      quarantineReasons: [{ reason: "STUDENT_NOT_FOUND", count: 1 }],
    };
  }

  async countEvaluatedForEvaluation(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    answerKeyId?: string;
  }): Promise<number> {
    this.evaluatedCalls.push(input);
    return this.evaluatedCount;
  }

  async listMatchedForEvaluation(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    answerKeyId?: string;
  }): Promise<RawImportEvaluationInput[]> {
    this.evaluationCalls.push(input);
    return this.matched;
  }
}

function createQuarantine(): ImportQuarantineRecord {
  return {
    id: "quarantine-a",
    tenantId: "tenant-a",
    examId: "exam-a",
    rawImportId: "raw-import-a",
    rowNumber: 12,
    rawRow: { studentNo: "1606", answers: "ABCDE" },
    reason: "STUDENT_NOT_MATCHED",
    status: "OPEN",
    resolvedParticipantId: "participant-a",
    answerKeyId: "answer-key-a",
    rawImportSha256: "raw-sha-a",
    createdAt: "2026-06-02T09:00:00.000Z",
    updatedAt: "2026-06-02T09:00:00.000Z",
  };
}
