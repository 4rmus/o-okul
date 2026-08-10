import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  GuardianRecord as SharedGuardianRecord,
  GuardianStudentDetailStudentRecord,
  GuardianStudentDetailsResponse,
  GuardianStudentRecord,
  StudentRecord as SharedStudentRecord,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { optionalTurkishMobilePhone } from "../auth/phone-normalize.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { IdentityProvisioningService } from "../identity-provisioning/identity-provisioning.service.js";
import { filterTenantResources } from "../tenant/tenant-access.js";
import { encryptTcIdentity, hashTcIdentity, normalizeTcIdentity } from "../student/tc-identity.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import {
  assertTenantAccess,
  changedInputFields,
  presentFields,
  resolveWriteTenantId,
} from "../school/school-utils.js";
import {
  assertGuardianTeacherScope,
  assertTeacherScopedStudent,
  filterGuardianStudentLinksByTeacherScope,
  listTeacherScopedGuardianIds,
  listTeacherScopedStudents,
  shouldLimitToTeacherScope,
} from "../school/teacher-scope.js";
import { GuardianWritePolicy } from "./guardian-write-policy.js";

export interface GuardianRecord extends SharedGuardianRecord {
  deletedAt?: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
}

export type GuardianWriteInput = Partial<GuardianRecord> & { email?: string; nationalId?: string };

export type GuardianStudentRelationInput = Partial<Pick<
  GuardianStudentRecord,
  "canViewFinance" | "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets"
>>;

export type GuardianNotificationPreferenceInput = Partial<Pick<
  GuardianStudentRecord,
  "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets"
>>;

const guardianStudentRelationFields: Array<keyof GuardianStudentRelationInput> = [
  "canViewFinance",
  "canReceiveSms",
  "canReceiveAnnouncements",
  "canOpenSupportTickets",
];

const guardianNotificationPreferenceFields: Array<keyof GuardianNotificationPreferenceInput> = [
  "canReceiveSms",
  "canReceiveAnnouncements",
  "canOpenSupportTickets",
];

@Injectable()
export class GuardianService {
  constructor(
    @Inject(guardianStoreToken) private readonly guardianStore: GuardianStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(classStoreToken) private readonly classStore: ClassStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly identityProvisioning?: IdentityProvisioningService,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly writePolicy?: GuardianWritePolicy,
  ) {}

  async listGuardians(context: RequestContext): Promise<GuardianRecord[]> {
    const guardians = filterTenantResources(context, await this.guardianStore.list()).filter((record) => !record.deletedAt);
    if (!shouldLimitToTeacherScope(context)) {
      return guardians;
    }

    const guardianIds = await this.listScopedGuardianIds(context);
    return guardians.filter((guardian) => guardianIds.has(guardian.id));
  }

  async findGuardian(context: RequestContext, id: string): Promise<GuardianRecord> {
    const record = await this.guardianStore.findById(id);
    if (!record || record.deletedAt) {
      throw new NotFoundException("GUARDIAN_NOT_FOUND");
    }

    assertTenantAccess(context, record);
    await assertGuardianTeacherScope(context, this.studentStore, this.teacherAssignmentStore, this.guardianStudentStore, record.id);
    return record;
  }

  async createGuardian(context: RequestContext, input: GuardianWriteInput, idempotencyKey?: string): Promise<GuardianRecord> {
    await this.writePolicy?.assertWritable(context);
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "guardian.create", request: input },
        () => this.createGuardianOnce(context, input),
      );
    }

    return this.createGuardianOnce(context, input);
  }

  private async createGuardianOnce(context: RequestContext, input: GuardianWriteInput): Promise<GuardianRecord> {
    const tenantId = resolveWriteTenantId(context, input.tenantId);
    const phone = optionalTurkishMobilePhone(input.phone, "GUARDIAN_PHONE_INVALID");
    const identity = this.resolveGuardianIdentity(input.nationalId);
    const nationalIdMatch = identity.nationalIdHash
      ? await this.guardianStore.findByNationalIdHash(tenantId, identity.nationalIdHash)
      : undefined;
    const phoneMatch = phone ? await this.guardianStore.findByPhone(tenantId, phone) : undefined;
    if (nationalIdMatch && phoneMatch && nationalIdMatch.id !== phoneMatch.id) {
      throw new ConflictException("GUARDIAN_IDENTITY_CONFLICT");
    }

    const matched = nationalIdMatch ?? phoneMatch;
    if (matched) {
      const updated = await this.updateMatchedGuardian(matched, phone, identity);
      return { ...(await this.autoProvisionGuardianAccount(context, updated, input)), matched: true };
    }

    const record = await this.guardianStore.create({
      tenantId,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      ...identity,
      phone,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Guardian",
      entityId: record.id,
      action: "guardian.created",
      diff: { fieldsSet: presentFields(record, ["firstName", "lastName", "phone", "nationalIdHash"]) },
    });
    return { ...(await this.autoProvisionGuardianAccount(context, record, input)), matched: false };
  }

  async updateGuardian(context: RequestContext, id: string, input: GuardianWriteInput): Promise<GuardianRecord> {
    await this.writePolicy?.assertWritable(context);
    const existing = await this.findGuardian(context, id);
    const identity = await this.resolveGuardianIdentityInput(context, existing.tenantId, input.nationalId, existing.id);
    const changedFields = changedInputFields(input, ["firstName", "lastName", "phone", "nationalId"]);
    const record = await this.guardianStore.update(id, {
      firstName: input.firstName,
      lastName: input.lastName,
      ...identity,
      phone: input.phone !== undefined ? optionalTurkishMobilePhone(input.phone, "GUARDIAN_PHONE_INVALID") : undefined,
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
    assertTenantAccess(context, record);
    return record;
  }

  async deleteGuardian(context: RequestContext, id: string): Promise<void> {
    await this.writePolicy?.assertWritable(context);
    const existing = await this.findGuardian(context, id);
    if (!this.identityProvisioning) {
      throw new Error("PROFILE_LIFECYCLE_STORE_UNAVAILABLE");
    }
    const deletedAt = new Date().toISOString();
    const lifecycle = await this.identityProvisioning.deactivateProfile({
      tenantId: existing.tenantId,
      subjectType: "GUARDIAN",
      subjectId: existing.id,
      deletedAt,
    });
    if (!lifecycle) {
      throw new NotFoundException("GUARDIAN_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: existing.tenantId,
      actorUserId: context.userId,
      entityType: "Guardian",
      entityId: existing.id,
      action: "guardian.deleted",
      diff: {
        deletedAt,
        accountAccessClosed: Boolean(lifecycle.userId),
        roleRemoved: lifecycle.roleRemoved,
        sessionsClosed: lifecycle.sessionsClosed,
        invitationsRevoked: lifecycle.invitationsRevoked,
      },
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
    return filterGuardianStudentLinksByTeacherScope(
      context,
      this.studentStore,
      this.teacherAssignmentStore,
      filterTenantResources(context, await this.guardianStudentStore.listByGuardian(guardian.id)),
    );
  }

  async listGuardianStudentDetails(context: RequestContext, guardianId: string): Promise<GuardianStudentDetailsResponse> {
    const guardian = await this.findGuardian(context, guardianId);
    const links = await filterGuardianStudentLinksByTeacherScope(
      context,
      this.studentStore,
      this.teacherAssignmentStore,
      filterTenantResources(context, await this.guardianStudentStore.listByGuardian(guardian.id)),
    );
    const linkedStudentIds = new Set(links.map((link) => link.studentId));
    const students = await listTeacherScopedStudents(context, this.studentStore, this.teacherAssignmentStore);

    const classNameById = new Map(
      filterTenantResources(context, await this.classStore.list())
        .filter((record) => !record.deletedAt)
        .map((record) => [record.id, record.name]),
    );
    const studentById = new Map(
      students.map((student) => [student.id, toGuardianStudentDetailStudent(student, classNameById)]),
    );
    const linkedStudents = links
      .map((link) => studentById.get(link.studentId))
      .filter((student): student is GuardianStudentDetailStudentRecord => Boolean(student));
    const availableStudents = students
      .filter((student) => !linkedStudentIds.has(student.id))
      .map((student) => studentById.get(student.id))
      .filter((student): student is GuardianStudentDetailStudentRecord => Boolean(student));

    return { availableStudents, linkedStudents, links };
  }

  async listStudentGuardians(context: RequestContext, studentId: string): Promise<GuardianRecord[]> {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await assertTeacherScopedStudent(context, this.teacherAssignmentStore, student);

    const links = filterTenantResources(context, await this.guardianStudentStore.listByStudent(student.id));
    const guardians = await Promise.all(links.map((link) => this.guardianStore.findById(link.guardianId)));
    return guardians.filter((guardian): guardian is GuardianRecord => guardian !== undefined && !guardian.deletedAt);
  }

  async listStudentGuardianLinks(context: RequestContext, studentId: string): Promise<GuardianStudentRecord[]> {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await assertTeacherScopedStudent(context, this.teacherAssignmentStore, student);

    return filterTenantResources(context, await this.guardianStudentStore.listByStudent(student.id));
  }

  async listCurrentStudentGuardians(context: RequestContext): Promise<GuardianRecord[]> {
    const student = await this.findCurrentStudentForGuardianRelation(context);
    const links = filterTenantResources(context, await this.guardianStudentStore.listByStudent(student.id));
    const guardians = await Promise.all(links.map((link) => this.guardianStore.findById(link.guardianId)));
    return guardians.filter((guardian): guardian is GuardianRecord => guardian !== undefined && !guardian.deletedAt && guardian.tenantId === student.tenantId);
  }

  async listCurrentStudentGuardianLinks(context: RequestContext): Promise<GuardianStudentRecord[]> {
    const student = await this.findCurrentStudentForGuardianRelation(context);
    return filterTenantResources(context, await this.guardianStudentStore.listByStudent(student.id));
  }

  async linkGuardianStudent(
    context: RequestContext,
    guardianId: string,
    studentId: string,
    input: GuardianStudentRelationInput = {},
    idempotencyKey?: string,
  ): Promise<GuardianStudentRecord> {
    await this.writePolicy?.assertWritable(context);
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "guardian.student-link.create", request: { guardianId, studentId, ...input } },
        () => this.linkGuardianStudentOnce(context, guardianId, studentId, input),
      );
    }

    return this.linkGuardianStudentOnce(context, guardianId, studentId, input);
  }

  private async linkGuardianStudentOnce(
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
    assertTenantAccess(context, student);
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
    await this.writePolicy?.assertWritable(context);
    const guardian = await this.findGuardian(context, guardianId);
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    assertTenantAccess(context, student);

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

  async findCurrentGuardianNotificationPreferences(context: RequestContext, studentId: string): Promise<GuardianStudentRecord> {
    return this.findCurrentGuardianStudentLink(context, studentId);
  }

  async updateCurrentGuardianNotificationPreferences(
    context: RequestContext,
    studentId: string,
    input: GuardianNotificationPreferenceInput,
  ): Promise<GuardianStudentRecord> {
    await this.writePolicy?.assertWritable(context);
    const link = await this.findCurrentGuardianStudentLink(context, studentId);
    const relation = resolveGuardianNotificationPreference(input);
    const updated = await this.guardianStudentStore.update(link.guardianId, link.studentId, relation);
    if (!updated) {
      throw new NotFoundException("GUARDIAN_STUDENT_NOT_FOUND");
    }

    await this.auditLogs?.record({
      tenantId: updated.tenantId,
      actorUserId: context.userId,
      entityType: "GuardianStudent",
      entityId: updated.id,
      action: "guardian_student.notification_preferences_updated",
      diff: {
        guardianId: updated.guardianId,
        studentId: updated.studentId,
        fieldsChanged: changedInputFields(relation, guardianNotificationPreferenceFields),
      },
    });
    return updated;
  }

  async unlinkGuardianStudent(context: RequestContext, guardianId: string, studentId: string): Promise<void> {
    await this.writePolicy?.assertWritable(context);
    const guardian = await this.findGuardian(context, guardianId);
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    assertTenantAccess(context, student);

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

  private listScopedGuardianIds(context: RequestContext): Promise<Set<string>> {
    return listTeacherScopedGuardianIds(context, this.studentStore, this.teacherAssignmentStore, this.guardianStudentStore);
  }

  private async findCurrentGuardianStudentLink(context: RequestContext, studentId: string): Promise<GuardianStudentRecord> {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    assertTenantAccess(context, student);

    const link = (await this.guardianStudentStore.listByStudent(student.id)).find((candidate) => candidate.guardianId === context.subjectId);
    if (!link) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
    return link;
  }

  private async findCurrentStudentForGuardianRelation(context: RequestContext): Promise<SharedStudentRecord> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    const student = await this.studentStore.findById(context.subjectId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    assertTenantAccess(context, student);
    return student;
  }

  private async resolveGuardianIdentityInput(
    context: RequestContext,
    tenantId: string,
    nationalIdInput: string | undefined,
    currentGuardianId?: string,
  ): Promise<Pick<GuardianRecord, "nationalIdEncrypted" | "nationalIdHash">> {
    const identity = this.resolveGuardianIdentity(nationalIdInput);
    if (!identity.nationalIdHash) return {};

    const duplicate = await this.guardianStore.findByNationalIdHash(tenantId, identity.nationalIdHash);
    if (duplicate && duplicate.id !== currentGuardianId) {
      throw new ConflictException("GUARDIAN_NATIONAL_ID_CONFLICT");
    }
    assertTenantAccess(context, { tenantId });
    return identity;
  }

  private resolveGuardianIdentity(nationalIdInput: string | undefined): Pick<GuardianRecord, "nationalIdEncrypted" | "nationalIdHash"> {
    const nationalIdText = nationalIdInput?.trim();
    if (!nationalIdText) return {};

    const nationalId = normalizeTcIdentity(nationalIdText, "GUARDIAN_NATIONAL_ID_INVALID");
    const nationalIdHash = hashTcIdentity(nationalId);
    return {
      nationalIdEncrypted: encryptTcIdentity(nationalId),
      nationalIdHash,
    };
  }

  private async updateMatchedGuardian(
    guardian: GuardianRecord,
    phone: string | undefined,
    identity: Pick<GuardianRecord, "nationalIdEncrypted" | "nationalIdHash">,
  ): Promise<GuardianRecord> {
    if (identity.nationalIdHash && guardian.nationalIdHash && guardian.nationalIdHash !== identity.nationalIdHash) {
      throw new ConflictException("GUARDIAN_NATIONAL_ID_CONFLICT");
    }

    const update: Partial<Pick<GuardianRecord, "phone" | "nationalIdEncrypted" | "nationalIdHash">> = {};
    if (phone && !guardian.phone) {
      update.phone = phone;
    }
    if (identity.nationalIdHash && (!guardian.nationalIdHash || !guardian.nationalIdEncrypted)) {
      update.nationalIdEncrypted = identity.nationalIdEncrypted;
      update.nationalIdHash = identity.nationalIdHash;
    }

    if (Object.keys(update).length === 0) return guardian;
    return await this.guardianStore.update(guardian.id, update) ?? guardian;
  }

  private async autoProvisionGuardianAccount(
    context: RequestContext,
    guardian: GuardianRecord,
    input: GuardianWriteInput,
  ): Promise<GuardianRecord> {
    if (!this.identityProvisioning || guardian.userId) return { ...guardian, provisioning: "SKIPPED" };

    const provisioning = await this.identityProvisioning.provisionOrInvite(context, {
      tenantId: guardian.tenantId,
      subjectType: "GUARDIAN",
      subjectId: guardian.id,
      displayName: `${guardian.firstName} ${guardian.lastName}`.trim(),
      nationalId: input.nationalId,
      phone: guardian.phone,
      email: input.email,
    });
    return { ...guardian, provisioning: provisioning.status };
  }
}

function toGuardianStudentDetailStudent(
  student: SharedStudentRecord,
  classNameById: ReadonlyMap<string, string>,
): GuardianStudentDetailStudentRecord {
  const className = student.classId ? classNameById.get(student.classId) : undefined;
  return {
    id: student.id,
    ...(student.studentNo ? { studentNo: student.studentNo } : {}),
    firstName: student.firstName,
    lastName: student.lastName,
    ...(student.classId ? { classId: student.classId } : {}),
    ...(className ? { className } : {}),
    status: student.status,
    hasPortalUser: Boolean(student.userId),
  };
}

function resolveGuardianStudentRelation(
  input: GuardianStudentRelationInput,
  applyDefaults = true,
): GuardianStudentRelationInput {
  const relation: GuardianStudentRelationInput = {};
  if (applyDefaults || input.canViewFinance !== undefined) {
    relation.canViewFinance = resolveBoolean(input.canViewFinance, false);
  }
  if (applyDefaults || input.canReceiveSms !== undefined) {
    relation.canReceiveSms = resolveBoolean(input.canReceiveSms, false);
  }
  if (applyDefaults || input.canReceiveAnnouncements !== undefined) {
    relation.canReceiveAnnouncements = resolveBoolean(input.canReceiveAnnouncements, false);
  }
  if (applyDefaults || input.canOpenSupportTickets !== undefined) {
    relation.canOpenSupportTickets = resolveBoolean(input.canOpenSupportTickets, false);
  }
  return relation;
}

function resolveGuardianNotificationPreference(input: GuardianNotificationPreferenceInput): GuardianNotificationPreferenceInput {
  const relation: GuardianNotificationPreferenceInput = {};
  if (input.canReceiveSms !== undefined) {
    relation.canReceiveSms = resolveBoolean(input.canReceiveSms, false);
  }
  if (input.canReceiveAnnouncements !== undefined) {
    relation.canReceiveAnnouncements = resolveBoolean(input.canReceiveAnnouncements, false);
  }
  if (input.canOpenSupportTickets !== undefined) {
    relation.canOpenSupportTickets = resolveBoolean(input.canOpenSupportTickets, false);
  }
  return relation;
}

function resolveBoolean(value: boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new BadRequestException("GUARDIAN_PERMISSION_INVALID");
  }
  return value;
}
