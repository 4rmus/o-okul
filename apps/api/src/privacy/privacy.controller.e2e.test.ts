import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("PrivacyController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];

    adminToken = await login("admin-a@example.test");
    teacherToken = await login("teacher-a@example.test");
    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        nationalId: "10000002430",
        phone: "5550000011",
        email: "student-inventory@example.test",
        photoKey: "students/student-a/inventory.jpg",
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("tenant admin KVKK envanterini PII-safe referanslarla görür", async () => {
    const response = await request(server)
      .get("/privacy/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "student-a",
        kind: "student",
        displayRef: expect.any(String),
        piiCategories: expect.arrayContaining(["Ad", "soyad", "T.C. kimlik no", "telefon", "e-posta", "fotoğraf"]),
        purgeAvailable: true,
      }),
      expect.objectContaining({
        kind: "user",
        displayRef: expect.any(String),
        piiCategories: expect.arrayContaining(["e-posta", "ad"]),
        purgeAvailable: true,
      }),
    ]));
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "Ada",
      "admin-a@example.test",
      "student-tenant-a",
      "nationalId",
      "phone",
      "token",
      "userId",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("privacy envanteri privacy capability olmayan öğretmene kapalıdır", async () => {
    await request(server)
      .get("/privacy/inventory")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
  });

  // DEC-20261102-08: a deleted teacher keeps personal data (and its ENDED Employee copy) until it is purged, so the
  // KVKK inventory lists it and the purge reaches it; every other teacher read still answers 404.
  it("silinmiş öğretmen KVKK envanterinde kalır ve kişisel verisi imha edilebilir", async () => {
    const created = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Silinen", lastName: "Envanter", nationalId: "10000008784", phone: "5550000077" })
      .expect(201);
    const teacherId = (created.body as { id: string }).id;
    await request(server).delete(`/teachers/${teacherId}`).set("Authorization", `Bearer ${adminToken}`).expect(204);

    await request(server).get(`/teachers/${teacherId}`).set("Authorization", `Bearer ${adminToken}`).expect(404);
    const listed = await request(server).get("/teachers").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(teacherId);
    await request(server).patch(`/teachers/${teacherId}`).set("Authorization", `Bearer ${adminToken}`).send({ firstName: "Geri" }).expect(404);

    const before = await request(server).get("/privacy/inventory").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(before.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: teacherId,
        kind: "teacher",
        piiCategories: ["Ad", "soyad", "T.C. kimlik no", "telefon"],
        purgeAvailable: true,
      }),
    ]));
    expect(JSON.stringify(before.body)).not.toContain("Silinen");

    await request(server).post(`/teachers/${teacherId}/purge-pii`).set("Authorization", `Bearer ${teacherToken}`).expect(403);
    await request(server)
      .post(`/teachers/${teacherId}/purge-pii`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: teacherId, firstName: "Anonim", lastName: "Ogretmen" });
        expect(body.phone).toBeUndefined();
        expect(body).not.toHaveProperty("nationalIdHash");
        expect(body).not.toHaveProperty("deletedAt");
      });

    const after = await request(server).get("/privacy/inventory").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(after.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: teacherId, kind: "teacher", piiCategories: [], purgeAvailable: false }),
    ]));
    await request(server).get(`/teachers/${teacherId}`).set("Authorization", `Bearer ${adminToken}`).expect(404);
  });

  it("silinmiş öğretmen imhası başka tenant'tan erişilemez", async () => {
    const created = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Kiraci", lastName: "Silinen" })
      .expect(201);
    const teacherId = (created.body as { id: string }).id;
    await request(server).delete(`/teachers/${teacherId}`).set("Authorization", `Bearer ${adminToken}`).expect(204);

    const tenantBToken = await login("admin-b@example.test");
    const response = await request(server).post(`/teachers/${teacherId}/purge-pii`).set("Authorization", `Bearer ${tenantBToken}`);
    expect([403, 404]).toContain(response.status);
    const inventory = await request(server).get("/privacy/inventory").set("Authorization", `Bearer ${tenantBToken}`).expect(200);
    expect(JSON.stringify(inventory.body)).not.toContain(teacherId);
  });

  // DEC-20261016-01: self-service account purge was removed; account PII is purged with the guardian/teacher record.
  it("kendi hesabını temizleme ucu kaldırıldı", async () => {
    for (const email of ["privacy@example.test", "guardian-a@example.test"]) {
      const token = await login(email);
      await request(server).post("/privacy/me/purge-pii").set("Authorization", `Bearer ${token}`).expect(404);
    }
  });
});
