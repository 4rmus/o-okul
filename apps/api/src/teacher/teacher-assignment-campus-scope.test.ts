import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService, InMemoryIdempotencyStore } from "../http/idempotency.js";
import { InMemoryAcademicCalendarStore } from "../school/academic-calendar-store.js";
import { InMemoryAlanStore } from "../school/alan-store.js";
import { InMemoryCampusStore } from "../school/campus-store.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryCourseStore } from "../school/course-store.js";
import { InMemoryGradeLevelCourseStore } from "../school/grade-level-course-store.js";
import { InMemoryGradeLevelStore } from "../school/grade-level-store.js";
import { InMemoryLearningOutcomeStore } from "../school/learning-outcome-store.js";
import { SchoolService } from "../school/school.service.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryTeacherStore } from "../school/teacher-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { TeacherService } from "./teacher.service.js";

const admin: RequestContext = { userId: "admin", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false };
const scoped: RequestContext = {
  ...admin, userId: "operations-main", roles: ["OPERATIONS_STAFF"], activePersona: "STAFF",
  campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
};

async function setup() {
  const teachers = new InMemoryTeacherStore();
  const students = new InMemoryStudentStore();
  const classes = new InMemoryClassStore();
  const assignments = new InMemoryTeacherAssignmentStore();
  const gradeCourses = new InMemoryGradeLevelCourseStore();
  const school = new SchoolService(new InMemoryAcademicCalendarStore(), new InMemoryAlanStore(), new InMemoryCampusStore(), classes,
    new InMemoryCourseStore(), gradeCourses, new InMemoryGradeLevelStore(), new InMemoryLearningOutcomeStore(), assignments);
  const otherClass = await classes.create({ tenantId: "tenant-a", name: "Other", campusId: "campus-other", gradeLevelId: "grade-8" });
  const foreignStudent = await students.create({ tenantId: "tenant-a", firstName: "Other", lastName: "Student", classId: otherClass.id });
  const unplaced = await students.create({ tenantId: "tenant-a", firstName: "Unplaced", lastName: "Student" });
  const otherAssignment = await assignments.create({ tenantId: "tenant-a", teacherId: "teacher-a", classId: otherClass.id, role: "CLASS_TEACHER" });
  const studentAssignment = await assignments.create({ tenantId: "tenant-a", teacherId: "teacher-a", studentId: foreignStudent.id, role: "RESPONSIBLE_TEACHER" });
  const mixedAssignment = await assignments.create({ tenantId: "tenant-a", teacherId: "teacher-a", classId: "class-a", studentId: foreignStudent.id, role: "RESPONSIBLE_TEACHER" });
  const unplacedAssignment = await assignments.create({ tenantId: "tenant-a", teacherId: "teacher-a", studentId: unplaced.id, role: "RESPONSIBLE_TEACHER" });
  const service = new TeacherService(teachers, assignments, students, gradeCourses, school, undefined, undefined,
    new IdempotencyService(new InMemoryIdempotencyStore()));
  return { service, assignments, classes, students, otherClass, foreignStudent, unplaced, otherAssignment, studentAssignment, mixedAssignment, unplacedAssignment };
}

describe("teacher assignment campus scope", () => {
  it("filters assignment detail and summary to rows whose every target is in scope", async () => {
    const f = await setup();
    expect((await f.service.listTeacherAssignments(scoped, "teacher-a")).map((row) => row.id)).toEqual(["teacher-assignment-class-a", "teacher-assignment-student-a"]);
    expect((await f.service.summarizeTeacherAssignments(scoped, ["teacher-a"])).get("teacher-a"))
      .toEqual({ total: 2, classCount: 1, studentCount: 1, courseCount: 0 });
    await expect(f.service.listStudentTeacherAssignments(scoped, f.foreignStudent.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await f.service.listStudentTeacherAssignments(scoped, "student-a")).map((row) => row.id))
      .toEqual(["teacher-assignment-class-a", "teacher-assignment-student-a"]);
  });

  it("validates class and student targets even when courseId is omitted", async () => {
    const f = await setup();
    const before = await f.assignments.listByTeacher("teacher-a");
    for (const target of [
      { classId: f.otherClass.id }, { studentId: f.foreignStudent.id }, { classId: "class-a", studentId: f.foreignStudent.id },
      { studentId: f.unplaced.id }, { studentId: "student-b" }, { classId: "missing-class" }, { studentId: "missing-student" },
    ]) await expect(f.service.createTeacherAssignment(scoped, "teacher-a", target)).rejects.toThrow();
    expect(await f.assignments.listByTeacher("teacher-a")).toEqual(before);
    await expect(f.service.createTeacherAssignment(scoped, "teacher-a", { classId: "class-a" })).resolves.toMatchObject({ classId: "class-a" });
    await expect(f.service.createTeacherAssignment(scoped, "teacher-a", { studentId: "student-a" })).resolves.toMatchObject({ studentId: "student-a" });
  });

  it("checks both the existing row and replacement targets before update or delete", async () => {
    const f = await setup();
    for (const row of [f.otherAssignment, f.studentAssignment, f.mixedAssignment, f.unplacedAssignment]) {
      await expect(f.service.updateTeacherAssignment(scoped, "teacher-a", row.id, { role: "GUIDANCE_COUNSELOR" })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(f.service.updateTeacherAssignment(scoped, "teacher-a", row.id, { classId: "class-a", studentId: "student-a" })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(f.service.deleteTeacherAssignment(scoped, "teacher-a", row.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await f.assignments.findById(row.id)).toEqual(row);
    }
    await expect(f.service.updateTeacherAssignment(scoped, "teacher-a", "teacher-assignment-class-a", { classId: f.otherClass.id })).rejects.toThrow();
    await expect(f.service.updateTeacherAssignment(scoped, "teacher-a", "teacher-assignment-student-a", { studentId: f.foreignStudent.id })).rejects.toThrow();
    await expect(f.service.updateTeacherAssignment(scoped, "teacher-a", "teacher-assignment-class-a", { role: "GUIDANCE_COUNSELOR" })).resolves.toMatchObject({ role: "GUIDANCE_COUNSELOR" });
    await f.service.deleteTeacherAssignment(scoped, "teacher-a", "teacher-assignment-student-a");
    expect(await f.assignments.findById("teacher-assignment-student-a")).toBeUndefined();
  });

  it("fails closed for operations staff without campus scope", async () => {
    const f = await setup();
    const missing = { ...scoped, campusScope: undefined };
    for (const run of [
      () => f.service.listTeacherAssignments(missing, "teacher-a"),
      () => f.service.summarizeTeacherAssignments(missing, ["teacher-a"]),
      () => f.service.listStudentTeacherAssignments(missing, "student-a"),
      () => f.service.createTeacherAssignment(missing, "teacher-a", { classId: "class-a" }),
      () => f.service.updateTeacherAssignment(missing, "teacher-a", "teacher-assignment-class-a", { role: "CLASS_TEACHER" }),
      () => f.service.deleteTeacherAssignment(missing, "teacher-a", "teacher-assignment-class-a"),
    ]) await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps tenant-wide and teacher reads and tenant-wide cross-campus writes", async () => {
    const f = await setup();
    const tenantOps = { ...scoped, campusScope: { scopeMode: "TENANT" as const, campusIds: [] } };
    expect((await f.service.listTeacherAssignments(tenantOps, "teacher-a")).map((row) => row.id)).toContain(f.otherAssignment.id);
    await expect(f.service.createTeacherAssignment(tenantOps, "teacher-a", { studentId: f.foreignStudent.id })).resolves.toMatchObject({ studentId: f.foreignStudent.id });
    await expect(f.service.updateTeacherAssignment(tenantOps, "teacher-a", f.otherAssignment.id, { role: "GUIDANCE_COUNSELOR" })).resolves.toMatchObject({ role: "GUIDANCE_COUNSELOR" });
    await f.service.deleteTeacherAssignment(tenantOps, "teacher-a", f.otherAssignment.id);
    const teacher = { ...admin, roles: ["TEACHER"], subjectType: "TEACHER" as const, subjectId: "teacher-a" };
    expect((await f.service.listStudentTeacherAssignments(teacher, "student-a")).length).toBeGreaterThan(0);
  });

  it("reauthorizes assignment targets on idempotent replay and binds keys to the actor", async () => {
    const f = await setup();
    const created = await f.service.createTeacherAssignment(scoped, "teacher-a", { classId: "class-a" }, "assignment-create");
    await expect(f.service.createTeacherAssignment(scoped, "teacher-a", { classId: "class-a" }, "assignment-create")).resolves.toMatchObject({ id: created.id });
    await expect(f.service.createTeacherAssignment({ ...scoped, userId: "other-operator" }, "teacher-a", { classId: "class-a" }, "assignment-create")).rejects.toThrow();
    const movedScope = { ...scoped, campusScope: { scopeMode: "CAMPUSES" as const, campusIds: ["campus-other"] } };
    await expect(f.service.createTeacherAssignment(movedScope, "teacher-a", { classId: "class-a" }, "assignment-create")).rejects.toThrow();
  });
});
