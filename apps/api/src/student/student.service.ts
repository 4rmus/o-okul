import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  StudentBulkEnrollmentRequest,
  StudentBulkEnrollmentResult as SharedStudentBulkEnrollmentResult,
  StudentCreateRequest,
  StudentContactCreateRequest,
  StudentEnrollmentActionRequest,
  StudentEnrollmentRecord,
  StudentGuardianProvisionRequest,
  StudentUpdateRequest,
  PublicStudentProfileRecord,
  PublicStudentRecord,
  StudentProfileRecord,
  StudentPortalAccessRecord,
  StudentPortalAccessUpdateRequest,
  StudentPortalAccessUpdateResult,
  StudentPortalInvitationIssueResponse,
  StudentRecord as SharedStudentRecord,
  StudentStatus,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { optionalTurkishMobilePhone } from "../auth/phone-normalize.js";
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
import { type GuardianRecord, type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { IdentityInvitationService } from "../identity-invitation/identity-invitation.service.js";
import { StudentPortalActivationService } from "../identity-invitation/student-portal-activation.service.js";
import { IdentityProvisioningService } from "../identity-provisioning/identity-provisioning.service.js";
import { GuardianWritePolicy } from "../guardian/guardian-write-policy.js";
import { IdempotencyService } from "../http/idempotency.js";
import { withCursorListMeta, withListMeta } from "../listing/list-query.js";
import { maskContactEmail, maskContactPhone } from "../privacy/contact-mask.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { type LicenseTermStore, licenseTermStoreToken } from "../license/license-term-store.js";
import { type ReportSnapshotStore, reportSnapshotStoreToken } from "../report/report-snapshot-store.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { type CampusStore, campusStoreToken } from "../school/campus-store.js";
import { type ClassRecord, type ClassStore, classStoreToken } from "../school/class-store.js";
import { type GradeLevelRecord, type GradeLevelStore, gradeLevelStoreToken } from "../school/grade-level-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type StudentPortalAccessQuery, type StudentProfileUpdate, type StudentRegistryQuery, type StudentStore, studentStoreToken } from "./student-store.js";
import {
  type StudentEnrollmentStore,
  studentEnrollmentStoreToken,
} from "./student-enrollment-store.js";
import { decryptTcIdentity, encryptTcIdentity, hashTcIdentity, isValidTcIdentity, maskTcIdentity, normalizeTcIdentity } from "./tc-identity.js";
import { buildStudentContactStorageInput } from "./student-contact-input.js";
import { type StudentContactStore, type StudentContactStoreInput, studentContactStoreToken } from "./student-contact-store.js";

export interface StudentRecord extends SharedStudentRecord {
  deletedAt?: string;
}

const studentStatuses: StudentStatus[] = ["ACTIVE", "PASSIVE", "GRADUATED", "TRANSFERRED"];
const studentRegistrySorts = new Set([
  "studentNo", "-studentNo", "firstName", "-firstName", "lastName", "-lastName", "classId", "-classId",
]);
const defaultStudentQuota = 200;

export interface StudentQuotaPreview {
  limit: number;
  current: number;
  incoming: number;
  wouldExceed: boolean;
}

export interface StudentRegistryListInput {
  page: number;
  limit: number;
  q?: string;
  sort?: string;
  ids?: string[];
  classId?: string;
  level?: string;
  responsibleTeacherId?: string;
  status?: StudentStatus;
  hasContact?: boolean;
}

export interface StudentProfileInput {
  nationalId?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
}

export interface StudentPiiPresenceRecord extends StudentRecord {
  hasNationalId: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  hasPhoto: boolean;
}

export type StudentEnrollmentActionInput = StudentEnrollmentActionRequest;
export type StudentBulkEnrollmentInput = StudentBulkEnrollmentRequest;
export type StudentBulkEnrollmentResult = SharedStudentBulkEnrollmentResult;
export type StudentGuardianProvisionInput = StudentGuardianProvisionRequest;
export type StudentCreateInput = StudentCreateRequest;
export type StudentBulkCreateInput = Pick<StudentRecord, "firstName" | "lastName"> &
  Partial<Pick<StudentRecord, "classId" | "studentNo">> &
  StudentProfileInput & {
    guardian?: StudentGuardianProvisionInput;
    contact?: StudentContactCreateRequest;
  };

@Injectable()
export class StudentService {
  private readonly testStudentQuota = Number.parseInt(process.env.STUDENT_QUOTA ?? "", 10) || undefined;

  constructor(
    @Inject(studentStoreToken) private readonly store: StudentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(guardianStoreToken) private readonly guardianStore: GuardianStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    @Inject(studentEnrollmentStoreToken) private readonly enrollmentStore: StudentEnrollmentStore,
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(campusStoreToken) private readonly campusStore: CampusStore,
    @Inject(classStoreToken) private readonly classStore: ClassStore,
    @Inject(gradeLevelStoreToken) private readonly gradeLevelStore: GradeLevelStore,
    @Inject(teacherStoreToken) private readonly teacherStore: TeacherStore,
    private readonly identityInvitations: IdentityInvitationService,
    @Inject(reportSnapshotStoreToken) private readonly reportSnapshots: ReportSnapshotStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly identityProvisioning?: IdentityProvisioningService,
    @Optional() @Inject(licenseTermStoreToken) private readonly licenseTerms?: LicenseTermStore,
    @Optional() private readonly studentPortalActivations?: StudentPortalActivationService,
    @Optional() private readonly guardianWritePolicy?: GuardianWritePolicy,
    @Optional() @Inject(studentContactStoreToken) private readonly studentContactStore?: StudentContactStore,
  ) {}

  async list(context: RequestContext): Promise<StudentRecord[]> {
    if (context.subjectType === "STUDENT" || context.subjectType === "GUARDIAN") {
      throw new ForbiddenException("STUDENT_LIST_SCOPE_FORBIDDEN");
    }
    this.assertCampusScopePresent(context);
    const students = await this.filterCampusScopedStudents(
      context,
      filterTenantResources(context, await this.store.list()).filter((student) => !student.deletedAt),
    );
    if (!isTeacherSubjectContext(context)) {
      return students;
    }

    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId));
    return students.filter((student) => this.isTeacherScopedStudent(context.subjectId, student, assignments));
  }

  async listPortalAccess(context: RequestContext, query: StudentPortalAccessQuery): Promise<StudentPortalAccessRecord[]> {
    if (!context.tenantId || context.bypassRls) throw new BadRequestException("TENANT_CONTEXT_REQUIRED");
    try {
      const studentIds = this.isCampusRestricted(context)
        ? (await this.list(context)).map((student) => student.id)
        : undefined;
      const page = await this.store.listPortalAccess(context.tenantId, { ...query, studentIds });
      return withCursorListMeta(page.records, page.meta);
    } catch (error) {
      if (error instanceof Error && error.message === "STUDENT_PORTAL_CURSOR_INVALID") {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async updatePortalAccess(
    context: RequestContext,
    id: string,
    input: StudentPortalAccessUpdateRequest,
  ): Promise<StudentPortalAccessUpdateResult> {
    if (!context.tenantId || context.bypassRls) throw new BadRequestException("TENANT_CONTEXT_REQUIRED");
    await this.assertPortalManagedStudentAccess(context, id);
    let updated: StudentPortalAccessUpdateResult | undefined;
    try {
      updated = await this.store.updatePortalAccess(context.tenantId, id, input);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "STUDENT_PORTAL_ACCOUNT_NOT_LINKED") throw new BadRequestException(code);
      if (
        code === "STUDENT_PORTAL_VERSION_CONFLICT" ||
        code === "STUDENT_PORTAL_PROFILE_NOT_ACTIVE" ||
        code === "STUDENT_PORTAL_MEMBERSHIP_ENDED"
      ) {
        throw new ConflictException(code);
      }
      throw error;
    }
    if (!updated) throw new NotFoundException("STUDENT_NOT_FOUND");
    await this.auditLogs?.record({
      tenantId: updated.tenantId,
      actorUserId: context.userId,
      entityType: "TenantMembership",
      entityId: updated.membership.id,
      action: "student.portal_access_updated",
      diff: {
        studentId: updated.studentId,
        status: updated.membership.status,
        version: updated.membership.version,
        sessionsRevoked: updated.sessionsRevoked,
      },
    });
    return updated;
  }

  async issuePortalInvitation(context: RequestContext, id: string): Promise<StudentPortalInvitationIssueResponse> {
    if (!this.studentPortalActivations) throw new Error("STUDENT_PORTAL_ACTIVATION_STORE_UNAVAILABLE");
    await this.assertPortalManagedStudentAccess(context, id);
    return this.studentPortalActivations.issue(context, id);
  }

  async listForViewer(context: RequestContext): Promise<PublicStudentRecord[]> {
    return (await this.list(context)).map(toPublicStudentRecord);
  }

  async listRegistryPageForViewer(
    context: RequestContext,
    input: StudentRegistryListInput,
  ): Promise<PublicStudentRecord[]> {
    if (!context.tenantId || context.bypassRls) throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    if (context.subjectType === "STUDENT" || context.subjectType === "GUARDIAN") {
      throw new ForbiddenException("STUDENT_LIST_SCOPE_FORBIDDEN");
    }
    this.assertCampusScopePresent(context);
    if (!Number.isInteger(input.page) || input.page < 1) throw new BadRequestException("LIST_PAGE_INVALID");
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new BadRequestException("LIST_LIMIT_INVALID");
    }
    if (input.q && input.q.length > 100) throw new BadRequestException("LIST_QUERY_INVALID");
    if (input.sort && !studentRegistrySorts.has(input.sort)) throw new BadRequestException("LIST_SORT_INVALID");

    const classes = filterTenantResources(context, await this.classStore.list()).filter((record) => !record.deletedAt);
    const requestedClassIds = classes
      .filter((record) => !input.classId || record.id === input.classId)
      .filter((record) => !input.level || record.gradeLevelId === input.level)
      .filter((record) => context.campusScope?.scopeMode !== "CAMPUSES"
        || Boolean(record.campusId && context.campusScope.campusIds.includes(record.campusId)))
      .map((record) => record.id);
    const classFilterRequested = Boolean(input.classId || input.level || context.campusScope?.scopeMode === "CAMPUSES");
    const registryQuery: StudentRegistryQuery = {
      page: input.page,
      limit: input.limit,
      q: input.q,
      sort: input.sort,
      ids: input.ids,
      classIds: classFilterRequested ? requestedClassIds : undefined,
      responsibleTeacherId: input.responsibleTeacherId,
      status: input.status,
      hasContact: input.hasContact,
    };

    if (isTeacherSubjectContext(context)) {
      const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId))
        .filter(isAssignmentActive);
      registryQuery.teacherId = context.subjectId;
      registryQuery.teacherStudentIds = assignments.flatMap((record) => record.studentId ? [record.studentId] : []);
      registryQuery.teacherClassIds = assignments.flatMap((record) => record.classId ? [record.classId] : []);
    }

    const page = await this.store.listRegistryPage(context.tenantId, registryQuery);
    return withListMeta(page.records.map(toPublicStudentRecord), page.meta);
  }

  async listStudentNosForImport(context: RequestContext): Promise<string[]> {
    if (!context.tenantId || context.bypassRls) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }
    return this.store.listStudentNos(context.tenantId);
  }

  async listPiiPresence(context: RequestContext): Promise<StudentPiiPresenceRecord[]> {
    const students = await this.list(context);
    return Promise.all(students.map(async (student) => {
      const profile = await this.store.findProfileById(student.id);
      return {
        ...student,
        hasNationalId: Boolean(profile?.nationalIdEncrypted || profile?.nationalIdHash),
        hasPhone: Boolean(profile?.phone),
        hasEmail: Boolean(profile?.email),
        hasPhoto: Boolean(profile?.photoKey),
      };
    }));
  }

  async findByNationalIdForViewer(context: RequestContext, nationalId: string): Promise<PublicStudentRecord | undefined> {
    const normalized = nationalId.replace(/\D/g, "");
    if (!isValidTcIdentity(normalized)) return undefined;
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const student = await this.store.findByNationalIdHash(context.tenantId, hashTcIdentity(normalized));
    return student ? this.findOneForViewer(context, student.id) : undefined;
  }

  async findOne(context: RequestContext, id: string): Promise<StudentRecord> {
    const student = await this.store.findById(id);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    this.assertAccess(context, student);
    await this.assertStudentCampusScope(context, student);
    return student;
  }

  async findOneForViewer(context: RequestContext, id: string): Promise<PublicStudentRecord> {
    const student = await this.store.findById(id);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.assertStudentCampusScope(context, student);

    const guardianIds = (await this.guardianStudentStore.listByStudent(student.id)).map((link) => link.guardianId);
    if (isTeacherSubjectContext(context)) {
      await this.assertTeacherAssignmentScope(context, student);
      return toPublicStudentRecord(student);
    }
    if (context.roles.includes("OPERATIONS_STAFF")) {
      this.assertAccess(context, student);
      return toPublicStudentRecord(student);
    }

    this.assertSubjectAccess(context, { ...student, guardianIds });
    return toPublicStudentRecord(student);
  }

  async findCurrentStudent(context: RequestContext): Promise<PublicStudentRecord> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.findOneForViewer(context, context.subjectId);
  }

  async findProfileForViewer(context: RequestContext, id: string): Promise<PublicStudentProfileRecord> {
    const student = await this.store.findProfileById(id);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.assertStudentCampusScope(context, student);

    const guardianIds = (await this.guardianStudentStore.listByStudent(student.id)).map((link) => link.guardianId);
    if (isTeacherSubjectContext(context)) {
      await this.assertTeacherAssignmentScope(context, student);
      await this.recordProfileView(context, student.id, student.tenantId);
      return this.toStudentProfile(student, this.canViewStudentContact(context, student.id));
    }
    if (context.roles.includes("OPERATIONS_STAFF")) {
      this.assertAccess(context, student);
      await this.recordProfileView(context, student.id, student.tenantId);
      return this.toStudentProfile(student, this.canViewStudentContact(context, student.id));
    }

    this.assertSubjectAccess(context, { ...student, guardianIds });
    await this.recordProfileView(context, student.id, student.tenantId);
    return this.toStudentProfile(student, this.canViewStudentContact(context, student.id));
  }

  async findCurrentStudentProfile(context: RequestContext): Promise<PublicStudentProfileRecord> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.findProfileForViewer(context, context.subjectId);
  }

  async listEnrollments(context: RequestContext, id: string): Promise<StudentEnrollmentRecord[]> {
    await this.findOneForViewer(context, id);
    return this.withClassNames(filterTenantResources(context, await this.enrollmentStore.listByStudent(id)));
  }

  async updateProfile(context: RequestContext, id: string, input: StudentProfileInput): Promise<PublicStudentProfileRecord> {
    const student = await this.findOne(context, id);
    const profileUpdate = {
      phone: input.phone !== undefined ? optionalText(input.phone) : undefined,
      email: input.email !== undefined ? optionalEmail(input.email) : undefined,
      photoKey: input.photoKey !== undefined ? optionalStudentPhotoKey(student.id, input.photoKey) : undefined,
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
        fieldsChanged: changedInputFields(input, ["nationalId", "phone", "email", "photoKey"]),
      },
    });
    return this.toStudentProfile(updated, this.canViewStudentContact(context, updated.id));
  }

  async listCurrentGuardianStudents(context: RequestContext): Promise<PublicStudentRecord[]> {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const links = await this.guardianStudentStore.listByGuardian(context.subjectId);
    const students = await Promise.all(links.map((link) => this.store.findById(link.studentId)));
    return students
      .filter((student): student is StudentRecord => Boolean(student && !student.deletedAt))
      .map((student) => {
        this.assertSubjectAccess(context, { ...student, guardianIds: [context.subjectId!] });
        return toPublicStudentRecord(student);
      });
  }

  async create(context: RequestContext, input: StudentCreateInput, idempotencyKey?: string): Promise<StudentRecord> {
    if (input.guardian) {
      await this.assertGuardianProvisioningAllowed(context);
    }
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "student.create", request: input },
        () => this.createOnce(context, input),
      );
    }

    return this.createOnce(context, input);
  }

  private async createOnce(context: RequestContext, input: StudentCreateInput): Promise<StudentRecord> {
    const tenantId = input.tenantId ?? context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId });
    await this.assertCampusScopeAllowsClass(context, input.classId);
    if (input.guardian) {
      parseGuardianProvisionInput(input.guardian, { lastName: input.lastName });
    }
    if (input.studentNo && (await this.list(context)).some((student) => student.tenantId === tenantId && student.studentNo === input.studentNo?.trim())) {
      throw new ConflictException("STUDENT_NO_CONFLICT");
    }
    const incomingActiveStudents = resolveStudentStatus(input.status) === "ACTIVE" && Boolean(input.classId) ? 1 : 0;
    if ((await this.previewQuota(context, incomingActiveStudents)).wouldExceed) {
      throw new ConflictException("ACTIVE_STUDENT_LIMIT_REACHED");
    }
    await this.assertStudentRelationTargets(context, tenantId, {
      classId: input.classId,
      responsibleTeacherId: input.responsibleTeacherId,
    });
    const profileUpdate = await this.resolveProfileUpdateForCreate(tenantId, input, new Set());

    const studentInput = {
      tenantId,
      studentNo: input.studentNo,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      classId: input.classId,
      responsibleTeacherId: input.responsibleTeacherId,
      status: resolveStudentStatus(input.status),
    };
    let student: StudentRecord;
    if (studentInput.classId) {
      const academicContext = await this.resolveCurrentAcademicContext(context);
      const enrollment = {
        classId: studentInput.classId,
        ...academicContext,
        startsAt: todayDateString(),
        status: studentInput.status,
        reason: "CREATED",
      };
      if (this.store.createWithEnrollment) {
        student = await this.store.createWithEnrollment(studentInput, enrollment);
      } else {
        student = await this.store.create(studentInput);
        await this.enrollmentStore.create({ tenantId: student.tenantId, studentId: student.id, ...enrollment });
      }
    } else {
      student = await this.store.create(studentInput);
    }
    if (profileUpdate) {
      await this.store.updateProfile(student.id, profileUpdate);
    }
    await this.autoProvisionStudentAccount(context, student, input);
    await this.auditLogs?.record({
      tenantId: student.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: student.id,
      action: "student.created",
      diff: { fieldsSet: presentFields(student, ["studentNo", "firstName", "lastName", "classId", "responsibleTeacherId", "status"]) },
    });
    if (input.guardian) {
      await this.autoProvisionGuardian(context, student, input.guardian);
    }
    return student;
  }

  async createMany(
    context: RequestContext,
    inputs: StudentBulkCreateInput[],
  ): Promise<StudentRecord[]> {
    if (inputs.some((input) => Boolean(input.guardian))) {
      await this.assertGuardianProvisioningAllowed(context);
    }
    const tenantId = context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId });
    await Promise.all(inputs.map((input) => this.assertCampusScopeAllowsClass(context, input.classId)));
    for (const input of inputs) {
      if (input.guardian) {
        parseGuardianProvisionInput(input.guardian, { lastName: input.lastName });
      }
    }
    const quota = await this.previewQuota(context, inputs.filter((input) => Boolean(input.classId)).length);
    if (quota.wouldExceed) {
      throw new ConflictException("ACTIVE_STUDENT_LIMIT_REACHED");
    }

    for (const input of inputs) {
      if (!input.classId) continue;
      const schoolClass = await this.classStore.findById(input.classId);
      if (!schoolClass) {
        throw new NotFoundException("CLASS_NOT_FOUND");
      }
      this.assertAccess(context, schoolClass);
    }

    const nationalIdHashes = new Set<string>();
    const profileUpdates: Array<StudentProfileUpdate | undefined> = [];
    for (const input of inputs) {
      profileUpdates.push(await this.resolveProfileUpdateForCreate(tenantId, input, nationalIdHashes));
    }

    const academicContext = await this.resolveCurrentAcademicContext(context);
    const createInputs = inputs.map((input) => ({
      student: {
        tenantId,
        studentNo: input.studentNo,
        firstName: input.firstName,
        lastName: input.lastName,
        classId: input.classId,
        status: "ACTIVE" as const,
      },
      enrollment: input.classId ? {
        classId: input.classId,
        ...academicContext,
        startsAt: todayDateString(),
        status: "ACTIVE" as const,
        reason: "CREATED",
      } : undefined,
      contact: input.contact
        ? omitStudentId(buildStudentContactStorageInput(tenantId, "pending", input.contact))
        : undefined,
    }));
    const includesContacts = createInputs.some((input) => Boolean(input.contact));
    if (includesContacts && !this.store.createManyWithEnrollmentsAndContacts && !this.studentContactStore) {
      throw new Error("STUDENT_CONTACT_STORE_UNAVAILABLE");
    }
    const students = includesContacts && this.store.createManyWithEnrollmentsAndContacts
      ? await this.store.createManyWithEnrollmentsAndContacts(createInputs)
      : this.store.createManyWithEnrollments
        ? await this.store.createManyWithEnrollments(createInputs)
        : await this.store.createMany(createInputs.map(({ student }) => student));
    if (!this.store.createManyWithEnrollments) {
      for (const student of students) {
        if (!student.classId) continue;
        await this.enrollmentStore.create({
          tenantId: student.tenantId,
          studentId: student.id,
          classId: student.classId,
          ...academicContext,
          startsAt: todayDateString(),
          status: student.status,
          reason: "CREATED",
        });
      }
    }
    if (includesContacts && !this.store.createManyWithEnrollmentsAndContacts) {
      for (const [index, student] of students.entries()) {
        const contact = inputs[index]?.contact;
        if (!contact) continue;
        await this.studentContactStore!.create(buildStudentContactStorageInput(tenantId, student.id, contact));
      }
    }
    for (const [index, student] of students.entries()) {
      const contact = inputs[index]?.contact;
      if (!contact) continue;
      await this.auditLogs?.record({
        tenantId,
        actorUserId: context.userId,
        entityType: "StudentContact",
        entityId: student.id,
        action: "student_contact.imported",
        diff: {
          studentId: student.id,
          relationType: contact.relationType,
          hasPhone: Boolean(contact.phone),
          hasEmail: Boolean(contact.email),
          permissionsDefaultOff: true,
        },
      });
    }
    for (const [index, student] of students.entries()) {
      const profileUpdate = profileUpdates[index];
      if (!profileUpdate) continue;
      await this.store.updateProfile(student.id, profileUpdate);
    }
    for (const [index, student] of students.entries()) {
      const input = inputs[index];
      if (!input) continue;
      await this.autoProvisionStudentAccount(context, student, input);
    }
    for (const [index, student] of students.entries()) {
      const guardian = inputs[index]?.guardian;
      if (!guardian) continue;
      await this.autoProvisionGuardian(context, student, guardian);
    }
    return students;
  }

  async assertGuardianProvisioningAllowed(context: RequestContext): Promise<void> {
    await this.guardianWritePolicy?.assertWritable(context);
  }

  async previewQuota(context: RequestContext, incoming: number): Promise<StudentQuotaPreview> {
    const tenantId = context.tenantId;
    if (!tenantId) throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    const students = filterTenantResources(context, await this.store.list())
      .filter((student) => !student.deletedAt && student.status === "ACTIVE");
    const enrollments = await this.enrollmentStore.listByStudents(students.map((student) => student.id));
    const openActiveByStudent = new Map<string, number>();
    for (const enrollment of enrollments) {
      if (enrollment.status !== "ACTIVE" || enrollment.endsAt) continue;
      openActiveByStudent.set(enrollment.studentId, (openActiveByStudent.get(enrollment.studentId) ?? 0) + 1);
    }
    const current = students.filter((student) => openActiveByStudent.get(student.id) === 1).length;
    const license = await this.licenseTerms?.resolveForTenant(tenantId);
    const limit = process.env.NODE_ENV === "test" && this.testStudentQuota
      ? this.testStudentQuota
      : license?.term.activeStudentLimit ?? defaultStudentQuota;
    return {
      limit,
      current,
      incoming,
      wouldExceed: current + incoming > limit,
    };
  }

  async hasNationalId(context: RequestContext, nationalId: string): Promise<boolean> {
    const tenantId = context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId });
    const normalized = normalizeTcIdentity(nationalId);
    return Boolean(await this.store.findByNationalIdHash(tenantId, hashTcIdentity(normalized)));
  }

  async update(context: RequestContext, id: string, input: StudentUpdateRequest): Promise<PublicStudentRecord> {
    const existing = await this.findOne(context, id);
    const previous = { ...existing };
    const changedFields = changedInputFields(input, ["firstName", "lastName", "classId", "responsibleTeacherId", "status"]);
    const nextStatus = input.status !== undefined ? resolveStudentStatus(input.status) : undefined;
    const nextClassId = input.classId !== undefined ? optionalText(input.classId) : undefined;
    const nextResponsibleTeacherId = input.responsibleTeacherId !== undefined ? optionalText(input.responsibleTeacherId) : undefined;
    if (input.classId !== undefined) await this.assertCampusScopeAllowsClass(context, nextClassId);
    await this.assertStudentRelationTargets(context, existing.tenantId, {
      classId: nextClassId,
      responsibleTeacherId: nextResponsibleTeacherId,
    });
    const studentUpdate = {
      firstName: input.firstName,
      lastName: input.lastName,
      classId: nextClassId,
      responsibleTeacherId: nextResponsibleTeacherId,
      status: nextStatus,
    };
    const effectiveClassId = input.classId !== undefined ? nextClassId : existing.classId;
    const effectiveStatus = nextStatus ?? existing.status;
    const classChanged = input.classId !== undefined && effectiveClassId !== existing.classId;
    const activated = existing.status !== "ACTIVE" && effectiveStatus === "ACTIVE";
    const deactivated = existing.status === "ACTIVE" && effectiveStatus !== "ACTIVE";
    const enrollmentTransition = classChanged || activated || deactivated
      ? {
          closeActive: { endsAt: todayDateString(), status: deactivated ? effectiveStatus : undefined },
          create: effectiveStatus === "ACTIVE" && effectiveClassId
            ? {
                classId: effectiveClassId,
                ...(await this.resolveCurrentAcademicContext(context)),
                startsAt: todayDateString(),
                status: "ACTIVE" as const,
                reason: classChanged ? "CLASS_CHANGED" : "REACTIVATED",
              }
            : undefined,
          suspendPortalAccess: deactivated
            ? { reason: `STUDENT_STATUS_${effectiveStatus}` }
            : undefined,
        }
      : undefined;
    const atomicResult = enrollmentTransition && this.store.updateWithEnrollmentTransition
      ? await this.store.updateWithEnrollmentTransition(id, studentUpdate, enrollmentTransition)
      : undefined;
    const updated = atomicResult?.student ?? await this.store.update(id, studentUpdate);
    if (!updated) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    if (!atomicResult && enrollmentTransition) {
      await this.enrollmentStore.closeActiveForStudent(
        updated.id,
        enrollmentTransition.closeActive.endsAt,
        enrollmentTransition.closeActive.status,
      );
      if (enrollmentTransition.create) {
        await this.enrollmentStore.create({
          tenantId: updated.tenantId,
          studentId: updated.id,
          ...enrollmentTransition.create,
        });
      }
    }
    await this.auditLogs?.record({
      tenantId: updated.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: updated.id,
      action: "student.updated",
      diff: {
        fieldsChanged: changedFields,
        ...(atomicResult?.portalAccess
          ? {
              portalAccessSuspended: true,
              membershipSuspended: atomicResult.portalAccess.membershipSuspended,
              sessionsRevoked: atomicResult.portalAccess.sessionsRevoked,
              invitationsRevoked: atomicResult.portalAccess.invitationsRevoked,
            }
          : {}),
      },
    });
    return toPublicStudentRecord(updated);
  }

  async renewEnrollment(
    context: RequestContext,
    id: string,
    input: StudentEnrollmentActionInput,
    idempotencyKey?: string,
  ): Promise<StudentEnrollmentRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "student.enrollment.renew", request: { studentId: id, ...input } },
        () => this.renewEnrollmentOnce(context, id, input),
      );
    }

    return this.renewEnrollmentOnce(context, id, input);
  }

  private async renewEnrollmentOnce(
    context: RequestContext,
    id: string,
    input: StudentEnrollmentActionInput,
  ): Promise<StudentEnrollmentRecord> {
    const existing = await this.findOne(context, id);
    const startsAt = input.startsAt ? enrollmentDate(input.startsAt) : todayDateString();
    const academicContext = await this.resolveEnrollmentAcademicContext(context, input);
    const classId = input.classId !== undefined ? optionalText(input.classId) : existing.classId;
    await this.assertStudentRelationTargets(context, existing.tenantId, { classId });
    const transition = {
      closeActive: { endsAt: startsAt },
      create: {
        classId,
        ...academicContext,
        startsAt,
        status: "ACTIVE" as const,
        reason: "RENEWED",
      },
    };
    const atomicResult = this.store.updateWithEnrollmentTransition
      ? await this.store.updateWithEnrollmentTransition(id, { classId, status: "ACTIVE" }, transition)
      : undefined;
    const updated = atomicResult?.student ?? await this.store.update(id, { classId, status: "ACTIVE" });
    if (!updated) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    const enrollment = atomicResult?.enrollment ?? await (async () => {
      await this.enrollmentStore.closeActiveForStudent(updated.id, startsAt);
      return this.enrollmentStore.create({
        tenantId: updated.tenantId,
        studentId: updated.id,
        ...transition.create,
      });
    })();
    await this.auditLogs?.record({
      tenantId: updated.tenantId,
      actorUserId: context.userId,
      entityType: "StudentEnrollment",
      entityId: enrollment.id,
      action: "student.enrollment_renewed",
      diff: { studentId: updated.id, classId, ...academicContext },
    });
    return enrollment;
  }

  async bulkRenewEnrollments(
    context: RequestContext,
    input: StudentBulkEnrollmentInput,
    idempotencyKey?: string,
  ): Promise<StudentBulkEnrollmentResult> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "student.enrollment.bulk-renew", request: input },
        () => this.bulkRenewEnrollmentBatch(context, input),
      );
    }

    return this.bulkRenewEnrollmentBatch(context, input);
  }

  private async bulkRenewEnrollmentBatch(context: RequestContext, input: StudentBulkEnrollmentInput): Promise<StudentBulkEnrollmentResult> {
    const studentIds = [...new Set(input.studentIds ?? [])].filter(Boolean);
    if (studentIds.length === 0) {
      throw new BadRequestException("STUDENT_BULK_ENROLLMENT_STUDENTS_REQUIRED");
    }

    const students = await Promise.all(studentIds.map((studentId) => this.findOne(context, studentId)));
    const automaticClassMapping = input.useAutomaticClassMapping ? await this.buildAutomaticClassMapping(context) : {};
    const renewals = students.map((student) => {
      const mappedClassId = student.classId ? input.classIdBySourceClassId?.[student.classId] : undefined;
      const automaticClassId = student.classId ? automaticClassMapping[student.classId] : undefined;
      return {
        student,
        classId: mappedClassId ?? automaticClassId ?? input.classId,
      };
    });
    await Promise.all(
      renewals.map(({ student, classId }) => this.assertStudentRelationTargets(context, student.tenantId, { classId })),
    );

    const enrollments: StudentEnrollmentRecord[] = [];
    for (const { student, classId } of renewals) {
      enrollments.push(await this.renewEnrollment(context, student.id, {
        academicYearId: input.academicYearId,
        termId: input.termId,
        classId,
        startsAt: input.startsAt,
      }));
    }
    return {
      updatedCount: enrollments.length,
      enrollments,
    };
  }

  private async buildAutomaticClassMapping(context: RequestContext): Promise<Record<string, string>> {
    const classes = this.filterCampusScopedClasses(
      context,
      filterTenantResources(context, await this.classStore.list()).filter((record) => !record.deletedAt),
    );
    const gradeLevels = filterTenantResources(context, await this.gradeLevelStore.list()).filter((record) => !record.deletedAt);
    const gradeLevelById = new Map(gradeLevels.map((record) => [record.id, record]));
    const mapping: Record<string, string> = {};

    for (const sourceClass of classes) {
      const targetGradeCode = nextGradeCode(resolveClassGradeCode(sourceClass, gradeLevelById));
      if (!targetGradeCode) continue;

      const targetClass = classes.find((candidate) =>
        candidate.id !== sourceClass.id &&
        resolveClassGradeCode(candidate, gradeLevelById) === targetGradeCode &&
        (!sourceClass.campusId || candidate.campusId === sourceClass.campusId) &&
        (!sourceClass.section || candidate.section === sourceClass.section),
      );
      if (targetClass) {
        mapping[sourceClass.id] = targetClass.id;
      }
    }

    return mapping;
  }

  async transferEnrollment(
    context: RequestContext,
    id: string,
    input: StudentEnrollmentActionInput,
    idempotencyKey?: string,
  ): Promise<StudentEnrollmentRecord | null> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "student.enrollment.transfer", request: { studentId: id, ...input } },
        () => this.transferEnrollmentOnce(context, id, input),
      );
    }

    return this.transferEnrollmentOnce(context, id, input);
  }

  private async transferEnrollmentOnce(
    context: RequestContext,
    id: string,
    input: StudentEnrollmentActionInput,
  ): Promise<StudentEnrollmentRecord | null> {
    const existing = await this.findOne(context, id);
    const startsAt = input.startsAt ? enrollmentDate(input.startsAt) : todayDateString();
    const academicContext = await this.resolveEnrollmentAcademicContext(context, input);
    const classId = input.classId !== undefined ? optionalText(input.classId) : undefined;
    await this.assertStudentRelationTargets(context, existing.tenantId, { classId });
    const nextStatus: StudentStatus = classId ? "ACTIVE" : "TRANSFERRED";
    const transition = {
      closeActive: { endsAt: startsAt, status: classId ? undefined : "TRANSFERRED" as const },
      create: classId ? {
        classId,
        ...academicContext,
        startsAt,
        status: "ACTIVE" as const,
        reason: "TRANSFERRED",
      } : undefined,
    };
    const atomicResult = this.store.updateWithEnrollmentTransition
      ? await this.store.updateWithEnrollmentTransition(id, { classId: classId ?? "", status: nextStatus }, transition)
      : undefined;
    const updated = atomicResult?.student ?? await this.store.update(id, {
      classId: classId ?? "",
      status: nextStatus,
    });
    if (!updated) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    if (!atomicResult) {
      await this.enrollmentStore.closeActiveForStudent(updated.id, startsAt, classId ? undefined : "TRANSFERRED");
    }
    if (!classId) {
      await this.auditLogs?.record({
        tenantId: updated.tenantId,
        actorUserId: context.userId,
        entityType: "Student",
        entityId: updated.id,
        action: "student.transferred_out",
        diff: { studentId: updated.id },
      });
      return null;
    }

    const enrollment = atomicResult?.enrollment ?? await this.enrollmentStore.create({
      tenantId: updated.tenantId,
      studentId: updated.id,
      ...transition.create!,
    });
    await this.auditLogs?.record({
      tenantId: updated.tenantId,
      actorUserId: context.userId,
      entityType: "StudentEnrollment",
      entityId: enrollment.id,
      action: "student.enrollment_transferred",
      diff: { studentId: updated.id, classId, ...academicContext },
    });
    return enrollment;
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findOne(context, id);
    if (!this.identityProvisioning) {
      throw new Error("PROFILE_LIFECYCLE_STORE_UNAVAILABLE");
    }
    const deletedAt = new Date().toISOString();
    const lifecycle = await this.identityProvisioning.deactivateProfile({
      tenantId: existing.tenantId,
      subjectType: "STUDENT",
      subjectId: existing.id,
      deletedAt,
    });
    if (!lifecycle) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: existing.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: existing.id,
      action: "student.deleted",
      diff: {
        deletedAt,
        accountAccessClosed: Boolean(lifecycle.userId),
        roleRemoved: lifecycle.roleRemoved,
        sessionsClosed: lifecycle.sessionsClosed,
        invitationsRevoked: lifecycle.invitationsRevoked,
      },
    });
  }

  async purgePii(context: RequestContext, id: string): Promise<PublicStudentRecord> {
    const student = await this.findOne(context, id);
    if (!this.reportSnapshots.purgeStudentIdentity) {
      throw new Error("REPORT_SNAPSHOT_PURGE_UNAVAILABLE");
    }
    const reportSnapshotsPurged = await this.reportSnapshots.purgeStudentIdentity(student.tenantId, student.id);
    if (!this.studentContactStore?.purgeByStudent) {
      throw new Error("STUDENT_CONTACT_PURGE_UNAVAILABLE");
    }
    const studentContactsPurged = await this.studentContactStore.purgeByStudent(student.tenantId, student.id);
    const purged = await this.store.purgePii(id);
    if (!purged) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: purged.tenantId,
      actorUserId: context.userId,
      entityType: "StudentContact",
      entityId: purged.id,
      action: "kvkk.student_contact_pii_purged",
      diff: {
        studentId: purged.id,
        recordCount: studentContactsPurged,
      },
    });
    await this.auditLogs?.record({
      tenantId: purged.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: purged.id,
      action: "kvkk.student_pii_purged",
      diff: {
        fieldsPurged: [
          "firstName",
          "lastName",
          "nationalIdEncrypted",
          "nationalIdHash",
          "phone",
          "email",
          "photoKey",
          "ReportSnapshot.displayName",
          "ReportSnapshot.studentNo",
          "StudentContact.firstName",
          "StudentContact.lastName",
          "StudentContact.relationType",
          "StudentContact.phoneEncrypted",
          "StudentContact.phoneHash",
          "StudentContact.emailEncrypted",
          "StudentContact.emailHash",
          "StudentContact.canReceiveSms",
          "StudentContact.canReceiveAnnouncements",
          "StudentContact.canReceiveFinance",
          "StudentContact.consentSource",
          "StudentContact.consentRecordedAt",
        ],
        reportSnapshotPurgeCount: reportSnapshotsPurged,
        studentContactPurgeCount: studentContactsPurged,
      },
    });
    return toPublicStudentRecord(purged);
  }

  async updateTenant(context: RequestContext, id: string, tenantId: string): Promise<PublicStudentRecord> {
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
    return toPublicStudentRecord(updated);
  }

  private assertAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
  }

  private assertCampusScopePresent(context: RequestContext): void {
    if (context.roles.includes("OPERATIONS_STAFF") && !context.campusScope) {
      throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_MISSING");
    }
  }

  private async assertPortalManagedStudentAccess(context: RequestContext, id: string): Promise<void> {
    const student = await this.store.findById(id);
    if (!student || student.deletedAt || student.tenantId !== context.tenantId) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.assertStudentCampusScope(context, student);
  }

  private isCampusRestricted(context: RequestContext): boolean {
    this.assertCampusScopePresent(context);
    return context.campusScope?.scopeMode === "CAMPUSES";
  }

  private filterCampusScopedClasses(context: RequestContext, classes: ClassRecord[]): ClassRecord[] {
    if (!this.isCampusRestricted(context)) return classes;
    const campusIds = new Set(context.campusScope!.campusIds);
    return classes.filter((record) => Boolean(record.campusId && campusIds.has(record.campusId)));
  }

  private async filterCampusScopedStudents(context: RequestContext, students: StudentRecord[]): Promise<StudentRecord[]> {
    if (!this.isCampusRestricted(context)) return students;
    const allowedClassIds = new Set(
      this.filterCampusScopedClasses(context, filterTenantResources(context, await this.classStore.list()))
        .map((record) => record.id),
    );
    return students.filter((student) => Boolean(student.classId && allowedClassIds.has(student.classId)));
  }

  private async assertStudentCampusScope(context: RequestContext, student: Pick<StudentRecord, "classId" | "tenantId">): Promise<void> {
    if (!this.isCampusRestricted(context)) return;
    if (!student.classId) throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    const schoolClass = await this.classStore.findById(student.classId);
    if (!schoolClass || schoolClass.deletedAt || schoolClass.tenantId !== student.tenantId) {
      throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    }
    const campusIds = new Set(context.campusScope!.campusIds);
    if (!schoolClass.campusId || !campusIds.has(schoolClass.campusId)) {
      throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    }
  }

  private async assertCampusScopeAllowsClass(context: RequestContext, classId: string | undefined): Promise<void> {
    if (!this.isCampusRestricted(context)) return;
    if (!classId) throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    const schoolClass = await this.classStore.findById(classId);
    if (!schoolClass || schoolClass.deletedAt) throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    this.assertAccess(context, schoolClass);
    const campusIds = new Set(context.campusScope!.campusIds);
    if (!schoolClass.campusId || !campusIds.has(schoolClass.campusId)) {
      throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    }
  }

  private async assertStudentRelationTargets(
    context: RequestContext,
    tenantId: string,
    input: { classId?: string; responsibleTeacherId?: string },
  ): Promise<void> {
    if (input.classId) {
      const schoolClass = await this.classStore.findById(input.classId);
      if (!schoolClass || schoolClass.deletedAt) {
        throw new NotFoundException("CLASS_NOT_FOUND");
      }
      this.assertSameTenantRelationTarget(context, tenantId, schoolClass);
      await this.assertCampusScopeAllowsClass(context, schoolClass.id);
    }

    if (input.responsibleTeacherId) {
      const teacher = await this.teacherStore.findById(input.responsibleTeacherId);
      if (!teacher) {
        throw new NotFoundException("TEACHER_NOT_FOUND");
      }
      this.assertSameTenantRelationTarget(context, tenantId, teacher);
    }
  }

  private assertSameTenantRelationTarget(
    context: RequestContext,
    tenantId: string,
    target: { tenantId: string },
  ): void {
    this.assertAccess(context, target);
    if (target.tenantId !== tenantId) {
      throw new ForbiddenException("FORBIDDEN_TENANT");
    }
  }

  private async autoProvisionGuardian(
    context: RequestContext,
    student: StudentRecord,
    input: StudentGuardianProvisionInput,
  ): Promise<void> {
    const guardianInput = parseGuardianProvisionInput(input, student);
    const identity = this.resolveGuardianIdentity(guardianInput.nationalId);
    const nationalIdMatch = identity.nationalIdHash
      ? await this.guardianStore.findByNationalIdHash(student.tenantId, identity.nationalIdHash)
      : undefined;
    const phoneMatch = await this.findGuardianByPhone(student.tenantId, guardianInput.phone);
    if (nationalIdMatch && phoneMatch && nationalIdMatch.id !== phoneMatch.id) {
      throw new ConflictException("GUARDIAN_IDENTITY_CONFLICT");
    }

    const existingGuardian = nationalIdMatch ?? phoneMatch;
    let guardian = existingGuardian ? await this.updateMatchedGuardian(existingGuardian, guardianInput.phone, identity) : undefined;
    if (!guardian) {
      guardian = await this.guardianStore.create({
        tenantId: student.tenantId,
        firstName: guardianInput.firstName,
        lastName: guardianInput.lastName,
        phone: guardianInput.phone,
        ...identity,
      });
    }

    const link = await this.guardianStudentStore.create({
      tenantId: student.tenantId,
      guardianId: guardian.id,
      studentId: student.id,
      canViewFinance: guardianInput.canViewFinance,
      canReceiveSms: guardianInput.canReceiveSms,
      canReceiveAnnouncements: guardianInput.canReceiveAnnouncements,
      canOpenSupportTickets: guardianInput.canOpenSupportTickets,
    });

    const { invitationId } = await this.provisionOrInviteGuardianAccount(context, guardian, guardianInput);

    await this.auditLogs?.record({
      tenantId: student.tenantId,
      actorUserId: context.userId,
      entityType: "GuardianStudent",
      entityId: link.id,
      action: "guardian.auto_provisioned",
      diff: {
        guardianId: guardian.id,
        studentId: student.id,
        invitationId,
      },
    });
  }

  private resolveGuardianIdentity(nationalIdInput: string | undefined): Pick<GuardianRecord, "nationalIdEncrypted" | "nationalIdHash"> {
    const nationalIdText = optionalText(nationalIdInput);
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
  ): Promise<GuardianRecord | undefined> {
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

  private async provisionOrInviteGuardianAccount(
    context: RequestContext,
    guardian: GuardianRecord,
    input: ReturnType<typeof parseGuardianProvisionInput>,
  ): Promise<{ invitationId?: string }> {
    if (guardian.userId) return {};

    if (this.identityProvisioning) {
      const provisioning = await this.identityProvisioning.provisionOrInvite(context, {
        tenantId: guardian.tenantId,
        subjectType: "GUARDIAN",
        subjectId: guardian.id,
        displayName: `${guardian.firstName} ${guardian.lastName}`.trim(),
        nationalId: input.nationalId,
        phone: guardian.phone,
        email: input.email,
      });
      return provisioning.status === "INVITED" ? { invitationId: provisioning.invitationId } : {};
    }

    if (!input.email) return {};
    const invitation = await this.identityInvitations.create(context, {
      subjectType: "GUARDIAN",
      subjectId: guardian.id,
      email: input.email,
      name: `${guardian.firstName} ${guardian.lastName}`,
    });
    return { invitationId: invitation.invitation.id };
  }

  private async findGuardianByPhone(tenantId: string, phone: string | undefined): Promise<GuardianRecord | undefined> {
    if (!phone) return undefined;
    return this.guardianStore.findByPhone(tenantId, phone);
  }

  private async resolveProfileUpdateForCreate(
    tenantId: string,
    input: StudentBulkCreateInput,
    seenNationalIdHashes: Set<string>,
  ): Promise<StudentProfileUpdate | undefined> {
    const profileUpdate: StudentProfileUpdate = {};
    let hasUpdate = false;

    if (input.phone !== undefined) {
      const phone = optionalText(input.phone);
      if (phone !== undefined) {
        profileUpdate.phone = phone;
        hasUpdate = true;
      }
    }
    if (input.email !== undefined) {
      const email = optionalEmail(input.email);
      if (email !== undefined) {
        profileUpdate.email = email;
        hasUpdate = true;
      }
    }
    const nationalIdInput = optionalText(input.nationalId);
    if (nationalIdInput !== undefined) {
      const nationalId = normalizeTcIdentity(nationalIdInput);
      const nationalIdHash = hashTcIdentity(nationalId);
      if (seenNationalIdHashes.has(nationalIdHash)) {
        throw new ConflictException("STUDENT_NATIONAL_ID_CONFLICT");
      }
      const duplicate = await this.store.findByNationalIdHash(tenantId, nationalIdHash);
      if (duplicate) {
        throw new ConflictException("STUDENT_NATIONAL_ID_CONFLICT");
      }
      seenNationalIdHashes.add(nationalIdHash);
      profileUpdate.nationalIdEncrypted = encryptTcIdentity(nationalId);
      profileUpdate.nationalIdHash = nationalIdHash;
      hasUpdate = true;
    }

    return hasUpdate ? profileUpdate : undefined;
  }

  private async autoProvisionStudentAccount(
    context: RequestContext,
    student: StudentRecord,
    input: StudentProfileInput & Pick<StudentRecord, "firstName" | "lastName">,
  ): Promise<void> {
    if (!this.identityProvisioning || student.userId || student.status !== "ACTIVE") return;

    await this.identityProvisioning.provisionOrInvite(context, {
      tenantId: student.tenantId,
      subjectType: "STUDENT",
      subjectId: student.id,
      displayName: `${input.firstName} ${input.lastName}`.trim(),
      nationalId: input.nationalId,
      phone: input.phone,
      email: input.email,
    });
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

  private async resolveCurrentAcademicContext(context: RequestContext): Promise<{ academicYearId?: string; termId?: string }> {
    const years = filterTenantResources(context, await this.academicCalendarStore.listYears()).filter((year) => !year.deletedAt);
    const activeYear = years.find((year) => year.isActive);
    const terms = filterTenantResources(context, await this.academicCalendarStore.listTerms()).filter((term) => !term.deletedAt);
    const activeTerm = terms.find((term) => term.isActive && (!activeYear || term.academicYearId === activeYear.id));
    return {
      academicYearId: activeYear?.id ?? activeTerm?.academicYearId,
      termId: activeTerm?.id,
    };
  }

  private async resolveEnrollmentAcademicContext(
    context: RequestContext,
    input: StudentEnrollmentActionInput,
  ): Promise<{ academicYearId?: string; termId?: string }> {
    const fallback = await this.resolveCurrentAcademicContext(context);
    if (!input.academicYearId && !input.termId) {
      return fallback;
    }

    const years = filterTenantResources(context, await this.academicCalendarStore.listYears()).filter((year) => !year.deletedAt);
    const terms = filterTenantResources(context, await this.academicCalendarStore.listTerms()).filter((term) => !term.deletedAt);
    const term = input.termId ? terms.find((record) => record.id === input.termId) : undefined;
    if (input.termId && !term) {
      throw new BadRequestException("STUDENT_ENROLLMENT_TERM_INVALID");
    }

    const academicYearId = input.academicYearId ?? term?.academicYearId ?? fallback.academicYearId;
    if (input.academicYearId && !years.some((year) => year.id === input.academicYearId)) {
      throw new BadRequestException("STUDENT_ENROLLMENT_ACADEMIC_YEAR_INVALID");
    }
    if (term && academicYearId && term.academicYearId !== academicYearId) {
      throw new BadRequestException("STUDENT_ENROLLMENT_TERM_YEAR_MISMATCH");
    }

    return {
      academicYearId,
      termId: term?.id ?? fallback.termId,
    };
  }

  private async toStudentProfile(student: {
    id: string;
    tenantId: string;
    firstName: string;
    lastName: string;
    classId?: string;
    responsibleTeacherId?: string;
    status: StudentStatus;
    userId?: string;
    nationalIdEncrypted?: string;
    phone?: string;
    email?: string;
    photoKey?: string;
  }, includeSensitiveContact: boolean): Promise<StudentProfileRecord> {
    const [schoolClass, teacher] = await Promise.all([
      student.classId ? this.classStore.findById(student.classId) : undefined,
      student.responsibleTeacherId ? this.teacherStore.findById(student.responsibleTeacherId) : undefined,
    ]);
    const [campus, gradeLevel] = await Promise.all([
      schoolClass?.campusId ? this.campusStore.findById(schoolClass.campusId) : undefined,
      schoolClass?.gradeLevelId ? this.gradeLevelStore.findById(schoolClass.gradeLevelId) : undefined,
    ]);
    return toStudentProfile(student, {
      className: schoolClass?.tenantId === student.tenantId ? schoolClass.name : undefined,
      campusName: campus?.tenantId === student.tenantId ? campus.name : undefined,
      gradeLevelName: gradeLevel?.tenantId === student.tenantId ? gradeLevel.name : undefined,
      section: schoolClass?.tenantId === student.tenantId ? schoolClass.section : undefined,
      responsibleTeacherName: teacher?.tenantId === student.tenantId ? `${teacher.firstName} ${teacher.lastName}` : undefined,
    }, includeSensitiveContact);
  }

  private canViewStudentContact(context: RequestContext, studentId: string): boolean {
    return hasCapability(context, "privacy:manage")
      || (context.subjectType === "STUDENT" && context.subjectId === studentId);
  }

  private async withClassNames<TRecord extends { tenantId: string; classId?: string }>(
    records: TRecord[],
  ): Promise<Array<TRecord & { campusName?: string; className?: string; gradeLevelName?: string; section?: string }>> {
    const classIds = [...new Set(records.map((record) => record.classId).filter((id): id is string => Boolean(id)))];
    const classes = await Promise.all(classIds.map((id) => this.classStore.findById(id)));
    const classById = new Map(
      classes
        .filter((record): record is ClassRecord => Boolean(record))
        .map((record) => [record.id, record]),
    );
    const campusIds = [...new Set(classes.map((record) => record?.campusId).filter((id): id is string => Boolean(id)))];
    const gradeLevelIds = [...new Set(classes.map((record) => record?.gradeLevelId).filter((id): id is string => Boolean(id)))];
    const [campuses, gradeLevels] = await Promise.all([
      Promise.all(campusIds.map((id) => this.campusStore.findById(id))),
      Promise.all(gradeLevelIds.map((id) => this.gradeLevelStore.findById(id))),
    ]);
    const campusById = new Map(campuses.filter((record): record is NonNullable<typeof record> => Boolean(record)).map((record) => [record.id, record]));
    const gradeLevelById = new Map(gradeLevels.filter((record): record is NonNullable<typeof record> => Boolean(record)).map((record) => [record.id, record]));

    return records.map((record) => {
      const schoolClass = record.classId ? classById.get(record.classId) : undefined;
      const isTenantClass = schoolClass?.tenantId === record.tenantId;
      const campus = isTenantClass && schoolClass?.campusId ? campusById.get(schoolClass.campusId) : undefined;
      const gradeLevel = isTenantClass && schoolClass?.gradeLevelId ? gradeLevelById.get(schoolClass.gradeLevelId) : undefined;
      return {
        ...record,
        className: isTenantClass ? schoolClass.name : undefined,
        campusName: campus?.tenantId === record.tenantId ? campus.name : undefined,
        gradeLevelName: gradeLevel?.tenantId === record.tenantId ? gradeLevel.name : undefined,
        section: isTenantClass ? schoolClass.section : undefined,
      };
    });
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

function resolveClassGradeCode(record: ClassRecord, gradeLevelById: Map<string, GradeLevelRecord>): string | undefined {
  if (record.gradeLevelId) {
    const gradeLevelCode = gradeLevelById.get(record.gradeLevelId)?.code?.trim();
    if (gradeLevelCode) return gradeLevelCode;
  }
  return undefined;
}

function nextGradeCode(code: string | undefined): string | undefined {
  if (!code || !/^\d+$/.test(code)) return undefined;
  return String(Number.parseInt(code, 10) + 1);
}

function toPublicStudentRecord(student: StudentRecord): PublicStudentRecord {
  return {
    id: student.id,
    tenantId: student.tenantId,
    studentNo: student.studentNo,
    firstName: student.firstName,
    lastName: student.lastName,
    classId: student.classId,
    responsibleTeacherId: student.responsibleTeacherId,
    status: student.status,
  };
}

function omitStudentId(input: StudentContactStoreInput): Omit<StudentContactStoreInput, "studentId"> {
  const { studentId: _studentId, ...rest } = input;
  return rest;
}

function toStudentProfile(student: {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  classId?: string;
  responsibleTeacherId?: string;
  status: StudentStatus;
  nationalIdEncrypted?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
}, labels: { campusName?: string; className?: string; gradeLevelName?: string; responsibleTeacherName?: string; section?: string } = {}, includeSensitiveContact = false): PublicStudentProfileRecord {
  return {
    id: student.id,
    tenantId: student.tenantId,
    firstName: student.firstName,
    lastName: student.lastName,
    classId: student.classId,
    responsibleTeacherId: student.responsibleTeacherId,
    status: student.status,
    ...(labels.className ? { className: labels.className } : {}),
    ...(labels.campusName ? { campusName: labels.campusName } : {}),
    ...(labels.gradeLevelName ? { gradeLevelName: labels.gradeLevelName } : {}),
    ...(labels.section ? { section: labels.section } : {}),
    ...(labels.responsibleTeacherName ? { responsibleTeacherName: labels.responsibleTeacherName } : {}),
    nationalIdMasked: student.nationalIdEncrypted ? maskTcIdentity(decryptTcIdentity(student.nationalIdEncrypted)) : undefined,
    ...(student.phone ? { phoneMasked: maskContactPhone(student.phone) } : {}),
    ...(student.email ? { emailMasked: maskContactEmail(student.email) } : {}),
    ...(includeSensitiveContact && student.phone ? { phone: student.phone } : {}),
    ...(includeSensitiveContact && student.email ? { email: student.email } : {}),
    photoKey: student.photoKey,
  };
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function enrollmentDate(value: string): string {
  const trimmed = value.trim();
  if (!isCalendarDateString(trimmed)) {
    throw new BadRequestException("STUDENT_ENROLLMENT_STARTS_AT_INVALID");
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

function optionalStudentPhotoKey(studentId: string, value: string | undefined): string | undefined {
  const trimmed = optionalText(value);
  if (trimmed === undefined) return undefined;
  if (
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    /^(https?:|s3:|gs:)/i.test(trimmed) ||
    !trimmed.startsWith(`students/${studentId}/`)
  ) {
    throw new BadRequestException("STUDENT_PHOTO_KEY_INVALID");
  }
  return trimmed;
}

function isCalendarDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

function parseGuardianProvisionInput(input: StudentGuardianProvisionInput, student: Pick<StudentRecord, "lastName">) {
  const phone = optionalTurkishMobilePhone(input.phone, "GUARDIAN_PHONE_INVALID");
  const email = optionalGuardianEmail(input.email);
  if (!phone && !email) {
    throw new BadRequestException("GUARDIAN_CONTACT_REQUIRED");
  }

  return {
    firstName: optionalGuardianText(input.firstName) ?? "Veli",
    lastName: optionalGuardianText(input.lastName) ?? optionalGuardianText(student.lastName) ?? "Veli",
    nationalId: optionalGuardianText(input.nationalId),
    phone,
    email,
    canViewFinance: input.canViewFinance,
    canReceiveSms: input.canReceiveSms,
    canReceiveAnnouncements: input.canReceiveAnnouncements,
    canOpenSupportTickets: input.canOpenSupportTickets,
  };
}

function optionalGuardianText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function optionalGuardianEmail(value: string | undefined): string | undefined {
  const email = optionalGuardianText(value)?.toLowerCase();
  if (!email) return undefined;
  if (!email.includes("@")) {
    throw new BadRequestException("GUARDIAN_EMAIL_INVALID");
  }
  return email;
}
