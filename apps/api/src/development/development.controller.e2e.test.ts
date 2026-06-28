import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Development API", () => {
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

    tenantAAccessToken = await login("admin-a@example.test");
    teacherAAccessToken = await login("teacher-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("creates development criteria and teacher assessment", async () => {
    const criterion = await request(server)
      .post("/development/criteria")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        name: "Sosyal Katilim",
        scaleMax: 5,
        scaleMin: 1,
        sortOrder: 10,
      })
      .expect(201);

    expect(criterion.body).toMatchObject({
      tenantId: "tenant-a",
      name: "Sosyal Katilim",
      scaleMax: 5,
      scaleMin: 1,
      sortOrder: 10,
    });

    const assessment = await request(server)
      .post("/development/assessments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        periodLabel: "2026 Haziran",
        scores: [{ criterionId: criterion.body.id, score: 4 }],
        studentId: "student-a",
        visibility: "GUARDIAN",
      })
      .expect(201);

    expect(assessment.body).toMatchObject({
      tenantId: "tenant-a",
      studentId: "student-a",
      teacherId: "teacher-a",
      periodLabel: "2026 Haziran",
      visibility: "GUARDIAN",
      scores: [expect.objectContaining({ criterionId: criterion.body.id, score: 4 })],
    });

    await request(server)
      .get("/development/assessments")
      .query({ studentId: "student-a" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: assessment.body.id, studentId: "student-a", teacherId: "teacher-a" }),
        ]));
      });
  });

  it("validates development criterion bodies with Zod", async () => {
    const invalidCreate = await request(server)
      .post("/development/criteria")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        name: " ",
        scaleMin: 1.5,
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "name" }),
          expect.objectContaining({ path: "scaleMin" }),
        ]),
      },
    });
  });

  it("validates development assessment bodies with Zod", async () => {
    const invalidCreate = await request(server)
      .post("/development/assessments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        periodLabel: " ",
        scores: [],
        studentId: " ",
        visibility: "PUBLIC",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "periodLabel" }),
          expect.objectContaining({ path: "scores" }),
          expect.objectContaining({ path: "studentId" }),
          expect.objectContaining({ path: "visibility" }),
        ]),
      },
    });

    const invalidScore = await request(server)
      .post("/development/assessments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        periodLabel: "2026 Haziran",
        scores: [{ criterionId: " ", score: 1.5 }],
        studentId: "student-a",
      })
      .expect(422);

    expect(invalidScore.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "scores.0.criterionId" }),
          expect.objectContaining({ path: "scores.0.score" }),
        ]),
      },
    });
  });
});
