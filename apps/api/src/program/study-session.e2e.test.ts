import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
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
      .send(testLoginBody("admin-a@example.test"))
      .expect(200);
    tenantAAccessToken = (login.body as { accessToken: string }).accessToken;

    const teacherLogin = await request(server)
      .post("/auth/login")
      .send(testLoginBody("teacher-a@example.test"))
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

  it("geçersiz etüt kapasitesini Zod ile reddeder", async () => {
    const response = await request(server)
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
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "capacity" })],
      },
    });
  });

  it("etüt gövdelerini Zod ile doğrular", async () => {
    const invalidCreate = await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        capacity: 1.5,
        classId: " ",
        endsAt: 123,
        startsAt: " ",
        studentIds: [],
        teacherId: 123,
        title: " ",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "capacity" }),
          expect.objectContaining({ path: "classId" }),
          expect.objectContaining({ path: "endsAt" }),
          expect.objectContaining({ path: "startsAt" }),
          expect.objectContaining({ path: "studentIds" }),
          expect.objectContaining({ path: "teacherId" }),
          expect.objectContaining({ path: "title" }),
        ]),
      },
    });

    const invalidCalendarDate = await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        capacity: 1,
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "Takvim Hatalı Etüt",
        startsAt: "2026-02-29T15:00",
        endsAt: "2026-03-01T16:00",
      })
      .expect(422);

    expect(invalidCalendarDate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "STUDY_SESSION_TIME_INVALID",
            path: "startsAt",
          }),
        ],
      },
    });

    const invalidRange = await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        capacity: 1,
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "Ters Saatli Etüt",
        startsAt: "2026-06-01T16:00:00.000Z",
        endsAt: "2026-06-01T15:00:00.000Z",
      })
      .expect(422);

    expect(invalidRange.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "STUDY_SESSION_TIME_RANGE_INVALID",
            path: "endsAt",
          }),
        ],
      },
    });

    const emptyUpdate = await request(server)
      .patch("/study-sessions/study-a")
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
      .patch("/study-sessions/study-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        startsAt: "2026-06-01T17:00:00.000Z",
        endsAt: "2026-06-01T16:00:00.000Z",
      })
      .expect(422);

    expect(invalidUpdateRange.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "STUDY_SESSION_TIME_RANGE_INVALID",
            path: "endsAt",
          }),
        ],
      },
    });

    const invalidUpdate = await request(server)
      .patch("/study-sessions/study-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        capacity: 0,
        startsAt: 123,
        studentIds: [],
        title: " ",
      })
      .expect(422);

    expect(invalidUpdate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "capacity" }),
          expect.objectContaining({ path: "startsAt" }),
          expect.objectContaining({ path: "studentIds" }),
          expect.objectContaining({ path: "title" }),
        ]),
      },
    });
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

  it("zorunlu etüt bağlantıları olmadan etüt oluşturmayı Zod ile reddeder", async () => {
    const response = await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        title: "Eksik Etüt",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "studentIds" }),
          expect.objectContaining({ path: "teacherId" }),
        ]),
      },
    });
  });

  it("geçersiz saat aralığını reddeder", async () => {
    const response = await request(server)
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
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "STUDY_SESSION_TIME_RANGE_INVALID",
            path: "endsAt",
          }),
        ],
      },
    });
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
