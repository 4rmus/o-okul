import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import type { ProducedJob, TenantQueueJobInput } from "../queue/job-producer.js";

export const rawImportQueueProducerToken = Symbol("rawImportQueueProducer");

export interface RawImportQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export interface EnqueueRawImportParseInput {
  examId?: string;
  rawImportId?: string;
  sha256?: string;
}

export interface RawImportParseJobResult {
  tenantId: string;
  examId: string;
  rawImportId: string;
  queueName: "excel-import";
  jobId: string;
  status: "queued";
}

@Injectable()
export class RawImportQueueService {
  constructor(
    @Inject(rawImportQueueProducerToken)
    private readonly producer: RawImportQueueProducer,
  ) {}

  async enqueueParse(
    context: RequestContext,
    input: EnqueueRawImportParseInput,
  ): Promise<RawImportParseJobResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const examId = required(input.examId, "RAW_IMPORT_EXAM_REQUIRED");
    const rawImportId = required(input.rawImportId, "RAW_IMPORT_ID_REQUIRED");
    const sha256 = required(input.sha256, "RAW_IMPORT_SHA256_REQUIRED");

    const job = await this.producer.enqueue({
      queueName: "excel-import",
      tenantId: context.tenantId,
      userId: context.userId,
      entityId: rawImportId,
      contentHash: sha256,
    });

    return {
      tenantId: context.tenantId,
      examId,
      rawImportId,
      queueName: "excel-import",
      jobId: job.options.jobId,
      status: "queued",
    };
  }
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}
