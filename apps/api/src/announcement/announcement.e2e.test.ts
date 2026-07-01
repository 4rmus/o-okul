import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NotificationAdapter, NotificationMessage, NotificationSendResult } from "@o-okul/notification-adapter";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import type { ProducedJob, TenantQueueJobInput } from "../queue/job-producer.js";
import {
  announcementDeliveryQueueProducerToken,
  notificationAdapterToken,
  type AnnouncementDeliveryQueueProducer,
} from "./announcement.service.js";

describe("Announcement API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let producer: FakeProducer;
  let notificationAdapter: FakeNotificationAdapter;
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;

  beforeAll(async () => {
    producer = new FakeProducer();
    notificationAdapter = new FakeNotificationAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(announcementDeliveryQueueProducerToken)
      .useValue(producer)
      .overrideProvider(notificationAdapterToken)
      .useValue(notificationAdapter)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    const login = await request(server)
      .post("/auth/login")
      .send(testLoginBody("admin-a@example.test"))
      .expect(200);
    tenantAAccessToken = (login.body as { accessToken: string }).accessToken;

    const teacherLogin = await request(server)
      .post("/auth/login")
      .send(testLoginBody("teacher-a@example.test"))
      .expect(200);
    teacherAAccessToken = (teacherLogin.body as { accessToken: string }).accessToken;

    const studentLogin = await request(server)
      .post("/auth/login")
      .send(testLoginBody("student-a@example.test"))
      .expect(200);
    studentAAccessToken = (studentLogin.body as { accessToken: string }).accessToken;

    const guardianLogin = await request(server)
      .post("/auth/login")
      .send(testLoginBody("guardian-a@example.test"))
      .expect(200);
    guardianAAccessToken = (guardianLogin.body as { accessToken: string }).accessToken;
  });

  beforeEach(() => {
    producer.inputs = [];
    notificationAdapter.messages = [];
    notificationAdapter.sendCalls = [];
    notificationAdapter.results = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant A sadece kendi duyurularını listeler", async () => {
    const response = await request(server)
      .get("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "announcement-a",
        tenantId: "tenant-a",
        title: "Veli toplantısı",
        body: "Cuma günü 8-A sınıfı için veli toplantısı yapılacaktır.",
        audience: "SCHOOL",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        publishedAt: "2026-06-08T09:00:00.000Z",
      },
    ]);
  });

  it("teacher tenant içindeki duyuruları okuyabilir", async () => {
    const response = await request(server)
      .get("/announcements/announcement-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: "announcement-a",
      tenantId: "tenant-a",
      title: "Veli toplantısı",
    });
  });

  it("tenant A başka tenant duyurusunu okuyamaz", async () => {
    await request(server)
      .get("/announcements/announcement-b")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);
  });

  it("tenant admin duyuru oluşturur", async () => {
    const response = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        title: "Deneme sınavı bilgilendirme",
        body: "Pazartesi günü genel deneme sınavı yapılacaktır.",
        audience: "GUARDIANS",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
      })
      .expect(201);

    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      title: "Deneme sınavı bilgilendirme",
      body: "Pazartesi günü genel deneme sınavı yapılacaktır.",
      audience: "GUARDIANS",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    });
    expect(typeof (response.body as { publishedAt?: unknown }).publishedAt).toBe("string");
  });

  it("tenant admin duyuru oluşturmayı Idempotency-Key ile tekilleştirir", async () => {
    const body = {
      title: "Idempotent duyuru",
      body: "Aynı istek tekrarlandığında tek duyuru kalmalıdır.",
      audience: "STUDENTS",
      classId: "class-a",
    };
    const key = "announcement-create-idempotency-a";

    const first = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, body: "Farklı gövde" })
      .expect(409);

    await request(server)
      .get("/announcements?q=Idempotent%20duyuru")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body: announcements }) => {
        expect(announcements).toHaveLength(1);
      });
  });

  it("tenant admin duyuru alıcı ve okunma raporunu görür", async () => {
    await request(server)
      .post("/me/student/announcements/announcement-a/read")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(201);

    await request(server)
      .get("/announcements/announcement-a/recipients")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          announcementId: "announcement-a",
          total: 3,
          read: 1,
          unread: 2,
        });
        expect(body.recipients).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              recipientType: "STUDENT",
              subjectId: "student-a",
              displayName: "Ada A",
              readAt: expect.any(String),
            }),
            expect.objectContaining({
              recipientType: "GUARDIAN",
              subjectId: "guardian-a",
              relatedStudentId: "student-a",
            }),
            expect.objectContaining({
              recipientType: "TEACHER",
              subjectId: "teacher-a",
            }),
          ]),
        );
      });

    await request(server)
      .get("/announcements/announcement-a/recipients")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);
  });

  it("tenant admin duyuru dış bildirim teslim raporlarını görür", async () => {
    await request(server)
      .get("/announcements/announcement-a/delivery-reports")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            announcementId: "announcement-a",
            channel: "EMAIL",
            recipientCount: 3,
            deliveredCount: 2,
            failedCount: 1,
            status: "completed",
          }),
          expect.objectContaining({
            announcementId: "announcement-a",
            channel: "PUSH",
            recipientCount: 3,
            deliveredCount: 0,
            failedCount: 0,
            status: "queued",
          }),
        ]);
      });

    await request(server)
      .get("/announcements/announcement-a/delivery-reports")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);
  });

  it("tenant admin sağlayıcı teslim sonucunu announcement-delivery queue'ya bağlar", async () => {
    const response = await request(server)
      .post("/announcements/announcement-a/delivery-results")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        channel: "EMAIL",
        recipientCount: 3,
        deliveredCount: 2,
        failedCount: 1,
        status: "completed",
        providerErrorCode: "EMAIL_PROVIDER_RETRY",
      })
      .expect(201);

    expect(producer.inputs).toHaveLength(1);
    expect(producer.inputs[0]).toMatchObject({
      queueName: "announcement-delivery",
      tenantId: "tenant-a",
      userId: "user-tenant-a",
      entityId: "announcement-a",
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      status: "completed",
      providerErrorCode: "EMAIL_PROVIDER_RETRY",
    });
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      announcementId: "announcement-a",
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      queueName: "announcement-delivery",
      jobId: `${producer.inputs[0]?.entityId}_${producer.inputs[0]?.contentHash}`,
      status: "queued",
    });
  });

  it("tenant admin sağlayıcı teslim sonucunu Idempotency-Key ile tekilleştirir", async () => {
    const key = "announcement-delivery-result-idempotency-a";
    const body = {
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      status: "completed",
      providerErrorCode: "EMAIL_PROVIDER_RETRY",
    };

    const first = await request(server)
      .post("/announcements/announcement-a/delivery-results")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/announcements/announcement-a/delivery-results")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(producer.inputs).toHaveLength(1);

    await request(server)
      .post("/announcements/announcement-a/delivery-results")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, failedCount: 0 })
      .expect(409);
    expect(producer.inputs).toHaveLength(1);
  });

  it("tenant admin duyuru alıcılarına e-posta gönderir ve sonucu rapor kuyruğuna bağlar", async () => {
    notificationAdapter.results = [
      { channel: "EMAIL", to: "guardian-a@example.test", status: "sent", providerMessageId: "mail-1" },
      { channel: "EMAIL", to: "student-a@example.test", status: "failed", errorCode: "EMAIL_BOUNCED" },
      { channel: "EMAIL", to: "teacher-a@example.test", status: "sent", providerMessageId: "mail-3" },
    ];

    const response = await request(server)
      .post("/announcements/announcement-a/deliveries")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", "announcement-delivery-send-email-a")
      .send({ channel: "EMAIL" })
      .expect(201);

    expect(notificationAdapter.messages).toEqual([
      {
        channel: "EMAIL",
        to: "guardian-a@example.test",
        subject: "Veli toplantısı",
        body: "Cuma günü 8-A sınıfı için veli toplantısı yapılacaktır.",
      },
      {
        channel: "EMAIL",
        to: "student-a@example.test",
        subject: "Veli toplantısı",
        body: "Cuma günü 8-A sınıfı için veli toplantısı yapılacaktır.",
      },
      {
        channel: "EMAIL",
        to: "teacher-a@example.test",
        subject: "Veli toplantısı",
        body: "Cuma günü 8-A sınıfı için veli toplantısı yapılacaktır.",
      },
    ]);
    expect(producer.inputs).toHaveLength(1);
    expect(producer.inputs[0]).toMatchObject({
      queueName: "announcement-delivery",
      tenantId: "tenant-a",
      userId: "user-tenant-a",
      entityId: "announcement-a",
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      status: "completed",
      providerErrorCode: "EMAIL_BOUNCED",
    });
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      announcementId: "announcement-a",
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      queueName: "announcement-delivery",
      jobId: `${producer.inputs[0]?.entityId}_${producer.inputs[0]?.contentHash}`,
      status: "queued",
    });
  });

  it("tenant admin dış duyuru gönderiminde Idempotency-Key zorunludur", async () => {
    notificationAdapter.results = [
      { channel: "EMAIL", to: "guardian-a@example.test", status: "sent", providerMessageId: "mail-1" },
    ];

    await request(server)
      .post("/announcements/announcement-a/deliveries")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ channel: "EMAIL" })
      .expect(400);

    expect(notificationAdapter.sendCalls).toHaveLength(0);
    expect(producer.inputs).toHaveLength(0);
  });

  it("tenant admin dış duyuru gönderimini Idempotency-Key ile tekilleştirir", async () => {
    const key = "announcement-delivery-send-idempotency-a";
    notificationAdapter.results = [
      { channel: "EMAIL", to: "guardian-a@example.test", status: "sent", providerMessageId: "mail-1" },
      { channel: "EMAIL", to: "student-a@example.test", status: "failed", errorCode: "EMAIL_BOUNCED" },
      { channel: "EMAIL", to: "teacher-a@example.test", status: "sent", providerMessageId: "mail-3" },
    ];
    const body = { channel: "EMAIL" };

    const first = await request(server)
      .post("/announcements/announcement-a/deliveries")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/announcements/announcement-a/deliveries")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(notificationAdapter.sendCalls).toHaveLength(1);
    expect(producer.inputs).toHaveLength(1);

    await request(server)
      .post("/announcements/announcement-a/deliveries")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({ channel: "PUSH" })
      .expect(409);
    expect(notificationAdapter.sendCalls).toHaveLength(1);
    expect(producer.inputs).toHaveLength(1);
  });

  it("tenant admin duyuru alıcılarına push gönderir ve sonucu rapor kuyruğuna bağlar", async () => {
    await request(server)
      .post("/me/notification-devices")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({ provider: "fcm", token: "guardian-device-token", platform: "ios" })
      .expect(201);
    await request(server)
      .post("/me/notification-devices")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({ provider: "fcm", token: "student-device-token", platform: "android" })
      .expect(201);
    await request(server)
      .post("/me/notification-devices")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ provider: "fcm", token: "teacher-device-token", platform: "web" })
      .expect(201);

    const response = await request(server)
      .post("/announcements/announcement-a/deliveries")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", "announcement-delivery-send-push-a")
      .send({ channel: "PUSH" })
      .expect(201);

    expect(notificationAdapter.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "PUSH", to: "guardian-device-token" }),
      expect.objectContaining({ channel: "PUSH", to: "student-device-token" }),
      expect.objectContaining({ channel: "PUSH", to: "teacher-device-token" }),
    ]));
    expect(producer.inputs).toHaveLength(1);
    expect(producer.inputs[0]).toMatchObject({
      queueName: "announcement-delivery",
      tenantId: "tenant-a",
      entityId: "announcement-a",
      channel: "PUSH",
      recipientCount: 3,
      deliveredCount: 3,
      failedCount: 0,
      status: "completed",
    });
    expect(response.body).toEqual(expect.objectContaining({
      announcementId: "announcement-a",
      channel: "PUSH",
      recipientCount: 3,
      deliveredCount: 3,
      failedCount: 0,
      status: "queued",
    }));
  });

  it("duyuru teslim sonucu sayıları ve erişimi doğrular", async () => {
    await request(server)
      .post("/announcements/announcement-a/delivery-results")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        channel: "EMAIL",
        recipientCount: 3,
        deliveredCount: 3,
        failedCount: 1,
        status: "completed",
      })
      .expect(400);

    await request(server)
      .post("/announcements/announcement-a/delivery-results")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        channel: "EMAIL",
        recipientCount: 1,
        deliveredCount: 1,
        failedCount: 0,
        status: "completed",
      })
      .expect(403);

    expect(producer.inputs).toHaveLength(0);
  });

  it("duyuru teslim gövdelerini Zod ile doğrular", async () => {
    const invalidResult = await request(server)
      .post("/announcements/announcement-a/delivery-results")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        channel: "SMS",
        recipientCount: -1,
        deliveredCount: 0,
        failedCount: 0,
        status: "queued",
      })
      .expect(422);

    expect(invalidResult.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "channel" }),
          expect.objectContaining({ path: "recipientCount" }),
          expect.objectContaining({ path: "status" }),
        ]),
      },
    });

    const invalidSend = await request(server)
      .post("/announcements/announcement-a/deliveries")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({})
      .expect(422);

    expect(invalidSend.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "channel" })],
      },
    });
    expect(producer.inputs).toHaveLength(0);
  });

  it("tenant admin başka tenant adına duyuru oluşturamaz", async () => {
    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        tenantId: "tenant-b",
        title: "Gizli duyuru",
        body: "Başka tenant",
      })
      .expect(403);
  });

  it("başlık ve hedef kitle doğrulaması yapar", async () => {
    const missingTitle = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ body: "Eksik başlık" })
      .expect(422);

    expect(missingTitle.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "title" })],
      },
    });

    const invalidAudience = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        title: "Hatalı hedef",
        body: "Geçersiz hedef",
        audience: "UNKNOWN",
      })
      .expect(422);

    expect(invalidAudience.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "audience" })],
      },
    });
  });

  it("duyuru hedef referanslarını tenant içinde doğrular", async () => {
    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        title: "Başka tenant dersi",
        body: "Tenant dışı hedef reddedilmeli.",
        audience: "STUDENTS",
        courseId: "course-turkish",
      })
      .expect(400);
  });

  it("teacher duyuru oluşturamaz", async () => {
    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        title: "Teacher duyurusu",
        body: "Yetkisiz yazma",
      })
      .expect(403);
  });

  it("yetkisiz request duyuru endpointine erişemez", async () => {
    await request(server).get("/announcements").expect(401);
  });
});

class FakeProducer implements AnnouncementDeliveryQueueProducer {
  inputs: TenantQueueJobInput[] = [];

  async enqueue(input: TenantQueueJobInput): Promise<ProducedJob> {
    this.inputs.push(input);
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload: input,
      options: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        jobId: `${input.entityId}_${input.contentHash}`,
        removeOnFail: false,
      },
    } as ProducedJob;
  }
}

class FakeNotificationAdapter implements NotificationAdapter {
  messages: NotificationMessage[] = [];
  sendCalls: NotificationMessage[][] = [];
  results: NotificationSendResult[] = [];

  async sendBatch(messages: NotificationMessage[]): Promise<NotificationSendResult[]> {
    this.messages = messages.map((message) => ({ ...message }));
    this.sendCalls.push(this.messages);
    if (this.results.length > 0) {
      return this.results.map((result) => ({ ...result }));
    }
    return messages.map((message, index) => ({
      channel: message.channel,
      to: message.to,
      status: "sent",
      providerMessageId: `fake-${index + 1}`,
    }));
  }
}
