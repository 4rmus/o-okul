import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("School management API", () => {
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

  it("tenant A sadece kendi class kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([{ id: "class-a", tenantId: "tenant-a", name: "8-A", level: "8" }]);
  });

  it("sınıf, öğretmen, veli ve öğrenci listelerinde page/limit/q/sort uygular", async () => {
    const classCreated = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "7-C", level: "7" })
      .expect(201);
    const teacherCreated = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Ziya", lastName: "Ogretmen", branch: "Fen" })
      .expect(201);
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
    const created = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9-A", level: "9" })
      .expect(201);

    const classId = (created.body as { id: string }).id;

    await request(server)
      .patch(`/classes/${classId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9 Fen" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe("9 Fen");
      });

    await request(server).delete(`/classes/${classId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/classes/${classId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
  });

  it("tenant A başka tenantId ile class oluşturamaz", async () => {
    await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ tenantId: "tenant-b", name: "Gizli Sube" })
      .expect(403);
  });

  it("teacher PII purge ad soyadı anonimleştirir", async () => {
    const created = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Gizli", lastName: "Ogretmen", branch: "Matematik" })
      .expect(201);
    const teacherId = (created.body as { id: string }).id;

    await request(server)
      .post(`/teachers/${teacherId}/purge-pii`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogretmen");
        expect(body.branch).toBe("Matematik");
      });

    await request(server)
      .get(`/teachers/${teacherId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogretmen");
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
      .send({ firstName: "Can", lastName: "Veli", phone: "5000000010" })
      .expect(201);

    const guardianId = (created.body as { id: string }).id;

    await request(server)
      .patch(`/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ phone: "5000000011" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.phone).toBe("5000000011");
      });

    await request(server)
      .post(`/guardians/${guardianId}/purge-pii`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Veli");
        expect(body.phone).toBeUndefined();
      });

    await request(server)
      .get(`/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Veli");
        expect(body.phone).toBeUndefined();
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
        relationshipType: "MOTHER",
        isPrimary: true,
        canViewFinance: true,
        canReceiveSms: true,
        canReceiveAnnouncements: true,
        canOpenSupportTickets: false,
      })
      .expect(201);

    expect(linked.body).toEqual(expect.objectContaining({
      tenantId: "tenant-a",
      guardianId,
      studentId: "student-a",
      relationshipType: "MOTHER",
      isPrimary: true,
      canOpenSupportTickets: false,
    }));

    const updated = await request(server)
      .patch(`/guardians/${guardianId}/students/student-a`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ relationshipType: "GUARDIAN", canViewFinance: false, canReceiveSms: false })
      .expect(200);
    expect(updated.body).toEqual(expect.objectContaining({
      guardianId,
      studentId: "student-a",
      relationshipType: "GUARDIAN",
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
      .send({ classId: "class-a", role: "CLASS_TEACHER" })
      .expect(201);
    const assignmentId = (assignmentCreated.body as { id: string }).id;
    expect(assignmentCreated.body).toEqual(expect.objectContaining({
      tenantId: "tenant-a",
      teacherId: "teacher-a",
      classId: "class-a",
      role: "CLASS_TEACHER",
    }));

    await request(server)
      .patch(`/teachers/teacher-a/assignments/${assignmentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ role: "GUIDANCE_COUNSELOR" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.role).toBe("GUIDANCE_COUNSELOR");
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
      .delete(`/students/${studentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
  });

  it("öğrenciyi sınıf ve sorumlu öğretmen ile oluşturur", async () => {
    const nextClass = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "8-C", level: "8" })
      .expect(201);
    const nextClassId = (nextClass.body as { id: string }).id;

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
      .query({ classId: nextClassId, level: "8", status: "PASSIVE" })
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
          expect.objectContaining({ studentId, classId: "class-a", reason: "CREATED", endsAt: expect.any(String) }),
          expect.objectContaining({ studentId, classId: nextClassId, reason: "CLASS_CHANGED" }),
        ]);
        expect(body[1].endsAt).toBeUndefined();
      });

    await request(server)
      .delete(`/students/${studentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .delete(`/classes/${nextClassId}`)
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
      .post("/students/student-a/purge-pii")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogrenci");
      });

    await request(server)
      .get("/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogrenci");
      });
  });
});
