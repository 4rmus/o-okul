import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { isSystemAdmin } from "../rbac/roles.js";
import type { TeacherAssignmentStore } from "./teacher-assignment-store.js";
import type { TeacherAssignmentRecord } from "@o-okul/shared-types";

export interface TeacherAssignmentScope {
  tenantId: string;
  classId?: string;
  studentId?: string;
  courseId?: string;
  termId?: string;
}

export async function assertTeacherAssigned(
  context: RequestContext,
  assignments: TeacherAssignmentStore,
  scope: TeacherAssignmentScope,
  referenceDate = new Date().toISOString().slice(0, 10),
): Promise<void> {
  if (canBypassTeacherAssignment(context)) return;
  assertTeacherContextAndScope(context, scope);

  const teacherAssignments = await assignments.listByTeacher(context.subjectId);
  assertTeacherAssignedFromRecords(context, teacherAssignments, scope, referenceDate);
}

export function assertTeacherAssignedFromRecords(
  context: RequestContext,
  assignments: TeacherAssignmentRecord[],
  scope: TeacherAssignmentScope,
  referenceDate = new Date().toISOString().slice(0, 10),
): void {
  if (canBypassTeacherAssignment(context)) return;
  assertTeacherContextAndScope(context, scope);
  const allowed = hasTeacherAssignmentForScope(assignments, scope, referenceDate);

  if (!allowed) {
    throw new ForbiddenException("FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE");
  }
}

function canBypassTeacherAssignment(context: RequestContext): boolean {
  return (context.bypassRls && isSystemAdmin(context.roles)) ||
    context.roles.includes("TENANT_ADMIN") ||
    context.roles.includes("ASSISTANT_ADMIN");
}

function assertTeacherContextAndScope(context: RequestContext, scope: TeacherAssignmentScope): asserts context is RequestContext & { subjectId: string } {
  if (context.subjectType !== "TEACHER" || !context.subjectId) {
    throw new ForbiddenException("TEACHER_CONTEXT_REQUIRED");
  }
  if (!scope.classId && !scope.studentId && !scope.courseId) {
    throw new BadRequestException("TEACHER_ASSIGNMENT_SCOPE_REQUIRED");
  }
}

export function hasTeacherAssignmentForScope(
  assignments: TeacherAssignmentRecord[],
  scope: TeacherAssignmentScope,
  referenceDate: string,
): boolean {
  return assignments.some((assignment) => {
    if (assignment.tenantId !== scope.tenantId) return false;
    if (assignment.startsAt && assignment.startsAt > referenceDate) return false;
    if (assignment.endsAt && assignment.endsAt < referenceDate) return false;
    if (scope.termId && assignment.termId && assignment.termId !== scope.termId) return false;
    if (scope.courseId && assignment.courseId && assignment.courseId !== scope.courseId) return false;
    if (scope.studentId && assignment.studentId === scope.studentId) return true;
    if (scope.classId && assignment.classId === scope.classId) return true;
    return Boolean(scope.courseId && assignment.courseId === scope.courseId);
  });
}
