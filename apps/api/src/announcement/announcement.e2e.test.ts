import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Announcement API", () => {
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

  it("tenant A sadece kendi duyurularını listeler", async () => {
    const response = await request(server)
      .get("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "announcement-a",
        tenantId: "tenant-a",
        title: "Veli toplantısı",
        body: "Cuma günü 8-A sınıfı için veli toplantısı yapılacaktır.",
        audience: "SCHOOL",
        publishedAt: "2026-06-08T09:00:00.000Z",
      },
    ]);
  });

  it("teacher tenant içindeki duyuruları okuyabilir", async () => {
    const response = await request(server)
      .get("/announcements/announcement-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: "announcement-a",
      tenantId: "tenant-a",
      title: "Veli toplantısı",
    });
  });

  it("tenant A başka tenant duyurusunu okuyamaz", async () => {
    await request(server)
      .get("/announcements/announcement-b")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);
  });

  it("tenant admin duyuru oluşturur", async () => {
    const response = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        title: "Deneme sınavı bilgilendirme",
        body: "Pazartesi günü genel deneme sınavı yapılacaktır.",
        audience: "TEACHERS",
      })
      .expect(201);

    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      title: "Deneme sınavı bilgilendirme",
      body: "Pazartesi günü genel deneme sınavı yapılacaktır.",
      audience: "TEACHERS",
    });
    expect(typeof (response.body as { publishedAt?: unknown }).publishedAt).toBe("string");
  });

  it("tenant admin başka tenant adına duyuru oluşturamaz", async () => {
    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        tenantId: "tenant-b",
        title: "Gizli duyuru",
        body: "Başka tenant",
      })
      .expect(403);
  });

  it("başlık ve hedef kitle doğrulaması yapar", async () => {
    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ body: "Eksik başlık" })
      .expect(400);

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        title: "Hatalı hedef",
        body: "Geçersiz hedef",
        audience: "GUARDIANS",
      })
      .expect(400);
  });

  it("teacher duyuru oluşturamaz", async () => {
    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        title: "Teacher duyurusu",
        body: "Yetkisiz yazma",
      })
      .expect(403);
  });

  it("yetkisiz request duyuru endpointine erişemez", async () => {
    await request(server).get("/announcements").expect(401);
  });
});
