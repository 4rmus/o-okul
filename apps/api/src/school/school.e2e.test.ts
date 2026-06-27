import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { TeacherImportService } from "./teacher-import.service.js";

describe("School management API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let teacherImports: TeacherImportService;
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;
  const originalStudentQuota = process.env.STUDENT_QUOTA;

  beforeAll(async () => {
    process.env.STUDENT_QUOTA = "2";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    teacherImports = app.get(TeacherImportService);

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
    if (originalStudentQuota === undefined) {
      delete process.env.STUDENT_QUOTA;
    } else {
      process.env.STUDENT_QUOTA = originalStudentQuota;
    }
  });

  it("tenant A sadece kendi class kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "class-a",
        tenantId: "tenant-a",
        name: "8-A",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        section: "A",
      },
    ]);
  });

  it("tenant A sadece kendi kampüs kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/campuses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([{ id: "campus-main", tenantId: "tenant-a", name: "Merkez Kampus", code: "MRK" }]);
  });

  it("tenant A sadece kendi seviye kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/grade-levels")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([{ id: "grade-8", tenantId: "tenant-a", name: "8. Sınıf", code: "8" }]);
  });

  it("tenant A sadece kendi alan kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/alanlar")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([{ id: "alan-11-sayisal", tenantId: "tenant-a", gradeLevelId: "grade-11", name: "Sayısal", code: "11-SAY" }]);
  });

  it("seviye ders şablonlarını tenant içinde listeler", async () => {
    await request(server)
      .get("/grade-levels/grade-8/courses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: "grade-course-8-math",
            tenantId: "tenant-a",
            gradeLevelId: "grade-8",
            courseId: "course-math",
            courseName: "Matematik",
            courseCode: "MAT",
            isDefault: true,
            sortOrder: 10,
          }),
        ]);
      });

    await request(server)
      .get("/grade-levels/grade-7/courses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);
  });

  it("tenant A sadece kendi ders kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/courses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([{ id: "course-math", tenantId: "tenant-a", name: "Matematik", code: "MAT" }]);
  });

  it("tenant A sadece kendi kazanım kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/learning-outcomes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "learning-outcome-demo-math",
        tenantId: "tenant-a",
        code: "MAT.8.1.1",
        branch: "Matematik",
        title: "Çarpanlar ve katlar",
        level: "8",
      },
    ]);
  });

  it("tenant A sadece kendi akademik yıl ve dönem kayıtlarını listeler", async () => {
    await request(server)
      .get("/academic-years")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "academic-year-2026",
            tenantId: "tenant-a",
            name: "2025-2026",
            startsAt: "2025-09-01",
            endsAt: "2026-06-30",
            isActive: true,
          },
        ]);
      });

    await request(server)
      .get("/academic-terms")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "term-2026-spring",
            tenantId: "tenant-a",
            academicYearId: "academic-year-2026",
            name: "2. Donem",
            startsAt: "2026-02-01",
            endsAt: "2026-06-30",
            isActive: true,
          },
        ]);
      });
  });

  it("öğrenci ve veli rapor bağlamı için ders ve dönem adlarını okuyabilir", async () => {
    for (const token of [studentAAccessToken, guardianAAccessToken]) {
      await request(server)
        .get("/courses")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual([{ id: "course-math", tenantId: "tenant-a", name: "Matematik", code: "MAT" }]);
        });

      await request(server)
        .get("/academic-terms")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual([
            {
              id: "term-2026-spring",
              tenantId: "tenant-a",
              academicYearId: "academic-year-2026",
              name: "2. Donem",
              startsAt: "2026-02-01",
              endsAt: "2026-06-30",
              isActive: true,
            },
          ]);
      });
    }
  });

  it("okul yönetimi gövdelerini Zod ile doğrular", async () => {
    expectValidationFields(
      await request(server)
        .post("/classes")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ name: " ", campusId: 123 })
        .expect(422),
      ["campusId", "name"],
    );

    expectValidationFields(
      await request(server)
        .post("/campuses")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ code: "KPS" })
        .expect(422),
      ["name"],
    );

    expectValidationFields(
      await request(server)
        .post("/learning-outcomes")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ code: " ", branch: 123, title: " " })
        .expect(422),
      ["branch", "code", "title"],
    );

    expectValidationFields(
      await request(server)
        .post("/academic-years")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ name: "2027", startsAt: "2027/09/01", endsAt: "2028-06-30", isActive: "yes" })
        .expect(422),
      ["isActive", "startsAt"],
    );

    expectValidationFields(
      await request(server)
        .post("/academic-years")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ name: "2027", startsAt: "2027-02-29", endsAt: "2028-06-30" })
        .expect(422),
      ["startsAt"],
    );

    expectValidationFields(
      await request(server)
        .post("/teachers")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ firstName: "Ada" })
        .expect(422),
      ["lastName"],
    );

    expectValidationFields(
      await request(server)
        .post("/teachers/teacher-a/assignments")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ role: "CLASS_TEACHER" })
        .expect(422),
      ["classId"],
    );

    expectValidationFields(
      await request(server)
        .post("/teachers/teacher-a/assignments")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ classId: "class-a", role: "OWNER" })
        .expect(422),
      ["role"],
    );

    expectValidationFields(
      await request(server)
        .post("/teachers/teacher-a/assignments")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ classId: "class-a", role: "CLASS_TEACHER", startsAt: "2026-02-29" })
        .expect(422),
      ["startsAt"],
    );

    expectValidationFields(
      await request(server)
        .post("/guardians")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ firstName: " ", lastName: "Veli" })
        .expect(422),
      ["firstName"],
    );

    expectValidationFields(
      await request(server)
        .post("/guardians/guardian-a/students")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({ canReceiveSms: "yes" })
        .expect(422),
      ["canReceiveSms", "studentId"],
    );
  });

  it("sınıf, öğretmen, veli ve öğrenci listelerinde page/limit/q/sort uygular", async () => {
    const classCreated = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "7-C" })
      .expect(201);
    const teacherCreated = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Ziya", lastName: "Ogretmen", branch: "Fen" })
      .expect(201);
    expect(teacherCreated.body).not.toHaveProperty("userId");
    const guardianCreated = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Yasemin", lastName: "Veli", phone: "5000000030" })
      .expect(201);
    const studentCreated = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Cem", lastName: "Liste" })
      .expect(201);

    await request(server)
      .get("/classes")
      .query({ q: "7", sort: "-name", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: classCreated.body.id, name: "7-C" })]);
      });
    await request(server)
      .get("/teachers")
      .query({ q: "fen", sort: "firstName", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: teacherCreated.body.id, firstName: "Ziya" })]);
        expect(body[0]).not.toHaveProperty("userId");
      });
    await request(server)
      .get("/guardians")
      .query({ q: "yasemin", sort: "lastName", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: guardianCreated.body.id, firstName: "Yasemin" })]);
      });
    await request(server)
      .get("/students")
      .query({ q: "cem", sort: "-lastName", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: studentCreated.body.id, firstName: "Cem" })]);
      });

    await request(server)
      .get("/students")
      .query({ sort: "unknown" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);

    await request(server)
      .delete(`/students/${studentCreated.body.id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/guardians/${guardianCreated.body.id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/teachers/${teacherCreated.body.id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/classes/${classCreated.body.id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
  });

  it("class CRUD akışını tenant içinde tamamlar", async () => {
    const alan = await request(server)
      .post("/alanlar")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "8. Sınıf Alanı", gradeLevelId: "grade-8", code: "8-ALAN" })
      .expect(201);
    const alanId = (alan.body as { id: string }).id;
    const otherGradeLevel = await request(server)
      .post("/grade-levels")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9. Sınıf", code: "9-TEST" })
      .expect(201);
    const otherGradeLevelId = (otherGradeLevel.body as { id: string }).id;

    const created = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9-A", alanId, campusId: "campus-main", gradeLevelId: "grade-8", section: "A" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.alanId).toBe(alanId);
        expect(body.campusId).toBe("campus-main");
        expect(body.gradeLevelId).toBe("grade-8");
        expect(body.section).toBe("A");
      });

    const classId = (created.body as { id: string }).id;

    await request(server)
      .patch(`/classes/${classId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9 Fen" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe("9 Fen");
        expect(body.alanId).toBe(alanId);
        expect(body.campusId).toBe("campus-main");
        expect(body.gradeLevelId).toBe("grade-8");
      });

    await request(server)
      .patch(`/classes/${classId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ gradeLevelId: otherGradeLevelId })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "ALAN_GRADE_LEVEL_MISMATCH" });
      });

    await request(server)
      .patch(`/classes/${classId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({})
      .expect(422)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
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

    await request(server).delete(`/classes/${classId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/classes/${classId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
    await request(server).delete(`/alanlar/${alanId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).delete(`/grade-levels/${otherGradeLevelId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
  });

  it("kampüs CRUD akışını tenant içinde tamamlar", async () => {
    const created = await request(server)
      .post("/campuses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Batı Kampus", code: "BTI" })
      .expect(201);

    const campusId = (created.body as { id: string }).id;

    await request(server)
      .patch(`/campuses/${campusId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Batı Şube" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe("Batı Şube");
        expect(body.code).toBe("BTI");
      });

    await request(server)
      .get("/campuses")
      .query({ q: "batı", sort: "name", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: campusId, name: "Batı Şube" })]);
      });

    await request(server).delete(`/campuses/${campusId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/campuses/${campusId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
  });

  it("seviye CRUD akışını tenant içinde tamamlar", async () => {
    const created = await request(server)
      .post("/grade-levels")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9. Sınıf", code: "9" })
      .expect(201);

    const gradeLevelId = (created.body as { id: string }).id;

    await request(server)
      .patch(`/grade-levels/${gradeLevelId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Hazırlık" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe("Hazırlık");
        expect(body.code).toBe("9");
      });

    await request(server)
      .get("/grade-levels")
      .query({ q: "hazırlık", sort: "name", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: gradeLevelId, name: "Hazırlık" })]);
      });

    await request(server).delete(`/grade-levels/${gradeLevelId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/grade-levels/${gradeLevelId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
  });

  it("ders CRUD akışını tenant içinde tamamlar", async () => {
    const created = await request(server)
      .post("/courses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Fen Bilimleri", code: "FEN" })
      .expect(201);

    const courseId = (created.body as { id: string }).id;

    await request(server)
      .patch(`/courses/${courseId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Fen" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe("Fen");
        expect(body.code).toBe("FEN");
      });

    await request(server).delete(`/courses/${courseId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/courses/${courseId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
  });

  it("kazanım CRUD akışını tenant içinde tamamlar", async () => {
    const created = await request(server)
      .post("/learning-outcomes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ code: "TUR.8.1.1", branch: "Türkçe", title: "Sözcükte anlam", level: "8" })
      .expect(201);

    const outcomeId = (created.body as { id: string }).id;

    await request(server)
      .patch(`/learning-outcomes/${outcomeId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "Cümlede anlam" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe("Cümlede anlam");
        expect(body.code).toBe("TUR.8.1.1");
      });

    await request(server)
      .get("/learning-outcomes")
      .query({ q: "cümlede", sort: "code", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: outcomeId, title: "Cümlede anlam" })]);
      });

    await request(server).delete(`/learning-outcomes/${outcomeId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/learning-outcomes/${outcomeId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
  });

  it("akademik yıl ve dönem CRUD akışını tenant içinde tamamlar", async () => {
    const yearCreated = await request(server)
      .post("/academic-years")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-06-30", isActive: false })
      .expect(201);
    const yearId = (yearCreated.body as { id: string }).id;

    await request(server)
      .patch(`/academic-years/${yearId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "2026-27", isActive: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe("2026-27");
        expect(body.isActive).toBe(true);
      });

    const termCreated = await request(server)
      .post("/academic-terms")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ academicYearId: yearId, name: "1. Donem", startsAt: "2026-09-01", endsAt: "2027-01-31", isActive: true })
      .expect(201);
    const termId = (termCreated.body as { id: string }).id;

    await request(server)
      .patch(`/academic-terms/${termId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Guz Donemi" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe("Guz Donemi");
      });

    await request(server)
      .get("/academic-terms")
      .query({ q: "guz", sort: "name", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: termId, name: "Guz Donemi" })]);
      });

    await request(server).delete(`/academic-terms/${termId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/academic-terms/${termId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
    await request(server).delete(`/academic-years/${yearId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/academic-years/${yearId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
  });

  it("tenant A başka tenantId ile class oluşturamaz", async () => {
    await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ tenantId: "tenant-b", name: "Gizli Sube" })
      .expect(403);
  });

  it("tenant A başka tenant kampüsü ile class oluşturamaz", async () => {
    await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Gizli Kampus Sinifi", campusId: "campus-b" })
      .expect(403);
  });

  it("tenant A başka tenant seviyesi ile class oluşturamaz", async () => {
    await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Gizli Seviye Sinifi", gradeLevelId: "grade-7" })
      .expect(403);
  });

  it("tenant A başka tenantId ile ders oluşturamaz", async () => {
    await request(server)
      .post("/courses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ tenantId: "tenant-b", name: "Gizli Ders" })
      .expect(403);
  });

  it("tenant A başka tenant akademik yılına dönem oluşturamaz", async () => {
    await request(server)
      .post("/academic-terms")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ academicYearId: "academic-year-2026-b", name: "Gizli Donem", startsAt: "2026-02-01", endsAt: "2026-06-30" })
      .expect(403);
  });

  it("teacher PII purge ad soyadı anonimleştirir", async () => {
    const created = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Gizli", lastName: "Ogretmen", branch: "Matematik", nationalId: "10000000146", phone: "0 555 000 00 10" })
      .expect(201);
    const teacherId = (created.body as { id: string }).id;
    expect(created.body).not.toHaveProperty("userId");
    expect(created.body).not.toHaveProperty("nationalIdEncrypted");
    expect(created.body).not.toHaveProperty("nationalIdHash");
    expect(created.body.phone).toBe("5550000010");

    await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Ayni", lastName: "Tc", nationalId: "10000000146", phone: "5550000011" })
      .expect(409);

    await request(server)
      .post(`/teachers/${teacherId}/purge-pii`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogretmen");
        expect(body.branch).toBe("Matematik");
        expect(body.phone).toBeUndefined();
        expect(body).not.toHaveProperty("nationalIdEncrypted");
        expect(body).not.toHaveProperty("nationalIdHash");
        expect(body).not.toHaveProperty("userId");
      });

    await request(server)
      .get(`/teachers/${teacherId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogretmen");
        expect(body.phone).toBeUndefined();
        expect(body).not.toHaveProperty("nationalIdEncrypted");
        expect(body).not.toHaveProperty("nationalIdHash");
        expect(body).not.toHaveProperty("userId");
      });

    await request(server).delete(`/teachers/${teacherId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
  });

  it("tenant A tenant B teacher kaydına erişemez", async () => {
    await request(server)
      .get("/teachers/teacher-b")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);
  });

  it("guardian CRUD için bağımsız kayıtları yönetir", async () => {
    const created = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Can", lastName: "Veli", nationalId: "10000000146", phone: "+90 500 000 00 10" })
      .expect(201);
    expect(created.body.phone).toBe("5000000010");
    expect(created.body).not.toHaveProperty("nationalIdEncrypted");
    expect(created.body).not.toHaveProperty("nationalIdHash");

    const guardianId = (created.body as { id: string }).id;

    await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Ayni", lastName: "Veli", nationalId: "10000000146", phone: "5000000012" })
      .expect(409);

    await request(server)
      .patch(`/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ phone: "0 500 000 00 11" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.phone).toBe("5000000011");
        expect(body).not.toHaveProperty("nationalIdEncrypted");
        expect(body).not.toHaveProperty("nationalIdHash");
      });

    await request(server)
      .post(`/guardians/${guardianId}/purge-pii`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Veli");
        expect(body.phone).toBeUndefined();
        expect(body).not.toHaveProperty("nationalIdEncrypted");
        expect(body).not.toHaveProperty("nationalIdHash");
      });

    await request(server)
      .get(`/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Veli");
        expect(body.phone).toBeUndefined();
        expect(body).not.toHaveProperty("nationalIdEncrypted");
        expect(body).not.toHaveProperty("nationalIdHash");
      });

    await request(server)
      .delete(`/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .get(`/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(404);
  });

  it("tenant admin veli-öğrenci bağlantısını tenant içinde yönetir", async () => {
    const created = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Bag", lastName: "Veli", phone: "5000000020" })
      .expect(201);
    const guardianId = (created.body as { id: string }).id;

    await request(server)
      .get(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([]);
      });

    const linked = await request(server)
      .post(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-a",
        canOpenSupportTickets: false,
      })
      .expect(201);

    expect(linked.body).toEqual(expect.objectContaining({
      tenantId: "tenant-a",
      guardianId,
      studentId: "student-a",
      canViewFinance: true,
      canReceiveSms: false,
      canReceiveAnnouncements: true,
      canOpenSupportTickets: false,
    }));

    const updated = await request(server)
      .patch(`/guardians/${guardianId}/students/student-a`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ canViewFinance: false, canReceiveSms: false })
      .expect(200);
    expect(updated.body).toEqual(expect.objectContaining({
      guardianId,
      studentId: "student-a",
      canViewFinance: false,
      canReceiveSms: false,
    }));

    await request(server)
      .post(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-b" })
      .expect(403);

    await request(server)
      .get(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ guardianId, studentId: "student-a", canViewFinance: false })]);
      });
    await request(server)
      .get(`/guardians/${guardianId}/student-details`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.links).toEqual([expect.objectContaining({ guardianId, studentId: "student-a", canViewFinance: false })]);
        expect(body.linkedStudents).toEqual([
          {
            classId: "class-a",
            className: "8-A",
            firstName: "Ada",
            hasPortalUser: true,
            id: "student-a",
            lastName: "A",
            status: "ACTIVE",
            studentNo: "100",
          },
        ]);
        expect(body.availableStudents).toEqual(expect.not.arrayContaining([expect.objectContaining({ id: "student-a" })]));
        expect(JSON.stringify(body)).not.toContain("student-b");
        expect(JSON.stringify(body)).not.toContain("class-b");
        expect(JSON.stringify(body)).not.toContain("responsibleTeacherId");
        expect(JSON.stringify(body)).not.toContain("userId");
      });
    await request(server)
      .get(`/guardians/${guardianId}/student-details`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);
    await request(server)
      .get(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ guardianId, studentId: "student-a" })]);
        expect(JSON.stringify(body)).not.toContain("student-b");
      });
    await request(server)
      .get("/guardians")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: guardianId })]));
        expect(body).toEqual(expect.not.arrayContaining([expect.objectContaining({ id: "guardian-b" })]));
      });
    await request(server)
      .get("/students/student-a/guardian-links")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ guardianId, studentId: "student-a", canReceiveSms: false })]));
      });

    await request(server)
      .delete(`/guardians/${guardianId}/students/student-a`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .get(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([]);
      });
    await request(server).delete(`/guardians/${guardianId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
  });

  it("öğrenciye bağlı velileri listeler", async () => {
    await request(server)
      .get("/students/student-a/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: "guardian-a", tenantId: "tenant-a" })]),
        );
      });
  });

  it("öğretmen ilişki tiplerini yönetir ve sınıf ataması öğrenci kapsamına yansır", async () => {
    const studentCreated = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Atama", lastName: "Ogrenci", classId: "class-a" })
      .expect(201);
    const studentId = (studentCreated.body as { id: string }).id;

    const assignmentCreated = await request(server)
      .post("/teachers/teacher-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: "class-a", courseId: "course-math", role: "CLASS_TEACHER" })
      .expect(201);
    const assignmentId = (assignmentCreated.body as { id: string }).id;
    expect(assignmentCreated.body).toEqual(expect.objectContaining({
      tenantId: "tenant-a",
      teacherId: "teacher-a",
      classId: "class-a",
      courseId: "course-math",
      role: "CLASS_TEACHER",
    }));

    await request(server)
      .post("/teachers/teacher-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: "class-a", courseId: "course-turkish", role: "BRANCH_TEACHER" })
      .expect(403);

    const extraCourse = await request(server)
      .post("/courses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Sablon Disi", code: "DIS" })
      .expect(201);
    const extraCourseId = (extraCourse.body as { id: string }).id;

    await request(server)
      .post("/teachers/teacher-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: "class-a", courseId: extraCourseId, role: "BRANCH_TEACHER" })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH" });
      });

    await request(server)
      .patch(`/teachers/teacher-a/assignments/${assignmentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ role: "GUIDANCE_COUNSELOR" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.role).toBe("GUIDANCE_COUNSELOR");
      });

    await request(server)
      .patch(`/teachers/teacher-a/assignments/${assignmentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({})
      .expect(422)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
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

    await request(server)
      .get(`/students/${studentId}/teacher-assignments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ teacherId: "teacher-a", classId: "class-a" })]));
      });

    await request(server)
      .get("/students")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: studentId })]));
      });

    await request(server)
      .get(`/students/${studentId}`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe(studentId);
      });

    await request(server)
      .delete(`/teachers/teacher-a/assignments/${assignmentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/courses/${extraCourseId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/students/${studentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
  });

  it("öğretmen import dry-run sınıf ve ders eşleşmesini doğrular", async () => {
    await request(server)
      .post("/teachers/imports/dry-run")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileBase64: createCsvBase64("ad;soyad;brans;tc;telefon;atanacak_sinif;ders\nMerve;Import;Matematik;10000000214;0555 000 0012;8-A;Matematik\n"),
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          dryRun: true,
          errors: [],
          totalRows: 1,
          validRows: [
            expect.objectContaining({
              branch: "Matematik",
              classId: "class-a",
              className: "8-A",
              courseId: "course-math",
              courseName: "Matematik",
              firstName: "Merve",
              lastName: "Import",
              accountPreview: {
                usernameMasked: "*******0214",
                willCreate: true,
              },
              row: 2,
            }),
          ],
          wouldImport: true,
        });
        expect(JSON.stringify(body)).not.toContain("5550000012");
      });
  });

  it("öğretmen import eski şablonda bransı ders olarak eşleştirir", async () => {
    await request(server)
      .post("/teachers/imports/dry-run")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileBase64: createCsvBase64("ad;soyad;brans;atanacak_sinif\nMerve;Import;Matematik;8-A\n"),
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          dryRun: true,
          errors: [],
          totalRows: 1,
          validRows: [
            expect.objectContaining({
              branch: "Matematik",
              classId: "class-a",
              className: "8-A",
              courseId: "course-math",
              courseName: "Matematik",
              firstName: "Merve",
              lastName: "Import",
              row: 2,
            }),
          ],
          wouldImport: true,
        });
      });
  });

  it("öğretmen import XLSX şablonunu dry-run ile doğrular", async () => {
    await request(server)
      .post("/teachers/imports/dry-run")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileBase64: await createTeacherWorkbookBase64(
          [["Xlsx", "Import", "Matematik", "8-A", "Matematik"]],
          ["ad", "soyad", "brans", "atanacak_sinif", "ders"],
          [["ogretmen-aktarim-sablonu"]],
        ),
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          dryRun: true,
          errors: [],
          totalRows: 1,
          validRows: [
            expect.objectContaining({
              branch: "Matematik",
              classId: "class-a",
              className: "8-A",
              courseId: "course-math",
              courseName: "Matematik",
              firstName: "Xlsx",
              lastName: "Import",
              row: 3,
            }),
          ],
          wouldImport: true,
        });
      });
  });

  it("öğretmen import dry-run eksik ad soyad ve bilinmeyen sınıf/ders hatası verir", async () => {
    await request(server)
      .post("/teachers/imports/dry-run")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileBase64: createCsvBase64("ad;soyad;brans;atanacak_sinif;ders\n; ;Matematik;Bilinmeyen Sınıf;Bilinmeyen Ders\n"),
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.wouldImport).toBe(false);
        expect(body.validRows).toEqual([]);
        expect(body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "REQUIRED", field: "firstName", row: 2 }),
            expect.objectContaining({ code: "REQUIRED", field: "lastName", row: 2 }),
            expect.objectContaining({ code: "CLASS_NOT_FOUND", field: "className", row: 2, value: "Bilinmeyen Sınıf" }),
            expect.objectContaining({ code: "COURSE_NOT_FOUND", field: "courseName", row: 2, value: "Bilinmeyen Ders" }),
          ]),
        );
      });
  });

  it("öğretmen import dry-run büyük dosyayı parse etmeden reddeder", async () => {
    await expect(
      teacherImports.dryRun(
        {
          bypassRls: false,
          capabilities: ["staff:manage"],
          roles: ["TENANT_ADMIN"],
          tenantAccessMode: "active",
          tenantId: "tenant-a",
          userId: "user-tenant-a",
        },
        { fileBase64: Buffer.alloc((5 * 1024 * 1024) + 1).toString("base64") },
      ),
    ).rejects.toThrow("IMPORT_FILE_TOO_LARGE");
  });

  it("öğretmen import commit hatalı dosyada kayıt oluşturmaz", async () => {
    const fileBase64 = createCsvBase64("ad;soyad;brans;atanacak_sinif;ders\nRiskli;Aktarim;Matematik;Bilinmeyen Sınıf;Bilinmeyen Ders\n");

    await request(server)
      .post("/teachers/imports")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ fileBase64 })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TEACHER_IMPORT_INVALID");
      });

    await request(server)
      .get("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toEqual(expect.arrayContaining([expect.objectContaining({ firstName: "Riskli", lastName: "Aktarim" })]));
      });
  });

  it("öğretmen import commit tek öğretmen ve sınıf/ders atamaları oluşturur", async () => {
    const fileBase64 = createCsvBase64([
      "ad;soyad;brans;tc;telefon;atanacak_sinif;ders",
      "Nehir;Import;Matematik;10000000382;5550000013;8-A;Matematik",
      "Nehir;Import;Matematik;10000000382;5550000013;8-A;",
    ].join("\n"));

    const imported = await request(server)
      .post("/teachers/imports")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ fileBase64 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.importedRows).toBe(2);
        expect(body.createdTeachers).toBe(1);
        expect(body.createdAssignments).toBe(2);
        expect(body.teachers).toHaveLength(1);
        expect(body.assignments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ classId: "class-a", courseId: "course-math", role: "BRANCH_TEACHER" }),
            expect.objectContaining({ classId: "class-a", role: "CLASS_TEACHER" }),
          ]),
        );
        expect(JSON.stringify(body)).not.toContain("10000000382");
        expect(JSON.stringify(body)).not.toContain("nationalIdHash");
        expect(JSON.stringify(body)).not.toContain("nationalIdEncrypted");
        expect(JSON.stringify(body)).not.toContain("userId");
      });

    await request(server)
      .post("/auth/login")
      .send({ tenantSlug: "dna-egitim", nationalId: "10000000382", password: "5550000013" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.session).toMatchObject({ mustChangePassword: true });
      });

    await request(server)
      .post("/teachers/imports")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ fileBase64 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.createdTeachers).toBe(0);
        expect(body.createdAssignments).toBe(0);
        expect(body.teachers).toEqual([expect.objectContaining({ id: imported.body.teachers[0].id })]);
      });

    await request(server)
      .get("/students/student-a/teacher-assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              classId: "class-a",
              courseId: "course-math",
              role: "BRANCH_TEACHER",
              teacherId: imported.body.teachers[0].id,
            }),
            expect.objectContaining({
              classId: "class-a",
              role: "CLASS_TEACHER",
              teacherId: imported.body.teachers[0].id,
            }),
          ]),
        );
      });

    for (const assignment of imported.body.assignments as Array<{ id: string }>) {
      await request(server)
        .delete(`/teachers/${imported.body.teachers[0].id}/assignments/${assignment.id}`)
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .expect(204);
    }
    await request(server)
      .delete(`/teachers/${imported.body.teachers[0].id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
  });

  it("öğretmen import commit işlemini Idempotency-Key ile tekilleştirir", async () => {
    const key = "teacher-import-idempotency-a";
    const fileBase64 = createCsvBase64([
      "ad;soyad;brans;atanacak_sinif;ders",
      "Defne;Idempotent;Matematik;8-A;Matematik",
    ].join("\n"));
    let teacherId = "";
    let assignmentIds: string[] = [];

    try {
      const first = await request(server)
        .post("/teachers/imports")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .set("Idempotency-Key", key)
        .send({ fileBase64 })
        .expect(201);
      teacherId = first.body.teachers[0].id;
      assignmentIds = (first.body.assignments as Array<{ id: string }>).map((assignment) => assignment.id);

      const second = await request(server)
        .post("/teachers/imports")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .set("Idempotency-Key", key)
        .send({ fileBase64 })
        .expect(201);

      expect(second.body).toEqual(first.body);

      await request(server)
        .post("/teachers/imports")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .set("Idempotency-Key", key)
        .send({
          fileBase64: createCsvBase64([
            "ad;soyad;brans;atanacak_sinif;ders",
            "Defne;Farkli;Matematik;8-A;Matematik",
          ].join("\n")),
        })
        .expect(409);

      await request(server)
        .get("/teachers")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect((body as Array<{ firstName: string; lastName: string }>).filter((teacher) => teacher.firstName === "Defne" && teacher.lastName === "Idempotent")).toHaveLength(1);
          expect((body as Array<{ firstName: string; lastName: string }>).filter((teacher) => teacher.firstName === "Defne" && teacher.lastName === "Farkli")).toHaveLength(0);
        });
    } finally {
      for (const assignmentId of assignmentIds) {
        await request(server)
          .delete(`/teachers/${teacherId}/assignments/${assignmentId}`)
          .set("Authorization", `Bearer ${tenantAAccessToken}`);
      }
      if (teacherId) {
        await request(server)
          .delete(`/teachers/${teacherId}`)
          .set("Authorization", `Bearer ${tenantAAccessToken}`);
      }
    }
  });

  it("öğrenciyi sınıf ve sorumlu öğretmen ile oluşturur", async () => {
    const nextClass = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "8-C", campusId: "campus-main", gradeLevelId: "grade-8", section: "C" })
      .expect(201);
    const nextClassId = (nextClass.body as { id: string }).id;
    const nextGradeLevel = await request(server)
      .post("/grade-levels")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9. Sınıf", code: "9" })
      .expect(201);
    const nextGradeLevelId = (nextGradeLevel.body as { id: string }).id;
    const promotedClass = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9-C", campusId: "campus-main", gradeLevelId: nextGradeLevelId, section: "C" })
      .expect(201);
    const promotedClassId = (promotedClass.body as { id: string }).id;

    const created = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Sinif", lastName: "Ogrenci", classId: "class-a", responsibleTeacherId: "teacher-a", status: "ACTIVE" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.classId).toBe("class-a");
        expect(body.responsibleTeacherId).toBe("teacher-a");
        expect(body.status).toBe("ACTIVE");
      });

    const studentId = (created.body as { id: string }).id;

    await request(server)
      .get(`/students/${studentId}/enrollments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            studentId,
            classId: "class-a",
            academicYearId: "academic-year-2026",
            termId: "term-2026-spring",
            status: "ACTIVE",
            reason: "CREATED",
          }),
        ]);
      });

    await request(server)
      .get("/students")
      .query({ classId: "class-a", responsibleTeacherId: "teacher-a", status: "ACTIVE", guardianLinked: "false" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: studentId })]));
        expect(JSON.stringify(body)).not.toContain("student-a");
      });

    await request(server)
      .patch(`/students/${studentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: nextClassId, responsibleTeacherId: "teacher-a", status: "PASSIVE" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.classId).toBe(nextClassId);
        expect(body.responsibleTeacherId).toBe("teacher-a");
        expect(body.status).toBe("PASSIVE");
      });

    await request(server)
      .get("/students")
      .query({ classId: nextClassId, level: "grade-8", status: "PASSIVE" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: studentId, classId: nextClassId, status: "PASSIVE" })]);
      });

    await request(server)
      .get(`/students/${studentId}/class-history`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ studentId, classId: "class-a", academicYearId: "academic-year-2026", termId: "term-2026-spring", reason: "CREATED", endsAt: expect.any(String) }),
          expect.objectContaining({ studentId, classId: nextClassId, academicYearId: "academic-year-2026", termId: "term-2026-spring", reason: "CLASS_CHANGED" }),
        ]);
        expect(body[1].endsAt).toBeUndefined();
      });

    await request(server)
      .patch(`/students/${studentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ status: "GRADUATED" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe("GRADUATED");
      });

    await request(server)
      .get("/students")
      .query({ status: "GRADUATED" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: studentId, status: "GRADUATED" })]);
      });

    await request(server)
      .get(`/students/${studentId}/class-history`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body[1]).toEqual(expect.objectContaining({ studentId, classId: nextClassId, reason: "CLASS_CHANGED", endsAt: expect.any(String) }));
      });

    await request(server)
      .get(`/students/${studentId}/enrollments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ studentId, classId: "class-a", reason: "CREATED", endsAt: expect.any(String) }),
          expect.objectContaining({ studentId, classId: nextClassId, reason: "CLASS_CHANGED", status: "GRADUATED", endsAt: expect.any(String) }),
        ]);
      });

    const renewRequest = {
      academicYearId: "academic-year-2026",
      termId: "term-2026-spring",
      classId: nextClassId,
      startsAt: "2026-06-05",
    };
    await request(server)
      .post(`/students/${studentId}/enrollments/renew`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ ...renewRequest, classId: "class-b" })
      .expect(403);

    await request(server)
      .post(`/students/${studentId}/enrollments/renew`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ ...renewRequest, startsAt: "2026-02-29" })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: "VALIDATION_FAILED",
          details: {
            fields: [
              expect.objectContaining({
                message: "STUDENT_ENROLLMENT_STARTS_AT_INVALID",
                path: "startsAt",
              }),
            ],
          },
        });
      });

    const renewed = await request(server)
      .post(`/students/${studentId}/enrollments/renew`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-renew-${studentId}`)
      .send(renewRequest)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(expect.objectContaining({
          studentId,
          classId: nextClassId,
          academicYearId: "academic-year-2026",
          termId: "term-2026-spring",
          status: "ACTIVE",
          reason: "RENEWED",
          startsAt: "2026-06-05",
        }));
      });

    await request(server)
      .post(`/students/${studentId}/enrollments/renew`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-renew-${studentId}`)
      .send(renewRequest)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(renewed.body);
      });

    await request(server)
      .post(`/students/${studentId}/enrollments/renew`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-renew-${studentId}`)
      .send({ ...renewRequest, startsAt: "2026-06-09" })
      .expect(409);

    await request(server)
      .get(`/students/${studentId}/enrollments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(
          (body as Array<{ reason: string; startsAt: string }>).filter(
            (enrollment) => enrollment.reason === "RENEWED" && enrollment.startsAt === "2026-06-05",
          ),
        ).toHaveLength(1);
      });

    const transferRequest = {
      classId: "class-a",
      academicYearId: "academic-year-2026",
      termId: "term-2026-spring",
      startsAt: "2026-06-06",
    };
    await request(server)
      .post(`/students/${studentId}/enrollments/transfer`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ ...transferRequest, classId: "class-b" })
      .expect(403);

    const transferred = await request(server)
      .post(`/students/${studentId}/enrollments/transfer`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-transfer-${studentId}`)
      .send(transferRequest)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(expect.objectContaining({
          studentId,
          classId: "class-a",
          status: "ACTIVE",
          reason: "TRANSFERRED",
          startsAt: "2026-06-06",
        }));
      });

    await request(server)
      .post(`/students/${studentId}/enrollments/transfer`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-transfer-${studentId}`)
      .send(transferRequest)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(transferred.body);
      });

    await request(server)
      .post(`/students/${studentId}/enrollments/transfer`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-transfer-${studentId}`)
      .send({ ...transferRequest, startsAt: "2026-06-10" })
      .expect(409);

    await request(server)
      .get(`/students/${studentId}/enrollments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(
          (body as Array<{ reason: string; startsAt: string }>).filter(
            (enrollment) => enrollment.reason === "TRANSFERRED" && enrollment.startsAt === "2026-06-06",
          ),
        ).toHaveLength(1);
      });

    const bulkRenewRequest = {
      studentIds: [studentId],
      classIdBySourceClassId: { "class-a": nextClassId },
      academicYearId: "academic-year-2026",
      termId: "term-2026-spring",
      startsAt: "2026-06-07",
    };
    await request(server)
      .post("/students/enrollments/bulk-renew")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ ...bulkRenewRequest, classIdBySourceClassId: undefined, classId: "class-b" })
      .expect(403);

    await request(server)
      .get(`/students/${studentId}/enrollments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).not.toContain("class-b");
      });

    const bulkRenewed = await request(server)
      .post("/students/enrollments/bulk-renew")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-bulk-renew-${studentId}`)
      .send(bulkRenewRequest)
      .expect(201)
      .expect(({ body }) => {
        expect(body.updatedCount).toBe(1);
        expect(body.enrollments).toEqual([
          expect.objectContaining({
            studentId,
            classId: nextClassId,
            status: "ACTIVE",
            reason: "RENEWED",
            startsAt: "2026-06-07",
          }),
        ]);
      });

    await request(server)
      .post("/students/enrollments/bulk-renew")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-bulk-renew-${studentId}`)
      .send(bulkRenewRequest)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(bulkRenewed.body);
      });

    await request(server)
      .post("/students/enrollments/bulk-renew")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", `student-bulk-renew-${studentId}`)
      .send({ ...bulkRenewRequest, startsAt: "2026-06-09" })
      .expect(409);

    await request(server)
      .get("/students")
      .query({ classId: nextClassId, status: "ACTIVE" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: studentId, classId: nextClassId, status: "ACTIVE" })]);
      });

    await request(server)
      .post("/students/enrollments/bulk-renew")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentIds: [studentId],
        useAutomaticClassMapping: true,
        academicYearId: "academic-year-2026",
        termId: "term-2026-spring",
        startsAt: "2026-06-08",
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.updatedCount).toBe(1);
        expect(body.enrollments).toEqual([
          expect.objectContaining({
            studentId,
            classId: promotedClassId,
            status: "ACTIVE",
            reason: "RENEWED",
            startsAt: "2026-06-08",
          }),
        ]);
      });

    await request(server)
      .get("/students")
      .query({ classId: promotedClassId, status: "ACTIVE" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: studentId, classId: promotedClassId, status: "ACTIVE" })]);
      });

    await request(server)
      .delete(`/students/${studentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    const replacement = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Yeni", lastName: "Numara" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.studentNo).toBe(created.body.studentNo);
      });
    await request(server)
      .delete(`/students/${replacement.body.id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/classes/${promotedClassId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/classes/${nextClassId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/grade-levels/${nextGradeLevelId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
  });

  it("student kotası tenant için hard-block uygular", async () => {
    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Yeni", lastName: "Ogrenci" })
      .expect(201);

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Fazla", lastName: "Ogrenci" })
      .expect(409);
  });

  it("student PII purge ad soyadı anonimleştirir", async () => {
    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        nationalId: "10000000146",
        phone: "5551234567",
        email: "ada-purge@example.test",
        photoKey: "students/student-a/purge-photo.jpg",
      })
      .expect(200);

    await request(server)
      .post("/students/student-a/purge-pii")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogrenci");
        expect(JSON.stringify(body)).not.toContain("student-tenant-a");
        expect(JSON.stringify(body)).not.toContain("10000000146");
        expect(JSON.stringify(body)).not.toContain("ada-purge@example.test");
      });

    await request(server)
      .get("/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogrenci");
      });

    await request(server)
      .get("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nationalIdMasked).toBeUndefined();
        expect(body.phone).toBeUndefined();
        expect(body.email).toBeUndefined();
        expect(body.photoKey).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain("10000000146");
        expect(JSON.stringify(body)).not.toContain("ada-purge@example.test");
      });
  });
});

function expectValidationFields(response: { body: { error?: unknown } }, paths: string[]): void {
  expect(response.body.error).toMatchObject({
    code: "VALIDATION_FAILED",
    details: {
      fields: expect.arrayContaining(paths.map((path) => expect.objectContaining({ path }))),
    },
  });
}

function createCsvBase64(content: string): string {
  return Buffer.from(`\uFEFF${content}`, "utf8").toString("base64");
}

async function createTeacherWorkbookBase64(rows: string[][], headers: string[], leadingRows: string[][] = []): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Teachers");
  for (const row of leadingRows) {
    worksheet.addRow(row);
  }
  worksheet.addRow(headers);
  for (const row of rows) {
    worksheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}
