import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("TeacherNote API", () => {
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

  it("tenant içi öğretmen notlarını INTERNAL dahil listeler", async () => {
    await request(server)
      .get("/teacher-notes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "teacher-note-internal-a",
            tenantId: "tenant-a",
            studentId: "student-a",
            teacherId: "teacher-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            visibility: "INTERNAL",
            body: "Dikkat takibi iç notu",
            developmentStatus: "FOLLOW_UP",
            createdAt: "2026-06-04T09:00:00.000Z",
          },
          {
            id: "teacher-note-visible-a",
            tenantId: "tenant-a",
            studentId: "student-a",
            teacherId: "teacher-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            visibility: "GUARDIAN_STUDENT",
            body: "Problem çözme rutini güçleniyor.",
            developmentStatus: "IMPROVING",
            createdAt: "2026-06-04T10:00:00.000Z",
          },
        ]);
      });

    await request(server)
      .get("/teacher-notes")
      .query({ classId: "class-a" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: "teacher-note-internal-a", studentId: "student-a" }),
          expect.objectContaining({ id: "teacher-note-visible-a", studentId: "student-a" }),
        ]));
      });

    await request(server)
      .get("/teacher-notes")
      .query({ classId: "class-b" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([]);
      });
  });

  it("öğretmen not oluşturur, günceller ve siler", async () => {
    const created = await request(server)
      .post("/teacher-notes")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        studentId: "student-a",
        visibility: "INTERNAL",
        body: "Ders içi katılım takip edilecek.",
        developmentStatus: "FOLLOW_UP",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      studentId: "student-a",
      teacherId: "teacher-a",
      visibility: "INTERNAL",
      body: "Ders içi katılım takip edilecek.",
      developmentStatus: "FOLLOW_UP",
    });

    await request(server)
      .patch(`/teacher-notes/${created.body.id}`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        visibility: "GUARDIAN_STUDENT",
        body: "Ders içi katılım artıyor.",
        developmentStatus: "IMPROVING",
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: created.body.id,
          visibility: "GUARDIAN_STUDENT",
          body: "Ders içi katılım artıyor.",
          developmentStatus: "IMPROVING",
        });
      });

    await request(server)
      .delete(`/teacher-notes/${created.body.id}`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(204);
  });

  it("öğretmen notu gövdelerini Zod ile doğrular", async () => {
    const invalidCreate = await request(server)
      .post("/teacher-notes")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        visibility: "PUBLIC",
        body: " ",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "studentId" }),
          expect.objectContaining({ path: "visibility" }),
          expect.objectContaining({ path: "body" }),
        ]),
      },
    });

    const invalidUpdate = await request(server)
      .patch("/teacher-notes/teacher-note-visible-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        visibility: "PUBLIC",
        body: " ",
      })
      .expect(422);

    expect(invalidUpdate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "visibility" }),
          expect.objectContaining({ path: "body" }),
        ]),
      },
    });
  });

  it("başka tenant öğrenci veya öğretmen referansını reddeder", async () => {
    await request(server)
      .post("/teacher-notes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-b",
        teacherId: "teacher-a",
        visibility: "INTERNAL",
        body: "Yanlış tenant öğrenci",
      })
      .expect(403);

    await request(server)
      .post("/teacher-notes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-a",
        teacherId: "teacher-b",
        visibility: "INTERNAL",
        body: "Yanlış tenant öğretmen",
      })
      .expect(403);

    const unscoped = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Kapsam", lastName: "Disi" })
      .expect(201);

    await request(server)
      .post("/teacher-notes")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        studentId: unscoped.body.id,
        visibility: "INTERNAL",
        body: "Kapsam dışı öğrenci",
      })
      .expect(403);

    await request(server)
      .get("/teacher-notes")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).not.toContain(unscoped.body.id);
      });
  });

  it("öğrenci ve veli genel not endpointine erişemez", async () => {
    await request(server).get("/teacher-notes").set("Authorization", `Bearer ${studentAAccessToken}`).expect(403);
    await request(server).get("/teacher-notes").set("Authorization", `Bearer ${guardianAAccessToken}`).expect(403);
  });
});
