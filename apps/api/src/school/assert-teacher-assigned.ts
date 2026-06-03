import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { isSystemAdmin } from "../rbac/roles.js";
import type { TeacherAssignmentStore } from "./teacher-assignment-store.js";

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
): Promise<void> {
  if (context.bypassRls && isSystemAdmin(context.roles)) {
    return;
  }
  if (context.roles.includes("TENANT_ADMIN") || context.roles.includes("ASSISTANT_ADMIN")) {
    return;
  }
  if (context.subjectType !== "TEACHER" || !context.subjectId) {
    throw new ForbiddenException("TEACHER_CONTEXT_REQUIRED");
  }
  if (!scope.classId && !scope.studentId && !scope.courseId) {
    throw new BadRequestException("TEACHER_ASSIGNMENT_SCOPE_REQUIRED");
  }

  const teacherAssignments = await assignments.listByTeacher(context.subjectId);
  const allowed = teacherAssignments.some((assignment) => {
    if (assignment.tenantId !== scope.tenantId) return false;
    if (scope.termId && assignment.termId && assignment.termId !== scope.termId) return false;
    if (scope.courseId && assignment.courseId && assignment.courseId !== scope.courseId) return false;
    if (scope.studentId && assignment.studentId === scope.studentId) return true;
    if (scope.classId && assignment.classId === scope.classId) return true;
    return Boolean(scope.courseId && assignment.courseId === scope.courseId);
  });

  if (!allowed) {
    throw new ForbiddenException("FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE");
  }
}
