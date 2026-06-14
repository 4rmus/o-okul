import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { ExamParticipantRecord, ExamRecord } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { assertTeacherAssigned } from "../school/assert-teacher-assigned.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";

export const examRepositoryToken = Symbol("ExamRepository");
export const examParticipantRepositoryToken = Symbol("ExamParticipantRepository");

export interface CreateExamRepositoryInput {
  tenantId: string;
  title: string;
  startsAt?: string;
}

export interface UpdateExamRepositoryInput {
  title: string;
  startsAt?: string;
}

export interface ExamRepository {
  create(input: CreateExamRepositoryInput): Promise<ExamRecord>;
  list(tenantId: string): Promise<ExamRecord[]>;
  findById(tenantId: string, examId: string): Promise<ExamRecord | undefined>;
  update(tenantId: string, examId: string, input: UpdateExamRepositoryInput): Promise<ExamRecord | undefined>;
  publish(tenantId: string, examId: string): Promise<ExamRecord | undefined>;
  delete(tenantId: string, examId: string): Promise<ExamRecord | undefined>;
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

export interface CreateExamInput {
  title?: string;
  startsAt?: string;
  classId?: string;
  classIds?: string[];
}

export interface UpdateExamInput extends CreateExamInput {}

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
    @Inject(teacherAssignmentStoreToken)
    private readonly teacherAssignments: TeacherAssignmentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
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
    const startsAt = optionalIso(input.startsAt, "EXAM_STARTS_AT_INVALID");
    const classIds = normalizeClassIds(input);

    for (const classId of classIds) {
      await this.requireClass(tenantId, classId);
    }

    const exam = await this.repository.create({ tenantId, title, ...(startsAt ? { startsAt } : {}) });
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Exam",
      entityId: exam.id,
      action: "exam.created",
      diff: { title: exam.title, status: exam.status },
    });
    for (const classId of classIds) {
      await this.addClassParticipants(context, tenantId, exam.id, classId);
    }
    return exam;
  }

  async list(context: RequestContext): Promise<ExamRecord[]> {
    const tenantId = requireTenant(context);
    return this.repository.list(tenantId);
  }

  async get(context: RequestContext, examId: string | undefined): Promise<ExamRecord> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
    return this.requireExam(tenantId, id);
  }

  async update(context: RequestContext, examId: string | undefined, input: UpdateExamInput): Promise<ExamRecord> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
    const title = requiredString(input.title, "EXAM_TITLE_REQUIRED");
    const startsAt = optionalIso(input.startsAt, "EXAM_STARTS_AT_INVALID");
    const classIds = normalizeClassIds(input);

    for (const classId of classIds) {
      await this.requireClass(tenantId, classId);
    }

    const exam = await this.repository.update(tenantId, id, { title, ...(startsAt ? { startsAt } : {}) });
    if (!exam) {
      throw new NotFoundException("EXAM_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Exam",
      entityId: exam.id,
      action: "exam.updated",
      diff: { title: exam.title, startsAt: exam.startsAt },
    });
    for (const classId of classIds) {
      await this.addClassParticipants(context, tenantId, exam.id, classId);
    }
    return exam;
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
    return exam;
  }

  async delete(context: RequestContext, examId: string | undefined): Promise<void> {
    const tenantId = requireTenant(context);
    const id = requiredString(examId, "EXAM_ID_REQUIRED");
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

function normalizeClassIds(input: CreateExamInput): string[] {
  const values = input.classIds ?? (input.classId ? [input.classId] : []);
  return [...new Set(values.map((value) => optionalString(value)).filter((value): value is string => Boolean(value)))];
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message === "EXAM_PARTICIPANT_EXISTS" || "code" in error && error.code === "23505";
}
