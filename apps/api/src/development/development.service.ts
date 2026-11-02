import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { IdempotencyService } from "../http/idempotency.js";
import {
  developmentMentorNoteMaxLength,
  type DevelopmentAssessmentVisibility,
  type DevelopmentAuthoringScope,
  type DevelopmentTrendItem,
  type TeacherAssignmentRole,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { assertTeacherAssigned, hasTeacherAssignmentForScope, type TeacherAssignmentScope } from "../school/assert-teacher-assigned.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { requiredText } from "../shared/required-text.js";
import {
  type GuardianStudentStore,
  guardianStudentStoreToken,
} from "../school/guardian-student-store.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type TeacherRecord, type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import {
  assertTenantResourceAccess,
  campusScopedClassIds,
  filterTenantResources,
  isCampusInScope,
  isTeacherSubjectContext,
  resolveCampusRestriction,
} from "../tenant/tenant-access.js";
import {
  type DevelopmentAssessmentRecord,
  type DevelopmentCriterionRecord,
  type DevelopmentScoreRecord,
  type DevelopmentStore,
  developmentStoreToken,
} from "./development-store.js";

export interface DevelopmentCriterionInput {
  name?: string;
  scaleMin?: number;
  scaleMax?: number;
  sortOrder?: number;
}

export interface DevelopmentAssessmentInput {
  studentId?: string;
  teacherId?: string;
  termId?: string;
  periodLabel?: string;
  mentorNote?: string;
  visibility?: DevelopmentAssessmentVisibility;
  scores?: Array<{ criterionId?: string; score?: number }>;
}

export interface DevelopmentAssessmentWithScores extends DevelopmentAssessmentRecord {
  scores: DevelopmentScoreRecord[];
}

/**
 * DEC-20261102-05: a teacher writes only through a CLASS_TEACHER or GUIDANCE_COUNSELOR assignment; BRANCH_TEACHER and
 * RESPONSIBLE_TEACHER do not. Admin writers name an author teacher who holds one of these assignments.
 */
const developmentWriterAssignmentRoles: readonly TeacherAssignmentRole[] = ["CLASS_TEACHER", "GUIDANCE_COUNSELOR"];
/** Staff roles that write on behalf of a teacher and read INTERNAL records (RK-6). OPERATIONS_STAFF is not one of them. */
const developmentAdminRoles = ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN"];

/**
 * What the idempotency store keeps for an assessment write: the id only, never the mentor note (DEC-20261102-05,
 * KVKK). A replay reloads the record, so a purged note is not served back from the replay cache either.
 */
interface DevelopmentAssessmentReceipt {
  assessmentId: string;
}

@Injectable()
export class DevelopmentService {
  constructor(
    @Inject(developmentStoreToken) private readonly store: DevelopmentStore,
    @Inject(studentStoreToken) private readonly students: StudentStore,
    @Inject(teacherStoreToken) private readonly teachers: TeacherStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignments: TeacherAssignmentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudents: GuardianStudentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() @Inject(classStoreToken) private readonly classes?: ClassStore,
  ) {}

  async listCriteria(context: RequestContext): Promise<DevelopmentCriterionRecord[]> {
    return filterTenantResources(context, await this.store.listCriteria());
  }

  async createCriterion(context: RequestContext, input: DevelopmentCriterionInput, idempotencyKey?: string): Promise<DevelopmentCriterionRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "development.criterion.create", request: { actorUserId: context.userId, input } },
        () => this.createCriterionOnce(context, input),
      );
    }
    return this.createCriterionOnce(context, input);
  }

  private async createCriterionOnce(context: RequestContext, input: DevelopmentCriterionInput): Promise<DevelopmentCriterionRecord> {
    const tenantId = requireTenantId(context);
    const scaleMin = optionalInt(input.scaleMin, 1, "DEVELOPMENT_CRITERION_SCALE_INVALID");
    const scaleMax = optionalInt(input.scaleMax, 5, "DEVELOPMENT_CRITERION_SCALE_INVALID");
    if (scaleMin >= scaleMax) {
      throw new BadRequestException("DEVELOPMENT_CRITERION_SCALE_INVALID");
    }
    const record = await this.store.createCriterion({
      tenantId,
      name: requiredText(input.name, "DEVELOPMENT_CRITERION_NAME_REQUIRED"),
      scaleMin,
      scaleMax,
      sortOrder: optionalInt(input.sortOrder, 0, "DEVELOPMENT_CRITERION_SORT_INVALID"),
    });
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "DevelopmentCriterion",
      entityId: record.id,
      action: "development_criterion.created",
      diff: { name: record.name, scaleMin: record.scaleMin, scaleMax: record.scaleMax },
    });
    return record;
  }

  async listAssessments(context: RequestContext, studentId?: string): Promise<DevelopmentAssessmentWithScores[]> {
    const assessments = await this.filterReadable(
      context,
      await this.filterForCampusScope(context, filterTenantResources(context, await this.store.listAssessments(studentId))),
    );
    return Promise.all(assessments.map(async (assessment) => ({
      ...assessment,
      scores: await this.store.listScores(assessment.id),
    })));
  }

  /** The students the signed-in teacher may write for: CLASS_TEACHER or GUIDANCE_COUNSELOR assignment, in campus scope. */
  async getAuthoringScope(context: RequestContext): Promise<DevelopmentAuthoringScope> {
    if (!isTeacherSubjectContext(context)) {
      throw new ForbiddenException("TEACHER_CONTEXT_REQUIRED");
    }
    const tenantId = requireTenantId(context);
    const assignments = await this.teacherAssignments.listByTeacher(context.subjectId);
    const campusStudentIds = await this.campusAllowedStudentIds(context);
    const referenceDate = today();
    const studentIds = filterTenantResources(context, await this.students.list())
      .filter((student) => !student.deletedAt)
      .filter((student) => !campusStudentIds || campusStudentIds.has(student.id))
      .filter((student) => hasTeacherAssignmentForScope(assignments, {
        tenantId,
        studentId: student.id,
        classId: student.classId,
        roles: developmentWriterAssignmentRoles,
      }, referenceDate))
      .map((student) => student.id);
    return { studentIds };
  }

  async listCurrentStudent(context: RequestContext): Promise<DevelopmentTrendItem[]> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    return this.listVisibleForStudent(context, context.subjectId);
  }

  async listCurrentGuardianStudent(context: RequestContext, studentId: string): Promise<DevelopmentTrendItem[]> {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    const student = await this.students.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    assertDevelopmentStudentTenantAccess(context, student);
    const links = await this.guardianStudents.listByStudent(student.id);
    if (!links.some((link) => link.guardianId === context.subjectId)) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
    return this.listVisibleForStudent(context, student.id);
  }

  /** Append-only: there is no update or delete; a correction is a new assessment (DEC-20261102-05). */
  async createAssessment(context: RequestContext, input: DevelopmentAssessmentInput, idempotencyKey?: string): Promise<DevelopmentAssessmentWithScores> {
    if (idempotencyKey && this.idempotency) {
      let created: DevelopmentAssessmentWithScores | undefined;
      const receipt = await this.idempotency.run<DevelopmentAssessmentReceipt>(
        context,
        { key: idempotencyKey, operation: "development.assessment.create", request: { actorUserId: context.userId, input } },
        async () => {
          created = await this.createAssessmentOnce(context, input);
          return { assessmentId: created.id };
        },
      );
      return created ?? this.loadReplayedAssessment(context, receipt);
    }
    return this.createAssessmentOnce(context, input);
  }

  private async createAssessmentOnce(context: RequestContext, input: DevelopmentAssessmentInput): Promise<DevelopmentAssessmentWithScores> {
    const tenantId = requireTenantId(context);
    const studentId = requiredText(input.studentId, "DEVELOPMENT_ASSESSMENT_STUDENT_REQUIRED");
    const student = await this.students.findById(studentId);
    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await this.assertStudentInCampusScope(context, student);

    const termId = optionalText(input.termId);
    const teacher = await this.resolveAuthor(context, input.teacherId, {
      tenantId,
      studentId: student.id,
      classId: student.classId,
      termId,
      roles: developmentWriterAssignmentRoles,
    });

    const scoreInputs = input.scores ?? [];
    if (scoreInputs.length === 0) {
      throw new BadRequestException("DEVELOPMENT_ASSESSMENT_SCORES_REQUIRED");
    }
    const criterionIds = scoreInputs.map((score) => requiredText(score.criterionId, "DEVELOPMENT_SCORE_CRITERION_REQUIRED"));
    if (new Set(criterionIds).size !== criterionIds.length) {
      throw new BadRequestException("DEVELOPMENT_SCORE_CRITERION_DUPLICATE");
    }
    const criteria = await Promise.all(criterionIds.map((criterionId) => this.requireCriterion(tenantId, criterionId)));
    // Every score is validated before the single atomic write, so a bad score never leaves a partial assessment.
    const validatedScores = scoreInputs.map((scoreInput, index) => {
      const criterion = criteria[index]!;
      const score = requiredInt(scoreInput.score, "DEVELOPMENT_SCORE_REQUIRED");
      if (score < criterion.scaleMin || score > criterion.scaleMax) {
        throw new BadRequestException("DEVELOPMENT_SCORE_OUT_OF_RANGE");
      }
      return { criterionId: criterion.id, score };
    });
    const mentorNote = optionalText(input.mentorNote);
    if (mentorNote && mentorNote.length > developmentMentorNoteMaxLength) {
      throw new BadRequestException("DEVELOPMENT_MENTOR_NOTE_TOO_LONG");
    }

    const { assessment, scores } = await this.store.createAssessmentWithScores({
      tenantId,
      studentId: student.id,
      teacherId: teacher.id,
      termId,
      periodLabel: requiredText(input.periodLabel, "DEVELOPMENT_ASSESSMENT_PERIOD_REQUIRED"),
      mentorNote,
      visibility: resolveVisibility(input.visibility),
    }, validatedScores);

    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "DevelopmentAssessment",
      entityId: assessment.id,
      action: "development_assessment.created",
      diff: { studentId: student.id, teacherId: teacher.id, scoreCount: scores.length, visibility: assessment.visibility },
    });
    return { ...assessment, scores };
  }

  /**
   * Teacher persona: the teacher is the author and needs a writer assignment for the student or the student's class.
   * Admin persona: names the author, who must hold an active writer assignment there. Everyone else is refused.
   */
  private async resolveAuthor(
    context: RequestContext,
    inputTeacherId: string | undefined,
    scope: TeacherAssignmentScope,
  ): Promise<TeacherRecord> {
    let teacherId: string;
    if (isTeacherSubjectContext(context)) {
      await assertTeacherAssigned(context, this.teacherAssignments, scope);
      teacherId = context.subjectId;
    } else if (isDevelopmentAdmin(context)) {
      teacherId = requiredText(inputTeacherId, "DEVELOPMENT_ASSESSMENT_TEACHER_REQUIRED");
    } else {
      throw new ForbiddenException("DEVELOPMENT_ASSESSMENT_WRITER_FORBIDDEN");
    }

    const teacher = await this.teachers.findById(teacherId);
    if (!teacher || teacher.tenantId !== scope.tenantId) {
      throw new NotFoundException("TEACHER_NOT_FOUND");
    }
    if (!isTeacherSubjectContext(context)) {
      const assignments = await this.teacherAssignments.listByTeacher(teacher.id);
      if (!hasTeacherAssignmentForScope(assignments, scope, today())) {
        throw new ForbiddenException("DEVELOPMENT_ASSESSMENT_AUTHOR_NOT_ASSIGNED");
      }
    }
    return teacher;
  }

  private async loadReplayedAssessment(context: RequestContext, receipt: unknown): Promise<DevelopmentAssessmentWithScores> {
    const assessmentId = receiptAssessmentId(receipt);
    const assessment = assessmentId ? await this.store.findAssessmentById(assessmentId) : undefined;
    if (!assessment) {
      throw new NotFoundException("DEVELOPMENT_ASSESSMENT_NOT_FOUND");
    }
    assertDevelopmentStudentTenantAccess(context, assessment);
    return { ...assessment, scores: await this.store.listScores(assessment.id) };
  }

  private async listVisibleForStudent(context: RequestContext, studentId: string): Promise<DevelopmentTrendItem[]> {
    const student = await this.students.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    assertDevelopmentStudentTenantAccess(context, student);
    const assessments = filterTenantResources(context, await this.store.listAssessments(student.id))
      .filter((assessment) => assessment.visibility === "GUARDIAN");
    const criteriaById = new Map(
      filterTenantResources(context, await this.store.listCriteria()).map((criterion) => [criterion.id, criterion]),
    );
    return Promise.all(assessments.map(async (assessment) => ({
      id: assessment.id,
      periodLabel: assessment.periodLabel,
      mentorNote: assessment.mentorNote,
      visibility: assessment.visibility,
      createdAt: assessment.createdAt,
      scores: (await this.store.listScores(assessment.id)).map((score) => {
        const criterion = criteriaById.get(score.criterionId);
        return {
          criterionId: score.criterionId,
          criterionName: criterion?.name ?? score.criterionId,
          score: score.score,
          scaleMin: criterion?.scaleMin ?? 1,
          scaleMax: criterion?.scaleMax ?? 5,
        };
      }),
    })));
  }

  private campusRestriction(context: RequestContext): ReadonlySet<string> | undefined {
    try {
      return resolveCampusRestriction(context);
    } catch {
      throw new ForbiddenException("DEVELOPMENT_CAMPUS_SCOPE_MISSING");
    }
  }

  /** Students whose current class is in the caller's campus scope; undefined when the caller is tenant-wide. */
  private async campusAllowedStudentIds(context: RequestContext): Promise<Set<string> | undefined> {
    const restriction = this.campusRestriction(context);
    if (!restriction) return undefined;

    const allowedClassIds = this.classes
      ? campusScopedClassIds(context, restriction, await this.classes.list())
      : new Set<string>();
    return new Set(
      filterTenantResources(context, await this.students.list())
        .filter((student) => Boolean(student.classId && allowedClassIds.has(student.classId)))
        .map((student) => student.id),
    );
  }

  // An assessment belongs to its student's current class campus; a student without a class fails closed.
  private async filterForCampusScope(
    context: RequestContext,
    assessments: DevelopmentAssessmentRecord[],
  ): Promise<DevelopmentAssessmentRecord[]> {
    const allowedStudentIds = await this.campusAllowedStudentIds(context);
    if (!allowedStudentIds) return assessments;
    return assessments.filter((assessment) => allowedStudentIds.has(assessment.studentId));
  }

  /**
   * RK-6: INTERNAL records reach admin roles, guidance counselors of the student and the author teacher only.
   * A teacher reads what they wrote plus every record of a student they counsel; other staff read GUARDIAN only.
   */
  private async filterReadable(
    context: RequestContext,
    assessments: DevelopmentAssessmentRecord[],
  ): Promise<DevelopmentAssessmentRecord[]> {
    for (const assessment of assessments) {
      assertDevelopmentStudentTenantAccess(context, assessment);
    }
    if (isTeacherSubjectContext(context)) {
      const counselsStudent = await this.guidanceMatcher(context, assessments);
      return assessments.filter((assessment) => assessment.teacherId === context.subjectId || counselsStudent(assessment.studentId));
    }
    if (isDevelopmentAdmin(context)) return assessments;
    return assessments.filter((assessment) => assessment.visibility === "GUARDIAN");
  }

  private async guidanceMatcher(
    context: RequestContext & { subjectId: string },
    assessments: DevelopmentAssessmentRecord[],
  ): Promise<(studentId: string) => boolean> {
    const guidance = (await this.teacherAssignments.listByTeacher(context.subjectId))
      .filter((assignment) => assignment.role === "GUIDANCE_COUNSELOR");
    if (guidance.length === 0 || !context.tenantId) return () => false;

    const tenantId = context.tenantId;
    const referenceDate = today();
    const studentIds = [...new Set(assessments.map((assessment) => assessment.studentId))];
    const counseled = new Set<string>();
    for (const studentId of studentIds) {
      const student = await this.students.findById(studentId);
      if (student && hasTeacherAssignmentForScope(guidance, { tenantId, studentId, classId: student.classId }, referenceDate)) {
        counseled.add(studentId);
      }
    }
    return (studentId) => counseled.has(studentId);
  }

  private async assertStudentInCampusScope(
    context: RequestContext,
    student: { tenantId: string; classId?: string },
  ): Promise<void> {
    const restriction = this.campusRestriction(context);
    if (!restriction) return;

    const schoolClass = student.classId && this.classes ? await this.classes.findById(student.classId) : undefined;
    if (
      !schoolClass
      || schoolClass.deletedAt
      || schoolClass.tenantId !== student.tenantId
      || !isCampusInScope(restriction, schoolClass.campusId)
    ) {
      throw new ForbiddenException("DEVELOPMENT_CAMPUS_SCOPE_FORBIDDEN");
    }
  }

  private async requireCriterion(tenantId: string, id: string): Promise<DevelopmentCriterionRecord> {
    const criterion = await this.store.findCriterionById(id);
    if (!criterion || criterion.tenantId !== tenantId) {
      throw new NotFoundException("DEVELOPMENT_CRITERION_NOT_FOUND");
    }
    return criterion;
  }
}

function isDevelopmentAdmin(context: RequestContext): boolean {
  return !isTeacherSubjectContext(context) && context.roles.some((role) => developmentAdminRoles.includes(role));
}

function receiptAssessmentId(receipt: unknown): string | undefined {
  if (!receipt || typeof receipt !== "object") return undefined;
  const record = receipt as Record<string, unknown>;
  // Keys stored before DEC-20261102-05 hold the full assessment; only its id is used, the stored note is never served.
  const id = record.assessmentId ?? record.id;
  return typeof id === "string" && id ? id : undefined;
}

function assertDevelopmentStudentTenantAccess(context: RequestContext, student: { tenantId: string }): void {
  try {
    assertTenantResourceAccess(context, student);
  } catch {
    throw new ForbiddenException("FORBIDDEN_TENANT");
  }
}

function requireTenantId(context: RequestContext): string {
  if (!context.tenantId) {
    throw new ForbiddenException("TENANT_CONTEXT_MISSING");
  }
  return context.tenantId;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function optionalInt(value: number | undefined, fallback: number, errorCode: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) throw new BadRequestException(errorCode);
  return value;
}

function requiredInt(value: number | undefined, errorCode: string): number {
  if (value === undefined || !Number.isInteger(value)) throw new BadRequestException(errorCode);
  return value;
}

/** DEC-20261102-05: omitted visibility is INTERNAL; the API writes GUARDIAN only when it is requested. */
function resolveVisibility(value: DevelopmentAssessmentVisibility | undefined): DevelopmentAssessmentVisibility {
  if (value === undefined) return "INTERNAL";
  if (value === "INTERNAL" || value === "GUARDIAN") return value;
  throw new BadRequestException("DEVELOPMENT_ASSESSMENT_VISIBILITY_INVALID");
}
