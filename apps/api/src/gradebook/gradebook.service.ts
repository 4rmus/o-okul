import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  ClassRecord,
  GradeAssessmentCreateRequest,
  GradeAssessmentDetail,
  GradeAssessmentPublishResult,
  GradeAssessmentRecord,
  GradeEntriesSaveRequest,
  GradeEntryRecord,
  TeacherAssignmentRole,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { assertTeacherAssigned, hasTeacherAssignmentForScope } from "../school/assert-teacher-assigned.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type CourseStore, courseStoreToken } from "../school/course-store.js";
import { type TeacherAssignmentStore, teacherAssignmentStoreToken } from "../school/teacher-assignment-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { isTeacherSubjectContext } from "../tenant/tenant-access.js";
import { type GradebookStore, gradebookStoreToken } from "./gradebook-store.js";

// Plan §4.5: grades are written by the class's branch or class teacher; guidance counsellors only read elsewhere.
const gradeWriterRoles: readonly TeacherAssignmentRole[] = ["CLASS_TEACHER", "BRANCH_TEACHER"];

@Injectable()
export class GradebookService {
  constructor(
    @Inject(gradebookStoreToken) private readonly store: GradebookStore,
    @Inject(classStoreToken) private readonly classes: ClassStore,
    @Inject(courseStoreToken) private readonly courses: CourseStore,
    @Inject(academicCalendarStoreToken) private readonly calendar: AcademicCalendarStore,
    @Inject(studentStoreToken) private readonly students: StudentStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignments: TeacherAssignmentStore,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async createAssessment(context: RequestContext, input: GradeAssessmentCreateRequest): Promise<GradeAssessmentRecord> {
    const tenantId = requireTenantId(context);
    const klass = await this.requireClass(context, tenantId, input.classId);
    const course = await this.courses.findById(input.courseId);
    if (!course || course.tenantId !== tenantId || course.deletedAt) throw new NotFoundException("COURSE_NOT_FOUND");
    const term = await this.calendar.findTermById(input.termId);
    if (!term || term.tenantId !== tenantId || term.deletedAt) throw new NotFoundException("ACADEMIC_TERM_NOT_FOUND");
    const maxScore = input.maxScore ?? 100;
    assertScoreScale(maxScore, "GRADE_MAX_SCORE_INVALID");
    if (maxScore <= 0) throw new BadRequestException("GRADE_MAX_SCORE_INVALID");

    const record = await this.store.createAssessment({
      tenantId,
      classId: klass.id,
      courseId: course.id,
      termId: term.id,
      kind: input.kind,
      title: input.title,
      heldOn: input.heldOn,
      maxScore,
      createdById: context.userId,
    });
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "GradeAssessment",
      entityId: record.id,
      action: "grade_assessment.created",
      diff: { classId: record.classId, courseId: record.courseId, termId: record.termId, kind: record.kind, maxScore },
    });
    return record;
  }

  async listAssessments(context: RequestContext, filter: { classId?: string; termId?: string; courseId?: string }): Promise<GradeAssessmentRecord[]> {
    const tenantId = requireTenantId(context);
    const visibleClassIds = await this.visibleClassIds(context, tenantId);
    const classIds = filter.classId ? visibleClassIds.filter((id) => id === filter.classId) : visibleClassIds;
    const records = (await this.store.listAssessments({ classIds, termId: filter.termId, courseId: filter.courseId }))
      .filter((record) => record.tenantId === tenantId);
    if (!isTeacherSubjectContext(context) || hasCapability(context, "academic:manage")) return records;
    const assignments = await this.teacherAssignments.listByTeacher(context.subjectId);
    const today = todayIso();
    return records.filter((record) => hasTeacherAssignmentForScope(assignments, assignmentScope(record), today));
  }

  async getAssessment(context: RequestContext, id: string): Promise<GradeAssessmentDetail> {
    const assessment = await this.requireReadableAssessment(context, id);
    return { assessment, entries: await this.store.listEntries(assessment.id) };
  }

  async saveEntries(context: RequestContext, id: string, input: GradeEntriesSaveRequest): Promise<GradeEntryRecord[]> {
    const tenantId = requireTenantId(context);
    const assessment = await this.requireAssessment(context, tenantId, id);
    await this.assertCanWriteEntries(context, assessment);
    const studentIds = new Set<string>();
    for (const entry of input.entries) {
      if (studentIds.has(entry.studentId)) throw new BadRequestException("GRADE_ENTRY_STUDENT_DUPLICATE");
      studentIds.add(entry.studentId);
      if (entry.absent ? entry.score !== null : entry.score === null) throw new BadRequestException("GRADE_ENTRY_SCORE_INVALID");
      if (entry.score !== null) {
        assertScoreScale(entry.score, "GRADE_ENTRY_SCORE_INVALID");
        if (entry.score < 0 || entry.score > assessment.maxScore) throw new BadRequestException("GRADE_ENTRY_SCORE_OUT_OF_RANGE");
      }
      const student = await this.students.findById(entry.studentId);
      if (!student || student.tenantId !== tenantId || student.deletedAt || student.classId !== assessment.classId) {
        throw new BadRequestException("GRADE_ENTRY_STUDENT_NOT_IN_CLASS");
      }
    }
    return this.store.saveDrafts(assessment, input.entries, context.userId);
  }

  async publish(context: RequestContext, id: string, idempotencyKey?: string): Promise<GradeAssessmentPublishResult> {
    if (!idempotencyKey?.trim()) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    if (!this.idempotency) throw new BadRequestException("IDEMPOTENCY_SERVICE_UNAVAILABLE");
    return this.idempotency.run(
      context,
      { key: idempotencyKey.trim(), operation: "grade-assessment.publish", request: { id } },
      () => this.publishOnce(context, id),
    );
  }

  private async publishOnce(context: RequestContext, id: string): Promise<GradeAssessmentPublishResult> {
    const tenantId = requireTenantId(context);
    const assessment = await this.requireAssessment(context, tenantId, id);
    if (!(await this.store.listEntries(assessment.id)).some((entry) => !entry.publishedAt)) {
      throw new ConflictException("GRADE_ASSESSMENT_NOTHING_TO_PUBLISH");
    }
    const result = await this.store.publish(assessment);
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "GradeAssessment",
      entityId: assessment.id,
      action: "grade_assessment.published",
      diff: { publishedVersion: result.assessment.publishedVersion, publishedCount: result.publishedCount },
    });
    return result;
  }

  private async assertCanWriteEntries(context: RequestContext, assessment: GradeAssessmentRecord): Promise<void> {
    if (hasCapability(context, "academic:manage")) return;
    await assertTeacherAssigned(context, this.teacherAssignments, { ...assignmentScope(assessment), roles: gradeWriterRoles }, todayIso());
  }

  private async requireReadableAssessment(context: RequestContext, id: string): Promise<GradeAssessmentRecord> {
    const tenantId = requireTenantId(context);
    const assessment = await this.requireAssessment(context, tenantId, id);
    if (isTeacherSubjectContext(context) && !hasCapability(context, "academic:manage")) {
      const assignments = await this.teacherAssignments.listByTeacher(context.subjectId);
      if (!hasTeacherAssignmentForScope(assignments, assignmentScope(assessment), todayIso())) {
        throw new ForbiddenException("FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE");
      }
    }
    return assessment;
  }

  /** Tenant and campus scope; a record outside them is reported as missing, not forbidden. */
  private async requireAssessment(context: RequestContext, tenantId: string, id: string): Promise<GradeAssessmentRecord> {
    const assessment = await this.store.findAssessment(id);
    if (!assessment || assessment.tenantId !== tenantId) throw new NotFoundException("GRADE_ASSESSMENT_NOT_FOUND");
    const klass = await this.classes.findById(assessment.classId);
    if (!klass || !campusAllows(context, klass)) throw new NotFoundException("GRADE_ASSESSMENT_NOT_FOUND");
    return assessment;
  }

  private async requireClass(context: RequestContext, tenantId: string, classId: string): Promise<ClassRecord> {
    const klass = await this.classes.findById(classId);
    if (!klass || klass.tenantId !== tenantId || klass.deletedAt || !campusAllows(context, klass)) {
      throw new NotFoundException("CLASS_NOT_FOUND");
    }
    return klass;
  }

  private async visibleClassIds(context: RequestContext, tenantId: string): Promise<string[]> {
    return (await this.classes.list())
      .filter((klass) => klass.tenantId === tenantId && campusAllows(context, klass))
      .map((klass) => klass.id);
  }
}

function assignmentScope(assessment: GradeAssessmentRecord) {
  return { tenantId: assessment.tenantId, classId: assessment.classId, courseId: assessment.courseId, termId: assessment.termId };
}

function campusAllows(context: RequestContext, klass: Pick<ClassRecord, "campusId">): boolean {
  if (context.roles.includes("OPERATIONS_STAFF") && !context.campusScope) return false;
  if (context.campusScope?.scopeMode !== "CAMPUSES") return true;
  return Boolean(klass.campusId && context.campusScope.campusIds.includes(klass.campusId));
}

/** DECIMAL(5,2): at most two fraction digits and below 1000. */
function assertScoreScale(value: number, code: string): void {
  // 72.3 * 100 is 7229.999… in binary floating point, so compare with a tolerance.
  if (!Number.isFinite(value) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6 || Math.abs(value) >= 1000) {
    throw new BadRequestException(code);
  }
}

function requireTenantId(context: RequestContext): string {
  if (!context.tenantId || context.bypassRls) throw new ForbiddenException("TENANT_CONTEXT_REQUIRED");
  return context.tenantId;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
