import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Identity invitations", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("kurum admin öğrenci daveti oluşturur, kabul edilince subject userId bağlanır", async () => {
    const admin = await login("admin-a@example.test");
    const student = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Davet", lastName: "Ogrenci" })
      .expect(201);
    const studentId = (student.body as { id: string }).id;

    const invite = await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        subjectType: "STUDENT",
        subjectId: studentId,
        email: "invite-student@example.test",
      })
      .expect(201);

    expect(invite.body).toMatchObject({
      invitation: {
        tenantId: "tenant-a",
        subjectType: "STUDENT",
        subjectId: studentId,
        email: "invite-student@example.test",
        role: "STUDENT",
        status: "PENDING",
      },
    });
    expect(invite.body.activationToken).toEqual(expect.any(String));

    await request(server)
      .get("/identity-invitations")
      .query({ q: "invite-student", sort: "email", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: invite.body.invitation.id, email: "invite-student@example.test" })]);
      });

    const accepted = await request(server)
      .post("/identity-invitations/accept")
      .send({ token: invite.body.activationToken, password: "password1" })
      .expect(201);

    expect(accepted.body).toMatchObject({
      subjectType: "STUDENT",
      subjectId: studentId,
      status: "ACCEPTED",
    });
    expect(accepted.body.acceptedUserId).toEqual(expect.any(String));

    await request(server)
      .get(`/students/${studentId}`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.userId).toBe(accepted.body.acceptedUserId);
      });
  });

  it("davet tekrar gönderilince eski token geçersiz olur", async () => {
    const admin = await login("admin-a@example.test");
    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Davet", lastName: "Ogretmen", branch: "Fen" })
      .expect(201);
    const teacherId = (teacher.body as { id: string }).id;
    const invite = await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        subjectType: "TEACHER",
        subjectId: teacherId,
        email: "invite-teacher@example.test",
      })
      .expect(201);

    const resent = await request(server)
      .post(`/identity-invitations/${invite.body.invitation.id}/resend`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(201);

    expect(resent.body.activationToken).not.toBe(invite.body.activationToken);
    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: invite.body.activationToken, password: "password1" })
      .expect(404);
    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: resent.body.activationToken, password: "password1" })
      .expect(201);
  });

  it("öğretmen davet oluşturamaz ve bağlı subject tekrar davet edilemez", async () => {
    const teacher = await login("teacher-a@example.test");
    await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${teacher}`)
      .send({
        subjectType: "STUDENT",
        subjectId: "student-a",
        email: "blocked@example.test",
      })
      .expect(403);

    const admin = await login("admin-a@example.test");
    await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        subjectType: "STUDENT",
        subjectId: "student-a",
        email: "already-linked@example.test",
      })
      .expect(400);
  });
});
