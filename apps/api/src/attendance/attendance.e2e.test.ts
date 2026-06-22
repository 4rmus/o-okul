import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Attendance API", () => {
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

    tenantAAccessToken = await login("admin-a@example.test");
    teacherAAccessToken = await login("teacher-a@example.test");
    studentAAccessToken = await login("student-a@example.test");
    guardianAAccessToken = await login("guardian-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("tenant içi devamsızlık kayıtlarını listeler ve özetler", async () => {
    await request(server)
      .get("/attendance")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "attendance-a",
            tenantId: "tenant-a",
            studentId: "student-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            date: "2026-06-03",
            status: "ABSENT",
          },
        ]);
      });

    await request(server)
      .get("/attendance")
      .query({ classId: "class-a" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "attendance-a", studentId: "student-a" })]);
      });

    await request(server)
      .get("/attendance")
      .query({ classId: "class-b" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([]);
      });

    await request(server)
      .get("/attendance/summary")
      .query({ studentId: "student-a" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          studentId: "student-a",
          total: 1,
          present: 0,
          absent: 1,
          late: 0,
          excused: 0,
        });
      });
  });

  it("öğretmen tenant içi devamsızlık kaydı oluşturur, günceller ve siler", async () => {
    const created = await request(server)
      .post("/attendance")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ studentId: "student-a", date: "2026-06-04", status: "LATE" })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      studentId: "student-a",
      date: "2026-06-04",
      status: "LATE",
    });

    await request(server)
      .patch(`/attendance/${created.body.id}`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ status: "EXCUSED" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: created.body.id, status: "EXCUSED" });
      });

    await request(server)
      .delete(`/attendance/${created.body.id}`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(204);
  });

  it("devamsızlık gövdelerini Zod ile doğrular", async () => {
    const invalidCreate = await request(server)
      .post("/attendance")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        studentId: " ",
        date: "06-04-2026",
        status: "UNKNOWN",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "studentId" }),
          expect.objectContaining({ path: "date" }),
          expect.objectContaining({ path: "status" }),
        ]),
      },
    });

    const invalidCalendarDate = await request(server)
      .post("/attendance")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ studentId: "student-a", date: "2026-02-29", status: "PRESENT" })
      .expect(422);

    expect(invalidCalendarDate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "ATTENDANCE_DATE_INVALID",
            path: "date",
          }),
        ],
      },
    });

    const invalidUpdate = await request(server)
      .patch("/attendance/attendance-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ status: "UNKNOWN" })
      .expect(422);

    expect(invalidUpdate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "status" })],
      },
    });

  });

  it("başka tenant öğrencisine devamsızlık yazmayı ve mükerrer tarihi reddeder", async () => {
    await request(server)
      .post("/attendance")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-b", date: "2026-06-05", status: "ABSENT" })
      .expect(403);

    const unscoped = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Kapsam", lastName: "Disi" })
      .expect(201);

    await request(server)
      .post("/attendance")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ studentId: unscoped.body.id, date: "2026-06-05", status: "ABSENT" })
      .expect(403);

    await request(server)
      .get("/attendance/summary")
      .query({ studentId: unscoped.body.id })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);

    await request(server)
      .post("/attendance")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-a", date: "2026-06-03", status: "PRESENT" })
      .expect(409);
  });

  it("öğrenci ve veli genel yazma endpointine erişemez", async () => {
    await request(server)
      .post("/attendance")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({ studentId: "student-a", date: "2026-06-06", status: "ABSENT" })
      .expect(403);

    await request(server)
      .post("/attendance")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .send({ studentId: "student-a", date: "2026-06-06", status: "ABSENT" })
      .expect(403);
  });
});
