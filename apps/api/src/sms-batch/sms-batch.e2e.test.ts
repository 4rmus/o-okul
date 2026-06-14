import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import type { ProducedJob } from "../queue/job-producer.js";
import { smsBatchQueueProducerToken, type SmsBatchQueueProducer } from "./sms-batch.service.js";

describe("SmsBatch API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let producer: FakeProducer;
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;

  beforeAll(async () => {
    producer = new FakeProducer();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(smsBatchQueueProducerToken)
      .useValue(producer)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    const login = await request(server)
      .post("/auth/login")
      .send({ email: "admin-a@example.test", password: "password" })
      .expect(200);
    tenantAAccessToken = (login.body as { accessToken: string }).accessToken;

    const teacherLogin = await request(server)
      .post("/auth/login")
      .send({ email: "teacher-a@example.test", password: "password" })
      .expect(200);
    teacherAAccessToken = (teacherLogin.body as { accessToken: string }).accessToken;
  });

  beforeEach(() => {
    producer.inputs = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it("TENANT_ADMIN SMS batch isteğini sms-batch queue'ya bağlar", async () => {
    const response = await request(server)
      .post("/sms-batches")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        templateId: "message-template-a",
        recipients: [{ to: "5000000001" }, { to: "5000000002" }],
      })
      .expect(201);

    expect(producer.inputs).toHaveLength(1);
    expect(producer.inputs[0]).toMatchObject({
      queueName: "sms-batch",
      tenantId: "tenant-a",
      userId: "user-tenant-a",
      entityId: "message-template-a",
      templateId: "message-template-a",
      messageBody: "Sayın veli, öğrencimizin deneme sınavı Pazartesi günü yapılacaktır.",
      recipients: [{ to: "5000000001" }, { to: "5000000002" }],
    });
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      templateId: "message-template-a",
      recipientCount: 2,
      queueName: "sms-batch",
      jobId: `${producer.inputs[0]?.entityId}_${producer.inputs[0]?.contentHash}`,
      status: "queued",
    });

    const report = await request(server)
      .get(`/sms-batches/${response.body.jobId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(report.body).toMatchObject({
      tenantId: "tenant-a",
      templateId: "message-template-a",
      recipientCount: 2,
      sentCount: 0,
      failedCount: 0,
      billableSegments: 0,
      jobId: response.body.jobId,
      status: "queued",
    });
  });

  it("SMS batch kuyruğa almayı Idempotency-Key ile tekilleştirir", async () => {
    const key = "sms-batch-idempotency-a";
    const body = {
      templateId: "message-template-a",
      recipients: [{ to: "5000000001" }, { to: "5000000002" }],
    };
    const first = await request(server)
      .post("/sms-batches")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    const second = await request(server)
      .post("/sms-batches")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(producer.inputs).toHaveLength(1);

    await request(server)
      .post("/sms-batches")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({
        templateId: "message-template-a",
        recipients: [{ to: "5000000001" }],
      })
      .expect(409);
    expect(producer.inputs).toHaveLength(1);
  });

  it("başka tenant şablonuyla batch oluşturamaz", async () => {
    await request(server)
      .post("/sms-batches")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        templateId: "message-template-b",
        recipients: [{ to: "5000000001" }],
      })
      .expect(403);

    expect(producer.inputs).toHaveLength(0);
  });

  it("alıcı doğrulaması yapar", async () => {
    const response = await request(server)
      .post("/sms-batches")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        templateId: "message-template-a",
        recipients: [{ to: " " }],
      })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "recipients.0.to" })],
      },
    });

    expect(producer.inputs).toHaveLength(0);
  });

  it("TENANT_ADMIN SMS alıcı önizlemesini veli SMS iznine göre alır", async () => {
    const response = await request(server)
      .post("/sms-batches/recipients/preview")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ announcementId: "announcement-a", studentStatus: "ACTIVE" })
      .expect(201);

    expect(response.body).toEqual({
      recipientCount: 1,
      recipients: [{
        to: "5000000001",
        guardianId: "guardian-a",
        guardianName: "Ali Veli",
        studentIds: ["student-a"],
        studentNames: ["Ada A"],
      }],
    });
  });

  it("SMS alıcı önizleme filtresini Zod ile doğrular", async () => {
    const response = await request(server)
      .post("/sms-batches/recipients/preview")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentStatus: "UNKNOWN" })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "studentStatus" })],
      },
    });
  });

  it("TEACHER SMS batch oluşturamaz", async () => {
    await request(server)
      .post("/sms-batches")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        templateId: "message-template-a",
        recipients: [{ to: "5000000001" }],
      })
      .expect(403);

    expect(producer.inputs).toHaveLength(0);
  });

  it("TEACHER SMS batch teslim raporunu okuyamaz", async () => {
    await request(server)
      .get("/sms-batches/message-template-a_sms-hash-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);
  });

  it("TEACHER SMS alıcı önizlemesini okuyamaz", async () => {
    await request(server)
      .post("/sms-batches/recipients/preview")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ classId: "class-a" })
      .expect(403);
  });

  it("yetkisiz request SMS batch endpointine erişemez", async () => {
    await request(server).post("/sms-batches").expect(401);
  });
});

class FakeProducer implements SmsBatchQueueProducer {
  inputs: Parameters<SmsBatchQueueProducer["enqueue"]>[0][] = [];

  async enqueue(input: Parameters<SmsBatchQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
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
