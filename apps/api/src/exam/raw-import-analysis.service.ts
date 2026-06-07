import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import {
  rawImportAnalysisStoreToken,
  type RawImportAnalysisStore,
  type RawImportParseSummary,
} from "./raw-import-analysis-store.js";
import {
  rawImportQueueProducerToken,
  type RawImportQueueProducer,
} from "./raw-import-queue.service.js";

export interface RawImportEvaluationQueueResult {
  tenantId: string;
  examId: string;
  rawImportId: string;
  answerKeyId?: string;
  rawImportSha256?: string;
  matchedCount: number;
  queuedCount: number;
  queueName: "exam-evaluation";
  jobs: Array<{
    participantId: string;
    jobId: string;
    status: "queued";
  }>;
}

export interface RawImportEvaluationStatus {
  tenantId: string;
  examId: string;
  rawImportId: string;
  answerKeyId?: string;
  matchedCount: number;
  evaluatedCount: number;
  pendingCount: number;
  status: "COMPLETED" | "RUNNING";
}

@Injectable()
export class RawImportAnalysisService {
  constructor(
    @Inject(rawImportAnalysisStoreToken)
    private readonly store: RawImportAnalysisStore,
    @Inject(rawImportQueueProducerToken)
    private readonly producer: RawImportQueueProducer,
  ) {}

  async summary(
    context: RequestContext,
    examId: string | undefined,
    rawImportId: string | undefined,
  ): Promise<RawImportParseSummary> {
    const tenantId = requireTenant(context);
    const resolvedExamId = required(examId, "RAW_IMPORT_EXAM_REQUIRED");
    const resolvedRawImportId = required(rawImportId, "RAW_IMPORT_ID_REQUIRED");
    const summary = await this.store.getSummary(tenantId, resolvedExamId, resolvedRawImportId);
    if (!summary) {
      throw new NotFoundException("RAW_IMPORT_NOT_FOUND");
    }
    return summary;
  }

  async enqueueEvaluation(
    context: RequestContext,
    input: { examId?: string; rawImportId?: string; answerKeyId?: string },
  ): Promise<RawImportEvaluationQueueResult> {
    const tenantId = requireTenant(context);
    const examId = required(input.examId, "RAW_IMPORT_EXAM_REQUIRED");
    const rawImportId = required(input.rawImportId, "RAW_IMPORT_ID_REQUIRED");
    const answerKeyId = optional(input.answerKeyId);
    const matched = await this.store.listMatchedForEvaluation({ tenantId, examId, rawImportId, answerKeyId });
    if (matched.length === 0) {
      return {
        tenantId,
        examId,
        rawImportId,
        ...(answerKeyId ? { answerKeyId } : {}),
        matchedCount: 0,
        queuedCount: 0,
        queueName: "exam-evaluation",
        jobs: [],
      };
    }

    const jobs = [];
    for (const item of matched) {
      const job = await this.producer.enqueue({
        queueName: "exam-evaluation",
        tenantId,
        userId: context.userId,
        entityId: item.parsedAnswerId,
        contentHash: `${item.rawImportSha256}-${item.answerKeyId}`,
        participantId: item.participantId,
        rawImportId: item.rawImportId,
        answerKeyId: item.answerKeyId,
      });
      jobs.push({
        participantId: item.participantId,
        jobId: job.options.jobId,
        status: "queued" as const,
      });
    }

    return {
      tenantId,
      examId,
      rawImportId,
      answerKeyId: matched[0]?.answerKeyId,
      rawImportSha256: matched[0]?.rawImportSha256,
      matchedCount: matched.length,
      queuedCount: jobs.length,
      queueName: "exam-evaluation",
      jobs,
    };
  }

  async evaluationStatus(
    context: RequestContext,
    input: { examId?: string; rawImportId?: string; answerKeyId?: string },
  ): Promise<RawImportEvaluationStatus> {
    const tenantId = requireTenant(context);
    const examId = required(input.examId, "RAW_IMPORT_EXAM_REQUIRED");
    const rawImportId = required(input.rawImportId, "RAW_IMPORT_ID_REQUIRED");
    const answerKeyId = optional(input.answerKeyId);
    const matched = await this.store.listMatchedForEvaluation({ tenantId, examId, rawImportId, answerKeyId });
    const resolvedAnswerKeyId = answerKeyId ?? matched[0]?.answerKeyId;
    const evaluatedCount = resolvedAnswerKeyId
      ? await this.store.countEvaluatedForEvaluation({ tenantId, examId, rawImportId, answerKeyId: resolvedAnswerKeyId })
      : 0;
    const pendingCount = Math.max(matched.length - evaluatedCount, 0);
    return {
      tenantId,
      examId,
      rawImportId,
      ...(resolvedAnswerKeyId ? { answerKeyId: resolvedAnswerKeyId } : {}),
      matchedCount: matched.length,
      evaluatedCount,
      pendingCount,
      status: pendingCount === 0 ? "COMPLETED" : "RUNNING",
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

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
