import type { RequestContext } from "../context/request-context.js";
import { isSystemAdmin } from "../rbac/roles.js";

export interface TenantResource {
  tenantId: string;
}

export interface SubjectResource extends TenantResource {
  studentId?: string;
  guardianId?: string;
  guardianIds?: string[];
  teacherId?: string;
}

export interface TeacherScopedStudentResource extends TenantResource {
  responsibleTeacherId?: string;
}

export function assertTenantResourceAccess(context: RequestContext, resource: TenantResource): void {
  if (context.bypassRls && isSystemAdmin(context.roles)) {
    return;
  }

  if (!context.tenantId) {
    throw new Error("TENANT_CONTEXT_MISSING");
  }

  if (context.tenantId !== resource.tenantId) {
    throw new Error("FORBIDDEN_TENANT");
  }
}

export function assertSubjectResourceAccess(context: RequestContext, resource: SubjectResource): void {
  assertTenantResourceAccess(context, resource);

  if (context.bypassRls && isSystemAdmin(context.roles)) {
    return;
  }

  if (context.roles.includes("TENANT_ADMIN")) {
    return;
  }

  if (!context.subjectType || !context.subjectId) {
    throw new Error("SUBJECT_CONTEXT_MISSING");
  }

  if (context.roles.includes("STUDENT") && context.subjectType === "STUDENT") {
    assertMatchingSubject(resource.studentId, context.subjectId);
    return;
  }

  if (context.roles.includes("GUARDIAN") && context.subjectType === "GUARDIAN") {
    const guardianIds = resource.guardianIds ?? (resource.guardianId ? [resource.guardianId] : []);
    assertMatchingSubjectList(guardianIds, context.subjectId);
    return;
  }

  if (context.roles.includes("TEACHER") && context.subjectType === "TEACHER") {
    assertMatchingSubject(resource.teacherId, context.subjectId);
    return;
  }

  throw new Error("FORBIDDEN_SUBJECT");
}

export function filterTenantResources<T extends TenantResource>(context: RequestContext, resources: T[]): T[] {
  if (context.bypassRls && isSystemAdmin(context.roles)) {
    return resources;
  }

  if (!context.tenantId) {
    throw new Error("TENANT_CONTEXT_MISSING");
  }

  return resources.filter((resource) => resource.tenantId === context.tenantId);
}

export function assertTeacherScopedStudentAccess(context: RequestContext, resource: TeacherScopedStudentResource): void {
  assertTenantResourceAccess(context, resource);

  if (context.bypassRls && isSystemAdmin(context.roles)) {
    return;
  }

  if (context.roles.includes("TENANT_ADMIN")) {
    return;
  }

  if (!isTeacherSubjectContext(context)) {
    throw new Error("FORBIDDEN_SUBJECT");
  }

  assertMatchingSubject(resource.responsibleTeacherId, context.subjectId);
}

export function filterTeacherScopedStudents<T extends TeacherScopedStudentResource>(
  context: RequestContext,
  resources: T[],
): T[] {
  const tenantResources = filterTenantResources(context, resources);

  if (context.bypassRls && isSystemAdmin(context.roles)) {
    return tenantResources;
  }

  if (context.roles.includes("TENANT_ADMIN")) {
    return tenantResources;
  }

  if (!isTeacherSubjectContext(context)) {
    return tenantResources;
  }

  return tenantResources.filter((resource) => resource.responsibleTeacherId === context.subjectId);
}

export function isTeacherSubjectContext(
  context: RequestContext,
): context is RequestContext & { subjectType: "TEACHER"; subjectId: string } {
  return context.roles.includes("TEACHER") && context.subjectType === "TEACHER" && Boolean(context.subjectId);
}

function assertMatchingSubject(resourceSubjectId: string | undefined, contextSubjectId: string): void {
  if (resourceSubjectId !== contextSubjectId) {
    throw new Error("FORBIDDEN_SUBJECT");
  }
}

function assertMatchingSubjectList(resourceSubjectIds: string[], contextSubjectId: string): void {
  if (!resourceSubjectIds.includes(contextSubjectId)) {
    throw new Error("FORBIDDEN_SUBJECT");
  }
}
