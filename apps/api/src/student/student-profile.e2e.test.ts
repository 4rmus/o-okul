import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Student profile + TC API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;
  let teacherAAccessToken: string;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("tenant admin öğrenci profilini TC doğrulamasıyla günceller ve ham TC dönmez", async () => {
    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        nationalId: "10000000146",
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
          nationalIdMasked: "*******0146",
          phone: "5551234567",
          email: "ada@example.test",
          photoKey: "students/student-a/photo.jpg",
        });
        expect(JSON.stringify(body)).not.toContain("10000000146");
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
        expect(body).toMatchObject({ id: "student-a", firstName: "Ada" });
        expectStudentCoreResponseIsPublic(body);
      });

    await request(server)
      .patch("/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Ada", nationalId: "10000000146", phone: "5551234567" })
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
      .send({ nationalId: "10000000145" })
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
      .send({ nationalId: "10000000146" })
      .expect(409);
  });

  it("cross-tenant classId ve responsibleTeacherId iliskilerini yazamaz", async () => {
    const beforeStudents = await request(server)
      .get("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);
    const beforeHistory = await request(server)
      .get("/me/student/class-history")
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
      .get("/me/student/class-history")
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
        expect(body.nationalIdMasked).toBe("*******0146");
        expect(body.className).toBe("8-A");
        expect(body.campusName).toBe("Merkez Kampus");
        expect(body.gradeLevelName).toBe("8. Sınıf");
        expect(body.section).toBe("A");
        expect(body.responsibleTeacherName).toBe("Ayse Ogretmen");
        expect(JSON.stringify(body)).not.toContain("10000000146");
        expect(JSON.stringify(body)).not.toContain("userId");
      });
    await request(server)
      .get("/me/student/class-history")
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
        expect(body.nationalIdMasked).toBe("*******0146");
        expect(body.className).toBe("8-A");
        expect(body.campusName).toBe("Merkez Kampus");
        expect(body.gradeLevelName).toBe("8. Sınıf");
        expect(body.section).toBe("A");
        expect(body.responsibleTeacherName).toBe("Ayse Ogretmen");
      });
    await request(server)
      .get("/me/guardian/students/student-a/class-history")
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
        expect(body.nationalIdMasked).toBe("*******0146");
        expect(body.className).toBe("8-A");
        expect(body.campusName).toBe("Merkez Kampus");
        expect(body.gradeLevelName).toBe("8. Sınıf");
        expect(body.section).toBe("A");
        expect(body.responsibleTeacherName).toBe("Ayse Ogretmen");
        expect(JSON.stringify(body)).not.toContain("10000000146");
        expectStudentProfileResponseIsPublic(body);
      });
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
        expect(JSON.stringify(profileView)).not.toContain("10000000146");
      });
  });
});

function expectStudentCoreResponseIsPublic(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "student-tenant-a",
    "userId",
    "10000000146",
    "*******0146",
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
    "10000000146",
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
