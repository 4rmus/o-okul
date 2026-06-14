import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("MessageTemplate API", () => {
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

  it("tenant A sadece kendi mesaj şablonlarını listeler", async () => {
    const response = await request(server)
      .get("/message-templates")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "message-template-a",
        tenantId: "tenant-a",
        name: "Deneme sınavı hatırlatma",
        channel: "SMS",
        body: "Sayın veli, öğrencimizin deneme sınavı Pazartesi günü yapılacaktır.",
      },
    ]);
  });

  it("teacher tenant içindeki mesaj şablonunu okuyabilir", async () => {
    const response = await request(server)
      .get("/message-templates/message-template-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: "message-template-a",
      tenantId: "tenant-a",
      name: "Deneme sınavı hatırlatma",
    });
  });

  it("tenant A başka tenant mesaj şablonunu okuyamaz", async () => {
    await request(server)
      .get("/message-templates/message-template-b")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);
  });

  it("tenant admin mesaj şablonu oluşturur, günceller ve siler", async () => {
    const created = await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        name: "Devamsızlık bilgilendirme",
        channel: "SMS",
        body: "Sayın veli, öğrencimizin bugün devamsızlığı bulunmaktadır.",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      name: "Devamsızlık bilgilendirme",
      channel: "SMS",
      body: "Sayın veli, öğrencimizin bugün devamsızlığı bulunmaktadır.",
    });

    const id = (created.body as { id: string }).id;
    const updated = await request(server)
      .patch(`/message-templates/${id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        name: "Devamsızlık SMS",
        body: "Sayın veli, öğrencimiz bugün derse katılmamıştır.",
      })
      .expect(200);

    expect(updated.body).toMatchObject({
      id,
      name: "Devamsızlık SMS",
      channel: "SMS",
      body: "Sayın veli, öğrencimiz bugün derse katılmamıştır.",
    });

    await request(server)
      .delete(`/message-templates/${id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    await request(server)
      .get(`/message-templates/${id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(404);
  });

  it("tenant admin başka tenant adına mesaj şablonu oluşturamaz", async () => {
    await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        tenantId: "tenant-b",
        name: "Gizli şablon",
        body: "Başka tenant",
      })
      .expect(403);
  });

  it("ad, gövde ve kanal doğrulaması yapar", async () => {
    const missingName = await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ body: "Eksik ad" })
      .expect(422);

    expect(missingName.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "name" })],
      },
    });

    const missingBody = await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Eksik gövde" })
      .expect(422);

    expect(missingBody.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "body" })],
      },
    });

    const invalidChannel = await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        name: "Hatalı kanal",
        channel: "EMAIL",
        body: "Geçersiz kanal",
      })
      .expect(422);

    expect(invalidChannel.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "channel" })],
      },
    });
  });

  it("teacher mesaj şablonu oluşturamaz", async () => {
    await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        name: "Teacher şablonu",
        body: "Yetkisiz yazma",
      })
      .expect(403);
  });

  it("yetkisiz request mesaj şablonu endpointine erişemez", async () => {
    await request(server).get("/message-templates").expect(401);
  });
});
