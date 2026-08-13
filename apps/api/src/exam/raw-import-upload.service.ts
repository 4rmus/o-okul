import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { RawImportUploadResult } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
import { examRepositoryToken, type ExamRepository } from "./exam.service.js";
import { parserConfigRepositoryToken, type ParserConfigRepository } from "./parser-config-approval.service.js";
import { RawImportQueueService, type RawImportParseJobResult } from "./raw-import-queue.service.js";

export const rawImportArchiveStoreToken = Symbol("RawImportArchiveStore");
export const rawImportRepositoryToken = Symbol("RawImportRepository");

export interface RawImportArchiveStore {
  put(input: {
    s3Key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<void>;
  delete(s3Key: string): Promise<void>;
}

export interface RawImportRepository {
  create(input: CreateRawImportInput): Promise<CreatedRawImport>;
}

export interface RawImportParseEnqueuer {
  enqueueParse(
    context: RequestContext,
    input: { examId: string; rawImportId: string; sha256: string },
  ): Promise<RawImportParseJobResult>;
}

export interface CreateRawImportInput {
  tenantId: string;
  examId: string;
  sourceType: string;
  fileName: string;
  s3Key: string;
  sha256: string;
  parserConfigVersion: string;
  metadata?: Record<string, unknown>;
}

export interface CreatedRawImport extends CreateRawImportInput {
  id: string;
}

export interface RawImportUploadInput {
  examId?: string;
  sourceType?: string;
  fileName?: string;
  bytes?: Buffer | Uint8Array;
  contentType?: string;
  parserConfigVersion?: string;
}

interface NormalizedRawImportUpload {
  tenantId: string;
  examId: string;
  sourceType: string;
  fileName: string;
  body: Buffer;
  contentType?: string;
  parserConfigVersion: string;
  sha256: string;
  s3Key: string;
}

@Injectable()
export class RawImportUploadService {
  constructor(
    @Inject(rawImportArchiveStoreToken)
    private readonly archiveStore: RawImportArchiveStore,
    @Inject(rawImportRepositoryToken)
    private readonly repository: RawImportRepository,
    @Inject(RawImportQueueService)
    private readonly parseQueue: RawImportParseEnqueuer,
    @Inject(examRepositoryToken)
    private readonly exams: Pick<ExamRepository, "findById">,
    @Inject(parserConfigRepositoryToken)
    private readonly parserConfigs: Pick<ParserConfigRepository, "findApproved">,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async upload(
    context: RequestContext,
    input: RawImportUploadInput,
    idempotencyKey?: string,
  ): Promise<RawImportUploadResult> {
    const tenantId = requireUploadScope(context);
    const normalized = normalizeUpload(tenantId, input);
    await this.assertUploadReady(normalized);
    const idempotencyRequest = {
      examId: normalized.examId,
      sourceType: normalized.sourceType,
      fileName: normalized.fileName,
      parserConfigVersion: normalized.parserConfigVersion,
      contentType: normalized.contentType,
      sha256: normalized.sha256,
    };

    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "raw-import.upload", request: idempotencyRequest },
        () => this.persistUpload(context, normalized),
      );
    }

    return this.persistUpload(context, normalized);
  }

  private async persistUpload(
    context: RequestContext,
    input: NormalizedRawImportUpload,
  ): Promise<RawImportUploadResult> {
    await this.archiveStore.put({
      s3Key: input.s3Key,
      body: input.body,
      contentType: input.contentType,
    });
    let rawImport: CreatedRawImport;
    try {
      rawImport = await this.repository.create({
        tenantId: input.tenantId,
        examId: input.examId,
        sourceType: input.sourceType,
        fileName: input.fileName,
        s3Key: input.s3Key,
        sha256: input.sha256,
        parserConfigVersion: input.parserConfigVersion,
        metadata: input.contentType ? { contentType: input.contentType } : undefined,
      });
    } catch (error) {
      await this.archiveStore.delete(input.s3Key);
      throw error;
    }
    const parseJob = await this.parseQueue.enqueueParse(context, {
      examId: input.examId,
      rawImportId: rawImport.id,
      sha256: input.sha256,
    });
    await this.auditLogs?.record({
      tenantId: input.tenantId,
      actorUserId: context.userId,
      entityType: "RawImport",
      entityId: rawImport.id,
      action: "raw_import.uploaded",
      diff: {
        examId: input.examId,
        sourceType: input.sourceType,
        parserConfigVersion: input.parserConfigVersion,
        contentType: input.contentType,
        byteLength: input.body.byteLength,
        sha256: input.sha256,
        parseJobId: parseJob.jobId,
      },
    });

    return {
      rawImport,
      parseJob,
      status: "uploaded",
    };
  }

  private async assertUploadReady(input: NormalizedRawImportUpload): Promise<void> {
    const exam = await this.exams.findById(input.tenantId, input.examId);
    if (!exam) throw new NotFoundException("EXAM_NOT_FOUND");

    const parserConfig = await this.parserConfigs.findApproved(
      input.tenantId,
      input.examId,
      input.parserConfigVersion,
    );
    if (!parserConfig) throw new BadRequestException("PARSER_CONFIG_NOT_APPROVED");
  }
}

function normalizeUpload(tenantId: string, input: RawImportUploadInput): NormalizedRawImportUpload {
  const examId = required(input.examId, "RAW_IMPORT_EXAM_REQUIRED");
  const sourceType = required(input.sourceType, "RAW_IMPORT_SOURCE_TYPE_REQUIRED");
  const fileName = normalizeFileName(input.fileName);
  const parserConfigVersion = required(
    input.parserConfigVersion,
    "RAW_IMPORT_PARSER_CONFIG_VERSION_REQUIRED",
  );
  const body = readBytes(input.bytes);
  const sha256 = createSha256(body);
  const s3Key = createRawImportS3Key({
    tenantId,
    examId,
    parserConfigVersion,
    sha256,
    fileName,
  });

  return {
    tenantId,
    examId,
    sourceType,
    fileName,
    body,
    contentType: input.contentType,
    parserConfigVersion,
    sha256,
    s3Key,
  };
}

function requireUploadScope(context: RequestContext): string {
  try {
    return requireTenantWideStaffContext(context, "RAW_IMPORT_CAMPUS_SCOPE_FORBIDDEN");
  } catch (error) {
    throw new ForbiddenException(error instanceof Error ? error.message : "RAW_IMPORT_CAMPUS_SCOPE_FORBIDDEN");
  }
}

export function createRawImportS3Key(input: {
  tenantId: string;
  examId: string;
  parserConfigVersion: string;
  sha256: string;
  fileName: string;
}): string {
  return [
    "raw-imports",
    input.tenantId,
    input.examId,
    input.parserConfigVersion,
    input.sha256,
    "source",
  ].map(encodeURIComponent).join("/");
}

function createSha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function readBytes(bytes: Buffer | Uint8Array | undefined): Buffer {
  if (!bytes) {
    throw new BadRequestException("RAW_IMPORT_FILE_REQUIRED");
  }
  const body = Buffer.from(bytes);
  if (body.length === 0) {
    throw new BadRequestException("RAW_IMPORT_FILE_REQUIRED");
  }
  return body;
}

function normalizeFileName(fileName: string | undefined): string {
  const value = required(fileName, "RAW_IMPORT_FILE_NAME_REQUIRED");
  const parts = value.split(/[\\/]/);
  const last = parts.at(-1)?.trim();
  if (!last) {
    throw new BadRequestException("RAW_IMPORT_FILE_NAME_REQUIRED");
  }
  return last;
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}
