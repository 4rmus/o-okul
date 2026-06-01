import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  StudentClassHistoryRecord,
  StudentProfileRecord,
  StudentRecord as SharedStudentRecord,
  StudentStatus,
} from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import {
  assertSubjectResourceAccess,
  assertTeacherScopedStudentAccess,
  assertTenantResourceAccess,
  filterTenantResources,
  isTeacherSubjectContext,
} from "../tenant/tenant-access.js";
import {
  type GuardianStudentStore,
  guardianStudentStoreToken,
} from "../school/guardian-student-store.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type StudentStore, studentStoreToken } from "./student-store.js";
import {
  type StudentClassHistoryStore,
  studentClassHistoryStoreToken,
} from "./student-class-history-store.js";
import { decryptTcIdentity, encryptTcIdentity, hashTcIdentity, maskTcIdentity, normalizeTcIdentity } from "./tc-identity.js";

export interface StudentRecord extends SharedStudentRecord {
  deletedAt?: string;
}

const studentStatuses: StudentStatus[] = ["ACTIVE", "PASSIVE"];

export interface StudentQuotaPreview {
  limit: number;
  current: number;
  incoming: number;
  wouldExceed: boolean;
}

export interface StudentProfileInput {
  nationalId?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
}

@Injectable()
export class StudentService {
  private readonly maxStudentsPerTenant = Number.parseInt(process.env.STUDENT_QUOTA ?? "", 10) || 2;

  constructor(
    @Inject(studentStoreToken) private readonly store: StudentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    @Inject(studentClassHistoryStoreToken) private readonly classHistoryStore: StudentClassHistoryStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<StudentRecord[]> {
    const students = filterTenantResources(context, await this.store.list()).filter((student) => !student.deletedAt);
    if (!isTeacherSubjectContext(context)) {
      return students;
    }

    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId));
    return students.filter((student) => this.isTeacherScopedStudent(context.subjectId, student, assignments));
  }

  async findOne(context: RequestContext, id: string): Promise<StudentRecord> {
    const student = await this.store.findById(id);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    this.assertAccess(context, student);
    return student;
  }

  async findOneForViewer(context: RequestContext, id: string): Promise<StudentRecord> {
    const student = await this.store.findById(id);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    const guardianIds = (await this.guardianStudentStore.listByStudent(student.id)).map((link) => link.guardianId);
    if (isTeacherSubjectContext(context)) {
      await this.assertTeacherAssignmentScope(context, student);
      return student;
    }

    this.assertSubjectAccess(context, { ...student, guardianIds });
    return student;
  }

  async findCurrentStudent(context: RequestContext): Promise<StudentRecord> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.findOneForViewer(context, context.subjectId);
  }

  async findProfileForViewer(context: RequestContext, id: string): Promise<StudentProfileRecord> {
    const student = await this.store.findProfileById(id);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    const guardianIds = (await this.guardianStudentStore.listByStudent(student.id)).map((link) => link.guardianId);
    if (isTeacherSubjectContext(context)) {
      await this.assertTeacherAssignmentScope(context, student);
      await this.recordProfileView(context, student.id, student.tenantId);
      return toStudentProfile(student);
    }

    this.assertSubjectAccess(context, { ...student, guardianIds });
    await this.recordProfileView(context, student.id, student.tenantId);
    return toStudentProfile(student);
  }

  async findCurrentStudentProfile(context: RequestContext): Promise<StudentProfileRecord> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.findProfileForViewer(context, context.subjectId);
  }

  async listClassHistory(context: RequestContext, id: string): Promise<StudentClassHistoryRecord[]> {
    await this.findOneForViewer(context, id);
    return filterTenantResources(context, await this.classHistoryStore.listByStudent(id));
  }

  async updateProfile(context: RequestContext, id: string, input: StudentProfileInput): Promise<StudentProfileRecord> {
    const student = await this.findOne(context, id);
    const profileUpdate = {
      birthDate: input.birthDate !== undefined ? optionalDate(input.birthDate) : undefined,
      phone: input.phone !== undefined ? optionalText(input.phone) : undefined,
      email: input.email !== undefined ? optionalEmail(input.email) : undefined,
      photoKey: input.photoKey !== undefined ? optionalText(input.photoKey) : undefined,
      nationalIdEncrypted: undefined as string | undefined,
      nationalIdHash: undefined as string | undefined,
    };

    if (input.nationalId !== undefined) {
      const nationalId = normalizeTcIdentity(input.nationalId);
      const nationalIdHash = hashTcIdentity(nationalId);
      const duplicate = await this.store.findByNationalIdHash(student.tenantId, nationalIdHash);
      if (duplicate && duplicate.id !== student.id) {
        throw new ConflictException("STUDENT_NATIONAL_ID_CONFLICT");
      }

      profileUpdate.nationalIdEncrypted = encryptTcIdentity(nationalId);
      profileUpdate.nationalIdHash = nationalIdHash;
    }

    const updated = await this.store.updateProfile(id, profileUpdate);
    if (!updated) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    await this.auditLogs?.record({
      tenantId: updated.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: updated.id,
      action: "student.profile_updated",
      diff: {
        fieldsChanged: changedInputFields(input, ["nationalId", "birthDate", "phone", "email", "photoKey"]),
      },
    });
    return toStudentProfile(updated);
  }

  async listCurrentGuardianStudents(context: RequestContext): Promise<StudentRecord[]> {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const links = await this.guardianStudentStore.listByGuardian(context.subjectId);
    const students = await Promise.all(links.map((link) => this.store.findById(link.studentId)));
    return students
      .filter((student): student is StudentRecord => Boolean(student && !student.deletedAt))
      .map((student) => {
        this.assertSubjectAccess(context, { ...student, guardianIds: [context.subjectId!] });
        return student;
      });
  }

  async create(context: RequestContext, input: Partial<StudentRecord>): Promise<StudentRecord> {
    const tenantId = input.tenantId ?? context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId });
    if ((await this.list(context)).filter((student) => student.tenantId === tenantId).length >= this.maxStudentsPerTenant) {
      throw new ConflictException("STUDENT_QUOTA_EXCEEDED");
    }

    const student = await this.store.create({
      tenantId,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      classId: input.classId,
      responsibleTeacherId: input.responsibleTeacherId,
      status: resolveStudentStatus(input.status),
    });
    if (student.classId) {
      await this.classHistoryStore.create({
        tenantId: student.tenantId,
        studentId: student.id,
        classId: student.classId,
        startsAt: todayDateString(),
        reason: "CREATED",
      });
    }
    await this.auditLogs?.record({
      tenantId: student.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: student.id,
      action: "student.created",
      diff: { fieldsSet: presentFields(student, ["firstName", "lastName", "classId", "responsibleTeacherId", "status"]) },
    });
    return student;
  }

  async createMany(
    context: RequestContext,
    inputs: Array<Pick<StudentRecord, "firstName" | "lastName">>,
  ): Promise<StudentRecord[]> {
    const tenantId = context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId });
    const quota = await this.previewQuota(context, inputs.length);
    if (quota.wouldExceed) {
      throw new ConflictException("STUDENT_QUOTA_EXCEEDED");
    }

    return this.store.createMany(inputs.map((input) => ({
      tenantId,
      firstName: input.firstName,
      lastName: input.lastName,
      status: "ACTIVE",
    })));
  }

  async previewQuota(context: RequestContext, incoming: number): Promise<StudentQuotaPreview> {
    const current = (await this.list(context)).length;
    return {
      limit: this.maxStudentsPerTenant,
      current,
      incoming,
      wouldExceed: current + incoming > this.maxStudentsPerTenant,
    };
  }

  async update(context: RequestContext, id: string, input: Partial<StudentRecord>): Promise<StudentRecord> {
    const existing = await this.findOne(context, id);
    const previous = { ...existing };
    const changedFields = changedInputFields(input, ["firstName", "lastName", "classId", "responsibleTeacherId", "status"]);
    const nextStatus = input.status !== undefined ? resolveStudentStatus(input.status) : undefined;
    const updated = await this.store.update(id, {
      firstName: input.firstName,
      lastName: input.lastName,
      classId: input.classId,
      responsibleTeacherId: input.responsibleTeacherId,
      status: nextStatus,
    });
    if (!updated) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.recordClassHistoryIfChanged(previous, updated, input);
    await this.auditLogs?.record({
      tenantId: updated.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: updated.id,
      action: "student.updated",
      diff: { fieldsChanged: changedFields },
    });
    return updated;
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    await this.findOne(context, id);
    const student = await this.store.softDelete(id, new Date().toISOString());
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: student.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: student.id,
      action: "student.deleted",
      diff: { deletedAt: student.deletedAt },
    });
  }

  async purgePii(context: RequestContext, id: string): Promise<StudentRecord> {
    const student = await this.findOne(context, id);
    const hadFirstName = student.firstName.length > 0;
    const hadLastName = student.lastName.length > 0;
    const purged = await this.store.purgePii(id);
    if (!purged) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: purged.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: purged.id,
      action: "kvkk.student_pii_purged",
      diff: {
        fieldsPurged: ["firstName", "lastName"],
        before: { firstNamePresent: hadFirstName, lastNamePresent: hadLastName },
      },
    });
    return purged;
  }

  async updateTenant(context: RequestContext, id: string, tenantId: string): Promise<StudentRecord> {
    const student = await this.findOne(context, id);
    const previousTenantId = student.tenantId;
    this.assertAccess(context, { tenantId });
    const updated = await this.store.updateTenant(id, tenantId);
    if (!updated) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: previousTenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: updated.id,
      action: "student.tenant_updated",
      diff: { before: { tenantId: previousTenantId }, after: { tenantId } },
    });
    return updated;
  }

  private assertAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
  }

  private assertSubjectAccess(context: RequestContext, resource: { tenantId: string; studentId?: string; guardianIds?: string[]; id?: string }): void {
    try {
      assertSubjectResourceAccess(context, {
        tenantId: resource.tenantId,
        studentId: resource.studentId ?? resource.id,
        guardianIds: resource.guardianIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_SUBJECT";
      throw new ForbiddenException(message);
    }
  }

  assertTeacherScope(context: RequestContext, resource: { tenantId: string; responsibleTeacherId?: string }): void {
    try {
      assertTeacherScopedStudentAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_SUBJECT";
      throw new ForbiddenException(message);
    }
  }

  private async assertTeacherAssignmentScope(context: RequestContext, student: StudentRecord): Promise<void> {
    try {
      assertTeacherScopedStudentAccess(context, student);
      return;
    } catch (error) {
      const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId!));
      if (this.isTeacherScopedStudent(context.subjectId!, student, assignments)) {
        return;
      }

      const message = error instanceof Error ? error.message : "FORBIDDEN_SUBJECT";
      throw new ForbiddenException(message);
    }
  }

  private isTeacherScopedStudent(
    teacherId: string,
    student: StudentRecord,
    assignments: Array<{ teacherId: string; studentId?: string; classId?: string; startsAt?: string; endsAt?: string }>,
  ): boolean {
    return student.responsibleTeacherId === teacherId ||
      assignments.some((assignment) =>
        assignment.teacherId === teacherId &&
        isAssignmentActive(assignment) &&
        (assignment.studentId === student.id || Boolean(student.classId && assignment.classId === student.classId)),
      );
  }

  private async recordClassHistoryIfChanged(
    existing: StudentRecord,
    updated: StudentRecord,
    input: Partial<StudentRecord>,
  ): Promise<void> {
    if (input.classId === undefined || existing.classId === updated.classId) {
      return;
    }

    const changedAt = todayDateString();
    await this.classHistoryStore.closeActiveForStudent(updated.id, changedAt);
    if (updated.classId) {
      await this.classHistoryStore.create({
        tenantId: updated.tenantId,
        studentId: updated.id,
        classId: updated.classId,
        startsAt: changedAt,
        reason: "CLASS_CHANGED",
      });
    }
  }

  private async recordProfileView(context: RequestContext, studentId: string, tenantId: string): Promise<void> {
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: studentId,
      action: "student.profile_viewed",
      diff: { maskedFields: ["nationalId"] },
    });
  }
}

function presentFields<TRecord extends object>(record: TRecord, fields: Array<keyof TRecord>): string[] {
  return fields.filter((field) => record[field] !== undefined && record[field] !== "").map(String);
}

function changedInputFields<TRecord extends object>(input: Partial<TRecord>, fields: Array<keyof TRecord>): string[] {
  return fields.filter((field) => input[field] !== undefined).map(String);
}

function toStudentProfile(student: {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  classId?: string;
  responsibleTeacherId?: string;
  status: StudentStatus;
  userId?: string;
  nationalIdEncrypted?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
}): StudentProfileRecord {
  return {
    id: student.id,
    tenantId: student.tenantId,
    firstName: student.firstName,
    lastName: student.lastName,
    classId: student.classId,
    responsibleTeacherId: student.responsibleTeacherId,
    status: student.status,
    userId: student.userId,
    nationalIdMasked: student.nationalIdEncrypted ? maskTcIdentity(decryptTcIdentity(student.nationalIdEncrypted)) : undefined,
    birthDate: student.birthDate,
    phone: student.phone,
    email: student.email,
    photoKey: student.photoKey,
  };
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalDate(value: string | undefined): string | undefined {
  const trimmed = optionalText(value);
  if (trimmed === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestException("STUDENT_BIRTH_DATE_INVALID");
  }
  return trimmed;
}

function optionalEmail(value: string | undefined): string | undefined {
  const trimmed = optionalText(value);
  if (trimmed === undefined) return undefined;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    throw new BadRequestException("STUDENT_EMAIL_INVALID");
  }
  return trimmed;
}

function isAssignmentActive(assignment: { startsAt?: string; endsAt?: string }): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return (!assignment.startsAt || assignment.startsAt <= today) && (!assignment.endsAt || assignment.endsAt >= today);
}

function resolveStudentStatus(value: StudentStatus | undefined): StudentStatus {
  const status = value ?? "ACTIVE";
  if (!studentStatuses.includes(status)) {
    throw new BadRequestException("STUDENT_STATUS_INVALID");
  }
  return status;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}
