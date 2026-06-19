import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { DevelopmentAssessmentVisibility, DevelopmentTrendItem } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { assertTeacherAssigned } from "../school/assert-teacher-assigned.js";
import {
  type GuardianStudentStore,
  guardianStudentStoreToken,
} from "../school/guardian-student-store.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { assertTenantResourceAccess, filterTenantResources, isTeacherSubjectContext } from "../tenant/tenant-access.js";
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

@Injectable()
export class DevelopmentService {
  constructor(
    @Inject(developmentStoreToken) private readonly store: DevelopmentStore,
    @Inject(studentStoreToken) private readonly students: StudentStore,
    @Inject(teacherStoreToken) private readonly teachers: TeacherStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignments: TeacherAssignmentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudents: GuardianStudentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async listCriteria(context: RequestContext): Promise<DevelopmentCriterionRecord[]> {
    return filterTenantResources(context, await this.store.listCriteria());
  }

  async createCriterion(context: RequestContext, input: DevelopmentCriterionInput): Promise<DevelopmentCriterionRecord> {
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
    const assessments = filterTenantResources(context, await this.store.listAssessments(studentId)).filter((assessment) =>
      this.canReadAssessment(context, assessment),
    );
    return Promise.all(assessments.map(async (assessment) => ({
      ...assessment,
      scores: await this.store.listScores(assessment.id),
    })));
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

  async createAssessment(context: RequestContext, input: DevelopmentAssessmentInput): Promise<DevelopmentAssessmentWithScores> {
    const tenantId = requireTenantId(context);
    const studentId = requiredText(input.studentId, "DEVELOPMENT_ASSESSMENT_STUDENT_REQUIRED");
    const student = await this.students.findById(studentId);
    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    const teacherId = await this.resolveTeacherId(context, input.teacherId);
    const teacher = await this.teachers.findById(teacherId);
    if (!teacher || teacher.tenantId !== tenantId) {
      throw new NotFoundException("TEACHER_NOT_FOUND");
    }

    await assertTeacherAssigned(context, this.teacherAssignments, {
      tenantId,
      studentId: student.id,
      classId: student.classId,
      termId: optionalText(input.termId),
    });

    const scoreInputs = input.scores ?? [];
    if (scoreInputs.length === 0) {
      throw new BadRequestException("DEVELOPMENT_ASSESSMENT_SCORES_REQUIRED");
    }

    const criteria = await Promise.all(scoreInputs.map((score) =>
      this.requireCriterion(tenantId, requiredText(score.criterionId, "DEVELOPMENT_SCORE_CRITERION_REQUIRED")),
    ));
    const assessment = await this.store.createAssessment({
      tenantId,
      studentId: student.id,
      teacherId: teacher.id,
      termId: optionalText(input.termId),
      periodLabel: requiredText(input.periodLabel, "DEVELOPMENT_ASSESSMENT_PERIOD_REQUIRED"),
      mentorNote: optionalText(input.mentorNote),
      visibility: resolveVisibility(input.visibility),
    });
    const scores = await Promise.all(scoreInputs.map((scoreInput, index) => {
      const criterion = criteria[index]!;
      const score = requiredInt(scoreInput.score, "DEVELOPMENT_SCORE_REQUIRED");
      if (score < criterion.scaleMin || score > criterion.scaleMax) {
        throw new BadRequestException("DEVELOPMENT_SCORE_OUT_OF_RANGE");
      }
      return this.store.createScore({
        tenantId,
        assessmentId: assessment.id,
        criterionId: criterion.id,
        score,
      });
    }));

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

  private async resolveTeacherId(context: RequestContext, inputTeacherId: string | undefined): Promise<string> {
    if (isTeacherSubjectContext(context)) {
      return context.subjectId;
    }
    return requiredText(inputTeacherId, "DEVELOPMENT_ASSESSMENT_TEACHER_REQUIRED");
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

  private async requireCriterion(tenantId: string, id: string): Promise<DevelopmentCriterionRecord> {
    const criterion = await this.store.findCriterionById(id);
    if (!criterion || criterion.tenantId !== tenantId) {
      throw new NotFoundException("DEVELOPMENT_CRITERION_NOT_FOUND");
    }
    return criterion;
  }

  private canReadAssessment(context: RequestContext, assessment: DevelopmentAssessmentRecord): boolean {
    try {
      assertTenantResourceAccess(context, assessment);
      if (!isTeacherSubjectContext(context)) return true;
      return assessment.teacherId === context.subjectId;
    } catch {
      throw new ForbiddenException("FORBIDDEN_TENANT");
    }
  }
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

function requiredText(value: string | undefined, errorCode: string): string {
  const text = optionalText(value);
  if (!text) throw new BadRequestException(errorCode);
  return text;
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

function resolveVisibility(value: "INTERNAL" | "GUARDIAN" | undefined): "INTERNAL" | "GUARDIAN" {
  if (value === undefined) return "GUARDIAN";
  if (value === "INTERNAL" || value === "GUARDIAN") return value;
  throw new BadRequestException("DEVELOPMENT_ASSESSMENT_VISIBILITY_INVALID");
}
