import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("TeacherNote API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;
  let assistantAccessToken: string;
  let financeAccessToken: string;
  let systemAccessToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({
      id: "user-finance-teacher-note",
      email: "finance-teacher-note@example.test",
      name: "Finance Teacher Note",
      password: "password",
      tenantId: "tenant-a",
      roles: ["FINANCE_STAFF"],
      membership: {
        id: "membership-finance-teacher-note",
        staffRole: "FINANCE_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    registerTestLoginIdentity("finance-teacher-note@example.test", { tenantSlug: "dna-egitim" });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];

    tenantAAccessToken = await login("admin-a@example.test");
    teacherAAccessToken = await login("teacher-a@example.test");
    studentAAccessToken = await login("student-a@example.test");
    guardianAAccessToken = await login("guardian-a@example.test");
    assistantAccessToken = await login("assistant-a@example.test");
    financeAccessToken = await login("finance-teacher-note@example.test");
    systemAccessToken = await login("system@example.test");
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
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

    const emptyUpdate = await request(server)
      .patch("/teacher-notes/teacher-note-visible-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
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
      .send({ firstName: "Kapsam", lastName: "Disi", gradeLevelId: "grade-8" })
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

  // Legacy-role cutover: the capability guard must admit exactly the roles the old @Roles("TEACHER") rank check admitted.
  it("yetki matrisi: personel note:* ve öğretmen persona kabul edilir; finans, öğrenci, veli ve sistem yöneticisi 403", async () => {
    await request(server).get("/teacher-notes").set("Authorization", `Bearer ${assistantAccessToken}`).expect(200);
    await request(server).get("/teacher-notes").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(200);
    for (const token of [financeAccessToken, studentAAccessToken, guardianAAccessToken, systemAccessToken]) {
      await request(server).get("/teacher-notes").set("Authorization", `Bearer ${token}`).expect(403);
      await request(server).post("/teacher-notes").set("Authorization", `Bearer ${token}`)
        .send({ studentId: "student-a", body: "Yetkisiz not" }).expect(403);
      await request(server).patch("/teacher-notes/teacher-note-visible-a").set("Authorization", `Bearer ${token}`)
        .send({ body: "Yetkisiz düzenleme" }).expect(403);
      await request(server).delete("/teacher-notes/teacher-note-visible-a").set("Authorization", `Bearer ${token}`).expect(403);
    }
  });

  it("öğretmen notu oluşturmayı Idempotency-Key ile tekilleştirir", async () => {
    const body = { studentId: "student-a", visibility: "INTERNAL", body: "Tekil not.", developmentStatus: "FOLLOW_UP" };
    const send = (payload: object) => request(server)
      .post("/teacher-notes")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .set("Idempotency-Key", "teacher-note-create-idempotency-a")
      .send(payload);
    const first = await send(body).expect(201);
    const second = await send(body).expect(201);
    expect(second.body).toEqual(first.body);
    await send({ ...body, body: "Başka not." })
      .expect(409)
      .expect(({ body: error }) => expect(error.error.code).toBe("IDEMPOTENCY_KEY_BODY_MISMATCH"));
  });
});
