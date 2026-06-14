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
        birthDate: "2012-05-10",
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
          birthDate: "2012-05-10",
          phone: "5551234567",
          email: "ada@example.test",
          photoKey: "students/student-a/photo.jpg",
        });
        expect(JSON.stringify(body)).not.toContain("10000000146");
      });

    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ nationalId: "10000000145" })
      .expect(422);

    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ birthDate: "2011-02-29" })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: "VALIDATION_FAILED",
          details: {
            fields: [
              expect.objectContaining({
                message: "STUDENT_BIRTH_DATE_INVALID",
                path: "birthDate",
              }),
            ],
          },
        });
      });
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
