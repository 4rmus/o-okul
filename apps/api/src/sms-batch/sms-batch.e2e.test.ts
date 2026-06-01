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
    await request(server)
      .post("/sms-batches")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        templateId: "message-template-a",
        recipients: [{ to: " " }],
      })
      .expect(400);

    expect(producer.inputs).toHaveLength(0);
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
