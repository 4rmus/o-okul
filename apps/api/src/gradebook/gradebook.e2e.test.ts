import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { testLoginBody } from "../test-auth.js";

describe("Gradebook API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let admin: string;
  let teacher: string;
  let tenantB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
    admin = await login("admin-a@example.test");
    teacher = await login("teacher-a@example.test");
    tenantB = await login("admin-b@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("class teacher enters a draft, publish needs Idempotency-Key and one key publishes once", async () => {
    const created = await request(server)
      .post("/grade-assessments")
      .set("Authorization", `Bearer ${admin}`)
      .send({ classId: "class-a", courseId: "course-math", termId: "term-2026-spring", kind: "WRITTEN", title: "1. Yazılı", heldOn: "2026-03-10" })
      .expect(201);
    const id = (created.body as { id: string }).id;

    await request(server)
      .post("/grade-assessments")
      .set("Authorization", `Bearer ${teacher}`)
      .send({ classId: "class-a", courseId: "course-math", termId: "term-2026-spring", kind: "WRITTEN", title: "x", heldOn: "2026-03-10" })
      .expect(403);

    await request(server)
      .put(`/grade-assessments/${id}/entries`)
      .set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 88.5, absent: false }] })
      .expect(200);

    await request(server).post(`/grade-assessments/${id}/publish`).set("Authorization", `Bearer ${admin}`).expect(400);
    const first = await request(server)
      .post(`/grade-assessments/${id}/publish`)
      .set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "grade-publish-idempotency-a")
      .expect(201);
    const replay = await request(server)
      .post(`/grade-assessments/${id}/publish`)
      .set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "grade-publish-idempotency-a")
      .expect(201);
    expect(first.body).toMatchObject({ publishedCount: 1, assessment: { publishedVersion: 1 } });
    expect(replay.body).toEqual(first.body);

    await request(server)
      .get(`/grade-assessments/${id}`)
      .set("Authorization", `Bearer ${teacher}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.entries).toEqual([expect.objectContaining({ studentId: "student-a", version: 1, score: 88.5, publishedAt: expect.any(String) })]);
      });

    await request(server).get(`/grade-assessments/${id}`).set("Authorization", `Bearer ${tenantB}`).expect(404);
    await request(server).get("/grade-assessments").set("Authorization", `Bearer ${tenantB}`).expect(200, []);
  });
});
