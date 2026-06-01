import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
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

  beforeAll(async () => {
    archiveStore = new FakeArchiveStore();
    repository = new FakeRepository();
    producer = new FakeProducer();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(rawImportArchiveStoreToken)
      .useValue(archiveStore)
      .overrideProvider(rawImportRepositoryToken)
      .useValue(repository)
      .overrideProvider(rawImportQueueProducerToken)
      .useValue(producer)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
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
    archiveStore.puts = [];
    repository.creates = [];
    producer.inputs = [];

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
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload: {
        tenantId: input.tenantId,
        userId: input.userId,
        entityId: input.entityId,
        contentHash: input.contentHash,
      },
      options: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        jobId: `${input.entityId}_${input.contentHash}`,
        removeOnFail: false,
      },
    };
  }
}
