import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import {
  rawImportQuarantineStoreToken,
  type ImportQuarantineRecord,
  type RawImportQuarantineStore,
} from "./raw-import-quarantine-store.js";
import {
  rawImportQueueProducerToken,
  type RawImportQueueProducer,
} from "./raw-import-queue.service.js";

export interface ResolvedImportQuarantineResult extends ImportQuarantineRecord {
  evaluationJob?: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    participantId: string;
    answerKeyId: string;
    queueName: "exam-evaluation";
    jobId: string;
    status: "queued";
  };
}

export interface ResolveImportQuarantineInput {
  examId?: string;
  rawImportId?: string;
  quarantineId?: string;
  resolvedStudentId?: string;
}

@Injectable()
export class RawImportQuarantineService {
  constructor(
    @Inject(rawImportQuarantineStoreToken)
    private readonly store: RawImportQuarantineStore,
    @Inject(rawImportQueueProducerToken)
    private readonly producer: RawImportQueueProducer,
  ) {}

  async list(
    context: RequestContext,
    examId: string | undefined,
    rawImportId: string | undefined,
  ): Promise<ImportQuarantineRecord[]> {
    const tenantId = requireTenant(context);
    return this.store.listByRawImport(
      tenantId,
      required(examId, "IMPORT_QUARANTINE_EXAM_REQUIRED"),
      required(rawImportId, "IMPORT_QUARANTINE_RAW_IMPORT_REQUIRED"),
    );
  }

  async resolve(
    context: RequestContext,
    input: ResolveImportQuarantineInput,
  ): Promise<ResolvedImportQuarantineResult> {
    const tenantId = requireTenant(context);
    const record = await this.store.resolve({
      tenantId,
      examId: required(input.examId, "IMPORT_QUARANTINE_EXAM_REQUIRED"),
      rawImportId: required(input.rawImportId, "IMPORT_QUARANTINE_RAW_IMPORT_REQUIRED"),
      quarantineId: required(input.quarantineId, "IMPORT_QUARANTINE_ID_REQUIRED"),
      resolvedStudentId: required(input.resolvedStudentId, "IMPORT_QUARANTINE_STUDENT_REQUIRED"),
    });
    if (!record) {
      throw new NotFoundException("IMPORT_QUARANTINE_NOT_FOUND");
    }
    if (!record.resolvedParticipantId || !record.answerKeyId || !record.rawImportSha256) {
      throw new NotFoundException("IMPORT_QUARANTINE_REPROCESS_INPUT_NOT_FOUND");
    }

    const job = await this.producer.enqueue({
      queueName: "exam-evaluation",
      tenantId,
      userId: context.userId,
      entityId: record.id,
      contentHash: record.rawImportSha256,
      participantId: record.resolvedParticipantId,
      rawImportId: record.rawImportId,
      answerKeyId: record.answerKeyId,
    });

    return {
      ...record,
      evaluationJob: {
        tenantId,
        examId: record.examId,
        rawImportId: record.rawImportId,
        participantId: record.resolvedParticipantId,
        answerKeyId: record.answerKeyId,
        queueName: "exam-evaluation",
        jobId: job.options.jobId,
        status: "queued",
      },
    };
  }
}

function requireTenant(context: RequestContext): string {
  if (!context.tenantId) {
    throw new ForbiddenException("TENANT_CONTEXT_MISSING");
  }
  return context.tenantId;
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}
