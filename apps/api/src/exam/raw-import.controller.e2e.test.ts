import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import {
  rawImportQuarantineStoreToken,
  type ImportQuarantineRecord,
  type RawImportQuarantineStore,
} from "./raw-import-quarantine-store.js";
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

  beforeAll(async () => {
    archiveStore = new FakeArchiveStore();
    repository = new FakeRepository();
    producer = new FakeProducer();
    quarantineStore = new FakeQuarantineStore();

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
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    archiveStore.puts = [];
    repository.creates = [];
    producer.inputs = [];
    quarantineStore.reset();
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
    expect(repository.creates[0]?.sha256).toBe(producer.inputs[0]?.contentHash);
    expect(producer.inputs[0]).toMatchObject({
      queueName: "excel-import",
      tenantId: "tenant-a",
      userId: "user-tenant-a",
      entityId: "raw-import-a",
    });
  });

  it("eksik dosya gövdesinde yan etki oluşturmaz", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/exams/exam-a/raw-imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        sourceType: "OPTICAL_TXT",
        fileName: "answers.dat",
        parserConfigVersion: "parser-v1",
      })
      .expect(400);

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

  it("TENANT_ADMIN karantina satırını öğrenciye bağlayıp çözer", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-a/resolve")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ resolvedStudentId: "student-a" })
      .expect(201);

    expect(quarantineStore.resolves).toEqual([
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
        jobId: "quarantine-a_raw-sha-a",
        status: "queued",
      },
    });
    expect(producer.inputs).toEqual([
      {
        queueName: "exam-evaluation",
        tenantId: "tenant-a",
        userId: "user-tenant-a",
        entityId: "quarantine-a",
        contentHash: "raw-sha-a",
        participantId: "participant-a",
        rawImportId: "raw-import-a",
        answerKeyId: "answer-key-a",
      },
    ]);
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
      .expect(400);

    expect(quarantineStore.resolves).toHaveLength(0);
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
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

  async enqueue(input: Parameters<RawImportQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
    this.inputs.push(input);
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
  lists: Array<{ tenantId: string; examId: string; rawImportId: string }> = [];
  resolves: Array<{
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }> = [];

  reset(): void {
    this.records = [createQuarantine()];
    this.lists = [];
    this.resolves = [];
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
    const resolved = { ...record, status: "RESOLVED", resolvedStudentId: input.resolvedStudentId };
    this.records = this.records.map((item) => item.id === record.id ? resolved : item);
    return resolved;
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
