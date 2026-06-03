import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Study Session API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant A sadece kendi etütlerini listeler", async () => {
    const response = await request(server)
      .get("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "study-a",
        tenantId: "tenant-a",
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        studentIds: ["student-a"],
        title: "Matematik Etut",
        capacity: 4,
        startsAt: "2026-06-02T13:00:00.000Z",
        endsAt: "2026-06-02T14:00:00.000Z",
      },
    ]);
  });

  it("etüt listesinde page/limit/q/sort uygular", async () => {
    await request(server)
      .get("/study-sessions")
      .query({ q: "matematik", sort: "-startsAt", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "study-a", title: "Matematik Etut" })]);
      });

    await request(server)
      .get("/study-sessions")
      .query({ sort: "unknown" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);
  });

  it("etüt CRUD akışını tenant içinde tamamlar", async () => {
    const created = await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        studentIds: ["student-a"],
        title: "Problem Çözümü",
        capacity: 2,
        startsAt: "2026-06-02T14:00:00.000Z",
        endsAt: "2026-06-02T15:00:00.000Z",
      })
      .expect(201);

    const sessionId = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      classId: "class-a",
      teacherId: "teacher-a",
      studentIds: ["student-a"],
      title: "Problem Çözümü",
      capacity: 2,
    });

    await request(server)
      .patch(`/study-sessions/${sessionId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "Problem Tekrarı", capacity: 3 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe("Problem Tekrarı");
        expect(body.capacity).toBe(3);
      });

    await request(server).delete(`/study-sessions/${sessionId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/study-sessions/${sessionId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
  });

  it("öğretmen saat çakışmasını tenant içinde 409 ile engeller", async () => {
    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "Çakışan Etüt",
        capacity: 2,
        startsAt: "2026-06-02T13:30:00.000Z",
        endsAt: "2026-06-02T14:30:00.000Z",
      })
      .expect(409);
  });

  it("kapasite öğrenci sayısını karşılamazsa etüt oluşturmayı reddeder", async () => {
    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "Kapasitesiz Etüt",
        capacity: 0,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(400);
  });

  it("tenant A başka tenant class/teacher/student ile etüt oluşturamaz", async () => {
    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-b",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "Gizli Class",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-b",
        studentIds: ["student-a"],
        title: "Gizli Öğretmen",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-b"],
        title: "Gizli Öğrenci",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-turkish",
        studentIds: ["student-a"],
        title: "Gizli Ders",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        termId: "term-2026-spring-b",
        studentIds: ["student-a"],
        title: "Gizli Donem",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(403);
  });

  it("tenant A başka tenantId ile etüt oluşturamaz", async () => {
    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        tenantId: "tenant-b",
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "Gizli Tenant",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(403);
  });

  it("zorunlu bağlantılar olmadan etüt oluşturmayı reddeder", async () => {
    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        title: "Eksik Etüt",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(400);
  });

  it("geçersiz saat aralığını reddeder", async () => {
    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "Ters Saat",
        capacity: 2,
        startsAt: "2026-06-02T16:00:00.000Z",
        endsAt: "2026-06-02T15:00:00.000Z",
      })
      .expect(400);
  });

  it("tenant A tenant B etüt kaydına erişemez", async () => {
    await request(server).get("/study-sessions/study-b").set("Authorization", `Bearer ${tenantAAccessToken}`).expect(403);
  });

  it("teacher etütleri okuyabilir ama yazamaz", async () => {
    await request(server).get("/study-sessions").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(200);
    await request(server).get("/study-sessions/study-a").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(200);
    await request(server).get("/study-sessions/study-b").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(403);

    await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "Teacher Etüdü",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .patch("/study-sessions/study-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ title: "Teacher Güncelleme" })
      .expect(403);

    await request(server)
      .delete("/study-sessions/study-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);
  });

  it("yetkisiz request etüt endpointine erişemez", async () => {
    await request(server).get("/study-sessions").expect(401);
  });
});
