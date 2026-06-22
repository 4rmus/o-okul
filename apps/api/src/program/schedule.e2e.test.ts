import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Schedule API", () => {
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

  it("tenant A sadece kendi ders programı kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "lesson-a",
        tenantId: "tenant-a",
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        title: "Matematik",
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-01T10:00:00.000Z",
      },
    ]);
  });

  it("ders programı listesinde page/limit/q/sort uygular", async () => {
    await request(server)
      .get("/schedule-lessons")
      .query({ q: "matematik", sort: "-startsAt", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "lesson-a", title: "Matematik" })]);
      });

    await request(server)
      .get("/schedule-lessons")
      .query({ sort: "unknown" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);
  });

  it("ders programı CRUD akışını tenant içinde tamamlar", async () => {
    const created = await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        title: "Geometri",
        startsAt: "2026-06-01T10:00:00.000Z",
        endsAt: "2026-06-01T11:00:00.000Z",
      })
      .expect(201);

    const lessonId = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      classId: "class-a",
      teacherId: "teacher-a",
      title: "Geometri",
    });

    await request(server)
      .patch(`/schedule-lessons/${lessonId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "Analitik Geometri" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe("Analitik Geometri");
      });

    await request(server)
      .delete(`/schedule-lessons/${lessonId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .get(`/schedule-lessons/${lessonId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(404);
  });

  it("öğretmen saat çakışmasını tenant içinde 409 ile engeller", async () => {
    await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        title: "Çakışan Ders",
        startsAt: "2026-06-01T09:30:00.000Z",
        endsAt: "2026-06-01T10:30:00.000Z",
      })
      .expect(409);
  });

  it("ders programı gövdelerini Zod ile doğrular", async () => {
    const invalidCreate = await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: " ",
        endsAt: 123,
        startsAt: " ",
        teacherId: 123,
        title: " ",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "classId" }),
          expect.objectContaining({ path: "endsAt" }),
          expect.objectContaining({ path: "startsAt" }),
          expect.objectContaining({ path: "teacherId" }),
          expect.objectContaining({ path: "title" }),
        ]),
      },
    });

    const invalidCalendarDate = await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        title: "Takvim Hatalı Ders",
        startsAt: "2026-02-29T09:00",
        endsAt: "2026-03-01T10:00",
      })
      .expect(422);

    expect(invalidCalendarDate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "SCHEDULE_LESSON_TIME_INVALID",
            path: "startsAt",
          }),
        ],
      },
    });

    const invalidRange = await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        title: "Ters Saatli Ders",
        startsAt: "2026-06-01T10:00:00.000Z",
        endsAt: "2026-06-01T09:00:00.000Z",
      })
      .expect(422);

    expect(invalidRange.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "SCHEDULE_LESSON_TIME_RANGE_INVALID",
            path: "endsAt",
          }),
        ],
      },
    });

    const emptyUpdate = await request(server)
      .patch("/schedule-lessons/lesson-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({})
      .expect(422);

    expect(emptyUpdate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "UPDATE_BODY_EMPTY",
            path: "$",
          }),
        ],
      },
    });

    const invalidUpdateRange = await request(server)
      .patch("/schedule-lessons/lesson-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        startsAt: "2026-06-01T11:00:00.000Z",
        endsAt: "2026-06-01T10:00:00.000Z",
      })
      .expect(422);

    expect(invalidUpdateRange.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "SCHEDULE_LESSON_TIME_RANGE_INVALID",
            path: "endsAt",
          }),
        ],
      },
    });

    const invalidUpdate = await request(server)
      .patch("/schedule-lessons/lesson-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        startsAt: 123,
        title: " ",
      })
      .expect(422);

    expect(invalidUpdate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "startsAt" }),
          expect.objectContaining({ path: "title" }),
        ]),
      },
    });
  });

  it("tenant A başka tenant class/teacher ile ders programı oluşturamaz", async () => {
    await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-b",
        teacherId: "teacher-a",
        title: "Gizli Ders",
        startsAt: "2026-06-01T11:00:00.000Z",
        endsAt: "2026-06-01T12:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-b",
        title: "Gizli Ogretmen",
        startsAt: "2026-06-01T11:00:00.000Z",
        endsAt: "2026-06-01T12:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-turkish",
        title: "Gizli Ders",
        startsAt: "2026-06-01T11:00:00.000Z",
        endsAt: "2026-06-01T12:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        termId: "term-2026-spring-b",
        title: "Gizli Donem",
        startsAt: "2026-06-01T11:00:00.000Z",
        endsAt: "2026-06-01T12:00:00.000Z",
      })
      .expect(403);
  });

  it("teacher ders programını okuyabilir ama yazamaz", async () => {
    await request(server).get("/schedule-lessons").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(200);
    await request(server).get("/schedule-lessons/lesson-a").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(200);
    await request(server).get("/schedule-lessons/lesson-b").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(403);

    await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        title: "Teacher Dersi",
        startsAt: "2026-06-01T11:00:00.000Z",
        endsAt: "2026-06-01T12:00:00.000Z",
      })
      .expect(403);

    await request(server)
      .patch("/schedule-lessons/lesson-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ title: "Teacher Güncelleme" })
      .expect(403);

    await request(server)
      .delete("/schedule-lessons/lesson-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);
  });
});
