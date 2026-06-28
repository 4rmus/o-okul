import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Global search API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let tenantBAccessToken: string;
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
    tenantBAccessToken = await login("admin-b@example.test");
    teacherAAccessToken = await login("teacher-a@example.test");
    studentAAccessToken = await login("student-a@example.test");
    guardianAAccessToken = await login("guardian-a@example.test");

    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ nationalId: "10000002430", phone: "5551234567", email: "ada@example.test" })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("kurum kullanıcısı öğrenci, öğretmen, veli ve sınıf sonuçlarını dar DTO ile arar", async () => {
    await request(server)
      .get("/search")
      .query({ q: "Ada", limit: "5" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            href: "/kurum/ogrenciler/student-a",
            id: "student-a",
            title: "Ada A",
            type: "students",
          }),
        ]);
        expect(JSON.stringify(body)).not.toContain("tenant-a");
        expect(JSON.stringify(body)).not.toContain("student-tenant-a");
        expect(JSON.stringify(body)).not.toContain("5551234567");
        expect(JSON.stringify(body)).not.toContain("ada@example.test");
        expect(JSON.stringify(body)).not.toContain("10000002430");
      });

    await request(server)
      .get("/search")
      .query({ q: "Ogretmen" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ href: "/kurum/ogretmenler/teacher-a", title: "Ayse Ogretmen", type: "teachers" }),
        ]);
      });

    await request(server)
      .get("/search")
      .query({ q: "Veli", types: "guardians" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ href: "/kurum/veliler/guardian-a", title: expect.stringMatching(/Veli$/), type: "guardians" }),
        ]);
        expect(JSON.stringify(body)).not.toContain("5000000001");
      });

    await request(server)
      .get("/search")
      .query({ q: "8-A", types: "classes" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ href: "/kurum/siniflar/class-a", title: "8-A", type: "classes" }),
        ]);
      });
  });

  it("types ve limit parametrelerini uygular", async () => {
    await request(server)
      .get("/search")
      .query({ q: "A", types: "students", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);

    await request(server)
      .get("/search")
      .query({ q: "Ada", types: "students", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ id: "student-a", type: "students" });
      });
  });

  it("tenant sınırı ve öğretmen kapsamını korur", async () => {
    await request(server)
      .get("/search")
      .query({ q: "Ada" })
      .set("Authorization", `Bearer ${tenantBAccessToken}`)
      .expect(200, []);

    await request(server)
      .get("/search")
      .query({ q: "Bora" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200, []);

    await request(server)
      .get("/search")
      .query({ q: "Ada", types: "students" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            href: "/ogretmen/ogrenci-takibi?studentId=student-a",
            id: "student-a",
            type: "students",
          }),
        ]);
      });

    await request(server)
      .get("/search")
      .query({ q: "Bora", types: "students,guardians" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200, []);
  });

  it("PII pattern aramasını öğretmene açmaz ve response içinde PII döndürmez", async () => {
    await request(server)
      .get("/search")
      .query({ q: "10000002430", types: "students" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "student-a", title: "Ada A", type: "students" })]);
        expect(JSON.stringify(body)).not.toContain("10000002430");
      });

    await request(server)
      .get("/search")
      .query({ q: "10000002430", types: "students" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200, []);

    await request(server)
      .get("/search")
      .query({ q: "5000000001", types: "guardians" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200, []);
  });

  it("yetkisiz roller ve geçersiz query değerlerini reddeder", async () => {
    await request(server)
      .get("/search")
      .query({ q: "Ada" })
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(403);

    await request(server)
      .get("/search")
      .query({ q: "Ada" })
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(403);

    await request(server)
      .get("/search")
      .query({ q: "Ada", types: "unknown" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);

    await request(server)
      .get("/search")
      .query({ q: "Ada", limit: "0" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);
  });
});
