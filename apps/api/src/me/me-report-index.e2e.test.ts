import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { examRepositoryToken } from "../exam/exam.service.js";
import { testLoginBody } from "../test-auth.js";

describe("Me report index API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let studentToken: string;
  let guardianToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(examRepositoryToken)
      .useValue({
        list: async (tenantId: string) => tenantId === "tenant-a" ? [{
          id: "exam-demo",
          tenantId,
          title: "Demo Sınavı",
          status: "PUBLISHED",
          startsAt: "2026-06-06T09:00:00.000Z",
          createdAt: "2026-06-01T09:00:00.000Z",
          updatedAt: "2026-06-01T09:00:00.000Z",
        }] : [],
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    [studentToken, guardianToken, teacherToken] = await Promise.all([
      login("student-a@example.test"),
      login("guardian-a@example.test"),
      login("teacher-a@example.test"),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("öğrenci, veli ve öğretmene ortak READY indeks şekli döndürür", async () => {
    for (const [path, token] of [
      ["/me/student/reports", studentToken],
      ["/me/guardian/students/student-a/reports", guardianToken],
      ["/me/teacher/reports", teacherToken],
    ] as const) {
      await request(server)
        .get(path)
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual([{
            examId: "exam-demo",
            title: "Demo Sınavı",
            startsAt: "2026-06-06T09:00:00.000Z",
            latestReadySnapshotId: "snapshot-demo",
            latestGeneratedAt: "2026-06-06T09:00:00.000Z",
          }]);
        });
    }
  });

  it("veli bağlantılı olmayan öğrencinin rapor indeksine erişemez", async () => {
    await request(server)
      .get("/me/guardian/students/student-b/reports")
      .set("Authorization", `Bearer ${guardianToken}`)
      .expect(403);
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }
});
