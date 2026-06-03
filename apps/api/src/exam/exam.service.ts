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
import { assertTeacherAssigned } from "../school/assert-teacher-assigned.js";
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

export interface ExamRepository {
  create(input: CreateExamRepositoryInput): Promise<ExamRecord>;
  list(tenantId: string): Promise<ExamRecord[]>;
  findById(tenantId: string, examId: string): Promise<ExamRecord | undefined>;
  publish(tenantId: string, examId: string): Promise<ExamRecord | undefined>;
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
    @Inject(teacherAssignmentStoreToken)
    private readonly teacherAssignments: TeacherAssignmentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async create(context: RequestContext, input: CreateExamInput): Promise<ExamRecord> {
    const tenantId = requireTenant(context);
    const title = requiredString(input.title, "EXAM_TITLE_REQUIRED");
    const startsAt = optionalIso(input.startsAt, "EXAM_STARTS_AT_INVALID");

    const exam = await this.repository.create({ tenantId, title, ...(startsAt ? { startsAt } : {}) });
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Exam",
      entityId: exam.id,
      action: "exam.created",
      diff: { title: exam.title, status: exam.status },
    });
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

  async publish(context: RequestContext, examId: string | undefined): Promise<ExamRecord> {
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

    try {
      const participant = await this.participants.create({
        tenantId,
        examId: id,
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
        diff: { examId: id, studentId },
      });
      return participant;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("EXAM_PARTICIPANT_EXISTS");
      }
      throw error;
    }
  }

  private async requireExam(tenantId: string, examId: string): Promise<ExamRecord> {
    const exam = await this.repository.findById(tenantId, examId);
    if (!exam) {
      throw new NotFoundException("EXAM_NOT_FOUND");
    }
    return exam;
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
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message === "EXAM_PARTICIPANT_EXISTS" || "code" in error && error.code === "23505";
}
