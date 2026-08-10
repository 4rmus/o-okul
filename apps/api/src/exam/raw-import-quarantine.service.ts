import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  RawImportQuarantineResolveBulkItem,
  RawImportQuarantineResolveBulkResponse,
} from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
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

export interface ImportQuarantineSummary {
  openCount: number;
}

export interface ResolveImportQuarantineInput {
  examId?: string;
  rawImportId?: string;
  quarantineId?: string;
  resolvedStudentId?: string;
}

export interface ResolveImportQuarantineBulkInput {
  examId?: string;
  rawImportId?: string;
  items?: RawImportQuarantineResolveBulkItem[];
}

@Injectable()
export class RawImportQuarantineService {
  constructor(
    @Inject(rawImportQuarantineStoreToken)
    private readonly store: RawImportQuarantineStore,
    @Inject(rawImportQueueProducerToken)
    private readonly producer: RawImportQueueProducer,
    @Optional() private readonly idempotency?: IdempotencyService,
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

  async summary(context: RequestContext): Promise<ImportQuarantineSummary> {
    const tenantId = requireTenant(context);
    return { openCount: await this.store.countOpenByTenant(tenantId) };
  }

  async resolve(
    context: RequestContext,
    input: ResolveImportQuarantineInput,
    idempotencyKey?: string,
  ): Promise<ResolvedImportQuarantineResult> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "raw-import.quarantine.resolve", request: input },
        () => this.resolveOnce(context, input),
      );
    }

    return this.resolveOnce(context, input);
  }

  async resolveBulk(
    context: RequestContext,
    input: ResolveImportQuarantineBulkInput,
    idempotencyKey?: string,
  ): Promise<RawImportQuarantineResolveBulkResponse> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "raw-import.quarantine.resolve-bulk", request: input },
        () => this.resolveBulkOnce(context, input),
      );
    }

    return this.resolveBulkOnce(context, input);
  }

  private async resolveBulkOnce(
    context: RequestContext,
    input: ResolveImportQuarantineBulkInput,
  ): Promise<RawImportQuarantineResolveBulkResponse> {
    const items = input.items;
    if (!items || items.length === 0) {
      throw new BadRequestException("IMPORT_QUARANTINE_BULK_ITEMS_REQUIRED");
    }

    const results: RawImportQuarantineResolveBulkResponse["results"] = [];
    for (const item of items) {
      try {
        const quarantine = await this.resolveOnce(context, {
          examId: input.examId,
          rawImportId: input.rawImportId,
          quarantineId: item.quarantineId,
          resolvedStudentId: item.resolvedStudentId,
        });
        results.push({ quarantineId: item.quarantineId, status: "RESOLVED", quarantine });
      } catch (error) {
        results.push({
          quarantineId: item.quarantineId,
          status: "FAILED",
          errorCode: readExceptionCode(error),
        });
      }
    }

    return { results };
  }

  private async resolveOnce(
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

    const resolvedRecord = await this.store.markResolved({
      tenantId,
      examId: record.examId,
      rawImportId: record.rawImportId,
      quarantineId: record.id,
      resolvedStudentId: required(input.resolvedStudentId, "IMPORT_QUARANTINE_STUDENT_REQUIRED"),
    });
    if (!resolvedRecord) {
      throw new NotFoundException("IMPORT_QUARANTINE_NOT_FOUND");
    }

    let job: Awaited<ReturnType<RawImportQueueProducer["enqueue"]>>;
    try {
      job = await this.producer.enqueue({
        queueName: "exam-evaluation",
        tenantId,
        userId: context.userId,
        entityId: record.id,
        contentHash: `${record.rawImportSha256}-${record.answerKeyId}`,
        participantId: record.resolvedParticipantId,
        rawImportId: record.rawImportId,
        answerKeyId: record.answerKeyId,
      });
    } catch (error) {
      await this.store.reopen({
        tenantId,
        examId: record.examId,
        rawImportId: record.rawImportId,
        quarantineId: record.id,
        resolvedStudentId: required(input.resolvedStudentId, "IMPORT_QUARANTINE_STUDENT_REQUIRED"),
      });
      throw error;
    }

    return {
      ...resolvedRecord,
      resolvedParticipantId: record.resolvedParticipantId,
      answerKeyId: record.answerKeyId,
      rawImportSha256: record.rawImportSha256,
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
  try {
    return requireTenantWideStaffContext(context, "RAW_IMPORT_CAMPUS_SCOPE_FORBIDDEN");
  } catch (error) {
    throw new ForbiddenException(error instanceof Error ? error.message : "RAW_IMPORT_CAMPUS_SCOPE_FORBIDDEN");
  }
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function readExceptionCode(error: unknown): string {
  const response = typeof (error as { getResponse?: () => unknown })?.getResponse === "function"
    ? (error as { getResponse: () => unknown }).getResponse()
    : undefined;
  if (typeof response === "string") return response;
  if (response && typeof response === "object") {
    const message = (response as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  }
  return error instanceof Error ? error.message : "IMPORT_QUARANTINE_RESOLVE_FAILED";
}
