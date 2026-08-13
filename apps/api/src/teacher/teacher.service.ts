import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  TeacherAssignmentRecord,
  TeacherAssignmentRole,
  TeacherRecord as SharedTeacherRecord,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { optionalTurkishMobilePhone } from "../auth/phone-normalize.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { IdentityProvisioningService } from "../identity-provisioning/identity-provisioning.service.js";
import { filterTenantResources } from "../tenant/tenant-access.js";
import { encryptTcIdentity, hashTcIdentity, normalizeTcIdentity } from "../student/tc-identity.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { type ClassRecord, SchoolService } from "../school/school.service.js";
import { type GradeLevelCourseStore, gradeLevelCourseStoreToken } from "../school/grade-level-course-store.js";
import {
  assertTenantAccess,
  changedInputFields,
  optionalDate,
  optionalText,
  presentFields,
  resolveWriteTenantId,
} from "../school/school-utils.js";
import { assertTeacherScopedStudent } from "../school/teacher-scope.js";
import {
  type TeacherAssignmentInput,
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";

export interface TeacherRecord extends SharedTeacherRecord {
  deletedAt?: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
}

export type TeacherWriteInput = Partial<TeacherRecord> & { email?: string; nationalId?: string };

export type TeacherAssignmentRelationInput = Partial<Pick<
  TeacherAssignmentRecord,
  "classId" | "studentId" | "courseId" | "termId" | "role" | "startsAt" | "endsAt"
>>;

const teacherAssignmentRoles: TeacherAssignmentRole[] = ["CLASS_TEACHER", "BRANCH_TEACHER", "GUIDANCE_COUNSELOR", "RESPONSIBLE_TEACHER"];

const teacherAssignmentRelationFields: Array<keyof TeacherAssignmentRelationInput> = [
  "classId",
  "studentId",
  "courseId",
  "termId",
  "role",
  "startsAt",
  "endsAt",
];

@Injectable()
export class TeacherService {
  constructor(
    @Inject(teacherStoreToken) private readonly teacherStore: TeacherStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(gradeLevelCourseStoreToken) private readonly gradeLevelCourseStore: GradeLevelCourseStore,
    private readonly school: SchoolService,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly identityProvisioning?: IdentityProvisioningService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async listTeachers(context: RequestContext): Promise<TeacherRecord[]> {
    const teachers = filterTenantResources(context, await this.teacherStore.list()).filter((record) => !record.deletedAt);
    if (context.roles.includes("OPERATIONS_STAFF") && !context.campusScope) {
      throw new ForbiddenException("TEACHER_CAMPUS_SCOPE_MISSING");
    }
    if (context.campusScope?.scopeMode !== "CAMPUSES") return teachers;

    const allowedClassIds = new Set((await this.school.listClasses(context)).map((record) => record.id));
    const students = filterTenantResources(context, await this.studentStore.list())
      .filter((record) => Boolean(record.classId && allowedClassIds.has(record.classId)));
    const allowedStudentIds = new Set(students.map((record) => record.id));
    const teacherIds = new Set(students.map((record) => record.responsibleTeacherId).filter((id): id is string => Boolean(id)));
    for (const assignment of filterTenantResources(context, await this.teacherAssignmentStore.list())) {
      if (
        (assignment.classId && allowedClassIds.has(assignment.classId))
        || (assignment.studentId && allowedStudentIds.has(assignment.studentId))
      ) {
        teacherIds.add(assignment.teacherId);
      }
    }
    return teachers.filter((record) => teacherIds.has(record.id));
  }

  async findTeacher(context: RequestContext, id: string): Promise<TeacherRecord> {
    const record = await this.teacherStore.findById(id);
    if (!record || record.deletedAt) {
      throw new NotFoundException("TEACHER_NOT_FOUND");
    }

    assertTenantAccess(context, record);
    if (context.roles.includes("OPERATIONS_STAFF") && !context.campusScope) {
      throw new ForbiddenException("TEACHER_CAMPUS_SCOPE_MISSING");
    }
    if (
      context.campusScope?.scopeMode === "CAMPUSES"
      && !(await this.listTeachers(context)).some((candidate) => candidate.id === record.id)
    ) {
      throw new ForbiddenException("TEACHER_CAMPUS_SCOPE_FORBIDDEN");
    }
    return record;
  }

  async findCurrentTeacher(context: RequestContext): Promise<TeacherRecord> {
    if (context.subjectType !== "TEACHER" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.findTeacher(context, context.subjectId);
  }

  async createTeacher(context: RequestContext, input: TeacherWriteInput, idempotencyKey?: string): Promise<TeacherRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "teacher.create", request: input },
        () => this.createTeacherOnce(context, input),
      );
    }

    return this.createTeacherOnce(context, input);
  }

  private async createTeacherOnce(context: RequestContext, input: TeacherWriteInput): Promise<TeacherRecord> {
    const tenantId = resolveWriteTenantId(context, input.tenantId);
    const identity = await this.resolveTeacherIdentityInput(context, tenantId, input.nationalId);
    const record = await this.teacherStore.create({
      tenantId,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      branch: input.branch,
      ...identity,
      phone: optionalTurkishMobilePhone(input.phone, "TEACHER_PHONE_INVALID"),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Teacher",
      entityId: record.id,
      action: "teacher.created",
      diff: { fieldsSet: presentFields(record, ["firstName", "lastName", "branch", "nationalIdHash", "phone"]) },
    });
    return this.autoProvisionTeacherAccount(context, record, input);
  }

  async updateTeacher(context: RequestContext, id: string, input: TeacherWriteInput): Promise<TeacherRecord> {
    const existing = await this.findTeacher(context, id);
    const identity = await this.resolveTeacherIdentityInput(context, existing.tenantId, input.nationalId, existing.id);
    const changedFields = changedInputFields(input, ["firstName", "lastName", "branch", "nationalId", "phone"]);
    const record = await this.teacherStore.update(id, {
      firstName: input.firstName,
      lastName: input.lastName,
      branch: input.branch,
      ...identity,
      phone: input.phone !== undefined ? optionalTurkishMobilePhone(input.phone, "TEACHER_PHONE_INVALID") : undefined,
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
    assertTenantAccess(context, record);
    return this.autoProvisionTeacherAccount(context, record, input);
  }

  async deleteTeacher(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findTeacher(context, id);
    if (!this.identityProvisioning) {
      throw new Error("PROFILE_LIFECYCLE_STORE_UNAVAILABLE");
    }
    const deletedAt = new Date().toISOString();
    const lifecycle = await this.identityProvisioning.deactivateProfile({
      tenantId: existing.tenantId,
      subjectType: "TEACHER",
      subjectId: existing.id,
      deletedAt,
    });
    if (!lifecycle) {
      throw new NotFoundException("TEACHER_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: existing.tenantId,
      actorUserId: context.userId,
      entityType: "Teacher",
      entityId: existing.id,
      action: "teacher.deleted",
      diff: {
        deletedAt,
        accountAccessClosed: Boolean(lifecycle.userId),
        roleRemoved: lifecycle.roleRemoved,
        sessionsClosed: lifecycle.sessionsClosed,
        invitationsRevoked: lifecycle.invitationsRevoked,
      },
    });
  }

  async purgeTeacherPii(context: RequestContext, id: string): Promise<TeacherRecord> {
    const existing = await this.findTeacher(context, id);
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
        fieldsPurged: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone"],
        before: {
          firstNamePresent: existing.firstName.length > 0,
          lastNamePresent: existing.lastName.length > 0,
          nationalIdPresent: Boolean(existing.nationalIdEncrypted || existing.nationalIdHash),
          phonePresent: Boolean(existing.phone),
        },
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
    await assertTeacherScopedStudent(context, this.teacherAssignmentStore, student);

    return filterTenantResources(context, await this.teacherAssignmentStore.list()).filter((assignment) =>
      assignment.studentId === student.id || Boolean(student.classId && assignment.classId === student.classId),
    );
  }

  async createTeacherAssignment(
    context: RequestContext,
    teacherId: string,
    input: TeacherAssignmentRelationInput,
    idempotencyKey?: string,
  ): Promise<TeacherAssignmentRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "teacher.assignment.create", request: { teacherId, ...input } },
        () => this.createTeacherAssignmentOnce(context, teacherId, input),
      );
    }

    return this.createTeacherAssignmentOnce(context, teacherId, input);
  }

  private async createTeacherAssignmentOnce(
    context: RequestContext,
    teacherId: string,
    input: TeacherAssignmentRelationInput,
  ): Promise<TeacherAssignmentRecord> {
    const teacher = await this.findTeacher(context, teacherId);
    if (input.courseId) {
      await this.school.findCourse(context, input.courseId);
    }
    if (input.termId) {
      await this.school.findAcademicTerm(context, input.termId);
    }
    const assignmentInput = this.resolveTeacherAssignmentInput(teacher, input) as TeacherAssignmentInput;
    await this.assertTeacherAssignmentCourseFitsClass(context, assignmentInput);
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
    assertTenantAccess(context, existing);
    if (input.courseId) {
      await this.school.findCourse(context, input.courseId);
    }
    if (input.termId) {
      await this.school.findAcademicTerm(context, input.termId);
    }

    const assignmentInput = this.resolveTeacherAssignmentInput(teacher, input, false);
    await this.assertTeacherAssignmentCourseFitsClass(context, {
      ...existing,
      ...assignmentInput,
    });
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
    assertTenantAccess(context, existing);

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

  private async assertTeacherAssignmentCourseFitsClass(
    context: RequestContext,
    assignment: Pick<TeacherAssignmentInput, "tenantId"> &
      Partial<Pick<TeacherAssignmentInput, "classId" | "studentId" | "courseId">>,
  ): Promise<void> {
    const courseId = optionalText(assignment.courseId);
    if (!courseId) return;

    const course = await this.school.findCourse(context, courseId);
    if (course.tenantId !== assignment.tenantId) {
      throw new ForbiddenException("FORBIDDEN_TENANT");
    }

    let targetClass: ClassRecord | undefined;
    const classId = optionalText(assignment.classId);
    if (classId) {
      targetClass = await this.school.findClass(context, classId);
    }

    const studentId = optionalText(assignment.studentId);
    if (studentId) {
      const student = await this.studentStore.findById(studentId);
      if (!student) {
        throw new NotFoundException("STUDENT_NOT_FOUND");
      }
      assertTenantAccess(context, student);
      if (!targetClass && student.classId) {
        targetClass = await this.school.findClass(context, student.classId);
      }
    }

    if (!targetClass?.gradeLevelId) return;

    const gradeLevelCourses = filterTenantResources(
      context,
      await this.gradeLevelCourseStore.listByGradeLevel(targetClass.gradeLevelId, targetClass.alanId),
    );
    const courseFitsClass = gradeLevelCourses.some((template) => template.courseId === course.id);
    if (!courseFitsClass) {
      throw new BadRequestException("TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH");
    }
  }

  private async resolveTeacherIdentityInput(
    context: RequestContext,
    tenantId: string,
    nationalIdInput: string | undefined,
    currentTeacherId?: string,
  ): Promise<Pick<TeacherRecord, "nationalIdEncrypted" | "nationalIdHash">> {
    const nationalIdText = optionalText(nationalIdInput);
    if (!nationalIdText) return {};

    const nationalId = normalizeTcIdentity(nationalIdText, "TEACHER_NATIONAL_ID_INVALID");
    const nationalIdHash = hashTcIdentity(nationalId);
    const duplicate = await this.teacherStore.findByNationalIdHash(tenantId, nationalIdHash);
    if (duplicate && duplicate.id !== currentTeacherId) {
      throw new ConflictException("TEACHER_NATIONAL_ID_CONFLICT");
    }
    assertTenantAccess(context, { tenantId });
    return {
      nationalIdEncrypted: encryptTcIdentity(nationalId),
      nationalIdHash,
    };
  }

  private async autoProvisionTeacherAccount(
    context: RequestContext,
    teacher: TeacherRecord,
    input: TeacherWriteInput,
  ): Promise<TeacherRecord> {
    if (!this.identityProvisioning || teacher.userId) return { ...teacher, provisioning: "SKIPPED" };

    const provisioning = await this.identityProvisioning.provisionOrInvite(context, {
      tenantId: teacher.tenantId,
      subjectType: "TEACHER",
      subjectId: teacher.id,
      displayName: `${teacher.firstName} ${teacher.lastName}`.trim(),
      nationalId: input.nationalId,
      phone: teacher.phone,
      email: input.email,
    });
    return { ...teacher, provisioning: provisioning.status };
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
    if (applyDefaults || input.termId !== undefined) assignment.termId = optionalText(input.termId);
    if (applyDefaults || input.startsAt !== undefined) assignment.startsAt = optionalDate(input.startsAt, "TEACHER_ASSIGNMENT_STARTS_AT_INVALID");
    if (applyDefaults || input.endsAt !== undefined) assignment.endsAt = optionalDate(input.endsAt, "TEACHER_ASSIGNMENT_ENDS_AT_INVALID");
    if (applyDefaults && (!assignment.classId && !assignment.studentId)) {
      throw new BadRequestException("TEACHER_ASSIGNMENT_TARGET_REQUIRED");
    }
    return assignment;
  }
}

function resolveTeacherAssignmentRole(value: TeacherAssignmentRole | undefined, applyDefault: boolean): TeacherAssignmentRole {
  const role = value ?? (applyDefault ? "RESPONSIBLE_TEACHER" : undefined);
  if (!role || !teacherAssignmentRoles.includes(role)) {
    throw new BadRequestException("TEACHER_ASSIGNMENT_ROLE_INVALID");
  }
  return role;
}
