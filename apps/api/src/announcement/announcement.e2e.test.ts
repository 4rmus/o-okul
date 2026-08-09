import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NotificationAdapter, NotificationMessage, NotificationSendResult } from "@o-okul/notification-adapter";
import request from "supertest";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";
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
  let campusOperationsAccessToken: string;
  let outOfScopeClassId: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({
      id: "user-campus-announcement",
      email: "campus-announcement@example.test",
      name: "Campus Announcement Operations",
      password: "password",
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      membership: {
        id: "membership-campus-announcement",
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "CAMPUSES",
        campusIds: ["campus-main"],
      },
    });
    registerTestLoginIdentity("campus-announcement@example.test", { tenantSlug: "dna-egitim" });
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

    const campusOperationsLogin = await request(server)
      .post("/auth/login")
      .send(testLoginBody("campus-announcement@example.test"))
      .expect(200);
    campusOperationsAccessToken = (campusOperationsLogin.body as { accessToken: string }).accessToken;

    const outOfScopeCampus = await request(server)
      .post("/campuses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Uzak Kampüs", code: "UZK" })
      .expect(201);
    const outOfScopeClass = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9-Z", campusId: outOfScopeCampus.body.id, section: "Z" })
      .expect(201);
    outOfScopeClassId = outOfScopeClass.body.id as string;

    const expiredTeacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Süresi", lastName: "Dolmuş", branch: "Matematik" })
      .expect(201);
    await request(server)
      .post(`/teachers/${expiredTeacher.body.id}/assignments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        endsAt: "2025-12-31",
        role: "CLASS_TEACHER",
        startsAt: "2025-01-01",
      })
      .expect(201);
  });

  beforeEach(() => {
    producer.inputs = [];
    notificationAdapter.messages = [];
    notificationAdapter.sendCalls = [];
    notificationAdapter.results = [];
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  async function previewAnnouncement(input: Record<string, unknown>) {
    const { audience, campusId, classId, courseId, gradeLevelId, termId } = input;
    return request(server)
      .post("/announcements/recipients/preview")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ audience, campusId, channel: "IN_APP", classId, courseId, gradeLevelId, termId })
      .expect(201);
  }

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

  it("teacher generic yönetim rotalarını kullanamaz; yalnız scoped me rotasından okur", async () => {
    await request(server)
      .get("/announcements/announcement-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);
    await request(server)
      .get("/announcements")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);

    await request(server)
      .get("/me/teacher/announcements")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "announcement-a", tenantId: "tenant-a" })]);
      });
  });

  it("tenant A başka tenant duyurusunu okuyamaz", async () => {
    await request(server)
      .get("/announcements/announcement-b")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);
  });

  it("tenant admin alıcıları PII döndürmeden sayısal olarak önizler", async () => {
    const response = await previewAnnouncement({ audience: "SCHOOL", classId: "class-a" });

    expect(response.body).toMatchObject({
      audience: "SCHOOL",
      channel: "IN_APP",
      counts: { guardians: 1, students: 1, teachers: 1 },
      recipientCount: 3,
      scope: { campusId: "campus-main", classId: "class-a", gradeLevelId: "grade-8" },
    });
    expect(response.body.previewToken).toEqual(expect.any(String));
    expect(response.body.expiresAt).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty("recipients");
    expect(JSON.stringify(response.body)).not.toMatch(/Ada A|guardian-a|student-a|teacher-a/);
    const tokenPayload = JSON.parse(Buffer.from(response.body.previewToken.split(".")[0], "base64url").toString("utf8"));
    expect(JSON.stringify(tokenPayload)).not.toMatch(/tenant-a|user-tenant-a/);
  });

  it("kampüs kapsamlı operasyon personeli yalnız izinli kampüste önizleme yapar", async () => {
    await request(server)
      .post("/announcements/recipients/preview")
      .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
      .send({ audience: "STUDENTS", channel: "IN_APP", classId: "class-a" })
      .expect(201)
      .expect(({ body }) => expect(body.scope).toMatchObject({ campusId: "campus-main", classId: "class-a" }));

    await request(server)
      .post("/announcements/recipients/preview")
      .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
      .send({ audience: "STUDENTS", channel: "IN_APP", classId: outOfScopeClassId })
      .expect(403);
  });

  it("önizleme belirtecini imza ve aktör bağlamı dışında reddeder", async () => {
    const input = {
      audience: "STUDENTS",
      body: "Belirteç bağlamı doğrulanır.",
      classId: "class-a",
      title: "Belirteç doğrulaması",
    };
    const preview = await previewAnnouncement(input);
    const publishBody = {
      ...input,
      channel: "IN_APP",
      recipientPreviewToken: preview.body.previewToken,
    };

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ ...publishBody, recipientPreviewToken: `${preview.body.previewToken}x` })
      .expect(403);

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
      .send(publishBody)
      .expect(403);
  });

  it("tenant admin duyuru oluşturur", async () => {
    const input = {
      title: "Deneme sınavı bilgilendirme",
      body: "Pazartesi günü genel deneme sınavı yapılacaktır.",
      audience: "GUARDIANS",
      classId: "class-a",
    };
    const preview = await previewAnnouncement(input);
    const response = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        ...input,
        channel: "IN_APP",
        recipientPreviewToken: preview.body.previewToken,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      title: "Deneme sınavı bilgilendirme",
      body: "Pazartesi günü genel deneme sınavı yapılacaktır.",
      audience: "GUARDIANS",
      classId: "class-a",
    });
    expect(typeof (response.body as { publishedAt?: unknown }).publishedAt).toBe("string");
  });

  it("tenant admin duyuru oluşturmayı Idempotency-Key ile tekilleştirir", async () => {
    const input = {
      title: "Idempotent duyuru",
      body: "Aynı istek tekrarlandığında tek duyuru kalmalıdır.",
      audience: "STUDENTS",
      classId: "class-a",
    };
    const preview = await previewAnnouncement(input);
    const body = { ...input, channel: "IN_APP", recipientPreviewToken: preview.body.previewToken };
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
        channel: "IN_APP",
        recipientPreviewToken: "unused-preview-token",
      })
      .expect(403);
  });

  it("başlık ve hedef kitle doğrulaması yapar", async () => {
    const missingTitle = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ body: "Eksik başlık", channel: "IN_APP", recipientPreviewToken: "unused-preview-token" })
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
        channel: "IN_APP",
        recipientPreviewToken: "unused-preview-token",
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
      .post("/announcements/recipients/preview")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        audience: "STUDENTS",
        channel: "IN_APP",
        courseId: "course-turkish",
      })
      .expect(400);

    await request(server)
      .post("/announcements/recipients/preview")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        audience: "GUARDIANS",
        channel: "IN_APP",
        classId: "class-a",
        courseId: "course-math",
      })
      .expect(400)
      .expect(({ body }) => expect(body.error?.code).toBe("ANNOUNCEMENT_AUDIENCE_TARGET_INVALID"));
  });

  it("yayın önizleme kapsamını ve yayın anındaki alıcıları yeniden doğrular", async () => {
    const input = {
      title: "Veli kapsamı",
      body: "Yalnız önizlenen veli kapsamına yayınlanır.",
      audience: "GUARDIANS" as const,
      classId: "class-a",
    };
    const preview = await previewAnnouncement(input);
    let zeroRecipientPreviewToken = "";

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        ...input,
        classId: undefined,
        channel: "IN_APP",
        recipientPreviewToken: preview.body.previewToken,
      })
      .expect(403);

    await request(server)
      .patch("/guardians/guardian-a/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ canReceiveAnnouncements: false })
      .expect(200);
    try {
      await request(server)
        .post("/announcements")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({
          ...input,
          channel: "IN_APP",
          recipientPreviewToken: preview.body.previewToken,
        })
        .expect(400)
        .expect(({ body }) => expect(body.error?.code).toBe("ANNOUNCEMENT_RECIPIENT_PREVIEW_STALE"));
      const zeroPreview = await previewAnnouncement(input);
      expect(zeroPreview.body.recipientCount).toBe(0);
      zeroRecipientPreviewToken = zeroPreview.body.previewToken;
    } finally {
      await request(server)
        .patch("/guardians/guardian-a/students/student-a")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ canReceiveAnnouncements: true })
        .expect(200);
    }


    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        ...input,
        channel: "IN_APP",
        recipientPreviewToken: zeroRecipientPreviewToken,
      })
      .expect(400)
      .expect(({ body }) => expect(body.error?.code).toBe("ANNOUNCEMENT_RECIPIENT_PREVIEW_STALE"));
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
