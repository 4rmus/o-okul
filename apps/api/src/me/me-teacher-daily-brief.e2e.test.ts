import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { examRepositoryToken } from "../exam/exam.service.js";
import { testLoginBody } from "../test-auth.js";

describe("Me teacher daily brief API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(examRepositoryToken)
      .useValue({
        list: async () => [{
          id: "exam-demo",
          tenantId: "tenant-a",
          title: "Demo sınavı",
          status: "PUBLISHED",
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
        }],
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    for (const email of ["teacher-a@example.test", "admin-a@example.test", "student-a@example.test", "system@example.test"]) {
      const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
      tokens.set(email, (response.body as { accessToken: string }).accessToken);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("tarih ve tenant query override'ını değiştirmeden PII-safe aggregate döndürür", async () => {
    const token = tokens.get("teacher-a@example.test")!;
    const base = await request(server)
      .get("/me/teacher/daily-brief?date=2026-06-17")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const overridden = await request(server)
      .get("/me/teacher/daily-brief?date=2026-06-17&tenantId=tenant-b")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(overridden.body).toEqual(base.body);
    expect(base.body).toMatchObject({
      actions: expect.any(Array),
      assignedStudentCount: expect.any(Number),
      date: "2026-06-17",
      openSupportTicketCount: expect.any(Number),
      pendingAttendanceClassCount: expect.any(Number),
      todayLessonCount: expect.any(Number),
      uncheckedHomeworkCount: expect.any(Number),
    });
    expect(base.body.actions.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(base.body)).not.toMatch(/tenantId|studentId|teacherId|firstName|lastName|email|phone|nationalId|requesterId/i);
  });

  it("yalnız öğretmen personasını açar ve geçersiz tarihi reddeder", async () => {
    const teacherToken = tokens.get("teacher-a@example.test")!;
    await request(server)
      .get("/me/teacher/daily-brief?date=2026-02-31")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(400)
      .expect(({ body }) => expect(body.error?.code).toBe("DAILY_BRIEF_DATE_INVALID"));

    for (const email of ["admin-a@example.test", "student-a@example.test", "system@example.test"]) {
      await request(server)
        .get("/me/teacher/daily-brief?date=2026-06-17")
        .set("Authorization", `Bearer ${tokens.get(email)!}`)
        .expect(403);
    }
  });
});
