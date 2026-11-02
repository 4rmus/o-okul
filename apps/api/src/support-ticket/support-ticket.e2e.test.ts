import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Support ticket API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;
  let mainCampusOperationsToken: string;
  let otherCampusOperationsToken: string;

  beforeAll(async () => {
    for (const [id, email, campusId] of [
      ["user-support-ops-main", "support-ops-main@example.test", "campus-main"],
      ["user-support-ops-other", "support-ops-other@example.test", "campus-other"],
    ] as const) {
      upsertInMemoryAuthUser({
        id,
        email,
        name: "Kampüs Operasyon",
        password: "password",
        tenantId: "tenant-a",
        roles: ["OPERATIONS_STAFF"],
        membership: {
          id: `membership-${id}`,
          staffRole: "OPERATIONS_STAFF",
          hasTeacherPersona: false,
          hasStudentPersona: false,
          version: 1,
          scopeMode: "CAMPUSES",
          campusIds: [campusId],
        },
      });
      registerTestLoginIdentity(email, { tenantSlug: "dna-egitim" });
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
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

    mainCampusOperationsToken = await loginToken("support-ops-main@example.test");
    otherCampusOperationsToken = await loginToken("support-ops-other@example.test");
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  async function loginToken(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("tenant A sadece kendi destek taleplerini listeler", async () => {
    const response = await request(server)
      .get("/support-tickets")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "support-ticket-a",
        tenantId: "tenant-a",
        requesterId: "user-tenant-a",
        studentId: "student-a",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        subject: "Optik dosya yüklenemiyor",
        message: "TXT dosyası yüklenirken hata alıyoruz.",
        priority: "NORMAL",
        status: "OPEN",
        createdAt: "2026-06-08T09:00:00.000Z",
      },
    ]);
  });

  it("destek taleplerini akademik bağlam filtresiyle listeler", async () => {
    const response = await request(server)
      .get("/support-tickets?campusId=campus-main&gradeLevelId=grade-8&classId=class-a&courseId=course-math&termId=term-2026-spring")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: "support-ticket-a",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
      }),
    ]);

    const emptyResponse = await request(server)
      .get("/support-tickets?courseId=course-turkish")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);
    expect(emptyResponse.body).toEqual([]);
  });

  it("destek taleplerini arama, sıralama ve sayfalama sorgusuyla listeler", async () => {
    const response = await request(server)
      .get("/support-tickets?q=optik&sort=-createdAt&page=1&limit=1")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: "support-ticket-a",
        subject: "Optik dosya yüklenemiyor",
      }),
    ]);
  });

  it("teacher tenant içinde destek talebi oluşturabilir", async () => {
    const created = await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        subject: "Rapor PDF indirilemiyor",
        message: "PDF butonu hata veriyor.",
        priority: "HIGH",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      requesterId: "teacher-tenant-a",
      subject: "Rapor PDF indirilemiyor",
      message: "PDF butonu hata veriyor.",
      priority: "HIGH",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      status: "OPEN",
    });
    expect(typeof (created.body as { createdAt?: unknown }).createdAt).toBe("string");
  });

  it("öğretmen me yüzeyinden yalnız kendi destek taleplerini açar ve listeler", async () => {
    const created = await request(server)
      .post("/me/teacher/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        subject: "Portal yoklama sorunu",
        message: "Yoklama kaydet düğmesi hata verdi.",
        priority: "NORMAL",
        studentId: "student-a",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      subject: "Portal yoklama sorunu",
      studentId: "student-a",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      status: "OPEN",
    });
    expectPortalSupportTicketResponseIsPublic(created.body);

    await request(server)
      .get("/me/teacher/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id, studentId: "student-a" })]));
        expect(body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "support-ticket-a" })]));
        expectPortalSupportTicketResponseIsPublic(body);
      });
  });

  it("öğretmen kapsam dışı sınıf için destek talebi açamaz", async () => {
    const createdClass = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Destek Dışı" })
      .expect(201);

    await request(server)
      .post("/me/teacher/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        subject: "Kapsam dışı",
        message: "Bu sınıf benim kapsamımda değil.",
        classId: createdClass.body.id,
      })
      .expect(403);
  });

  it("öğrenci kendi portalından destek talebi açar ve listeler", async () => {
    const created = await request(server)
      .post("/me/student/support-tickets")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({
        subject: "Ödev dosyası açılmıyor",
        message: "Materyal bağlantısı hata veriyor.",
        priority: "NORMAL",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      studentId: "student-a",
      subject: "Ödev dosyası açılmıyor",
      status: "OPEN",
    });
    expectPortalSupportTicketResponseIsPublic(created.body);

    await request(server)
      .get("/me/student/support-tickets")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: created.body.id, studentId: "student-a" })]);
        expectPortalSupportTicketResponseIsPublic(body);
      });
  });

  it("veli bağlı ve izinli öğrenci için destek talebi açar", async () => {
    const created = await request(server)
      .post("/me/guardian/students/student-a/support-tickets")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({
        subject: "Rapor sorusu",
        message: "Son raporu görüntüleyemiyorum.",
        priority: "HIGH",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      studentId: "student-a",
      subject: "Rapor sorusu",
      priority: "HIGH",
    });
    expectPortalSupportTicketResponseIsPublic(created.body);

    await request(server)
      .get("/me/guardian/students/student-a/support-tickets")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: created.body.id, studentId: "student-a" })]);
        expectPortalSupportTicketResponseIsPublic(body);
      });

    await request(server)
      .get("/me/guardian/students/student-b/support-tickets")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(403);
  });

  it("veli destek izni kapalıysa talep açamaz", async () => {
    await request(server)
      .get("/me/guardian/students/student-a/notification-preferences")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.objectContaining({
          guardianId: "guardian-a",
          studentId: "student-a",
          canReceiveSms: true,
          canReceiveAnnouncements: true,
          canOpenSupportTickets: true,
        }));
      });

    await request(server)
      .patch("/me/guardian/students/student-a/notification-preferences")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({ canReceiveSms: false, canReceiveAnnouncements: false, canOpenSupportTickets: false })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.objectContaining({
          canReceiveSms: false,
          canReceiveAnnouncements: false,
          canOpenSupportTickets: false,
        }));
      });

    await request(server)
      .patch("/me/guardian/students/student-a/notification-preferences")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({ canReceiveSms: "no", canReceiveAnnouncements: 1 })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: "VALIDATION_FAILED",
          details: {
            fields: expect.arrayContaining([
              expect.objectContaining({ path: "canReceiveAnnouncements" }),
              expect.objectContaining({ path: "canReceiveSms" }),
            ]),
          },
        });
      });

    await request(server)
      .get("/me/guardian/students/student-b/notification-preferences")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(403);

    await request(server)
      .post("/me/guardian/students/student-a/support-tickets")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({ subject: "İzin kapalı", message: "Açılamamalı.", priority: "LOW" })
      .expect(403);

    await request(server)
      .patch("/me/guardian/students/student-a/notification-preferences")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({ canReceiveSms: true, canReceiveAnnouncements: true, canOpenSupportTickets: true })
      .expect(200);
  });

  it("öğrenci talebinde konuşmayı güvenli biçimde listeler, idempotent yanıtlar ve durum kurallarını uygular", async () => {
    const created = await request(server)
      .post("/me/student/support-tickets")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({ subject: "Konuşma testi", message: "İlk mesaj", priority: "NORMAL" })
      .expect(201);
    const ticketId = created.body.id as string;

    await request(server)
      .post(`/support-tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `institution-comment-${ticketId}`)
      .send({ body: "Kurum yanıtı" })
      .expect(201);

    const listed = await request(server)
      .get(`/me/student/support-tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ ticketId, author: "INSTITUTION", body: "Kurum yanıtı" }),
    ]);
    expectPortalCommentResponseIsPublic(listed.body);

    await request(server)
      .post(`/me/student/support-tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({ body: "Anahtarsız yanıt" })
      .expect(400);

    const idempotencyKey = `student-comment-${ticketId}`;
    const firstReply = await request(server)
      .post(`/me/student/support-tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ body: "Öğrenci yanıtı" })
      .expect(201);
    const repeatedReply = await request(server)
      .post(`/me/student/support-tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ body: "Öğrenci yanıtı" })
      .expect(201);
    expect(repeatedReply.body).toEqual(firstReply.body);
    expect(firstReply.body).toMatchObject({
      ticket: { id: ticketId, status: "OPEN" },
      comment: { ticketId, author: "REQUESTER", body: "Öğrenci yanıtı" },
    });
    expectPortalCommentResponseIsPublic(firstReply.body);

    await request(server)
      .patch(`/support-tickets/${ticketId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ status: "RESOLVED" })
      .expect(200);
    await request(server)
      .post(`/me/student/support-tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .set("Idempotency-Key", `student-reopen-${ticketId}`)
      .send({ body: "Sorun sürüyor" })
      .expect(201)
      .expect(({ body }) => expect(body.ticket.status).toBe("IN_PROGRESS"));

    await request(server)
      .patch(`/support-tickets/${ticketId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ status: "CLOSED" })
      .expect(200);
    await request(server)
      .post(`/me/student/support-tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .set("Idempotency-Key", `student-closed-${ticketId}`)
      .send({ body: "Kapalı talep yanıtı" })
      .expect(409);

    await request(server)
      .get(`/me/teacher/support-tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(404);
  });

  it("öğretmen yalnız kendi talebine metin yanıtı ekler", async () => {
    const teacherTicket = await request(server)
      .post("/me/teacher/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ subject: "Öğretmen konuşması", message: "Öğretmen mesajı" })
      .expect(201);
    await request(server)
      .post(`/me/teacher/support-tickets/${teacherTicket.body.id}/comments`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .set("Idempotency-Key", `teacher-comment-${teacherTicket.body.id}`)
      .send({ body: "Öğretmen yanıtı" })
      .expect(201)
      .expect(({ body }) => expect(body.comment.author).toBe("REQUESTER"));

    await request(server)
      .get(`/me/student/support-tickets/${teacherTicket.body.id}/comments`)
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(404);
  });

  it("tenant A başka tenant destek talebini okuyamaz", async () => {
    await request(server)
      .get("/support-tickets/support-ticket-b")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);
  });

  it("tenant admin destek talebi durumunu günceller", async () => {
    const updated = await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ status: "IN_PROGRESS", priority: "HIGH" })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: "support-ticket-a",
      status: "IN_PROGRESS",
      priority: "HIGH",
    });
  });

  it("destek talebine güvenli dosya eki ekler ve listeler", async () => {
    const list = await request(server)
      .get("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(list.body).toEqual([
      {
        id: "support-attachment-a",
        tenantId: "tenant-a",
        ticketId: "support-ticket-a",
        uploadedById: "user-tenant-a",
        fileName: "hata-ekrani.txt",
        contentType: "text/plain",
        byteSize: 11,
        sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
        createdAt: "2026-06-08T09:10:00.000Z",
      },
    ]);

    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        fileName: "../ekran.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(404);

    const created = await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "../ekran.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      ticketId: "support-ticket-a",
      uploadedById: "user-tenant-a",
      fileName: "ekran.txt",
      contentType: "text/plain",
      byteSize: 11,
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    });
    expect(created.body.contentBase64).toBeUndefined();
    expect(created.body.fileBase64).toBeUndefined();
  });

  it("destek eki yüklemeyi Idempotency-Key ile tekilleştirir", async () => {
    const key = "support-attachment-idempotency-a";
    const body = {
      fileName: "idempotent-ek.txt",
      contentType: "text/plain",
      fileBase64: Buffer.from("idempotent attachment").toString("base64"),
    };

    const first = await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({
        ...body,
        fileBase64: Buffer.from("different attachment").toString("base64"),
      })
      .expect(409);

    await request(server)
      .get("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body: attachments }) => {
        expect((attachments as Array<{ fileName: string }>).filter((attachment) => attachment.fileName === "idempotent-ek.txt")).toHaveLength(1);
      });
  });

  it("destek eki içeriğini sadece doğru tenant ve bildirim altında indirir", async () => {
    const downloaded = await request(server)
      .get("/support-tickets/support-ticket-a/attachments/support-attachment-a/download")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(downloaded.body).toEqual({
      fileName: "hata-ekrani.txt",
      contentType: "text/plain",
      byteSize: 11,
      sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
      downloadMode: "inline",
      fileBase64: "aGVsbG8gd29ybGQ=",
    });

    await request(server)
      .get("/support-tickets/support-ticket-b/attachments/support-attachment-b/download")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);

    await request(server)
      .get("/support-tickets/support-ticket-a/attachments/support-attachment-b/download")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(404);
  });

  it("destek talebine yorum ekler ve listeler", async () => {
    const list = await request(server)
      .get("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(list.body).toEqual([
      {
        id: "support-comment-a",
        tenantId: "tenant-a",
        ticketId: "support-ticket-a",
        authorId: "user-tenant-a",
        body: "Ekran görüntüsünü ekledim.",
        createdAt: "2026-06-08T09:20:00.000Z",
      },
    ]);

    await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ body: "Kontrol ediyoruz." })
      .expect(404);

    const created = await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ body: "Kontrol ediyoruz." })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      ticketId: "support-ticket-a",
      authorId: "user-tenant-a",
      body: "Kontrol ediyoruz.",
    });
    expect(typeof (created.body as { createdAt?: unknown }).createdAt).toBe("string");
  });

  it("destek yorumunu Idempotency-Key ile tekilleştirir", async () => {
    const key = "support-comment-idempotency-a";
    const body = { body: "Idempotent destek yorumu." };

    const first = await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({ body: "Farklı destek yorumu." })
      .expect(409);

    await request(server)
      .get("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body: comments }) => {
        expect((comments as Array<{ body: string }>).filter((comment) => comment.body === "Idempotent destek yorumu.")).toHaveLength(1);
      });
  });

  it("başka tenant destek talebine dosya eki ekleyemez", async () => {
    await request(server)
      .post("/support-tickets/support-ticket-b/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "ekran.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(403);
  });

  it("başka tenant destek talebine yorum ekleyemez", async () => {
    await request(server)
      .get("/support-tickets/support-ticket-b/comments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);

    await request(server)
      .post("/support-tickets/support-ticket-b/comments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ body: "Yanlış tenant" })
      .expect(403);
  });

  it("geçersiz destek eki girdilerini reddeder", async () => {
    const invalidContentType = await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "ekran.exe",
        contentType: "application/x-msdownload",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(422);

    expect(invalidContentType.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "contentType" })],
      },
    });

    const missingFile = await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "ekran.txt",
        contentType: "text/plain",
      })
      .expect(422);

    expect(missingFile.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "fileBase64" })],
      },
    });

    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "ekran.txt",
        contentType: "text/plain",
        fileBase64: "not-base64",
      })
      .expect(400);

    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "ekran.txt",
        contentType: "text/plain",
        fileBase64: Buffer.alloc(64 * 1024 + 1).toString("base64"),
      })
      .expect(400);

    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "ekran.pdf",
        contentType: "application/pdf",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(400);
  });

  it("boş destek yorumunu reddeder", async () => {
    const response = await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ body: " " })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "body" })],
      },
    });
  });

  it("geçersiz destek talebi girdilerini reddeder", async () => {
    const missingSubject = await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ message: "Konu yok" })
      .expect(422);

    expect(missingSubject.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "subject" })],
      },
    });

    const invalidPriority = await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ subject: "Konu", message: "Mesaj", priority: "URGENT" })
      .expect(422);

    expect(invalidPriority.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "priority" })],
      },
    });

    await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ subject: "Konu", message: "Mesaj", classId: "class-b" })
      .expect(400);

    const emptyUpdate = await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({})
      .expect(422);

    expect(emptyUpdate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "$" })],
      },
    });
  });

  it("portal destek talebi gövdesini Zod ile doğrular", async () => {
    const response = await request(server)
      .post("/me/student/support-tickets")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({ message: "Konu yok" })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
          fields: [expect.objectContaining({ path: "subject" })],
        },
      });

    await request(server)
      .post("/me/student/support-tickets")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({
        subject: "Kapsam dışı",
        message: "Body öğrenci seçemez.",
        requesterId: "student-tenant-a",
        status: "CLOSED",
        studentId: "student-b",
        tenantId: "tenant-b",
      })
      .expect(422);

    await request(server)
      .post("/me/guardian/students/student-a/support-tickets")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({
        subject: "Kapsam dışı",
        message: "Body öğrenci seçemez.",
        requesterId: "guardian-tenant-a",
        status: "CLOSED",
        studentId: "student-b",
        tenantId: "tenant-b",
      })
      .expect(422);

    await request(server)
      .post("/me/teacher/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        subject: "Kapsam dışı",
        message: "Tenant body'den gelmemeli.",
        requesterId: "teacher-tenant-a",
        status: "CLOSED",
        tenantId: "tenant-b",
      })
      .expect(422);
  });

  it("teacher destek durumunu güncelleyemez", async () => {
    await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ status: "RESOLVED" })
      .expect(403);
  });

  it("öğretmen personel uçlarında yalnız kendi taleplerini görür; başkasının talebine 404 alır", async () => {
    const own = await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ subject: "Kendi talebim", message: "Öğretmen talebi." })
      .expect(201);
    const ownId = own.body.id as string;
    const studentTicket = await request(server)
      .post("/me/student/support-tickets")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({ subject: "Öğrenci talebi", message: "Öğretmen görmemeli." })
      .expect(201);
    const guardianTicket = await request(server)
      .post("/me/guardian/students/student-a/support-tickets")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({ subject: "Veli talebi", message: "Öğretmen görmemeli." })
      .expect(201);

    const listed = await request(server)
      .get("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200);
    const listedTickets = listed.body as Array<{ id: string; requesterId: string }>;
    expect(listedTickets.map((ticket) => ticket.id)).toContain(ownId);
    expect(listedTickets.every((ticket) => ticket.requesterId === "teacher-tenant-a")).toBe(true);

    const attachment = { fileName: "ek.txt", contentType: "text/plain", fileBase64: Buffer.from("hello world").toString("base64") };
    for (const ticketId of ["support-ticket-a", studentTicket.body.id as string, guardianTicket.body.id as string]) {
      await request(server).get(`/support-tickets/${ticketId}`).set("Authorization", `Bearer ${teacherAAccessToken}`).expect(404);
      await request(server).get(`/support-tickets/${ticketId}/comments`).set("Authorization", `Bearer ${teacherAAccessToken}`).expect(404);
      await request(server).get(`/support-tickets/${ticketId}/attachments`).set("Authorization", `Bearer ${teacherAAccessToken}`).expect(404);
      await request(server)
        .post(`/support-tickets/${ticketId}/comments`)
        .set("Authorization", `Bearer ${teacherAAccessToken}`)
        .send({ body: "Erişememeli." })
        .expect(404);
      await request(server)
        .post(`/support-tickets/${ticketId}/attachments`)
        .set("Authorization", `Bearer ${teacherAAccessToken}`)
        .send(attachment)
        .expect(404);
    }
    await request(server)
      .get("/support-tickets/support-ticket-a/attachments/support-attachment-a/download")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(404);

    await request(server).get(`/support-tickets/${ownId}`).set("Authorization", `Bearer ${teacherAAccessToken}`).expect(200);
    await request(server)
      .post(`/support-tickets/${ownId}/comments`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ body: "Kendi talebime yanıt." })
      .expect(201);
    await request(server)
      .post(`/support-tickets/${ownId}/attachments`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send(attachment)
      .expect(201);
    await request(server)
      .get(`/support-tickets/${ownId}/comments`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([expect.objectContaining({ body: "Kendi talebime yanıt." })]));

    await request(server)
      .get("/me/teacher/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: ownId })]));
        expect(body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "support-ticket-a" })]));
        expectPortalSupportTicketResponseIsPublic(body);
      });
    await request(server)
      .get(`/me/teacher/support-tickets/${ownId}/comments`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200);
    await request(server)
      .get(`/me/teacher/support-tickets/${studentTicket.body.id as string}/comments`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(404);
  });

  it("CAMPUSES kapsamlı personel yalnız kendi kampüsünün taleplerine ulaşır; kampüssüz talepler kapalı kalır", async () => {
    // Portal tickets are stamped with the student's class campus at create time, so the campus manager reaches them.
    const portal = await request(server)
      .post("/me/student/support-tickets")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({ subject: "Öğrenci talebi", message: "Kampüs yöneticisi görmeli." })
      .expect(201);
    const portalId = portal.body.id as string;
    const guardianPortal = await request(server)
      .post("/me/guardian/students/student-a/support-tickets")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({ subject: "Veli talebi", message: "Kampüs yöneticisi görmeli." })
      .expect(201);
    const guardianPortalId = guardianPortal.body.id as string;
    const campusless = await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ subject: "Kampüssüz talep", message: "Yalnız kurum geneli personel görür." })
      .expect(201);
    const campuslessId = campusless.body.id as string;
    expect(campusless.body).not.toHaveProperty("campusId");

    await request(server)
      .get("/support-tickets")
      .set("Authorization", `Bearer ${mainCampusOperationsToken}`)
      .expect(200)
      .expect(({ body }) => {
        const tickets = body as Array<{ id: string; campusId?: string }>;
        expect(tickets.map((ticket) => ticket.id)).toEqual(expect.arrayContaining(["support-ticket-a", portalId, guardianPortalId]));
        expect(tickets.map((ticket) => ticket.id)).not.toContain(campuslessId);
        expect(tickets.every((ticket) => ticket.campusId === "campus-main")).toBe(true);
      });
    await request(server).get("/support-tickets/support-ticket-a").set("Authorization", `Bearer ${mainCampusOperationsToken}`).expect(200);
    await request(server)
      .get(`/support-tickets/${portalId}`)
      .set("Authorization", `Bearer ${mainCampusOperationsToken}`)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ campusId: "campus-main", studentId: "student-a" }));
    await request(server).get(`/support-tickets/${guardianPortalId}`).set("Authorization", `Bearer ${mainCampusOperationsToken}`).expect(200);
    await request(server).get(`/support-tickets/${campuslessId}`).set("Authorization", `Bearer ${mainCampusOperationsToken}`).expect(404);

    await request(server)
      .get("/support-tickets")
      .set("Authorization", `Bearer ${otherCampusOperationsToken}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));
    for (const ticketId of ["support-ticket-a", portalId, guardianPortalId, campuslessId]) {
      await request(server).get(`/support-tickets/${ticketId}`).set("Authorization", `Bearer ${otherCampusOperationsToken}`).expect(404);
    }
    await request(server).get("/support-tickets/support-ticket-a/comments").set("Authorization", `Bearer ${otherCampusOperationsToken}`).expect(404);
    await request(server).get("/support-tickets/support-ticket-a/attachments").set("Authorization", `Bearer ${otherCampusOperationsToken}`).expect(404);
    await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${otherCampusOperationsToken}`)
      .send({ body: "Kapsam dışı." })
      .expect(404);
    await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${otherCampusOperationsToken}`)
      .send({ status: "RESOLVED" })
      .expect(404);

    await request(server).get(`/support-tickets/${campuslessId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(200);
  });

  it("CAMPUSES kapsamlı personel kapsam dışı kampüs, sınıf veya öğrenciye talep açamaz", async () => {
    for (const body of [{ classId: "class-a" }, { studentId: "student-a" }, { campusId: "campus-main" }]) {
      const rejected = await request(server)
        .post("/support-tickets")
        .set("Authorization", `Bearer ${otherCampusOperationsToken}`)
        .send({ subject: "Kapsam dışı", message: "Başka kampüs.", ...body })
        .expect(403);
      expect(rejected.body.error.code).toBe("SUPPORT_TICKET_CAMPUS_SCOPE_FORBIDDEN");
    }

    const inScope = await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${mainCampusOperationsToken}`)
      .send({ subject: "Kapsam içi", message: "Merkez kampüs.", classId: "class-a" })
      .expect(201);
    expect(inScope.body).toMatchObject({ classId: "class-a", campusId: "campus-main" });

    // A campus-scoped creator may still open a ticket without context; only the requester and tenant-wide staff see it.
    await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${otherCampusOperationsToken}`)
      .send({ subject: "Bağlamsız", message: "Genel soru." })
      .expect(201);
  });

  it("yetkisiz request destek endpointine erişemez", async () => {
    await request(server).get("/support-tickets").expect(401);
  });

  it("destek talebi oluşturmayı dört uçta da Idempotency-Key ile tekilleştirir", async () => {
    const cases = [
      { path: "/support-tickets", token: teacherAAccessToken, key: "support-ticket-create-idempotency-a" },
      { path: "/me/teacher/support-tickets", token: teacherAAccessToken, key: "teacher-support-ticket-create-idempotency-a" },
      { path: "/me/student/support-tickets", token: studentAAccessToken, key: "student-support-ticket-create-idempotency-a" },
      { path: "/me/guardian/students/student-a/support-tickets", token: guardianAAccessToken, key: "guardian-support-ticket-create-idempotency-a" },
    ];
    for (const { path, token, key } of cases) {
      const body = { subject: "Tekil talep", message: "Aynı istek iki kez gönderildi.", priority: "NORMAL" };
      const first = await request(server).post(path).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", key).send(body).expect(201);
      const second = await request(server).post(path).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", key).send(body).expect(201);
      expect(second.body).toEqual(first.body);
      await request(server)
        .post(path)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send({ ...body, message: "Farklı içerik." })
        .expect(409)
        .expect(({ body: error }) => expect(error.error.code).toBe("IDEMPOTENCY_KEY_BODY_MISMATCH"));
    }
  });
});

function expectPortalSupportTicketResponseIsPublic(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "requesterId",
    "userId",
    "student-tenant-a",
    "guardian-tenant-a",
    "teacher-tenant-a",
    "token",
    "storageKey",
    "fileBase64",
    "contentBase64",
    "downloadUrl",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}

function expectPortalCommentResponseIsPublic(body: unknown): void {
  const records = Array.isArray(body) ? body : [(body as { comment: unknown }).comment];
  for (const record of records) {
    expect(record).not.toHaveProperty("authorId");
    expect(record).not.toHaveProperty("tenantId");
  }
}
