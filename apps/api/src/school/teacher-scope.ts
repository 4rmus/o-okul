import { ForbiddenException } from "@nestjs/common";
import type { GuardianStudentRecord, StudentRecord, TeacherAssignmentRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { assertTeacherScopedStudentAccess, filterTenantResources, isTeacherSubjectContext } from "../tenant/tenant-access.js";
import type { StudentStore } from "../student/student-store.js";
import type { GuardianStudentStore } from "./guardian-student-store.js";
import type { TeacherAssignmentStore } from "./teacher-assignment-store.js";

export function isAssignmentActive(assignment: Pick<TeacherAssignmentRecord, "startsAt" | "endsAt">): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return (!assignment.startsAt || assignment.startsAt <= today) && (!assignment.endsAt || assignment.endsAt >= today);
}

export function shouldLimitToTeacherScope(
  context: RequestContext,
): context is RequestContext & { subjectType: "TEACHER"; subjectId: string } {
  return isTeacherSubjectContext(context) &&
    !context.roles.includes("TENANT_ADMIN") &&
    !context.roles.includes("ASSISTANT_ADMIN");
}

export async function assertTeacherScopedStudent(
  context: RequestContext,
  teacherAssignmentStore: TeacherAssignmentStore,
  resource: { tenantId: string; responsibleTeacherId?: string; id?: string; classId?: string },
): Promise<void> {
  try {
    assertTeacherScopedStudentAccess(context, resource);
  } catch (error) {
    if (await hasTeacherAssignmentScope(context, teacherAssignmentStore, resource)) {
      return;
    }
    const message = error instanceof Error ? error.message : "FORBIDDEN_SUBJECT";
    throw new ForbiddenException(message);
  }
}

async function hasTeacherAssignmentScope(
  context: RequestContext,
  teacherAssignmentStore: TeacherAssignmentStore,
  resource: { tenantId: string; id?: string; classId?: string },
): Promise<boolean> {
  if (context.roles.includes("TENANT_ADMIN") || !context.subjectId || context.subjectType !== "TEACHER") {
    return false;
  }

  const assignments = await teacherAssignmentStore.listByTeacher(context.subjectId);
  return filterTenantResources(context, assignments).some((assignment) =>
    isAssignmentActive(assignment) &&
    (assignment.studentId === resource.id || Boolean(resource.classId && assignment.classId === resource.classId)),
  );
}

export async function listTeacherScopedStudents(
  context: RequestContext,
  studentStore: StudentStore,
  teacherAssignmentStore: TeacherAssignmentStore,
): Promise<StudentRecord[]> {
  const students = filterTenantResources(context, await studentStore.list());
  if (!shouldLimitToTeacherScope(context)) {
    return students;
  }

  const assignments = filterTenantResources(context, await teacherAssignmentStore.listByTeacher(context.subjectId));
  return students.filter((student) =>
    student.responsibleTeacherId === context.subjectId ||
    assignments.some((assignment) =>
      isAssignmentActive(assignment) &&
      (assignment.studentId === student.id || Boolean(student.classId && assignment.classId === student.classId)),
    ),
  );
}

export async function listTeacherScopedGuardianIds(
  context: RequestContext,
  studentStore: StudentStore,
  teacherAssignmentStore: TeacherAssignmentStore,
  guardianStudentStore: GuardianStudentStore,
): Promise<Set<string>> {
  const students = await listTeacherScopedStudents(context, studentStore, teacherAssignmentStore);
  const links = await Promise.all(
    students.map((student) => guardianStudentStore.listByStudent(student.id)),
  );
  return new Set(
    links
      .flat()
      .filter((link) => link.tenantId === context.tenantId)
      .map((link) => link.guardianId),
  );
}

export async function assertGuardianTeacherScope(
  context: RequestContext,
  studentStore: StudentStore,
  teacherAssignmentStore: TeacherAssignmentStore,
  guardianStudentStore: GuardianStudentStore,
  guardianId: string,
): Promise<void> {
  if (!shouldLimitToTeacherScope(context)) {
    return;
  }

  const guardianIds = await listTeacherScopedGuardianIds(context, studentStore, teacherAssignmentStore, guardianStudentStore);
  if (!guardianIds.has(guardianId)) {
    throw new ForbiddenException("FORBIDDEN_SUBJECT");
  }
}

export async function filterGuardianStudentLinksByTeacherScope(
  context: RequestContext,
  studentStore: StudentStore,
  teacherAssignmentStore: TeacherAssignmentStore,
  links: GuardianStudentRecord[],
): Promise<GuardianStudentRecord[]> {
  if (!shouldLimitToTeacherScope(context)) {
    return links;
  }

  const studentIds = new Set((await listTeacherScopedStudents(context, studentStore, teacherAssignmentStore)).map((student) => student.id));
  return links.filter((link) => studentIds.has(link.studentId));
}
