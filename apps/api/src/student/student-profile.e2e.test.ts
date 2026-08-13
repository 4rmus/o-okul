import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Student profile + TC API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;
  let teacherAAccessToken: string;
  let campusOperationsAccessToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({
      id: "user-tenant-a",
      email: "admin-a@example.test",
      name: "Tenant A Admin",
      password: "password",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membership: {
        id: "membership-tenant-a-admin",
        staffRole: "TENANT_ADMIN",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 2,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    upsertInMemoryAuthUser({
      id: "user-operations-a",
      email: "operations-a@example.test",
      name: "Campus Operations",
      password: "password",
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      membership: {
        id: "membership-operations-a",
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "CAMPUSES",
        campusIds: ["campus-main"],
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    tenantAAccessToken = await login("admin-a@example.test");
    studentAAccessToken = await login("student-a@example.test");
    guardianAAccessToken = await login("guardian-a@example.test");
    teacherAAccessToken = await login("teacher-a@example.test");
    campusOperationsAccessToken = await login("operations-a@example.test");
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  async function login(email: string): Promise<string> {
    const body = email === "operations-a@example.test"
      ? { loginName: email, password: "password", tenantSlug: "dna-egitim" }
      : testLoginBody(email);
    const response = await request(server).post("/auth/login").send(body).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("tenant admin öğrenci profilini TC doğrulamasıyla günceller ve ham TC dönmez", async () => {
    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        nationalId: "10000002362",
        phone: "5551234567",
        email: "ada@example.test",
        photoKey: "students/student-a/photo.jpg",
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: "student-a",
          tenantId: "tenant-a",
          className: "8-A",
          campusName: "Merkez Kampus",
          gradeLevelName: "8. Sınıf",
          section: "A",
          responsibleTeacherName: "Ayse Ogretmen",
          nationalIdMasked: "*******2362",
          phone: "5551234567",
          email: "ada@example.test",
          photoKey: "students/student-a/photo.jpg",
        });
        expect(JSON.stringify(body)).not.toContain("10000002362");
        expectStudentProfileResponseIsPublic(body);
      });

    await request(server)
      .get("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "student-a", firstName: "Ada" })]);
        expectStudentCoreResponseIsPublic(body);
      });

    await request(server)
      .get("/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "student-a", firstName: "Ada" });
        expectStudentCoreResponseIsPublic(body);
      });

    await request(server)
      .patch("/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Ada" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "student-a", firstName: "ADA" });
        expectStudentCoreResponseIsPublic(body);
      });

    await request(server)
      .patch("/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Ada", nationalId: "10000002362", phone: "5551234567" })
      .expect(422);

    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ nationalIdHash: "hash", nationalIdEncrypted: "encrypted", userId: "student-tenant-a" })
      .expect(422);

    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ photoKey: "students/student-b/photo.jpg" })
      .expect(400);

    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ nationalId: "1000000014" })
      .expect(422);

  });

  it("tenant içinde nationalIdHash benzersizliğini korur", async () => {
    const created = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Ece", lastName: "Profil" })
      .expect(201);

    await request(server)
      .patch(`/students/${created.body.id}/profile`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ nationalId: "10000002362" })
      .expect(409);
  });

  it("öğrencileri en fazla 200 kimlikle viewer scope içinde toplu getirir", async () => {
    await request(server)
      .get("/students")
      .query({ ids: "student-a,student-b" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "student-a", tenantId: "tenant-a" })]);
      });

    await request(server)
      .get("/students")
      .query({ ids: Array.from({ length: 201 }, (_, index) => `student-${index}`).join(",") })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);
  });

  it("cross-tenant classId ve responsibleTeacherId iliskilerini yazamaz", async () => {
    const beforeStudents = await request(server)
      .get("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);
    const beforeHistory = await request(server)
      .get("/me/student/enrollments")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(200);

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Yanlis", lastName: "Sinif", classId: "class-b" })
      .expect(403);

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Yanlis", lastName: "Ogretmen", responsibleTeacherId: "teacher-b" })
      .expect(403);

    await request(server)
      .patch("/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: "class-b" })
      .expect(403);

    await request(server)
      .patch("/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ responsibleTeacherId: "teacher-b" })
      .expect(403);

    await request(server)
      .get("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(beforeStudents.body.length);
      });

    await request(server)
      .get("/me/student/profile")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.className).toBe("8-A");
        expect(body.responsibleTeacherName).toBe("Ayse Ogretmen");
      });

    await request(server)
      .get("/me/student/enrollments")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(beforeHistory.body.length);
        expect(JSON.stringify(body)).not.toContain("7-B");
      });
  });

  it("bulk enrollment tenant dışı öğrenciyle kısmi yenileme yapmaz", async () => {
    const before = await request(server)
      .get("/students/student-a/enrollments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    await request(server)
      .post("/students/enrollments/bulk-renew")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentIds: ["student-a", "student-b"], classId: "class-a", startsAt: "2026-09-01" })
      .expect(403);

    await request(server)
      .get("/students/student-a/enrollments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(before.body.length);
        expect(JSON.stringify(body)).not.toContain("2026-09-01");
      });
  });

  it("öğrenci, veli ve kapsamlı öğretmen profili maskeli görür", async () => {
    await request(server)
      .get("/me/student/profile")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nationalIdMasked).toBe("*******2362");
        expect(body.className).toBe("8-A");
        expect(body.campusName).toBe("Merkez Kampus");
        expect(body.gradeLevelName).toBe("8. Sınıf");
        expect(body.section).toBe("A");
        expect(body.responsibleTeacherName).toBe("Ayse Ogretmen");
        expect(JSON.stringify(body)).not.toContain("10000002362");
        expect(JSON.stringify(body)).not.toContain("userId");
      });
    await request(server)
      .get("/me/student/enrollments")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body[0]).toMatchObject({
          className: "8-A",
          campusName: "Merkez Kampus",
          gradeLevelName: "8. Sınıf",
          section: "A",
        });
      });

    await request(server)
      .get("/me/guardian/students/student-a/profile")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nationalIdMasked).toBe("*******2362");
        expect(body.className).toBe("8-A");
        expect(body.campusName).toBe("Merkez Kampus");
        expect(body.gradeLevelName).toBe("8. Sınıf");
        expect(body.section).toBe("A");
        expect(body.responsibleTeacherName).toBe("Ayse Ogretmen");
        expect(body.phoneMasked).toBe("••• ••• ••67");
        expect(body.emailMasked).toBe("ad••@•••.test");
        expect(JSON.stringify(body)).not.toContain("5551234567");
        expect(JSON.stringify(body)).not.toContain("ada@example.test");
      });
    await request(server)
      .get("/me/guardian/students/student-a/enrollments")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body[0]).toMatchObject({
          className: "8-A",
          campusName: "Merkez Kampus",
          gradeLevelName: "8. Sınıf",
          section: "A",
        });
      });

    await request(server)
      .get("/me/guardian/students/student-b/profile")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(403);

    await request(server)
      .get("/students/student-a/profile")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nationalIdMasked).toBe("*******2362");
        expect(body.className).toBe("8-A");
        expect(body.campusName).toBe("Merkez Kampus");
        expect(body.gradeLevelName).toBe("8. Sınıf");
        expect(body.section).toBe("A");
        expect(body.responsibleTeacherName).toBe("Ayse Ogretmen");
        expect(body.phoneMasked).toBe("••• ••• ••67");
        expect(body.emailMasked).toBe("ad••@•••.test");
        expect(JSON.stringify(body)).not.toContain("10000002362");
        expect(JSON.stringify(body)).not.toContain("5551234567");
        expect(JSON.stringify(body)).not.toContain("ada@example.test");
        expectStudentProfileResponseIsPublic(body);
      });
  });

  it("kampüs kapsamlı operasyon çalışanına başka kampüs sınıfı ve öğretmeni dönmez", async () => {
    const campus = await request(server)
      .post("/campuses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Uzak Kampüs", code: "UZK" })
      .expect(201);
    const schoolClass = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "7-U", campusId: campus.body.id })
      .expect(201);
    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Uzak", lastName: "Öğretmen", phone: "5550000088" })
      .expect(201);
    const assignment = await request(server)
      .post(`/teachers/${teacher.body.id}/assignments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: schoolClass.body.id, role: "CLASS_TEACHER" })
      .expect(201);

    try {
      await request(server)
        .get("/campuses")
        .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual([expect.objectContaining({ id: "campus-main" })]);
          expect(JSON.stringify(body)).not.toContain(campus.body.id);
        });
      await request(server)
        .get("/classes")
        .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
        .expect(200)
        .expect(({ body }) => expect(JSON.stringify(body)).not.toContain(schoolClass.body.id));
      await request(server)
        .get("/teachers")
        .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect(JSON.stringify(body)).not.toContain(teacher.body.id);
          expect(JSON.stringify(body)).not.toContain("5550000088");
        });
      await request(server)
        .get(`/teachers/${teacher.body.id}`)
        .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
        .expect(403);
    } finally {
      await request(server)
        .delete(`/teachers/${teacher.body.id}/assignments/${assignment.body.id}`)
        .set("Authorization", `Bearer ${tenantAAccessToken}`);
      await request(server).delete(`/teachers/${teacher.body.id}`).set("Authorization", `Bearer ${tenantAAccessToken}`);
      await request(server).delete(`/classes/${schoolClass.body.id}`).set("Authorization", `Bearer ${tenantAAccessToken}`);
      await request(server).delete(`/campuses/${campus.body.id}`).set("Authorization", `Bearer ${tenantAAccessToken}`);
    }
  });

  it("profil görüntüleme audit kaydı ham TC içermez", async () => {
    await request(server).get("/me/student/profile").set("Authorization", `Bearer ${studentAAccessToken}`).expect(200);

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        const profileView = body.find((record: { action: string }) => record.action === "student.profile_viewed");
        expect(profileView).toMatchObject({
          tenantId: "tenant-a",
          entityType: "Student",
          entityId: "student-a",
          action: "student.profile_viewed",
        });
        expect(JSON.stringify(profileView)).not.toContain("10000002362");
      });
  });
});

function expectStudentCoreResponseIsPublic(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "student-tenant-a",
    "userId",
    "10000002362",
    "*******2362",
    "ada@example.test",
    "5551234567",
    "students/student-a/photo.jpg",
    "nationalId",
    "nationalIdEncrypted",
    "nationalIdHash",
    "phone",
    "photoKey",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}

function expectStudentProfileResponseIsPublic(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "student-tenant-a",
    "userId",
    "10000002362",
    "nationalIdEncrypted",
    "nationalIdHash",
    "token",
    "fileBase64",
    "contentBase64",
    "storageKey",
    "objectKey",
    "s3Key",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}
