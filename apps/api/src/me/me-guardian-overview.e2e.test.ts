import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuardianStudentOverview } from "@o-okul/shared-types";
import { AppModule } from "../app.module.js";
import { testLoginBody } from "../test-auth.js";

const overviewKeys = ["announcements", "attendance", "examSeries", "finance", "homework", "schoolGrades", "student"];

describe("Guardian student overview (KV-4)", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let admin: string;
  let teacher: string;
  let guardian: string;
  let student: string;
  let tenantBAdmin: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
    admin = await login("admin-a@example.test");
    teacher = await login("teacher-a@example.test");
    guardian = await login("guardian-a@example.test");
    student = await login("student-a@example.test");
    tenantBAdmin = await login("admin-b@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  function getOverview(token: string, studentId = "student-a") {
    return request(server).get(`/me/guardian/students/${studentId}/overview`).set("Authorization", `Bearer ${token}`);
  }

  it("returns only allow-listed fields: no teacher note, contact or other guardian data", async () => {
    await request(server)
      .post("/teacher-notes")
      .set("Authorization", `Bearer ${teacher}`)
      .send({ studentId: "student-a", visibility: "GUARDIAN_STUDENT", body: "OGRETMEN-NOTU-SIZMAMALI" })
      .expect(201);
    await request(server)
      .post("/students/student-a/contacts")
      .set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "kv4-overview-contact-a")
      .send({ firstName: "IletisimSizmamali", lastName: "Kisi", relationType: "MOTHER", phone: "5550004401", email: "iletisim-kv4@example.test" })
      .expect(201);
    const otherGuardian = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "DigerVeliSizmamali", lastName: "Veli", phone: "5550004402" })
      .expect(201);
    await request(server)
      .post(`/guardians/${(otherGuardian.body as { id: string }).id}/students`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ studentId: "student-a" })
      .expect(201);

    const response = await getOverview(guardian).expect(200);
    const body = response.body as GuardianStudentOverview;

    expect(Object.keys(body).sort()).toEqual(overviewKeys);
    expect(Object.keys(body.student).sort()).toEqual(expect.arrayContaining(["firstName", "id", "lastName"]));
    expect(Object.keys(body.student).every((key) => ["className", "firstName", "id", "lastName"].includes(key))).toBe(true);
    expect(Object.keys(body.attendance).sort()).toEqual(["absent", "excused", "late", "present", "total"]);
    expect(Object.keys(body.homework).sort()).toEqual(["assignmentCount", "upcoming"]);
    expect(Object.keys(body.announcements)).toEqual(["unreadCount"]);
    expect(body.student.id).toBe("student-a");

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "OGRETMEN-NOTU-SIZMAMALI",
      "IletisimSizmamali",
      "5550004401",
      "iletisim-kv4",
      "DigerVeliSizmamali",
      "5550004402",
      "teacherNote",
      "contacts",
      "guardians",
      "guardianLinks",
      "phone",
      "email",
      "nationalId",
      "userId",
      "\"note\"",
      "\"body\"",
    ]) {
      expect(serialized, `overview must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("shows only the current published school grade version, never a draft, separate from the exam series", async () => {
    const created = await request(server)
      .post("/grade-assessments")
      .set("Authorization", `Bearer ${admin}`)
      .send({ classId: "class-a", courseId: "course-math", termId: "term-2026-spring", kind: "WRITTEN", title: "KV4 Yazılı", heldOn: "2026-03-12" })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const draftOnly = await request(server)
      .post("/grade-assessments")
      .set("Authorization", `Bearer ${admin}`)
      .send({ classId: "class-a", courseId: "course-math", termId: "term-2026-spring", kind: "WRITTEN", title: "KV4 Taslak", heldOn: "2026-03-13" })
      .expect(201);
    const draftOnlyId = (draftOnly.body as { id: string }).id;

    await request(server).put(`/grade-assessments/${id}/entries`).set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 70, absent: false }] }).expect(200);
    await request(server).post(`/grade-assessments/${id}/publish`).set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "kv4-overview-publish-v1").expect(201);
    // Correction v2 published, then a v3 draft that must stay invisible.
    await request(server).put(`/grade-assessments/${id}/entries`).set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 75, absent: false }] }).expect(200);
    await request(server).post(`/grade-assessments/${id}/publish`).set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "kv4-overview-publish-v2").expect(201);
    await request(server).put(`/grade-assessments/${id}/entries`).set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 99, absent: false }] }).expect(200);
    await request(server).put(`/grade-assessments/${draftOnlyId}/entries`).set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 98, absent: false }] }).expect(200);

    const body = (await getOverview(guardian).expect(200)).body as GuardianStudentOverview;
    const grades = body.schoolGrades.filter((grade) => grade.title.startsWith("KV4"));
    expect(grades).toEqual([
      expect.objectContaining({ assessmentId: id, score: 75, maxScore: 100, version: 2, absent: false, courseId: "course-math" }),
    ]);
    expect(body.schoolGrades.some((grade) => grade.score === 99 || grade.score === 98)).toBe(false);
    expect(Array.isArray(body.examSeries)).toBe(true);
    expect(JSON.stringify(body.examSeries)).not.toContain(id);
  });

  it("rejects unlinked, other-tenant and missing students and non-guardian roles", async () => {
    const unlinked = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "BagliDegil", lastName: "Ogrenci", gradeLevelId: "grade-8" })
      .expect(201);
    const unlinkedId = (unlinked.body as { id: string }).id;

    const unlinkedResponse = await getOverview(guardian, unlinkedId).expect(403);
    expect(JSON.stringify(unlinkedResponse.body)).not.toContain("BagliDegil");
    const otherTenant = await getOverview(guardian, "student-b");
    expect([403, 404]).toContain(otherTenant.status);
    expect(JSON.stringify(otherTenant.body)).not.toContain("student-b");
    await getOverview(guardian, "student-does-not-exist").expect(404);

    for (const token of [student, teacher, admin, tenantBAdmin]) {
      await getOverview(token).expect(403);
    }
  });

  it("omits the finance block when the link has canViewFinance=false", async () => {
    expect(((await getOverview(guardian).expect(200)).body as GuardianStudentOverview).finance).toBeDefined();
    await request(server)
      .patch("/guardians/guardian-a/students/student-a")
      .set("Authorization", `Bearer ${admin}`)
      .send({ canViewFinance: false })
      .expect(200);

    const body = (await getOverview(guardian).expect(200)).body as GuardianStudentOverview;
    expect(Object.keys(body)).not.toContain("finance");
    expect(JSON.stringify(body)).not.toContain("payment-plan");
  });
});
