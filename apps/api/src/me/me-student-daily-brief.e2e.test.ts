import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { examRepositoryToken } from "../exam/exam.service.js";
import { testLoginBody } from "../test-auth.js";

describe("Me student daily brief API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(examRepositoryToken)
      .useValue({
        list: async () => [{
          createdAt: "2026-06-01T08:00:00.000Z",
          id: "exam-demo",
          status: "PUBLISHED",
          tenantId: "tenant-a",
          title: "Demo sınavı",
          updatedAt: "2026-06-01T08:00:00.000Z",
        }],
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    for (const email of ["student-a@example.test", "teacher-a@example.test", "guardian-a@example.test", "admin-a@example.test", "system@example.test"]) {
      const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
      tokens.set(email, (response.body as { accessToken: string }).accessToken);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant query override'ından etkilenmeden PII-safe self aggregate döndürür", async () => {
    const token = tokens.get("student-a@example.test")!;
    const base = await request(server)
      .get("/me/student/daily-brief")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const overridden = await request(server)
      .get("/me/student/daily-brief?tenantId=tenant-b")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(overridden.body).toEqual(base.body);
    expect(base.body).toMatchObject({
      absenceCount: expect.any(Number),
      actions: expect.any(Array),
      attendanceRecordCount: expect.any(Number),
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      homeworkAssignmentCount: expect.any(Number),
      lateCount: expect.any(Number),
      openSupportTicketCount: expect.any(Number),
      unreadAnnouncementCount: expect.any(Number),
    });
    expect(base.body.actions.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(base.body)).not.toMatch(/tenantId|studentId|firstName|lastName|email|phone|nationalId|requesterId|message|body/i);
  });

  it("yalnız öğrenci personasını açar", async () => {
    for (const email of ["teacher-a@example.test", "guardian-a@example.test", "admin-a@example.test", "system@example.test"]) {
      await request(server)
        .get("/me/student/daily-brief")
        .set("Authorization", `Bearer ${tokens.get(email)!}`)
        .expect(403);
    }
  });

  it("read-only role preview'da admin actor verisi yerine hedef öğrenciyle aynı aggregate'i döndürür", async () => {
    const studentResponse = await request(server)
      .get("/me/student/daily-brief")
      .set("Authorization", `Bearer ${tokens.get("student-a@example.test")!}`)
      .expect(200);
    const preview = await request(server)
      .post("/role-previews")
      .set("Authorization", `Bearer ${tokens.get("admin-a@example.test")!}`)
      .send({ targetRole: "STUDENT", targetSubjectId: "student-a" })
      .expect(201);
    const previewResponse = await request(server)
      .get("/me/student/daily-brief")
      .set("Authorization", `Bearer ${tokens.get("admin-a@example.test")!}`)
      .set("x-role-preview-token", (preview.body as { previewToken: string }).previewToken)
      .expect(200);

    expect(previewResponse.body).toEqual(studentResponse.body);
  });
});
