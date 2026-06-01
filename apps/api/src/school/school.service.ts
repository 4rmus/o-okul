import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  ClassRecord as SharedClassRecord,
  GuardianRecord as SharedGuardianRecord,
  GuardianRelationshipType,
  GuardianStudentRecord,
  TeacherAssignmentRecord,
  TeacherAssignmentRole,
  TeacherRecord as SharedTeacherRecord,
} from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { assertTeacherScopedStudentAccess, assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { type ClassStore, classStoreToken } from "./class-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "./guardian-student-store.js";
import { type GuardianStore, guardianStoreToken } from "./guardian-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import {
  type TeacherAssignmentInput,
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "./teacher-assignment-store.js";
import { type TeacherStore, teacherStoreToken } from "./teacher-store.js";

export interface ClassRecord extends SharedClassRecord {
  deletedAt?: string;
}

export interface TeacherRecord extends SharedTeacherRecord {
  deletedAt?: string;
}

export interface GuardianRecord extends SharedGuardianRecord {
  deletedAt?: string;
}

type SchoolRecord = ClassRecord | TeacherRecord | GuardianRecord;

export type GuardianStudentRelationInput = Partial<Pick<
  GuardianStudentRecord,
  "relationshipType" | "isPrimary" | "canViewFinance" | "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets"
>>;

export type TeacherAssignmentRelationInput = Partial<Pick<
  TeacherAssignmentRecord,
  "classId" | "studentId" | "courseId" | "role" | "startsAt" | "endsAt"
>>;

const guardianRelationshipTypes: GuardianRelationshipType[] = ["MOTHER", "FATHER", "GUARDIAN", "EMERGENCY_CONTACT", "OTHER"];
const teacherAssignmentRoles: TeacherAssignmentRole[] = ["CLASS_TEACHER", "BRANCH_TEACHER", "GUIDANCE_COUNSELOR", "RESPONSIBLE_TEACHER"];

@Injectable()
export class SchoolService {
  constructor(
    @Inject(classStoreToken) private readonly classStore: ClassStore,
    @Inject(teacherStoreToken) private readonly teacherStore: TeacherStore,
    @Inject(guardianStoreToken) private readonly guardianStore: GuardianStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async listClasses(context: RequestContext): Promise<ClassRecord[]> {
    return this.list(context, await this.classStore.list());
  }

  async findClass(context: RequestContext, id: string): Promise<ClassRecord> {
    return this.find(context, await this.classStore.list(), id, "CLASS_NOT_FOUND");
  }

  async createClass(context: RequestContext, input: Partial<ClassRecord>): Promise<ClassRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const record = await this.classStore.create({
      tenantId,
      name: input.name ?? "",
      level: input.level,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Class",
      entityId: record.id,
      action: "class.created",
      diff: { name: record.name, level: record.level },
    });
    return record;
  }

  async updateClass(context: RequestContext, id: string, input: Partial<ClassRecord>): Promise<ClassRecord> {
    const existing = await this.findClass(context, id);
    const previousState = { name: existing.name, level: existing.level };
    const record = await this.classStore.update(id, { name: input.name, level: input.level });
    if (!record) {
      throw new NotFoundException("CLASS_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Class",
      entityId: record.id,
      action: "class.updated",
      diff: {
        before: previousState,
        after: { name: record.name, level: record.level },
      },
    });
    return record;
  }

  async deleteClass(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findClass(context, id);
    const record = await this.classStore.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("CLASS_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Class",
      entityId: record.id,
      action: "class.deleted",
      diff: { name: existing.name, deletedAt: record.deletedAt },
    });
  }

  async listTeachers(context: RequestContext): Promise<TeacherRecord[]> {
    return this.list(context, await this.teacherStore.list());
  }

  async findTeacher(context: RequestContext, id: string): Promise<TeacherRecord> {
    return this.findRecord(context, await this.teacherStore.findById(id), "TEACHER_NOT_FOUND");
  }

  async findCurrentTeacher(context: RequestContext): Promise<TeacherRecord> {
    if (context.subjectType !== "TEACHER" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.findTeacher(context, context.subjectId);
  }

  async createTeacher(context: RequestContext, input: Partial<TeacherRecord>): Promise<TeacherRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const record = await this.teacherStore.create({
      tenantId,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      branch: input.branch,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Teacher",
      entityId: record.id,
      action: "teacher.created",
      diff: { fieldsSet: presentFields(record, ["firstName", "lastName", "branch"]) },
    });
    return record;
  }

  async updateTeacher(context: RequestContext, id: string, input: Partial<TeacherRecord>): Promise<TeacherRecord> {
    await this.findTeacher(context, id);
    const changedFields = changedInputFields(input, ["firstName", "lastName", "branch"]);
    const record = await this.teacherStore.update(id, {
      firstName: input.firstName,
      lastName: input.lastName,
      branch: input.branch,
    });
    if (!record) {
      throw new NotFoundException("TEACHER_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Teacher",
      entityId: record.id,
      action: "teacher.updated",
      diff: { fieldsChanged: changedFields },
    });
    this.assertAccess(context, record);
    return record;
  }

  async deleteTeacher(context: RequestContext, id: string): Promise<void> {
    await this.findTeacher(context, id);
    const record = await this.teacherStore.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("TEACHER_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Teacher",
      entityId: record.id,
      action: "teacher.deleted",
      diff: { deletedAt: record.deletedAt },
    });
  }

  async purgeTeacherPii(context: RequestContext, id: string): Promise<TeacherRecord> {
    const existing = await this.findTeacher(context, id);
    const hadFirstName = existing.firstName.length > 0;
    const hadLastName = existing.lastName.length > 0;
    const record = await this.teacherStore.purgePii(id);
    if (!record) {
      throw new NotFoundException("TEACHER_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Teacher",
      entityId: record.id,
      action: "kvkk.teacher_pii_purged",
      diff: {
        fieldsPurged: ["firstName", "lastName"],
        before: { firstNamePresent: hadFirstName, lastNamePresent: hadLastName },
      },
    });
    return record;
  }

  async listTeacherAssignments(context: RequestContext, teacherId: string): Promise<TeacherAssignmentRecord[]> {
    const teacher = await this.findTeacher(context, teacherId);
    return filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(teacher.id));
  }

  async listStudentTeacherAssignments(context: RequestContext, studentId: string): Promise<TeacherAssignmentRecord[]> {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.assertTeacherScope(context, student);

    return filterTenantResources(context, await this.teacherAssignmentStore.list()).filter((assignment) =>
      assignment.studentId === student.id || Boolean(student.classId && assignment.classId === student.classId),
    );
  }

  async createTeacherAssignment(
    context: RequestContext,
    teacherId: string,
    input: TeacherAssignmentRelationInput,
  ): Promise<TeacherAssignmentRecord> {
    const teacher = await this.findTeacher(context, teacherId);
    const assignmentInput = this.resolveTeacherAssignmentInput(teacher, input) as TeacherAssignmentInput;
    const record = await this.teacherAssignmentStore.create(assignmentInput);
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "TeacherAssignment",
      entityId: record.id,
      action: "teacher_assignment.created",
      diff: { teacherId: record.teacherId, fieldsSet: presentFields(assignmentInput, teacherAssignmentRelationFields) },
    });
    return record;
  }

  async updateTeacherAssignment(
    context: RequestContext,
    teacherId: string,
    assignmentId: string,
    input: TeacherAssignmentRelationInput,
  ): Promise<TeacherAssignmentRecord> {
    const teacher = await this.findTeacher(context, teacherId);
    const existing = await this.teacherAssignmentStore.findById(assignmentId);
    if (!existing || existing.teacherId !== teacher.id) {
      throw new NotFoundException("TEACHER_ASSIGNMENT_NOT_FOUND");
    }
    this.assertAccess(context, existing);

    const assignmentInput = this.resolveTeacherAssignmentInput(teacher, input, false);
    const record = await this.teacherAssignmentStore.update(assignmentId, assignmentInput);
    if (!record) {
      throw new NotFoundException("TEACHER_ASSIGNMENT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "TeacherAssignment",
      entityId: record.id,
      action: "teacher_assignment.updated",
      diff: { teacherId: record.teacherId, fieldsChanged: changedInputFields(assignmentInput, teacherAssignmentRelationFields) },
    });
    return record;
  }

  async deleteTeacherAssignment(context: RequestContext, teacherId: string, assignmentId: string): Promise<void> {
    const teacher = await this.findTeacher(context, teacherId);
    const existing = await this.teacherAssignmentStore.findById(assignmentId);
    if (!existing || existing.teacherId !== teacher.id) {
      throw new NotFoundException("TEACHER_ASSIGNMENT_NOT_FOUND");
    }
    this.assertAccess(context, existing);

    const deleted = await this.teacherAssignmentStore.delete(assignmentId);
    if (!deleted) {
      throw new NotFoundException("TEACHER_ASSIGNMENT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: existing.tenantId,
      actorUserId: context.userId,
      entityType: "TeacherAssignment",
      entityId: existing.id,
      action: "teacher_assignment.deleted",
      diff: { teacherId: existing.teacherId },
    });
  }

  async listGuardians(context: RequestContext): Promise<GuardianRecord[]> {
    return this.list(context, await this.guardianStore.list());
  }

  async findGuardian(context: RequestContext, id: string): Promise<GuardianRecord> {
    return this.findRecord(context, await this.guardianStore.findById(id), "GUARDIAN_NOT_FOUND");
  }

  async createGuardian(context: RequestContext, input: Partial<GuardianRecord>): Promise<GuardianRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const record = await this.guardianStore.create({
      tenantId,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      phone: input.phone,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Guardian",
      entityId: record.id,
      action: "guardian.created",
      diff: { fieldsSet: presentFields(record, ["firstName", "lastName", "phone"]) },
    });
    return record;
  }

  async updateGuardian(context: RequestContext, id: string, input: Partial<GuardianRecord>): Promise<GuardianRecord> {
    await this.findGuardian(context, id);
    const changedFields = changedInputFields(input, ["firstName", "lastName", "phone"]);
    const record = await this.guardianStore.update(id, {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    });
    if (!record) {
      throw new NotFoundException("GUARDIAN_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Guardian",
      entityId: record.id,
      action: "guardian.updated",
      diff: { fieldsChanged: changedFields },
    });
    this.assertAccess(context, record);
    return record;
  }

  async deleteGuardian(context: RequestContext, id: string): Promise<void> {
    await this.findGuardian(context, id);
    const record = await this.guardianStore.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("GUARDIAN_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Guardian",
      entityId: record.id,
      action: "guardian.deleted",
      diff: { deletedAt: record.deletedAt },
    });
  }

  async purgeGuardianPii(context: RequestContext, id: string): Promise<GuardianRecord> {
    const existing = await this.findGuardian(context, id);
    const hadFirstName = existing.firstName.length > 0;
    const hadLastName = existing.lastName.length > 0;
    const hadPhone = existing.phone !== undefined;
    const record = await this.guardianStore.purgePii(id);
    if (!record) {
      throw new NotFoundException("GUARDIAN_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Guardian",
      entityId: record.id,
      action: "kvkk.guardian_pii_purged",
      diff: {
        fieldsPurged: ["firstName", "lastName", "phone"],
        before: { firstNamePresent: hadFirstName, lastNamePresent: hadLastName, phonePresent: hadPhone },
      },
    });
    return record;
  }

  async listGuardianStudents(context: RequestContext, guardianId: string): Promise<GuardianStudentRecord[]> {
    const guardian = await this.findGuardian(context, guardianId);
    return filterTenantResources(context, await this.guardianStudentStore.listByGuardian(guardian.id));
  }

  async listStudentGuardians(context: RequestContext, studentId: string): Promise<GuardianRecord[]> {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.assertTeacherScope(context, student);

    const links = filterTenantResources(context, await this.guardianStudentStore.listByStudent(student.id));
    const guardians = await Promise.all(links.map((link) => this.guardianStore.findById(link.guardianId)));
    return guardians.filter((guardian): guardian is GuardianRecord => guardian !== undefined && !guardian.deletedAt);
  }

  async listStudentGuardianLinks(context: RequestContext, studentId: string): Promise<GuardianStudentRecord[]> {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.assertTeacherScope(context, student);

    return filterTenantResources(context, await this.guardianStudentStore.listByStudent(student.id));
  }

  async linkGuardianStudent(
    context: RequestContext,
    guardianId: string,
    studentId: string,
    input: GuardianStudentRelationInput = {},
  ): Promise<GuardianStudentRecord> {
    const guardian = await this.findGuardian(context, guardianId);
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    this.assertAccess(context, student);
    const relation = resolveGuardianStudentRelation(input);

    const link = await this.guardianStudentStore.create({
      tenantId: guardian.tenantId,
      guardianId: guardian.id,
      studentId: student.id,
      ...relation,
    });
    await this.auditLogs?.record({
      tenantId: link.tenantId,
      actorUserId: context.userId,
      entityType: "GuardianStudent",
      entityId: link.id,
      action: "guardian_student.linked",
      diff: { guardianId: link.guardianId, studentId: link.studentId, fieldsSet: presentFields(relation, guardianStudentRelationFields) },
    });
    return link;
  }

  async updateGuardianStudent(
    context: RequestContext,
    guardianId: string,
    studentId: string,
    input: GuardianStudentRelationInput,
  ): Promise<GuardianStudentRecord> {
    const guardian = await this.findGuardian(context, guardianId);
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    this.assertAccess(context, student);

    const relation = resolveGuardianStudentRelation(input, false);
    const updated = await this.guardianStudentStore.update(guardian.id, student.id, relation);
    if (!updated) {
      throw new NotFoundException("GUARDIAN_STUDENT_NOT_FOUND");
    }

    await this.auditLogs?.record({
      tenantId: guardian.tenantId,
      actorUserId: context.userId,
      entityType: "GuardianStudent",
      entityId: updated.id,
      action: "guardian_student.updated",
      diff: { guardianId: guardian.id, studentId: student.id, fieldsChanged: changedInputFields(relation, guardianStudentRelationFields) },
    });
    return updated;
  }

  async unlinkGuardianStudent(context: RequestContext, guardianId: string, studentId: string): Promise<void> {
    const guardian = await this.findGuardian(context, guardianId);
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    this.assertAccess(context, student);

    const deleted = await this.guardianStudentStore.delete(guardian.id, student.id);
    if (!deleted) {
      throw new NotFoundException("GUARDIAN_STUDENT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: guardian.tenantId,
      actorUserId: context.userId,
      entityType: "GuardianStudent",
      entityId: `${guardian.id}:${student.id}`,
      action: "guardian_student.unlinked",
      diff: { guardianId: guardian.id, studentId: student.id },
    });
  }

  private list<TRecord extends SchoolRecord>(context: RequestContext, records: TRecord[]): TRecord[] {
    return filterTenantResources(context, records).filter((record) => !record.deletedAt);
  }

  private find<TRecord extends SchoolRecord>(
    context: RequestContext,
    records: TRecord[],
    id: string,
    notFoundMessage: string,
  ): TRecord {
    const record = records.find((candidate) => candidate.id === id && !candidate.deletedAt);
    if (!record) {
      throw new NotFoundException(notFoundMessage);
    }

    this.assertAccess(context, record);
    return record;
  }

  private findRecord<TRecord extends SchoolRecord>(
    context: RequestContext,
    record: TRecord | undefined,
    notFoundMessage: string,
  ): TRecord {
    if (!record) {
      throw new NotFoundException(notFoundMessage);
    }

    this.assertAccess(context, record);
    return record;
  }

  private resolveTenantId(context: RequestContext, tenantId: string | undefined): string {
    const resolvedTenantId = tenantId ?? context.tenantId;
    if (!resolvedTenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId: resolvedTenantId });
    return resolvedTenantId;
  }

  private assertAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
  }

  private async assertTeacherScope(context: RequestContext, resource: { tenantId: string; responsibleTeacherId?: string; id?: string; classId?: string }): Promise<void> {
    try {
      assertTeacherScopedStudentAccess(context, resource);
    } catch (error) {
      if (await this.hasTeacherAssignmentScope(context, resource)) {
        return;
      }
      const message = error instanceof Error ? error.message : "FORBIDDEN_SUBJECT";
      throw new ForbiddenException(message);
    }
  }

  private async hasTeacherAssignmentScope(
    context: RequestContext,
    resource: { tenantId: string; id?: string; classId?: string },
  ): Promise<boolean> {
    if (context.roles.includes("TENANT_ADMIN") || !context.subjectId || context.subjectType !== "TEACHER") {
      return false;
    }

    const assignments = await this.teacherAssignmentStore.listByTeacher(context.subjectId);
    return filterTenantResources(context, assignments).some((assignment) =>
      isAssignmentActive(assignment) &&
      (assignment.studentId === resource.id || Boolean(resource.classId && assignment.classId === resource.classId)),
    );
  }

  private resolveTeacherAssignmentInput(
    teacher: TeacherRecord,
    input: TeacherAssignmentRelationInput,
    applyDefaults = true,
  ): Partial<TeacherAssignmentInput> {
    const assignment: Partial<TeacherAssignmentInput> = {
      tenantId: teacher.tenantId,
      teacherId: teacher.id,
    };
    if (applyDefaults || input.role !== undefined) assignment.role = resolveTeacherAssignmentRole(input.role, applyDefaults);
    if (applyDefaults || input.classId !== undefined) assignment.classId = optionalText(input.classId);
    if (applyDefaults || input.studentId !== undefined) assignment.studentId = optionalText(input.studentId);
    if (applyDefaults || input.courseId !== undefined) assignment.courseId = optionalText(input.courseId);
    if (applyDefaults || input.startsAt !== undefined) assignment.startsAt = optionalDate(input.startsAt, "TEACHER_ASSIGNMENT_STARTS_AT_INVALID");
    if (applyDefaults || input.endsAt !== undefined) assignment.endsAt = optionalDate(input.endsAt, "TEACHER_ASSIGNMENT_ENDS_AT_INVALID");
    if (applyDefaults && (!assignment.classId && !assignment.studentId)) {
      throw new BadRequestException("TEACHER_ASSIGNMENT_TARGET_REQUIRED");
    }
    return assignment;
  }
}

function presentFields<TRecord>(record: TRecord, fields: Array<keyof TRecord>): string[] {
  return fields.filter((field) => record[field] !== undefined && record[field] !== "").map(String);
}

function changedInputFields<TRecord>(
  input: Partial<TRecord>,
  fields: Array<keyof TRecord>,
): string[] {
  return fields.filter((field) => input[field] !== undefined).map(String);
}

const guardianStudentRelationFields: Array<keyof GuardianStudentRelationInput> = [
  "relationshipType",
  "isPrimary",
  "canViewFinance",
  "canReceiveSms",
  "canReceiveAnnouncements",
  "canOpenSupportTickets",
];

const teacherAssignmentRelationFields: Array<keyof TeacherAssignmentRelationInput> = [
  "classId",
  "studentId",
  "courseId",
  "role",
  "startsAt",
  "endsAt",
];

function resolveGuardianStudentRelation(
  input: GuardianStudentRelationInput,
  applyDefaults = true,
): GuardianStudentRelationInput {
  const relation: GuardianStudentRelationInput = {};
  if (applyDefaults || input.relationshipType !== undefined) {
    relation.relationshipType = resolveRelationshipType(input.relationshipType);
  }
  if (applyDefaults || input.isPrimary !== undefined) {
    relation.isPrimary = resolveBoolean(input.isPrimary, false);
  }
  if (applyDefaults || input.canViewFinance !== undefined) {
    relation.canViewFinance = resolveBoolean(input.canViewFinance, true);
  }
  if (applyDefaults || input.canReceiveSms !== undefined) {
    relation.canReceiveSms = resolveBoolean(input.canReceiveSms, true);
  }
  if (applyDefaults || input.canReceiveAnnouncements !== undefined) {
    relation.canReceiveAnnouncements = resolveBoolean(input.canReceiveAnnouncements, true);
  }
  if (applyDefaults || input.canOpenSupportTickets !== undefined) {
    relation.canOpenSupportTickets = resolveBoolean(input.canOpenSupportTickets, true);
  }
  return relation;
}

function resolveRelationshipType(value: GuardianRelationshipType | undefined): GuardianRelationshipType {
  const resolved = value ?? "GUARDIAN";
  if (!guardianRelationshipTypes.includes(resolved)) {
    throw new BadRequestException("GUARDIAN_RELATIONSHIP_TYPE_INVALID");
  }
  return resolved;
}

function resolveBoolean(value: boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new BadRequestException("GUARDIAN_PERMISSION_INVALID");
  }
  return value;
}

function resolveTeacherAssignmentRole(value: TeacherAssignmentRole | undefined, applyDefault: boolean): TeacherAssignmentRole {
  const role = value ?? (applyDefault ? "RESPONSIBLE_TEACHER" : undefined);
  if (!role || !teacherAssignmentRoles.includes(role)) {
    throw new BadRequestException("TEACHER_ASSIGNMENT_ROLE_INVALID");
  }
  return role;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalDate(value: string | undefined, message: string): string | undefined {
  const trimmed = optionalText(value);
  if (trimmed === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestException(message);
  }
  return trimmed;
}

function isAssignmentActive(assignment: Pick<TeacherAssignmentRecord, "startsAt" | "endsAt">): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return (!assignment.startsAt || assignment.startsAt <= today) && (!assignment.endsAt || assignment.endsAt >= today);
}
