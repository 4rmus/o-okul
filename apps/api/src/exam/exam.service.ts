import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { ExamRecord } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";

export const examRepositoryToken = Symbol("ExamRepository");

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

export interface CreateExamInput {
  title?: string;
  startsAt?: string;
}

@Injectable()
export class ExamService {
  constructor(
    @Inject(examRepositoryToken)
    private readonly repository: ExamRepository,
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
    const exam = await this.repository.findById(tenantId, id);
    if (!exam) {
      throw new NotFoundException("EXAM_NOT_FOUND");
    }
    return exam;
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
