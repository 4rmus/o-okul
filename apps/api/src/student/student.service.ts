import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type {
  StudentBulkEnrollmentRequest,
  StudentBulkEnrollmentResult as SharedStudentBulkEnrollmentResult,
  StudentCreateRequest,
  StudentContactCreateRequest,
  StudentEnrollmentActionRequest,
  StudentEnrollmentRecord,
  StudentUpdateRequest,
  PublicStudentProfileRecord,
  PublicStudentRecord,
  StudentProfileRecord,
  StudentPortalAccessRecord,
  StudentPortalAccessUpdateRequest,
  StudentPortalAccessUpdateResult,
  StudentPortalInvitationIssueResponse,
  StudentRecord as SharedStudentRecord,
  StudentListSort,
  StudentStatus,
  TeacherAssignmentRecord,
} from "@o-okul/shared-types";
import { AuditLogService, sanitizeAuditDiff } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import type { Queryable } from "../db/tenant-query.js";
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
import { StudentPortalActivationService } from "../identity-invitation/student-portal-activation.service.js";
import { IdentityProvisioningService } from "../identity-provisioning/identity-provisioning.service.js";
import { IdempotencyService } from "../http/idempotency.js";
import { withCursorListMeta } from "../listing/list-query.js";
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
import {
  type StudentCreateManyInput,
  type StudentImportBatchAudit,
  type StudentImportBatchRow,
  type StudentPortalAccessQuery,
  type StudentProfileStorageRecord,
  type StudentProfileUpdate,
  type StudentRegistryQuery,
  type StudentStore,
  studentCursorInvalid,
  studentImportBatchErrors,
  studentStoreToken,
} from "./student-store.js";
import {
  type StudentEnrollmentInput,
  type StudentEnrollmentStore,
  studentEnrollmentStoreToken,
} from "./student-enrollment-store.js";
import { decryptTcIdentity, encryptTcIdentity, hashTcIdentity, isValidTcIdentity, maskTcIdentity, normalizeTcIdentity } from "./tc-identity.js";
import { buildStudentContactStorageInput } from "./student-contact-input.js";
import { recordContactGuardianRemoval } from "../guardian/guardian-role-audit.js";
import { type StudentContactStore, studentContactStoreToken } from "./student-contact-store.js";

export interface StudentRecord extends SharedStudentRecord {
  deletedAt?: string;
}

const studentStatuses: StudentStatus[] = ["ACTIVE", "PASSIVE", "GRADUATED", "TRANSFERRED"];
const studentRegistrySorts = new Set<string>([
  "studentNo", "-studentNo", "firstName", "-firstName", "lastName", "-lastName", "classId", "-classId",
] satisfies StudentListSort[]);

function isStudentListSort(value: string): value is StudentListSort {
  return studentRegistrySorts.has(value);
}
const defaultStudentQuota = 200;

export interface StudentQuotaPreview {
  limit: number;
  current: number;
  incoming: number;
  wouldExceed: boolean;
}

export interface StudentRegistryListInput {
  cursor?: string;
  direction: "next" | "previous";
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
export type StudentCreateInput = StudentCreateRequest;
export type StudentBulkCreateInput = Pick<StudentRecord, "firstName" | "lastName"> &
  Partial<Pick<StudentRecord, "gradeLevelId" | "classId" | "studentNo">> &
  StudentProfileInput & {
    contact?: StudentContactCreateRequest;
  };

/** An audit written with the bulk create (same transaction when the store supports `importBatch`). */
export type StudentBulkCreateAudit = StudentImportBatchAudit;

export interface StudentBulkCreateOptions {
  /** Placement lookups already loaded by the caller (the import validator); loaded from the stores otherwise. */
  classById?: ReadonlyMap<string, ClassRecord>;
  gradeLevelById?: ReadonlyMap<string, GradeLevelRecord>;
  extraAudits?: StudentBulkCreateAudit[];
  /** Runs on the import transaction after every write; only called when the store supports `importBatch`. */
  finalize?: (client: Queryable, students: StudentRecord[]) => Promise<void>;
}

@Injectable()
export class StudentService {
  private readonly testStudentQuota = Number.parseInt(process.env.STUDENT_QUOTA ?? "", 10) || undefined;

  constructor(
    @Inject(studentStoreToken) private readonly store: StudentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    @Inject(studentEnrollmentStoreToken) private readonly enrollmentStore: StudentEnrollmentStore,
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(campusStoreToken) private readonly campusStore: CampusStore,
    @Inject(classStoreToken) private readonly classStore: ClassStore,
    @Inject(gradeLevelStoreToken) private readonly gradeLevelStore: GradeLevelStore,
    @Inject(teacherStoreToken) private readonly teacherStore: TeacherStore,
    @Inject(reportSnapshotStoreToken) private readonly reportSnapshots: ReportSnapshotStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly identityProvisioning?: IdentityProvisioningService,
    @Optional() @Inject(licenseTermStoreToken) private readonly licenseTerms?: LicenseTermStore,
    @Optional() private readonly studentPortalActivations?: StudentPortalActivationService,
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
    return this.withAssignedTeachers(context, (await this.list(context)).map(toPublicStudentRecord));
  }

  /**
   * UAT F-22: the list column "Sorumlu öğretmen" resolves from the same active assignment rows the student detail
   * lists (GET /students/:id/teacher-assignments). `responsibleTeacherId` stays the stored field; the fallback is a
   * read-model field (student-level RESPONSIBLE_TEACHER first, then the class's CLASS_TEACHER).
   */
  private async withAssignedTeachers(context: RequestContext, records: PublicStudentRecord[]): Promise<PublicStudentRecord[]> {
    if (records.every((record) => record.responsibleTeacherId)) return records;
    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.list()).filter(isAssignmentActive);
    const byStudent = new Map<string, TeacherAssignmentRecord>();
    const byClass = new Map<string, TeacherAssignmentRecord>();
    for (const assignment of assignments) {
      if (assignment.role === "RESPONSIBLE_TEACHER" && assignment.studentId && !byStudent.has(assignment.studentId)) {
        byStudent.set(assignment.studentId, assignment);
      }
      if (assignment.role === "CLASS_TEACHER" && assignment.classId && !assignment.studentId && !byClass.has(assignment.classId)) {
        byClass.set(assignment.classId, assignment);
      }
    }
    return records.map((record) => {
      if (record.responsibleTeacherId) return record;
      const assignment = byStudent.get(record.id) ?? (record.classId ? byClass.get(record.classId) : undefined);
      return assignment ? { ...record, assignedTeacherId: assignment.teacherId, assignedTeacherRole: assignment.role } : record;
    });
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
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new BadRequestException("LIST_LIMIT_INVALID");
    }
    if (input.q && input.q.length > 100) throw new BadRequestException("LIST_QUERY_INVALID");
    const sort = input.sort || "lastName";
    if (!isStudentListSort(sort)) throw new BadRequestException("LIST_SORT_INVALID");

    const classes = filterTenantResources(context, await this.classStore.list()).filter((record) => !record.deletedAt);
    const requestedClassIds = classes
      .filter((record) => !input.classId || record.id === input.classId)
      .filter((record) => context.campusScope?.scopeMode !== "CAMPUSES"
        || Boolean(record.campusId && context.campusScope.campusIds.includes(record.campusId)))
      .map((record) => record.id);
    const classFilterRequested = Boolean(input.classId || context.campusScope?.scopeMode === "CAMPUSES");
    const registryQuery: StudentRegistryQuery = {
      cursor: input.cursor,
      direction: input.direction,
      limit: input.limit,
      q: input.q,
      sort,
      ids: input.ids,
      gradeLevelId: input.level,
      classId: input.classId,
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

    try {
      const page = await this.store.listRegistryPage(context.tenantId, registryQuery);
      return withCursorListMeta(await this.withAssignedTeachers(context, page.records.map(toPublicStudentRecord)), page.meta);
    } catch (error) {
      if (error instanceof Error && error.message === studentCursorInvalid) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Returns the trimmed numbers that an active student of the tenant already uses. */
  async findExistingStudentNos(context: RequestContext, studentNos: string[]): Promise<Set<string>> {
    if (!context.tenantId || context.bypassRls) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }
    const normalized = [...new Set(studentNos.map((studentNo) => studentNo.trim()).filter(Boolean))];
    return new Set(normalized.length > 0 ? await this.store.findExistingStudentNos(context.tenantId, normalized) : []);
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
      // Soft-deleted students count: `Student_tenantId_nationalIdHash_key` keeps their hash. Only this student may hold it.
      if ((await this.store.findExistingNationalIdHashes(student.tenantId, [nationalIdHash], { includeDeleted: true })).length > 0
        && (await this.store.findProfileById(student.id))?.nationalIdHash !== nationalIdHash) {
        throw new ConflictException("STUDENT_NATIONAL_ID_CONFLICT");
      }

      profileUpdate.nationalIdEncrypted = encryptTcIdentity(nationalId);
      profileUpdate.nationalIdHash = nationalIdHash;
    }

    let updated: StudentProfileStorageRecord | undefined;
    try {
      updated = await this.store.updateProfile(id, profileUpdate);
    } catch (error) {
      throw toStudentUniqueConflictException(error);
    }
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
    const placement = await this.resolveStudentPlacement(context, tenantId, {
      classId: input.classId,
      gradeLevelId: input.gradeLevelId,
    }, true);
    if (input.studentNo && (await this.list(context)).some((student) => student.tenantId === tenantId && student.studentNo === input.studentNo?.trim())) {
      throw new ConflictException("STUDENT_NO_CONFLICT");
    }
    const incomingActiveStudents = resolveStudentStatus(input.status) === "ACTIVE" && Boolean(placement.gradeLevelId) ? 1 : 0;
    if ((await this.previewQuota(context, incomingActiveStudents)).wouldExceed) {
      throw new ConflictException("ACTIVE_STUDENT_LIMIT_REACHED");
    }
    await this.assertStudentRelationTargets(context, tenantId, {
      responsibleTeacherId: input.responsibleTeacherId,
    });
    const profile = await this.resolveProfileUpdateForCreate(tenantId, input, new Set());

    // Profile PII goes into the student INSERT itself: no post-commit profile write (DEC-20261021-02 (c)).
    const studentInput = {
      ...profile,
      tenantId,
      studentNo: input.studentNo,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      gradeLevelId: placement.gradeLevelId,
      classId: placement.classId,
      responsibleTeacherId: input.responsibleTeacherId,
      status: resolveStudentStatus(input.status),
    };
    let student: StudentRecord;
    if (studentInput.gradeLevelId) {
      const academicContext = await this.resolveCurrentAcademicContext(context);
      const enrollment = {
        gradeLevelId: studentInput.gradeLevelId,
        classId: studentInput.classId,
        ...academicContext,
        startsAt: todayDateString(),
        status: studentInput.status,
        reason: "CREATED",
      };
      if (this.store.createWithEnrollment) {
        student = await this.createStudentRow(() => this.store.createWithEnrollment!(studentInput, enrollment));
      } else {
        student = await this.createStudentRow(() => this.store.create(studentInput));
        await this.enrollmentStore.create({ tenantId: student.tenantId, studentId: student.id, ...enrollment });
      }
    } else {
      student = await this.createStudentRow(() => this.store.create(studentInput));
    }
    await this.autoProvisionStudentAccount(context, student, input);
    await this.auditLogs?.record({
      tenantId: student.tenantId,
      actorUserId: context.userId,
      entityType: "Student",
      entityId: student.id,
      action: "student.created",
      diff: { fieldsSet: presentFields(student, ["studentNo", "firstName", "lastName", "gradeLevelId", "classId", "responsibleTeacherId", "status"]) },
    });
    return student;
  }

  async createMany(
    context: RequestContext,
    inputs: StudentBulkCreateInput[],
    options: StudentBulkCreateOptions = {},
  ): Promise<StudentRecord[]> {
    const tenantId = context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId });
    const classById = options.classById ?? new Map((await this.classStore.list()).map((record) => [record.id, record]));
    const gradeLevelById = options.gradeLevelById
      ?? new Map((await this.gradeLevelStore.list()).map((record) => [record.id, record]));
    const placements = inputs.map((input) => this.resolveBulkPlacement(context, tenantId, input, classById, gradeLevelById));
    const quota = await this.previewQuota(context, placements.filter((placement) => Boolean(placement.gradeLevelId)).length);
    if (quota.wouldExceed) {
      throw new ConflictException("ACTIVE_STUDENT_LIMIT_REACHED");
    }

    const seenNationalIdHashes = new Set<string>();
    const profiles = inputs.map((input) => resolveBulkProfile(input, seenNationalIdHashes));
    const academicContext = await this.resolveCurrentAcademicContext(context);
    const startsAt = todayDateString();
    const studentInputs = inputs.map((input, index): StudentCreateManyInput => {
      const placement = placements[index]!;
      return {
        tenantId,
        studentNo: input.studentNo,
        firstName: input.firstName,
        lastName: input.lastName,
        gradeLevelId: placement.gradeLevelId,
        classId: placement.classId,
        status: "ACTIVE",
        ...profiles[index],
      };
    });
    const enrollmentFor = (index: number) => {
      const placement = placements[index]!;
      return placement.gradeLevelId ? {
        gradeLevelId: placement.gradeLevelId,
        classId: placement.classId,
        ...academicContext,
        startsAt,
        status: "ACTIVE" as const,
        reason: "CREATED",
      } : undefined;
    };
    const contactAudit = (studentId: string, contact: StudentContactCreateRequest): StudentBulkCreateAudit => ({
      entityType: "StudentContact",
      entityId: studentId,
      action: "student_contact.imported",
      diff: {
        studentId,
        relationType: contact.relationType,
        hasPhone: Boolean(contact.phone),
        hasEmail: Boolean(contact.email),
        permissionsDefaultOff: true,
      },
    });

    if (!this.store.importBatch) {
      return this.createManySequential(context, tenantId, inputs, studentInputs, enrollmentFor, contactAudit, options);
    }

    const rows: StudentImportBatchRow[] = studentInputs.map((student, index) => {
      const id = randomUUID();
      const contact = inputs[index]!.contact;
      return {
        id,
        student,
        enrollment: enrollmentFor(index),
        contact: contact ? buildStudentContactStorageInput(tenantId, id, contact) : undefined,
      };
    });
    const audits = this.auditLogs
      ? [
          ...rows.flatMap((row, index) => {
            const contact = inputs[index]!.contact;
            return contact ? [contactAudit(row.id, contact)] : [];
          }),
          ...(options.extraAudits ?? []),
        ].map((audit) => ({ ...audit, diff: sanitizeAuditDiff(audit.diff) }))
      : [];
    try {
      return await this.store.importBatch({
        tenantId,
        actorUserId: context.userId,
        rows,
        audits,
        auditCreatedAt: new Date().toISOString(),
        activeStudentLimit: quota.limit,
        campusIds: this.isCampusRestricted(context) ? [...context.campusScope!.campusIds] : undefined,
        finalize: options.finalize,
      });
    } catch (error) {
      throw toStudentImportBatchException(error);
    }
  }

  /** In-memory stores: same checks and records, written one store call at a time. */
  private async createManySequential(
    context: RequestContext,
    tenantId: string,
    inputs: StudentBulkCreateInput[],
    studentInputs: StudentCreateManyInput[],
    enrollmentFor: (index: number) => Omit<StudentEnrollmentInput, "tenantId" | "studentId"> | undefined,
    contactAudit: (studentId: string, contact: StudentContactCreateRequest) => StudentBulkCreateAudit,
    options: StudentBulkCreateOptions,
  ): Promise<StudentRecord[]> {
    const nationalIdHashes = studentInputs
      .map((input) => input.nationalIdHash)
      .filter((hash): hash is string => Boolean(hash));
    if (nationalIdHashes.length > 0
      && (await this.store.findExistingNationalIdHashes(tenantId, nationalIdHashes, { includeDeleted: true })).length > 0) {
      throw new ConflictException("STUDENT_NATIONAL_ID_CONFLICT");
    }
    if (inputs.some((input) => input.contact) && !this.studentContactStore) {
      throw new Error("STUDENT_CONTACT_STORE_UNAVAILABLE");
    }

    const students = await this.store.createMany(studentInputs);
    for (const [index, student] of students.entries()) {
      const enrollment = enrollmentFor(index);
      if (!enrollment) continue;
      await this.enrollmentStore.create({ tenantId: student.tenantId, studentId: student.id, ...enrollment });
    }
    for (const [index, student] of students.entries()) {
      const contact = inputs[index]?.contact;
      if (!contact) continue;
      await this.studentContactStore!.create(buildStudentContactStorageInput(tenantId, student.id, contact));
    }
    const audits = [
      ...students.flatMap((student, index) => {
        const contact = inputs[index]?.contact;
        return contact ? [contactAudit(student.id, contact)] : [];
      }),
      ...(options.extraAudits ?? []),
    ];
    for (const audit of audits) {
      await this.auditLogs?.record({ tenantId, actorUserId: context.userId, ...audit });
    }
    return students;
  }

  async previewQuota(context: RequestContext, incoming: number): Promise<StudentQuotaPreview> {
    const tenantId = context.tenantId;
    if (!tenantId) throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    const current = this.store.countLicensedActiveStudents
      ? await this.store.countLicensedActiveStudents(tenantId)
      : await this.countLicensedActiveStudentsInMemory(context);
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

  private async countLicensedActiveStudentsInMemory(context: RequestContext): Promise<number> {
    const students = filterTenantResources(context, await this.store.list())
      .filter((student) => !student.deletedAt && student.status === "ACTIVE");
    const enrollments = await this.enrollmentStore.listByStudents(students.map((student) => student.id));
    const openActiveByStudent = new Map<string, number>();
    for (const enrollment of enrollments) {
      if (enrollment.status !== "ACTIVE" || enrollment.endsAt) continue;
      openActiveByStudent.set(enrollment.studentId, (openActiveByStudent.get(enrollment.studentId) ?? 0) + 1);
    }
    return students.filter((student) => openActiveByStudent.get(student.id) === 1).length;
  }

  /**
   * Returns the normalized national IDs already stored for the tenant, soft-deleted students included:
   * `Student_tenantId_nationalIdHash_key` keeps those hashes, so the import preview must flag them per row.
   */
  async findExistingNationalIds(context: RequestContext, nationalIds: string[]): Promise<Set<string>> {
    const tenantId = context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId });
    const byHash = new Map([...new Set(nationalIds.map((nationalId) => normalizeTcIdentity(nationalId)))]
      .map((nationalId) => [hashTcIdentity(nationalId), nationalId] as const));
    if (byHash.size === 0) return new Set();
    const existing = await this.store.findExistingNationalIdHashes(tenantId, [...byHash.keys()], { includeDeleted: true });
    return new Set(existing.map((hash) => byHash.get(hash)).filter((nationalId): nationalId is string => Boolean(nationalId)));
  }

  async update(context: RequestContext, id: string, input: StudentUpdateRequest): Promise<PublicStudentRecord> {
    const existing = await this.findOne(context, id);
    const changedFields = changedInputFields(input, ["firstName", "lastName", "gradeLevelId", "classId", "responsibleTeacherId", "status"]);
    const nextStatus = input.status !== undefined ? resolveStudentStatus(input.status) : undefined;
    const nextGradeLevelId = input.gradeLevelId !== undefined ? optionalText(input.gradeLevelId) : undefined;
    const nextClassId = input.classId !== undefined ? optionalText(input.classId) : undefined;
    const nextResponsibleTeacherId = input.responsibleTeacherId !== undefined ? optionalText(input.responsibleTeacherId) : undefined;
    const effectiveStatus = nextStatus ?? existing.status;
    const placementChangedByRequest = input.gradeLevelId !== undefined || input.classId !== undefined;
    const activated = existing.status !== "ACTIVE" && effectiveStatus === "ACTIVE";
    const placement = placementChangedByRequest || activated
      ? await this.resolveStudentPlacement(context, existing.tenantId, {
          gradeLevelId: input.gradeLevelId !== undefined
            ? nextGradeLevelId
            : input.classId !== undefined && nextClassId
              ? undefined
              : existing.gradeLevelId,
          classId: input.classId !== undefined ? nextClassId : existing.classId,
        }, effectiveStatus === "ACTIVE")
      : { gradeLevelId: existing.gradeLevelId, classId: existing.classId };
    await this.assertStudentRelationTargets(context, existing.tenantId, {
      responsibleTeacherId: nextResponsibleTeacherId,
    });
    const studentUpdate = {
      firstName: input.firstName,
      lastName: input.lastName,
      gradeLevelId: placementChangedByRequest || activated ? placement.gradeLevelId : undefined,
      classId: input.classId !== undefined ? placement.classId ?? "" : undefined,
      responsibleTeacherId: nextResponsibleTeacherId,
      status: nextStatus,
    };
    const effectiveGradeLevelId = placement.gradeLevelId;
    const effectiveClassId = placement.classId;
    const gradeLevelChanged = placementChangedByRequest && effectiveGradeLevelId !== existing.gradeLevelId;
    const classChanged = input.classId !== undefined && effectiveClassId !== existing.classId;
    const deactivated = existing.status === "ACTIVE" && effectiveStatus !== "ACTIVE";
    const enrollmentTransition = gradeLevelChanged || classChanged || activated || deactivated
      ? {
          closeActive: { endsAt: todayDateString(), status: deactivated ? effectiveStatus : undefined },
          create: effectiveStatus === "ACTIVE" && effectiveGradeLevelId
            ? {
                gradeLevelId: effectiveGradeLevelId,
                classId: effectiveClassId,
                ...(await this.resolveCurrentAcademicContext(context)),
                startsAt: todayDateString(),
                status: "ACTIVE" as const,
                reason: classChanged ? "CLASS_CHANGED" : gradeLevelChanged ? "GRADE_LEVEL_CHANGED" : "REACTIVATED",
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
    const requestedClassId = input.classId !== undefined ? optionalText(input.classId) : existing.classId;
    const placement = await this.resolveStudentPlacement(context, existing.tenantId, {
      gradeLevelId: input.gradeLevelId !== undefined
        ? optionalText(input.gradeLevelId)
        : input.classId !== undefined && requestedClassId
          ? undefined
          : existing.gradeLevelId,
      classId: requestedClassId,
    }, true);
    const transition = {
      closeActive: { endsAt: startsAt },
      create: {
        gradeLevelId: placement.gradeLevelId,
        classId: placement.classId,
        ...academicContext,
        startsAt,
        status: "ACTIVE" as const,
        reason: "RENEWED",
      },
    };
    const atomicResult = this.store.updateWithEnrollmentTransition
      ? await this.store.updateWithEnrollmentTransition(id, { gradeLevelId: placement.gradeLevelId, classId: placement.classId ?? "", status: "ACTIVE" }, transition)
      : undefined;
    const updated = atomicResult?.student ?? await this.store.update(id, { gradeLevelId: placement.gradeLevelId, classId: placement.classId ?? "", status: "ACTIVE" });
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
      diff: { studentId: updated.id, gradeLevelId: placement.gradeLevelId, classId: placement.classId, ...academicContext },
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
        () => this.bulkRenewEnrollmentBatch(context, input, idempotencyKey),
      );
    }

    return this.bulkRenewEnrollmentBatch(context, input);
  }

  private async bulkRenewEnrollmentBatch(
    context: RequestContext,
    input: StudentBulkEnrollmentInput,
    idempotencyKey?: string,
  ): Promise<StudentBulkEnrollmentResult> {
    const studentIds = [...new Set(input.studentIds ?? [])].filter(Boolean);
    if (studentIds.length === 0) {
      throw new BadRequestException("STUDENT_BULK_ENROLLMENT_STUDENTS_REQUIRED");
    }

    const students = await Promise.all(studentIds.map((studentId) => this.findOne(context, studentId)));
    const automaticClassMapping = input.useAutomaticClassMapping ? await this.buildAutomaticClassMapping(context) : {};
    const renewals = await Promise.all(students.map(async (student) => {
      const mappedClassId = student.classId ? input.classIdBySourceClassId?.[student.classId] : undefined;
      const automaticClassId = student.classId ? automaticClassMapping[student.classId] : undefined;
      const classId = mappedClassId ?? automaticClassId ?? input.classId;
      return {
        student,
        placement: await this.resolveStudentPlacement(context, student.tenantId, {
          gradeLevelId: input.gradeLevelId ?? (classId ? undefined : student.gradeLevelId),
          classId: classId ?? student.classId,
        }, true),
      };
    }));

    const enrollments: StudentEnrollmentRecord[] = [];
    for (const { student, placement } of renewals) {
      // ponytail: per-student keys make retries resumable; use one DB transaction only if batches must become all-or-nothing.
      const itemIdempotencyKey = idempotencyKey
        ? `bulk-renew.${createHash("sha256").update(idempotencyKey.trim()).update("\0").update(student.id).digest("hex")}`
        : undefined;
      const renewalInput = {
        academicYearId: input.academicYearId,
        termId: input.termId,
        gradeLevelId: placement.gradeLevelId,
        classId: placement.classId,
        startsAt: input.startsAt,
      };
      const renew = () => this.renewEnrollmentOnce(context, student.id, renewalInput);
      enrollments.push(itemIdempotencyKey && this.idempotency
        ? await this.idempotency.run(
            context,
            {
              key: itemIdempotencyKey,
              operation: "student.enrollment.bulk-renew",
              request: { studentId: student.id, batch: input },
            },
            renew,
          )
        : await renew());
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
    const gradeLevelId = input.gradeLevelId !== undefined ? optionalText(input.gradeLevelId) : undefined;
    const transferIn = Boolean(classId || gradeLevelId);
    const placement = transferIn
      ? await this.resolveStudentPlacement(context, existing.tenantId, { gradeLevelId, classId }, true)
      : { gradeLevelId: undefined, classId: undefined };
    const nextStatus: StudentStatus = transferIn ? "ACTIVE" : "TRANSFERRED";
    const transition = {
      closeActive: { endsAt: startsAt, status: transferIn ? undefined : "TRANSFERRED" as const },
      create: transferIn ? {
        gradeLevelId: placement.gradeLevelId,
        classId: placement.classId,
        ...academicContext,
        startsAt,
        status: "ACTIVE" as const,
        reason: "TRANSFERRED",
      } : undefined,
    };
    const atomicResult = this.store.updateWithEnrollmentTransition
      ? await this.store.updateWithEnrollmentTransition(id, {
          gradeLevelId: placement.gradeLevelId ?? "",
          classId: placement.classId ?? "",
          status: nextStatus,
        }, transition)
      : undefined;
    const updated = atomicResult?.student ?? await this.store.update(id, {
      gradeLevelId: placement.gradeLevelId ?? "",
      classId: placement.classId ?? "",
      status: nextStatus,
    });
    if (!updated) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    if (!atomicResult) {
      await this.enrollmentStore.closeActiveForStudent(updated.id, startsAt, transferIn ? undefined : "TRANSFERRED");
    }
    if (!transferIn) {
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
      diff: { studentId: updated.id, gradeLevelId: placement.gradeLevelId, classId: placement.classId, ...academicContext },
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
    const { purged: studentContactsPurged, guardianUnlinks } = await this.studentContactStore.purgeByStudent(student.tenantId, student.id);
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
    for (const unlink of guardianUnlinks) {
      await recordContactGuardianRemoval(this.auditLogs, context, purged.tenantId, unlink, "kvkk.student_contact_pii_purged");
    }
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
    if (tenantId === previousTenantId) return toPublicStudentRecord(student);
    throw new ConflictException("STUDENT_TENANT_TRANSFER_NOT_SUPPORTED");
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

  private async resolveStudentPlacement(
    context: RequestContext,
    tenantId: string,
    input: { gradeLevelId?: string; classId?: string },
    required: boolean,
  ): Promise<{ gradeLevelId?: string; classId?: string }> {
    const classId = optionalText(input.classId);
    const requestedGradeLevelId = optionalText(input.gradeLevelId);
    let schoolClass: ClassRecord | undefined;

    if (classId) {
      schoolClass = await this.classStore.findById(classId);
      if (!schoolClass || schoolClass.deletedAt) {
        throw new NotFoundException("CLASS_NOT_FOUND");
      }
      this.assertSameTenantRelationTarget(context, tenantId, schoolClass);
    }
    await this.assertCampusScopeAllowsClass(context, classId);

    if (schoolClass && (!schoolClass.gradeLevelId || (requestedGradeLevelId && requestedGradeLevelId !== schoolClass.gradeLevelId))) {
      throw new BadRequestException("STUDENT_CLASS_GRADE_LEVEL_MISMATCH");
    }

    const gradeLevelId = requestedGradeLevelId ?? schoolClass?.gradeLevelId;
    if (required && !gradeLevelId) {
      throw new BadRequestException("STUDENT_GRADE_LEVEL_REQUIRED");
    }
    if (gradeLevelId) {
      const gradeLevel = await this.gradeLevelStore.findById(gradeLevelId);
      if (!gradeLevel || gradeLevel.deletedAt) {
        throw new NotFoundException("GRADE_LEVEL_NOT_FOUND");
      }
      this.assertSameTenantRelationTarget(context, tenantId, gradeLevel);
    }

    return { gradeLevelId, classId };
  }

  /** Synchronous twin of `resolveStudentPlacement` over preloaded lookups; same checks, exceptions and order. */
  private resolveBulkPlacement(
    context: RequestContext,
    tenantId: string,
    input: { gradeLevelId?: string; classId?: string },
    classById: ReadonlyMap<string, ClassRecord>,
    gradeLevelById: ReadonlyMap<string, GradeLevelRecord>,
  ): { gradeLevelId?: string; classId?: string } {
    const classId = optionalText(input.classId);
    const requestedGradeLevelId = optionalText(input.gradeLevelId);
    let schoolClass: ClassRecord | undefined;

    if (classId) {
      schoolClass = classById.get(classId);
      if (!schoolClass || schoolClass.deletedAt) {
        throw new NotFoundException("CLASS_NOT_FOUND");
      }
      this.assertSameTenantRelationTarget(context, tenantId, schoolClass);
    }
    if (this.isCampusRestricted(context)) {
      if (!schoolClass) throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
      this.assertAccess(context, schoolClass);
      const campusIds = new Set(context.campusScope!.campusIds);
      if (!schoolClass.campusId || !campusIds.has(schoolClass.campusId)) {
        throw new ForbiddenException("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
      }
    }

    if (schoolClass && (!schoolClass.gradeLevelId || (requestedGradeLevelId && requestedGradeLevelId !== schoolClass.gradeLevelId))) {
      throw new BadRequestException("STUDENT_CLASS_GRADE_LEVEL_MISMATCH");
    }

    const gradeLevelId = requestedGradeLevelId ?? schoolClass?.gradeLevelId;
    if (!gradeLevelId) {
      throw new BadRequestException("STUDENT_GRADE_LEVEL_REQUIRED");
    }
    const gradeLevel = gradeLevelById.get(gradeLevelId);
    if (!gradeLevel || gradeLevel.deletedAt) {
      throw new NotFoundException("GRADE_LEVEL_NOT_FOUND");
    }
    this.assertSameTenantRelationTarget(context, tenantId, gradeLevel);

    return { gradeLevelId, classId };
  }

  private async assertStudentRelationTargets(
    context: RequestContext,
    tenantId: string,
    input: { responsibleTeacherId?: string },
  ): Promise<void> {
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






  /** Race safety: a unique violation that slipped past the pre-check becomes the same 409 as the pre-check. */
  private async createStudentRow(create: () => Promise<StudentRecord>): Promise<StudentRecord> {
    try {
      return await create();
    } catch (error) {
      throw toStudentUniqueConflictException(error);
    }
  }

  private async resolveProfileUpdateForCreate(
    tenantId: string,
    input: StudentBulkCreateInput,
    seenNationalIdHashes: Set<string>,
  ): Promise<Pick<StudentProfileUpdate, "nationalIdEncrypted" | "nationalIdHash" | "phone" | "email"> | undefined> {
    const profileUpdate: Pick<StudentProfileUpdate, "nationalIdEncrypted" | "nationalIdHash" | "phone" | "email"> = {};
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
      // Soft-deleted students count, like `Student_tenantId_nationalIdHash_key` and the import.
      if ((await this.store.findExistingNationalIdHashes(tenantId, [nationalIdHash], { includeDeleted: true })).length > 0) {
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
    studentNo?: string;
    firstName: string;
    lastName: string;
    gradeLevelId?: string;
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
      student.gradeLevelId ? this.gradeLevelStore.findById(student.gradeLevelId) : undefined,
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

  private async withClassNames<TRecord extends { tenantId: string; gradeLevelId?: string; classId?: string }>(
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
    const gradeLevelIds = [...new Set(records.map((record) => record.gradeLevelId).filter((id): id is string => Boolean(id)))];
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
      const gradeLevel = record.gradeLevelId ? gradeLevelById.get(record.gradeLevelId) : undefined;
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
    gradeLevelId: student.gradeLevelId,
    classId: student.classId,
    responsibleTeacherId: student.responsibleTeacherId,
    status: student.status,
  };
}

/**
 * Pure part of `resolveProfileUpdateForCreate` for bulk creates: same normalization and in-batch duplicate rule.
 * The stored-duplicate check runs in the write transaction (no deletedAt filter, like the unique index).
 */
function resolveBulkProfile(
  input: StudentBulkCreateInput,
  seenNationalIdHashes: Set<string>,
): Pick<StudentProfileUpdate, "nationalIdEncrypted" | "nationalIdHash" | "phone" | "email"> {
  const profile: Pick<StudentProfileUpdate, "nationalIdEncrypted" | "nationalIdHash" | "phone" | "email"> = {};
  const phone = input.phone !== undefined ? optionalText(input.phone) : undefined;
  if (phone !== undefined) profile.phone = phone;
  const email = input.email !== undefined ? optionalEmail(input.email) : undefined;
  if (email !== undefined) profile.email = email;
  const nationalIdInput = optionalText(input.nationalId);
  if (nationalIdInput !== undefined) {
    const nationalId = normalizeTcIdentity(nationalIdInput);
    const nationalIdHash = hashTcIdentity(nationalId);
    if (seenNationalIdHashes.has(nationalIdHash)) {
      throw new ConflictException("STUDENT_NATIONAL_ID_CONFLICT");
    }
    seenNationalIdHashes.add(nationalIdHash);
    profile.nationalIdEncrypted = encryptTcIdentity(nationalId);
    profile.nationalIdHash = nationalIdHash;
  }
  return profile;
}

/** Single create and profile update: only the unique-index conflict sentinels become 409; anything else passes through. */
function toStudentUniqueConflictException(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof HttpException) return error;
  switch (error.message) {
    case studentImportBatchErrors.nationalIdConflict:
    case studentImportBatchErrors.studentNoConflict:
      return new ConflictException(error.message);
    default:
      return error;
  }
}

function toStudentImportBatchException(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof HttpException) return error;
  switch (error.message) {
    case studentImportBatchErrors.classNotFound:
      return new NotFoundException(error.message);
    case studentImportBatchErrors.classGradeLevelMismatch:
      return new BadRequestException(error.message);
    case studentImportBatchErrors.campusScopeForbidden:
      return new ForbiddenException(error.message);
    case studentImportBatchErrors.activeStudentLimitReached:
    case studentImportBatchErrors.nationalIdConflict:
    case studentImportBatchErrors.studentNoConflict:
      return new ConflictException(error.message);
    default:
      return error;
  }
}

function toStudentProfile(student: {
  id: string;
  tenantId: string;
  studentNo?: string;
  firstName: string;
  lastName: string;
  gradeLevelId?: string;
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
    // Same visibility as the list record (toPublicStudentRecord): every viewer of the student sees the school number.
    studentNo: student.studentNo,
    firstName: student.firstName,
    lastName: student.lastName,
    gradeLevelId: student.gradeLevelId,
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
