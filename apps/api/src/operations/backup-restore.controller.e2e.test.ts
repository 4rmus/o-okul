import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import type { ProducedJob } from "../queue/job-producer.js";
import {
  backupRestoreQueueProducerToken,
  type BackupRestoreQueueProducer,
} from "./backup-restore.service.js";

describe("BackupRestoreController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let producer: FakeProducer;
  let tenantAAccessToken: string;

  beforeAll(async () => {
    producer = new FakeProducer();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(backupRestoreQueueProducerToken)
      .useValue(producer)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    tenantAAccessToken = await login("admin-a@example.test");
  });

  beforeEach(() => {
    producer.inputs = [];
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("tenant admin çift onaylı backup job başlatır", async () => {
    const response = await request(server)
      .post("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        confirmationText: "YEDEK AL",
        operationType: "BACKUP",
        reason: "Panelden korumalı yedek alma",
        targetReference: "file:///mnt/backups/tenant-a",
      })
      .expect(201);

    expect(producer.inputs).toEqual([expect.objectContaining({
      queueName: "backup-restore",
      tenantId: "tenant-a",
      userId: "user-tenant-a",
      operationType: "BACKUP",
      reason: "Panelden korumalı yedek alma",
      targetReference: "file:///mnt/backups/tenant-a",
    })]);
    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      requestedByUserId: "user-tenant-a",
      operationType: "BACKUP",
      targetReference: "file:///mnt/backups/tenant-a",
      queueName: "backup-restore",
      status: "queued",
    });
    expect(response.body.jobId).toEqual(expect.any(String));

    await request(server)
      .get("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: response.body.id,
            operationType: "BACKUP",
            targetReference: "file:///mnt/backups/tenant-a",
          }),
        ]);
      });
  });

  it("tenant admin backup restore job başlatmayı Idempotency-Key ile tekilleştirir", async () => {
    const key = "backup-restore-idempotency-a";
    const body = {
      confirmationText: "YEDEK AL",
      operationType: "BACKUP",
      reason: "Panelden korumalı idempotent yedek alma",
      targetReference: "file:///mnt/backups/tenant-a-idempotent",
    };

    const first = await request(server)
      .post("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(producer.inputs).toHaveLength(1);

    await request(server)
      .post("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, reason: "Aynı key farklı açıklama" })
      .expect(409);
    expect(producer.inputs).toHaveLength(1);
  });

  it("backup target sözleşmesi geçersizse producer'a iş göndermez", async () => {
    const response = await request(server)
      .post("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        confirmationText: "YEDEK AL",
        operationType: "BACKUP",
        reason: "Serbest hedef reddi",
        targetReference: "offsite-backup",
      })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: "BACKUP_RESTORE_BACKUP_TARGET_URL_REQUIRED",
      message: "İstek geçersiz.",
    });
    expect(producer.inputs).toHaveLength(0);
  });

  it("backup restore job gövdesini Zod ile doğrular", async () => {
    const response = await request(server)
      .post("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        confirmationText: " ",
        operationType: "DELETE",
        reason: 123,
        targetReference: " ",
      })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "confirmationText" }),
          expect.objectContaining({ path: "operationType" }),
          expect.objectContaining({ path: "reason" }),
          expect.objectContaining({ path: "targetReference" }),
        ]),
      },
    });
    expect(producer.inputs).toHaveLength(0);
  });
});

class FakeProducer implements BackupRestoreQueueProducer {
  inputs: Parameters<BackupRestoreQueueProducer["enqueue"]>[0][] = [];

  async enqueue(input: Parameters<BackupRestoreQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
    this.inputs.push(input);
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload: input,
      options: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        jobId: `${input.entityId}_${input.contentHash}`,
        removeOnFail: false,
      },
    } as ProducedJob;
  }
}
