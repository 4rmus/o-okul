import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Support ticket API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

    const studentLogin = await request(server)
      .post("/auth/login")
      .send({ email: "student-a@example.test", password: "password" })
      .expect(200);
    studentAAccessToken = (studentLogin.body as { accessToken: string }).accessToken;

    const guardianLogin = await request(server)
      .post("/auth/login")
      .send({ email: "guardian-a@example.test", password: "password" })
      .expect(200);
    guardianAAccessToken = (guardianLogin.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

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
      requesterId: "teacher-tenant-a",
      subject: "Portal yoklama sorunu",
      studentId: "student-a",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      status: "OPEN",
    });

    await request(server)
      .get("/me/teacher/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id, requesterId: "teacher-tenant-a" })]));
        expect(body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "support-ticket-a" })]));
      });
  });

  it("öğretmen kapsam dışı sınıf için destek talebi açamaz", async () => {
    const createdClass = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Destek Dışı", level: "8" })
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
      requesterId: "student-tenant-a",
      studentId: "student-a",
      subject: "Ödev dosyası açılmıyor",
      status: "OPEN",
    });

    await request(server)
      .get("/me/student/support-tickets")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: created.body.id, studentId: "student-a" })]);
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
      requesterId: "guardian-tenant-a",
      studentId: "student-a",
      subject: "Rapor sorusu",
      priority: "HIGH",
    });

    await request(server)
      .get("/me/guardian/students/student-a/support-tickets")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: created.body.id, requesterId: "guardian-tenant-a" })]);
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

    const created = await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        fileName: "../ekran.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      ticketId: "support-ticket-a",
      uploadedById: "teacher-tenant-a",
      fileName: "ekran.txt",
      contentType: "text/plain",
      byteSize: 11,
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    });
    expect(created.body.contentBase64).toBeUndefined();
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

    const created = await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ body: "Kontrol ediyoruz." })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      ticketId: "support-ticket-a",
      authorId: "teacher-tenant-a",
      body: "Kontrol ediyoruz.",
    });
    expect(typeof (created.body as { createdAt?: unknown }).createdAt).toBe("string");
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
    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        fileName: "ekran.exe",
        contentType: "application/x-msdownload",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(400);

    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        fileName: "ekran.txt",
        contentType: "text/plain",
        fileBase64: "not-base64",
      })
      .expect(400);

    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        fileName: "ekran.txt",
        contentType: "text/plain",
        fileBase64: Buffer.alloc(64 * 1024 + 1).toString("base64"),
      })
      .expect(400);

    await request(server)
      .post("/support-tickets/support-ticket-a/attachments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        fileName: "ekran.pdf",
        contentType: "application/pdf",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(400);
  });

  it("boş destek yorumunu reddeder", async () => {
    await request(server)
      .post("/support-tickets/support-ticket-a/comments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ body: " " })
      .expect(400);
  });

  it("geçersiz destek talebi girdilerini reddeder", async () => {
    await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ message: "Konu yok" })
      .expect(400);

    await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ subject: "Konu", message: "Mesaj", priority: "URGENT" })
      .expect(400);

    await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ subject: "Konu", message: "Mesaj", classId: "class-b" })
      .expect(400);

    await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({})
      .expect(400);
  });

  it("teacher destek durumunu güncelleyemez", async () => {
    await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ status: "RESOLVED" })
      .expect(403);
  });

  it("yetkisiz request destek endpointine erişemez", async () => {
    await request(server).get("/support-tickets").expect(401);
  });
});
