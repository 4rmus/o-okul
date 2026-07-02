import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  AcademicTermRecord as SharedAcademicTermRecord,
  AcademicYearRecord as SharedAcademicYearRecord,
  AlanRecord as SharedAlanRecord,
  CampusRecord as SharedCampusRecord,
  ClassRecord as SharedClassRecord,
  CourseRecord as SharedCourseRecord,
  GradeLevelCourseRecord,
  GradeLevelRecord as SharedGradeLevelRecord,
  GuardianRecord as SharedGuardianRecord,
  GuardianStudentDetailStudentRecord,
  GuardianStudentDetailsResponse,
  GuardianStudentRecord,
  LearningOutcomeRecord as SharedLearningOutcomeRecord,
  StudentRecord as SharedStudentRecord,
  TeacherAssignmentRecord,
  TeacherAssignmentRole,
  TeacherRecord as SharedTeacherRecord,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { optionalTurkishMobilePhone } from "../auth/phone-normalize.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { IdentityProvisioningService } from "../identity-provisioning/identity-provisioning.service.js";
import { assertTeacherScopedStudentAccess, assertTenantResourceAccess, filterTenantResources, isTeacherSubjectContext } from "../tenant/tenant-access.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "./academic-calendar-store.js";
import { type AlanStore, alanStoreToken } from "./alan-store.js";
import { type CampusStore, campusStoreToken } from "./campus-store.js";
import { type ClassStore, classStoreToken } from "./class-store.js";
import { type CourseStore, courseStoreToken } from "./course-store.js";
import { type GradeLevelCourseStore, gradeLevelCourseStoreToken } from "./grade-level-course-store.js";
import { type GradeLevelStore, gradeLevelStoreToken } from "./grade-level-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "./guardian-student-store.js";
import { type GuardianStore, guardianStoreToken } from "./guardian-store.js";
import { type LearningOutcomeStore, learningOutcomeStoreToken } from "./learning-outcome-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import {
  type TeacherAssignmentInput,
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "./teacher-assignment-store.js";
import { type TeacherStore, teacherStoreToken } from "./teacher-store.js";
import { encryptTcIdentity, hashTcIdentity, normalizeTcIdentity } from "../student/tc-identity.js";

export interface ClassRecord extends SharedClassRecord {
  deletedAt?: string;
}

export interface CampusRecord extends SharedCampusRecord {
  deletedAt?: string;
}

export interface AlanRecord extends SharedAlanRecord {
  deletedAt?: string;
}

export interface GradeLevelRecord extends SharedGradeLevelRecord {
  deletedAt?: string;
}

export interface AcademicYearRecord extends SharedAcademicYearRecord {
  deletedAt?: string;
}

export interface AcademicTermRecord extends SharedAcademicTermRecord {
  deletedAt?: string;
}

export interface CourseRecord extends SharedCourseRecord {
  deletedAt?: string;
}

export interface LearningOutcomeRecord extends SharedLearningOutcomeRecord {
  deletedAt?: string;
}

type SchoolRecord =
  | AcademicYearRecord
  | AcademicTermRecord
  | AlanRecord
  | CampusRecord
  | ClassRecord
  | CourseRecord
  | GradeLevelRecord
  | LearningOutcomeRecord;

@Injectable()
export class SchoolService {
  constructor(
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(alanStoreToken) private readonly alanStore: AlanStore,
    @Inject(campusStoreToken) private readonly campusStore: CampusStore,
    @Inject(classStoreToken) private readonly classStore: ClassStore,
    @Inject(courseStoreToken) private readonly courseStore: CourseStore,
    @Inject(gradeLevelCourseStoreToken) private readonly gradeLevelCourseStore: GradeLevelCourseStore,
    @Inject(gradeLevelStoreToken) private readonly gradeLevelStore: GradeLevelStore,
    @Inject(learningOutcomeStoreToken) private readonly learningOutcomeStore: LearningOutcomeStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async listClasses(context: RequestContext): Promise<ClassRecord[]> {
    return this.list(context, await this.classStore.list());
  }

  async listCampuses(context: RequestContext): Promise<CampusRecord[]> {
    return this.list(context, await this.campusStore.list());
  }

  async findCampus(context: RequestContext, id: string): Promise<CampusRecord> {
    return this.findRecord(context, await this.campusStore.findById(id), "CAMPUS_NOT_FOUND");
  }

  async createCampus(context: RequestContext, input: Partial<CampusRecord>): Promise<CampusRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const record = await this.campusStore.create({
      tenantId,
      name: input.name ?? "",
      code: optionalText(input.code),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Campus",
      entityId: record.id,
      action: "campus.created",
      diff: { fieldsSet: presentFields(record, ["name", "code"]) },
    });
    return record;
  }

  async updateCampus(context: RequestContext, id: string, input: Partial<CampusRecord>): Promise<CampusRecord> {
    await this.findCampus(context, id);
    const changedFields = changedInputFields(input, ["name", "code"]);
    const record = await this.campusStore.update(id, {
      name: input.name,
      code: input.code !== undefined ? optionalText(input.code) : undefined,
    });
    if (!record) {
      throw new NotFoundException("CAMPUS_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Campus",
      entityId: record.id,
      action: "campus.updated",
      diff: { fieldsChanged: changedFields },
    });
    return record;
  }

  async deleteCampus(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findCampus(context, id);
    const record = await this.campusStore.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("CAMPUS_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Campus",
      entityId: record.id,
      action: "campus.deleted",
      diff: { name: existing.name, deletedAt: record.deletedAt },
    });
  }

  async listGradeLevels(context: RequestContext): Promise<GradeLevelRecord[]> {
    return this.list(context, await this.gradeLevelStore.list());
  }

  async findGradeLevel(context: RequestContext, id: string): Promise<GradeLevelRecord> {
    return this.findRecord(context, await this.gradeLevelStore.findById(id), "GRADE_LEVEL_NOT_FOUND");
  }

  async listAlanlar(context: RequestContext): Promise<AlanRecord[]> {
    return this.list(context, await this.alanStore.list());
  }

  async findAlan(context: RequestContext, id: string): Promise<AlanRecord> {
    return this.findRecord(context, await this.alanStore.findById(id), "ALAN_NOT_FOUND");
  }

  async createAlan(context: RequestContext, input: Partial<AlanRecord>): Promise<AlanRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const gradeLevelId = optionalText(input.gradeLevelId);
    if (gradeLevelId) {
      const gradeLevel = await this.findGradeLevel(context, gradeLevelId);
      if (gradeLevel.tenantId !== tenantId) {
        throw new ForbiddenException("FORBIDDEN_TENANT");
      }
    }
    const record = await this.alanStore.create({
      tenantId,
      gradeLevelId,
      name: input.name ?? "",
      code: optionalText(input.code),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Alan",
      entityId: record.id,
      action: "alan.created",
      diff: { fieldsSet: presentFields(record, ["name", "code", "gradeLevelId"]) },
    });
    return record;
  }

  async updateAlan(context: RequestContext, id: string, input: Partial<AlanRecord>): Promise<AlanRecord> {
    await this.findAlan(context, id);
    const gradeLevelId = input.gradeLevelId !== undefined ? optionalText(input.gradeLevelId) : undefined;
    if (gradeLevelId) {
      await this.findGradeLevel(context, gradeLevelId);
    }
    const changedFields = changedInputFields(input, ["name", "code", "gradeLevelId"]);
    const record = await this.alanStore.update(id, {
      name: input.name,
      code: input.code !== undefined ? optionalText(input.code) : undefined,
      gradeLevelId,
    });
    if (!record) {
      throw new NotFoundException("ALAN_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Alan",
      entityId: record.id,
      action: "alan.updated",
      diff: { fieldsChanged: changedFields },
    });
    return record;
  }

  async deleteAlan(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findAlan(context, id);
    const record = await this.alanStore.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("ALAN_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Alan",
      entityId: record.id,
      action: "alan.deleted",
      diff: { name: existing.name, deletedAt: record.deletedAt },
    });
  }

  async listGradeLevelCourses(context: RequestContext, gradeLevelId: string, alanId?: string): Promise<GradeLevelCourseRecord[]> {
    await this.findGradeLevel(context, gradeLevelId);
    return filterTenantResources(context, await this.gradeLevelCourseStore.listByGradeLevel(gradeLevelId, optionalText(alanId)));
  }

  async createGradeLevel(context: RequestContext, input: Partial<GradeLevelRecord>): Promise<GradeLevelRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const record = await this.gradeLevelStore.create({
      tenantId,
      name: input.name ?? "",
      code: optionalText(input.code),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "GradeLevel",
      entityId: record.id,
      action: "grade_level.created",
      diff: { fieldsSet: presentFields(record, ["name", "code"]) },
    });
    return record;
  }

  async updateGradeLevel(context: RequestContext, id: string, input: Partial<GradeLevelRecord>): Promise<GradeLevelRecord> {
    await this.findGradeLevel(context, id);
    const changedFields = changedInputFields(input, ["name", "code"]);
    const record = await this.gradeLevelStore.update(id, {
      name: input.name,
      code: input.code !== undefined ? optionalText(input.code) : undefined,
    });
    if (!record) {
      throw new NotFoundException("GRADE_LEVEL_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "GradeLevel",
      entityId: record.id,
      action: "grade_level.updated",
      diff: { fieldsChanged: changedFields },
    });
    return record;
  }

  async deleteGradeLevel(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findGradeLevel(context, id);
    const record = await this.gradeLevelStore.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("GRADE_LEVEL_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "GradeLevel",
      entityId: record.id,
      action: "grade_level.deleted",
      diff: { name: existing.name, deletedAt: record.deletedAt },
    });
  }

  async listAcademicYears(context: RequestContext): Promise<AcademicYearRecord[]> {
    return this.list(context, await this.academicCalendarStore.listYears());
  }

  async findAcademicYear(context: RequestContext, id: string): Promise<AcademicYearRecord> {
    return this.findRecord(context, await this.academicCalendarStore.findYearById(id), "ACADEMIC_YEAR_NOT_FOUND");
  }

  async createAcademicYear(context: RequestContext, input: Partial<AcademicYearRecord>): Promise<AcademicYearRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const range = resolveDateRange(input.startsAt, input.endsAt, "ACADEMIC_YEAR_DATE_INVALID");
    const record = await this.academicCalendarStore.createYear({
      tenantId,
      name: input.name ?? "",
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      isActive: Boolean(input.isActive),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "AcademicYear",
      entityId: record.id,
      action: "academic_year.created",
      diff: { fieldsSet: presentFields(record, ["name", "startsAt", "endsAt", "isActive"]) },
    });
    return record;
  }

  async updateAcademicYear(context: RequestContext, id: string, input: Partial<AcademicYearRecord>): Promise<AcademicYearRecord> {
    const existing = await this.findAcademicYear(context, id);
    const range = resolveDateRange(input.startsAt ?? existing.startsAt, input.endsAt ?? existing.endsAt, "ACADEMIC_YEAR_DATE_INVALID");
    const record = await this.academicCalendarStore.updateYear(id, {
      name: input.name,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      isActive: input.isActive,
    });
    if (!record) {
      throw new NotFoundException("ACADEMIC_YEAR_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "AcademicYear",
      entityId: record.id,
      action: "academic_year.updated",
      diff: { fieldsChanged: changedInputFields(input, ["name", "startsAt", "endsAt", "isActive"]) },
    });
    return record;
  }

  async deleteAcademicYear(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findAcademicYear(context, id);
    const record = await this.academicCalendarStore.softDeleteYear(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("ACADEMIC_YEAR_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "AcademicYear",
      entityId: record.id,
      action: "academic_year.deleted",
      diff: { name: existing.name, deletedAt: record.deletedAt },
    });
  }

  async listAcademicTerms(context: RequestContext): Promise<AcademicTermRecord[]> {
    return this.list(context, await this.academicCalendarStore.listTerms());
  }

  async findAcademicTerm(context: RequestContext, id: string): Promise<AcademicTermRecord> {
    return this.findRecord(context, await this.academicCalendarStore.findTermById(id), "ACADEMIC_TERM_NOT_FOUND");
  }

  async createAcademicTerm(context: RequestContext, input: Partial<AcademicTermRecord>): Promise<AcademicTermRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const academicYear = await this.findAcademicYear(context, input.academicYearId ?? "");
    if (academicYear.tenantId !== tenantId) {
      throw new ForbiddenException("FORBIDDEN_TENANT");
    }
    const range = resolveDateRange(input.startsAt, input.endsAt, "ACADEMIC_TERM_DATE_INVALID");
    const record = await this.academicCalendarStore.createTerm({
      tenantId,
      academicYearId: academicYear.id,
      name: input.name ?? "",
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      isActive: Boolean(input.isActive),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "AcademicTerm",
      entityId: record.id,
      action: "academic_term.created",
      diff: { fieldsSet: presentFields(record, ["academicYearId", "name", "startsAt", "endsAt", "isActive"]) },
    });
    return record;
  }

  async updateAcademicTerm(context: RequestContext, id: string, input: Partial<AcademicTermRecord>): Promise<AcademicTermRecord> {
    const existing = await this.findAcademicTerm(context, id);
    const academicYearId = input.academicYearId ?? existing.academicYearId;
    await this.findAcademicYear(context, academicYearId);
    const range = resolveDateRange(input.startsAt ?? existing.startsAt, input.endsAt ?? existing.endsAt, "ACADEMIC_TERM_DATE_INVALID");
    const record = await this.academicCalendarStore.updateTerm(id, {
      academicYearId,
      name: input.name,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      isActive: input.isActive,
    });
    if (!record) {
      throw new NotFoundException("ACADEMIC_TERM_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "AcademicTerm",
      entityId: record.id,
      action: "academic_term.updated",
      diff: { fieldsChanged: changedInputFields(input, ["academicYearId", "name", "startsAt", "endsAt", "isActive"]) },
    });
    return record;
  }

  async deleteAcademicTerm(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findAcademicTerm(context, id);
    const record = await this.academicCalendarStore.softDeleteTerm(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("ACADEMIC_TERM_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "AcademicTerm",
      entityId: record.id,
      action: "academic_term.deleted",
      diff: { name: existing.name, deletedAt: record.deletedAt },
    });
  }

  async findClass(context: RequestContext, id: string): Promise<ClassRecord> {
    return this.find(context, await this.classStore.list(), id, "CLASS_NOT_FOUND");
  }

  async createClass(context: RequestContext, input: Partial<ClassRecord>, idempotencyKey?: string): Promise<ClassRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "class.create", request: input },
        () => this.createClassOnce(context, input),
      );
    }

    return this.createClassOnce(context, input);
  }

  private async createClassOnce(context: RequestContext, input: Partial<ClassRecord>): Promise<ClassRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const alanId = optionalText(input.alanId);
    const campusId = optionalText(input.campusId);
    const gradeLevelId = optionalText(input.gradeLevelId);
    if (campusId) {
      const campus = await this.findCampus(context, campusId);
      if (campus.tenantId !== tenantId) {
        throw new ForbiddenException("FORBIDDEN_TENANT");
      }
    }
    if (gradeLevelId) {
      const gradeLevel = await this.findGradeLevel(context, gradeLevelId);
      if (gradeLevel.tenantId !== tenantId) {
        throw new ForbiddenException("FORBIDDEN_TENANT");
      }
    }
    if (alanId) {
      await this.assertAlanFitsClass(context, alanId, tenantId, gradeLevelId);
    }
    const record = await this.classStore.create({
      tenantId,
      alanId,
      campusId,
      gradeLevelId,
      name: input.name ?? "",
      section: optionalText(input.section),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Class",
      entityId: record.id,
      action: "class.created",
      diff: { name: record.name, alanId: record.alanId, campusId: record.campusId, gradeLevelId: record.gradeLevelId, section: record.section },
    });
    return record;
  }

  async updateClass(context: RequestContext, id: string, input: Partial<ClassRecord>): Promise<ClassRecord> {
    const existing = await this.findClass(context, id);
    const previousState = { name: existing.name, alanId: existing.alanId, campusId: existing.campusId, gradeLevelId: existing.gradeLevelId, section: existing.section };
    const alanId = input.alanId !== undefined ? optionalText(input.alanId) : undefined;
    const campusId = input.campusId !== undefined ? optionalText(input.campusId) : undefined;
    const gradeLevelId = input.gradeLevelId !== undefined ? optionalText(input.gradeLevelId) : undefined;
    if (campusId) {
      await this.findCampus(context, campusId);
    }
    if (gradeLevelId) {
      await this.findGradeLevel(context, gradeLevelId);
    }
    const effectiveAlanId = input.alanId !== undefined ? alanId : existing.alanId;
    if (effectiveAlanId) {
      await this.assertAlanFitsClass(context, effectiveAlanId, existing.tenantId, gradeLevelId ?? existing.gradeLevelId);
    }
    const record = await this.classStore.update(id, {
      name: input.name,
      alanId,
      campusId,
      gradeLevelId,
      section: input.section !== undefined ? optionalText(input.section) : undefined,
    });
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
        after: { name: record.name, alanId: record.alanId, campusId: record.campusId, gradeLevelId: record.gradeLevelId, section: record.section },
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

  async listCourses(context: RequestContext): Promise<CourseRecord[]> {
    return this.list(context, await this.courseStore.list());
  }

  async findCourse(context: RequestContext, id: string): Promise<CourseRecord> {
    return this.findRecord(context, await this.courseStore.findById(id), "COURSE_NOT_FOUND");
  }

  async createCourse(context: RequestContext, input: Partial<CourseRecord>, idempotencyKey?: string): Promise<CourseRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "course.create", request: input },
        () => this.createCourseOnce(context, input),
      );
    }

    return this.createCourseOnce(context, input);
  }

  private async createCourseOnce(context: RequestContext, input: Partial<CourseRecord>): Promise<CourseRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const record = await this.courseStore.create({
      tenantId,
      name: input.name ?? "",
      code: optionalText(input.code),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Course",
      entityId: record.id,
      action: "course.created",
      diff: { fieldsSet: presentFields(record, ["name", "code"]) },
    });
    return record;
  }

  async updateCourse(context: RequestContext, id: string, input: Partial<CourseRecord>): Promise<CourseRecord> {
    await this.findCourse(context, id);
    const changedFields = changedInputFields(input, ["name", "code"]);
    const record = await this.courseStore.update(id, {
      name: input.name,
      code: input.code !== undefined ? optionalText(input.code) : undefined,
    });
    if (!record) {
      throw new NotFoundException("COURSE_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Course",
      entityId: record.id,
      action: "course.updated",
      diff: { fieldsChanged: changedFields },
    });
    return record;
  }

  async deleteCourse(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findCourse(context, id);
    const record = await this.courseStore.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("COURSE_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Course",
      entityId: record.id,
      action: "course.deleted",
      diff: { name: existing.name, deletedAt: record.deletedAt },
    });
  }

  async listLearningOutcomes(context: RequestContext): Promise<LearningOutcomeRecord[]> {
    return this.list(context, await this.learningOutcomeStore.list());
  }

  async findLearningOutcome(context: RequestContext, id: string): Promise<LearningOutcomeRecord> {
    return this.findRecord(context, await this.learningOutcomeStore.findById(id), "LEARNING_OUTCOME_NOT_FOUND");
  }

  async createLearningOutcome(context: RequestContext, input: Partial<LearningOutcomeRecord>): Promise<LearningOutcomeRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const record = await this.learningOutcomeStore.create({
      tenantId,
      code: input.code ?? "",
      branch: input.branch ?? "",
      title: input.title ?? "",
      level: optionalText(input.level),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "LearningOutcome",
      entityId: record.id,
      action: "learning_outcome.created",
      diff: { fieldsSet: presentFields(record, ["code", "branch", "title", "level"]) },
    });
    return record;
  }

  async updateLearningOutcome(
    context: RequestContext,
    id: string,
    input: Partial<LearningOutcomeRecord>,
  ): Promise<LearningOutcomeRecord> {
    await this.findLearningOutcome(context, id);
    const changedFields = changedInputFields(input, ["code", "branch", "title", "level"]);
    const record = await this.learningOutcomeStore.update(id, {
      code: input.code,
      branch: input.branch,
      title: input.title,
      level: input.level !== undefined ? optionalText(input.level) : undefined,
    });
    if (!record) {
      throw new NotFoundException("LEARNING_OUTCOME_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "LearningOutcome",
      entityId: record.id,
      action: "learning_outcome.updated",
      diff: { fieldsChanged: changedFields },
    });
    return record;
  }

  async deleteLearningOutcome(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findLearningOutcome(context, id);
    const record = await this.learningOutcomeStore.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("LEARNING_OUTCOME_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "LearningOutcome",
      entityId: record.id,
      action: "learning_outcome.deleted",
      diff: { code: existing.code, deletedAt: record.deletedAt },
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
    if (!record || record.deletedAt) {
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

  private async assertAlanFitsClass(context: RequestContext, alanId: string, tenantId: string, gradeLevelId: string | undefined): Promise<void> {
    const alan = await this.findAlan(context, alanId);
    if (alan.tenantId !== tenantId) {
      throw new ForbiddenException("FORBIDDEN_TENANT");
    }
    if (alan.gradeLevelId && alan.gradeLevelId !== gradeLevelId) {
      throw new BadRequestException("ALAN_GRADE_LEVEL_MISMATCH");
    }
  }

  private assertAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
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

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalDate(value: string | undefined, message: string): string | undefined {
  const trimmed = optionalText(value);
  if (trimmed === undefined) return undefined;
  if (!isCalendarDateString(trimmed)) {
    throw new BadRequestException(message);
  }
  return trimmed;
}

function isCalendarDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function resolveDateRange(startsAt: string | undefined, endsAt: string | undefined, message: string): { startsAt: string; endsAt: string } {
  const start = optionalDate(startsAt, message);
  const end = optionalDate(endsAt, message);
  if (!start || !end || Date.parse(start) >= Date.parse(end)) {
    throw new BadRequestException(message);
  }
  return { startsAt: start, endsAt: end };
}
