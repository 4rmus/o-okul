import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StudentSelfOverview } from "@o-okul/shared-types";
import { AppModule } from "../app.module.js";
import { testLoginBody } from "../test-auth.js";

const overviewKeys = ["attendance", "examSeries", "homework", "schoolGrades"];

describe("Student self overview (Gelişimim)", () => {
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

  function getOverview(token: string, query = "") {
    return request(server).get(`/me/student/overview${query}`).set("Authorization", `Bearer ${token}`);
  }

  it("returns only allow-listed fields: no guardian, finance, contact or teacher note data", async () => {
    await request(server)
      .post("/teacher-notes")
      .set("Authorization", `Bearer ${teacher}`)
      .send({ studentId: "student-a", visibility: "GUARDIAN_STUDENT", body: "OGRETMEN-NOTU-GELISIMIM" })
      .expect(201);
    await request(server)
      .post("/students/student-a/contacts")
      .set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "gelisimim-overview-contact-a")
      .send({ firstName: "IletisimGelisimim", lastName: "Kisi", relationType: "MOTHER", phone: "5550004501", email: "iletisim-gelisimim@example.test" })
      .expect(201);

    const body = (await getOverview(student).expect(200)).body as StudentSelfOverview;

    expect(Object.keys(body).sort()).toEqual(overviewKeys);
    expect(Object.keys(body.attendance).sort()).toEqual(["absent", "excused", "late", "present", "total"]);
    expect(Object.keys(body.homework).sort()).toEqual(["materialAssignmentCount", "openClassHomeworkCount"]);
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "OGRETMEN-NOTU-GELISIMIM",
      "IletisimGelisimim",
      "5550004501",
      "iletisim-gelisimim",
      "finance",
      "canViewFinance",
      "guardian",
      "contacts",
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

  it("counts open class homework and material assignments of the signed-in student only", async () => {
    const before = (await getOverview(student).expect(200)).body as StudentSelfOverview;
    const classmate = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "SinifArkadasi", lastName: "Gelisimim", gradeLevelId: "grade-8", classId: "class-a" })
      .expect(201);
    const classmateId = (classmate.body as { id: string }).id;

    await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${admin}`)
      .send({ studentId: classmateId, note: "Yalniz arkadasa", dueAt: "2026-06-10T12:00:00.000Z" })
      .expect(201);
    const afterOther = (await getOverview(student).expect(200)).body as StudentSelfOverview;
    expect(afterOther.homework.materialAssignmentCount).toBe(before.homework.materialAssignmentCount);

    await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${admin}`)
      .send({ studentId: "student-a", note: "Gelisimim tekrar", dueAt: "2026-06-10T12:00:00.000Z" })
      .expect(201);
    const homework = await request(server)
      .post("/homework")
      .set("Authorization", `Bearer ${admin}`)
      .send({ classId: "class-a", title: "Gelisimim Sinif Odevi", description: "Sayfa 12", dueAt: "2026-06-12T12:00:00.000Z" })
      .expect(201);
    const homeworkId = (homework.body as { id: string }).id;

    const afterOwn = (await getOverview(student).expect(200)).body as StudentSelfOverview;
    expect(afterOwn.homework.materialAssignmentCount).toBe(before.homework.materialAssignmentCount + 1);
    expect(afterOwn.homework.openClassHomeworkCount).toBe(before.homework.openClassHomeworkCount + 1);

    await request(server)
      .post(`/me/student/homework/${homeworkId}/submission`)
      .set("Authorization", `Bearer ${student}`)
      .set("Idempotency-Key", "gelisimim-overview-submission-a")
      .expect(201);
    const afterSubmit = (await getOverview(student).expect(200)).body as StudentSelfOverview;
    expect(afterSubmit.homework.openClassHomeworkCount).toBe(before.homework.openClassHomeworkCount);
  });

  it("shows only the student's own current published grade version, never a draft or a classmate's score", async () => {
    const classmate = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "NotArkadasi", lastName: "Gelisimim", gradeLevelId: "grade-8", classId: "class-a" })
      .expect(201);
    const classmateId = (classmate.body as { id: string }).id;
    const created = await request(server)
      .post("/grade-assessments")
      .set("Authorization", `Bearer ${admin}`)
      .send({ classId: "class-a", courseId: "course-math", termId: "term-2026-spring", kind: "WRITTEN", title: "GLS Yazılı", heldOn: "2026-03-20", maxScore: 50 })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const draftOnly = await request(server)
      .post("/grade-assessments")
      .set("Authorization", `Bearer ${admin}`)
      .send({ classId: "class-a", courseId: "course-math", termId: "term-2026-spring", kind: "WRITTEN", title: "GLS Taslak", heldOn: "2026-03-21" })
      .expect(201);
    const draftOnlyId = (draftOnly.body as { id: string }).id;

    await request(server).put(`/grade-assessments/${id}/entries`).set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 31, absent: false }, { studentId: classmateId, score: 47.5, absent: false }] }).expect(200);
    await request(server).post(`/grade-assessments/${id}/publish`).set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "gelisimim-publish-v1").expect(201);
    // Correction v2 published; a later v3 draft must stay invisible (ADR-0011: published rows are never edited in place).
    await request(server).put(`/grade-assessments/${id}/entries`).set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 33, absent: false }] }).expect(200);
    await request(server).post(`/grade-assessments/${id}/publish`).set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "gelisimim-publish-v2").expect(201);
    await request(server).put(`/grade-assessments/${id}/entries`).set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 49, absent: false }] }).expect(200);
    await request(server).put(`/grade-assessments/${draftOnlyId}/entries`).set("Authorization", `Bearer ${teacher}`)
      .send({ entries: [{ studentId: "student-a", score: 48, absent: false }] }).expect(200);

    // A smuggled studentId query is ignored: the student id only ever comes from the session.
    const body = (await getOverview(student, `?studentId=${encodeURIComponent(classmateId)}`).expect(200)).body as StudentSelfOverview;
    const grades = body.schoolGrades.filter((grade) => grade.title.startsWith("GLS"));
    expect(grades).toEqual([
      expect.objectContaining({ assessmentId: id, score: 33, maxScore: 50, version: 2, absent: false, courseId: "course-math" }),
    ]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(classmateId);
    expect(body.schoolGrades.some((grade) => [47.5, 49, 48].includes(grade.score as number))).toBe(false);
    expect(JSON.stringify(body.examSeries)).not.toContain(id);
  });

  it("rejects every non-student persona and other tenants", async () => {
    for (const token of [guardian, teacher, admin, tenantBAdmin]) {
      const response = await getOverview(token).expect(403);
      expect(JSON.stringify(response.body)).not.toContain("schoolGrades");
    }
    await request(server).get("/me/student/overview").expect(401);
  });
});
