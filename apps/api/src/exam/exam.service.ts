import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { AnswerKeyRecord, ExamParticipantRecord, ExamRecord, ExamType } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "../report/report-snapshot-store.js";
import { type AlanStore, alanStoreToken } from "../school/alan-store.js";
import { assertTeacherAssigned } from "../school/assert-teacher-assigned.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type GradeLevelStore, gradeLevelStoreToken } from "../school/grade-level-store.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { AnswerKeyExcelImportService } from "./answer-key-excel-import.service.js";
import { answerKeyRepositoryToken, type AnswerKeyRepository } from "./answer-key.service.js";

export const examRepositoryToken = Symbol("ExamRepository");
export const examParticipantRepositoryToken = Symbol("ExamParticipantRepository");
const examTypes: ExamType[] = ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"];
const officialScoringProfiles = {
  "TR-LGS-2026-NOSD-V1": { examTypes: ["LGS"], examYear: 2026 },
  "TR-YKS-2026-NOSD-V1": { examTypes: ["TYT", "AYT"], examYear: 2026 },
} as const;

export interface CreateExamRepositoryInput {
  tenantId: string;
  gradeLevelId?: string;
  alanId?: string;
  examType?: ExamType;
  examYear?: number;
  scoringProfileId?: string;
  linkedTytExamId?: string;
  title: string;
  startsAt?: string;
}

export interface UpdateExamRepositoryInput {
  title: string;
  gradeLevelId?: string;
  alanId?: string;
  examType?: ExamType;
  examYear?: number;
  scoringProfileId?: string;
  linkedTytExamId?: string;
  startsAt?: string;
}

export interface ExamRepository {
  create(input: CreateExamRepositoryInput): Promise<ExamRecord>;
  list(tenantId: string): Promise<ExamRecord[]>;
  findById(tenantId: string, examId: string): Promise<ExamRecord | undefined>;
  update(tenantId: string, examId: string, input: UpdateExamRepositoryInput): Promise<ExamRecord | undefined>;
  publish(tenantId: string, examId: string): Promise<ExamRecord | undefined>;
  delete(tenantId: string, examId: string): Promise<ExamRecord | undefined>;
  hasScoringArtifacts?(tenantId: string, examId: string): Promise<boolean>;
}

export interface CreateExamParticipantRepositoryInput {
  tenantId: string;
  examId: string;
  studentId: string;
  participantNo?: string;
  bookletType?: string;
}

export interface ExamParticipantRepository {
  list(tenantId: string, examId: string): Promise<ExamParticipantRecord[]>;
  create(input: CreateExamParticipantRepositoryInput): Promise<ExamParticipantRecord>;
}

interface CreateExamAnswerKeyInput {
  version?: string;
  fileBase64?: string;
  scoringConfig?: unknown;
}

export interface CreateExamInput {
  title?: string;
  gradeLevelId?: string;
  alanId?: string;
  examType?: ExamType | string;
  examYear?: number;
  scoringProfileId?: string;
  linkedTytExamId?: string;
  startsAt?: string;
  classId?: string;
  classIds?: string[];
  answerKey: CreateExamAnswerKeyInput;
}

export interface UpdateExamInput {
  title?: string;
  gradeLevelId?: string;
  alanId?: string;
  examType?: ExamType | string;
  examYear?: number;
  scoringProfileId?: string;
  linkedTytExamId?: string;
  startsAt?: string;
  classId?: string;
  classIds?: string[];
}

export interface CreateExamParticipantInput {
  studentId?: string;
  participantNo?: string;
  bookletType?: string;
}

@Injectable()
export class ExamService {
  constructor(
    @Inject(examRepositoryToken)
    private readonly repository: ExamRepository,
    @Inject(examParticipantRepositoryToken)
    private readonly participants: ExamParticipantRepository,
    @Inject(studentStoreToken)
    private readonly students: StudentStore,
    @Inject(classStoreToken)
    private readonly classes: ClassStore,
    @Inject(gradeLevelStoreToken)
    private readonly gradeLevels: GradeLevelStore,
    @Inject(alanStoreToken)
    private readonly alanlar: AlanStore,
    @Inject(teacherAssignmentStoreToken)
    private readonly teacherAssignments: TeacherAssignmentStore,
    @Inject(answerKeyRepositoryToken)
    private readonly answerKeys: AnswerKeyRepository,
    private readonly answerKeyImports: AnswerKeyExcelImportService,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional()
    @Inject(reportSnapshotStoreToken)
    private readonly snapshots?: ReportSnapshotStore,
  ) {}

  async create(
    context: RequestContext,
    input: CreateExamInput,
    idempotencyKey?: string,
  ): Promise<ExamRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "exam.create", request: input },
        () => this.createOnce(context, input),
      );
    }

    return this.createOnce(context, input);
  }

  private async createOnce(context: RequestContext, input: CreateExamInput): Promise<ExamRecord> {
    const tenantId = requireTenant(context);
    const title = requiredString(input.title, "EXAM_TITLE_REQUIRED");
    const academicContext = await this.resolveAcademicContext(tenantId, input);
    const startsAt = optionalIso(input.startsAt, "EXAM_STARTS_AT_INVALID");
    const classIds = normalizeClassIds(input);
    const answerKey = requireCreateAnswerKey(input.answerKey);

    for (const classId of classIds) {
      await this.requireClass(tenantId, classId);
    }

    const exam = await this.repository.create({ tenantId, title, ...academicContext, ...(startsAt ? { startsAt } : {}) });
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Exam",
      entityId: exam.id,
      action: "exam.created",
      diff: {
        title: exam.title,
        status: exam.status,
        gradeLevelId: exam.gradeLevelId,
        alanId: exam.alanId,
        examType: exam.examType,
        examYear: exam.examYear,
        scoringProfileId: exam.scoringProfileId,
        linkedTytExamId: exam.linkedTytExamId,
      },
    });
    for (const classId of classIds) {
      await this.addClassParticipants(context, tenantId, exam.id, classId);
    }
    try {
      await this.answerKeyImports.import(context, {
        examId: exam.id,
        version: answerKey.version,
        fileBase64: answerKey.fileBase64,
        scoringConfig: answerKey.scoringConfig,
      });
    } catch (error) {
      await this.repository.delete(tenantId, exam.id).catch(() => undefined);
      throw error;
    }
    return this.withAnswerKeySummary(tenantId, exam);
  }

  async list(context: RequestContext): Promise<ExamRecord[]> {
    const tenantId = requireTenant(context);
    const exams = await this.repository.list(tenantId);
    return Promise.all(exams.map((exam) => this.withAnswerKeySummary(tenantId, exam)));
  }

  async get(context: RequestContext, examId: string | undefined): Promise<ExamRecord> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
    return this.withAnswerKeySummary(tenantId, await this.requireExam(tenantId, id));
  }

  async update(context: RequestContext, examId: string | undefined, input: UpdateExamInput): Promise<ExamRecord> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
    const title = requiredString(input.title, "EXAM_TITLE_REQUIRED");
    const existingExam = await this.requireExam(tenantId, id);
    const scoringIdentityTouched = input.examType !== undefined
      || input.examYear !== undefined
      || input.scoringProfileId !== undefined
      || input.linkedTytExamId !== undefined;
    const scoringIdentityInput = {
      ...input,
      examType: input.examType ?? existingExam.examType,
      examYear: input.examYear ?? existingExam.examYear,
      scoringProfileId: input.scoringProfileId ?? existingExam.scoringProfileId,
      linkedTytExamId: input.linkedTytExamId ?? existingExam.linkedTytExamId,
    };
    const academicContext = await this.resolveAcademicContext(
      tenantId,
      scoringIdentityInput,
      id,
      scoringIdentityTouched,
    );
    const scoringIdentityChanged = hasScoringIdentityChanged(existingExam, academicContext);
    if (scoringIdentityChanged) {
      const hasArtifacts = this.repository.hasScoringArtifacts
        ? await this.repository.hasScoringArtifacts(tenantId, id)
        : (await this.answerKeys.list(tenantId, id)).length > 0
          || (await this.snapshots?.listByExam(tenantId, id) ?? []).length > 0;
      const referencedByAyt = existingExam.examType === "TYT"
        && (await this.repository.list(tenantId)).some((exam) => exam.linkedTytExamId === id);
      if (hasArtifacts || referencedByAyt) {
        throw new ConflictException("EXAM_SCORING_PROFILE_IMMUTABLE");
      }
    }
    const startsAt = optionalIso(input.startsAt, "EXAM_STARTS_AT_INVALID");
    const classIds = normalizeClassIds(input);

    for (const classId of classIds) {
      await this.requireClass(tenantId, classId);
    }

    const exam = await this.repository.update(tenantId, id, { title, ...academicContext, ...(startsAt ? { startsAt } : {}) });
    if (!exam) {
      throw new NotFoundException("EXAM_NOT_FOUND");
    }
    if (scoringIdentityChanged) {
      await this.snapshots?.markStaleByExam(tenantId, id, "exam.scoring_identity.updated");
    }
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Exam",
      entityId: exam.id,
      action: "exam.updated",
      diff: {
        title: exam.title,
        startsAt: exam.startsAt,
        gradeLevelId: exam.gradeLevelId,
        alanId: exam.alanId,
        examType: exam.examType,
        examYear: exam.examYear,
        scoringProfileId: exam.scoringProfileId,
        linkedTytExamId: exam.linkedTytExamId,
      },
    });
    for (const classId of classIds) {
      await this.addClassParticipants(context, tenantId, exam.id, classId);
    }
    return this.withAnswerKeySummary(tenantId, exam);
  }

  async publish(
    context: RequestContext,
    examId: string | undefined,
    idempotencyKey?: string,
  ): Promise<ExamRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "exam.publish", request: { examId } },
        () => this.publishOnce(context, examId),
      );
    }

    return this.publishOnce(context, examId);
  }

  private async publishOnce(context: RequestContext, examId: string | undefined): Promise<ExamRecord> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
    await this.requireExam(tenantId, id);
    await this.requireAnswerKey(tenantId, id);
    const exam = await this.repository.publish(tenantId, id);
    if (!exam) {
      throw new NotFoundException("EXAM_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Exam",
      entityId: exam.id,
      action: "exam.published",
      diff: { status: exam.status },
    });
    return this.withAnswerKeySummary(tenantId, exam);
  }

  private async requireAnswerKey(tenantId: string, examId: string): Promise<void> {
    const answerKeys = await this.answerKeys.list(tenantId, examId);
    if (answerKeys.length === 0) {
      throw new BadRequestException("EXAM_ANSWER_KEY_REQUIRED");
    }
  }

  private async resolveAcademicContext(
    tenantId: string,
    input: Pick<CreateExamInput, "gradeLevelId" | "alanId" | "examType" | "examYear" | "scoringProfileId" | "linkedTytExamId">,
    examId?: string,
    validateScoringIdentity = true,
  ): Promise<Pick<CreateExamRepositoryInput, "gradeLevelId" | "alanId" | "examType" | "examYear" | "scoringProfileId" | "linkedTytExamId">> {
    const gradeLevelId = optionalString(input.gradeLevelId);
    const alanId = optionalString(input.alanId);
    const examType = resolveExamType(input.examType);
    const examYear = optionalExamYear(input.examYear);
    const scoringProfileId = optionalString(input.scoringProfileId);
    const linkedTytExamId = optionalString(input.linkedTytExamId);

    if (gradeLevelId) {
      const gradeLevel = await this.gradeLevels.findById(gradeLevelId);
      if (!gradeLevel || gradeLevel.deletedAt || gradeLevel.tenantId !== tenantId) {
        throw new ForbiddenException("FORBIDDEN_TENANT");
      }
    }
    if (alanId) {
      const alan = await this.alanlar.findById(alanId);
      if (!alan || alan.deletedAt || alan.tenantId !== tenantId) {
        throw new ForbiddenException("FORBIDDEN_TENANT");
      }
      if (alan.gradeLevelId && alan.gradeLevelId !== gradeLevelId) {
        throw new BadRequestException("ALAN_GRADE_LEVEL_MISMATCH");
      }
    }
    if (validateScoringIdentity) {
      assertOfficialScoringProfile(examType, examYear, scoringProfileId);
    }
    if (validateScoringIdentity && linkedTytExamId) {
      if (examType !== "AYT" || linkedTytExamId === examId) {
        throw new BadRequestException("LINKED_TYT_EXAM_INVALID");
      }
      const linkedTytExam = await this.repository.findById(tenantId, linkedTytExamId);
      if (
        !linkedTytExam
        || linkedTytExam.examType !== "TYT"
        || linkedTytExam.examYear !== examYear
        || linkedTytExam.scoringProfileId !== "TR-YKS-2026-NOSD-V1"
      ) {
        throw new BadRequestException("LINKED_TYT_EXAM_INVALID");
      }
    }

    return {
      ...(gradeLevelId ? { gradeLevelId } : {}),
      ...(alanId ? { alanId } : {}),
      ...(examType ? { examType } : {}),
      ...(examYear !== undefined ? { examYear } : {}),
      ...(scoringProfileId ? { scoringProfileId } : {}),
      ...(linkedTytExamId ? { linkedTytExamId } : {}),
    };
  }

  private async withAnswerKeySummary(tenantId: string, exam: ExamRecord): Promise<ExamRecord> {
    const answerKeys = await this.answerKeys.list(tenantId, exam.id);
    return {
      ...exam,
      answerKeySummary: summarizeExamAnswerKeys(answerKeys),
    };
  }

  async delete(context: RequestContext, examId: string | undefined): Promise<void> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
    const existing = await this.requireExam(tenantId, id);
    if (
      existing.examType === "TYT"
      && (await this.repository.list(tenantId)).some((exam) => exam.linkedTytExamId === id)
    ) {
      throw new ConflictException("LINKED_TYT_EXAM_IN_USE");
    }
    const exam = await this.repository.delete(tenantId, id);
    if (!exam) {
      throw new NotFoundException("EXAM_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Exam",
      entityId: exam.id,
      action: "exam.deleted",
      diff: { title: exam.title, status: exam.status },
    });
  }

  async listParticipants(context: RequestContext, examId: string | undefined): Promise<ExamParticipantRecord[]> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
    await this.requireExam(tenantId, id);
    return this.participants.list(tenantId, id);
  }

  async addParticipant(
    context: RequestContext,
    examId: string | undefined,
    input: CreateExamParticipantInput,
    idempotencyKey?: string,
  ): Promise<ExamParticipantRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "exam.participant.create", request: { examId, ...input } },
        () => this.addParticipantOnce(context, examId, input),
      );
    }

    return this.addParticipantOnce(context, examId, input);
  }

  private async addParticipantOnce(
    context: RequestContext,
    examId: string | undefined,
    input: CreateExamParticipantInput,
  ): Promise<ExamParticipantRecord> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
    const studentId = requiredString(input.studentId, "EXAM_PARTICIPANT_STUDENT_REQUIRED");
    const participantNo = optionalString(input.participantNo);
    const bookletType = optionalString(input.bookletType);
    await this.requireExam(tenantId, id);
    const student = await this.students.findById(studentId);
    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    await assertTeacherAssigned(context, this.teacherAssignments, {
      tenantId,
      studentId: student.id,
      classId: student.classId,
    });

    return this.createParticipant(context, tenantId, id, studentId, participantNo, bookletType);
  }

  private async requireExam(tenantId: string, examId: string): Promise<ExamRecord> {
    const exam = await this.repository.findById(tenantId, examId);
    if (!exam) {
      throw new NotFoundException("EXAM_NOT_FOUND");
    }
    return exam;
  }

  private async requireClass(tenantId: string, classId: string): Promise<void> {
    const schoolClass = await this.classes.findById(classId);
    if (!schoolClass || schoolClass.tenantId !== tenantId || schoolClass.deletedAt) {
      throw new NotFoundException("CLASS_NOT_FOUND");
    }
  }

  private async addClassParticipants(context: RequestContext, tenantId: string, examId: string, classId: string): Promise<void> {
    await assertTeacherAssigned(context, this.teacherAssignments, { tenantId, classId });
    const existingStudentIds = new Set((await this.participants.list(tenantId, examId)).map((participant) => participant.studentId));
    const students = (await this.students.list()).filter(
      (student) => student.tenantId === tenantId && student.classId === classId && !student.deletedAt,
    );
    for (const student of students) {
      if (existingStudentIds.has(student.id)) continue;
      await this.createParticipant(context, tenantId, examId, student.id);
      existingStudentIds.add(student.id);
    }
  }

  private async createParticipant(
    context: RequestContext,
    tenantId: string,
    examId: string,
    studentId: string,
    participantNo?: string,
    bookletType?: string,
  ): Promise<ExamParticipantRecord> {
    try {
      const participant = await this.participants.create({
        tenantId,
        examId,
        studentId,
        ...(participantNo ? { participantNo } : {}),
        ...(bookletType ? { bookletType } : {}),
      });
      await this.auditLogs?.record({
        tenantId,
        actorUserId: context.userId,
        entityType: "ExamParticipant",
        entityId: participant.id,
        action: "exam_participant.created",
        diff: { examId, studentId },
      });
      return participant;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("EXAM_PARTICIPANT_EXISTS");
      }
      throw error;
    }
  }
}

function requireTenant(context: RequestContext): string {
  if (!context.tenantId) {
    throw new ForbiddenException("TENANT_CONTEXT_MISSING");
  }
  return context.tenantId;
}

function requiredString(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function requireCreateAnswerKey(input: CreateExamInput["answerKey"] | undefined): Required<Pick<CreateExamAnswerKeyInput, "version" | "fileBase64">> & Pick<CreateExamAnswerKeyInput, "scoringConfig"> {
  if (!input) {
    throw new BadRequestException("EXAM_ANSWER_KEY_REQUIRED");
  }
  return {
    version: requiredString(input.version, "ANSWER_KEY_VERSION_REQUIRED"),
    fileBase64: requiredString(input.fileBase64, "ANSWER_KEY_FILE_REQUIRED"),
    scoringConfig: input.scoringConfig,
  };
}

function optionalIso(value: string | undefined, errorCode: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!isIsoDateTimeString(trimmed)) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function isIsoDateTimeString(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  return Boolean(match?.[1] && isCalendarDateString(match[1]) && !Number.isNaN(Date.parse(value)));
}

function isCalendarDateString(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalExamYear(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 2000 || value > 2100) {
    throw new BadRequestException("EXAM_YEAR_INVALID");
  }
  return value;
}

function assertOfficialScoringProfile(
  examType: ExamType | undefined,
  examYear: number | undefined,
  scoringProfileId: string | undefined,
): void {
  const requiredProfile = examType === "LGS"
    ? "TR-LGS-2026-NOSD-V1"
    : examType === "TYT" || examType === "AYT"
      ? "TR-YKS-2026-NOSD-V1"
      : undefined;
  if (requiredProfile && !scoringProfileId) {
    throw new BadRequestException("SCORING_PROFILE_REQUIRED");
  }
  if (requiredProfile && scoringProfileId !== requiredProfile) {
    throw new BadRequestException("SCORING_PROFILE_EXAM_TYPE_MISMATCH");
  }
  if (!scoringProfileId) return;
  const profile = officialScoringProfiles[scoringProfileId as keyof typeof officialScoringProfiles];
  if (!profile) {
    throw new BadRequestException("SCORING_PROFILE_UNSUPPORTED");
  }
  if (!examType || !(profile.examTypes as readonly ExamType[]).includes(examType)) {
    throw new BadRequestException("SCORING_PROFILE_EXAM_TYPE_MISMATCH");
  }
  if (examYear !== profile.examYear) {
    throw new BadRequestException("SCORING_PROFILE_EXAM_YEAR_MISMATCH");
  }
}

function hasScoringIdentityChanged(
  current: ExamRecord,
  next: Pick<CreateExamRepositoryInput, "examType" | "examYear" | "scoringProfileId" | "linkedTytExamId">,
): boolean {
  return current.examType !== next.examType
    || current.examYear !== next.examYear
    || current.scoringProfileId !== next.scoringProfileId
    || current.linkedTytExamId !== next.linkedTytExamId;
}

function resolveExamType(value: string | undefined): ExamType | undefined {
  const trimmed = optionalString(value)?.toUpperCase();
  if (!trimmed) return undefined;
  if (!examTypes.includes(trimmed as ExamType)) {
    throw new BadRequestException("EXAM_TYPE_INVALID");
  }
  return trimmed as ExamType;
}

function normalizeClassIds(input: Pick<CreateExamInput, "classId" | "classIds">): string[] {
  const values = input.classIds ?? (input.classId ? [input.classId] : []);
  return [...new Set(values.map((value) => optionalString(value)).filter((value): value is string => Boolean(value)))];
}

function summarizeExamAnswerKeys(answerKeys: AnswerKeyRecord[]): NonNullable<ExamRecord["answerKeySummary"]> {
  const selected = [...answerKeys].sort(compareAnswerKeysForSummary)[0];
  if (!selected) {
    return { status: "MISSING" };
  }
  return {
    status: selected.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    version: selected.version,
    questionCount: selected.questionCount,
    branchCount: selected.branches.length,
    updatedAt: selected.updatedAt,
  };
}

function compareAnswerKeysForSummary(left: AnswerKeyRecord, right: AnswerKeyRecord): number {
  if (left.status === "PUBLISHED" && right.status !== "PUBLISHED") return -1;
  if (right.status === "PUBLISHED" && left.status !== "PUBLISHED") return 1;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message === "EXAM_PARTICIPANT_EXISTS" || "code" in error && error.code === "23505";
}
