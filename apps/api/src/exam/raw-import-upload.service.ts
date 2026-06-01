import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { RawImportQueueService, type RawImportParseJobResult } from "./raw-import-queue.service.js";

export const rawImportArchiveStoreToken = Symbol("RawImportArchiveStore");
export const rawImportRepositoryToken = Symbol("RawImportRepository");

export interface RawImportArchiveStore {
  put(input: {
    s3Key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<void>;
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

export interface RawImportUploadResult {
  rawImport: CreatedRawImport;
  parseJob: RawImportParseJobResult;
  status: "uploaded";
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
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async upload(
    context: RequestContext,
    input: RawImportUploadInput,
  ): Promise<RawImportUploadResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

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
      tenantId: context.tenantId,
      examId,
      parserConfigVersion,
      sha256,
      fileName,
    });

    await this.archiveStore.put({
      s3Key,
      body,
      contentType: input.contentType,
    });
    const rawImport = await this.repository.create({
      tenantId: context.tenantId,
      examId,
      sourceType,
      fileName,
      s3Key,
      sha256,
      parserConfigVersion,
      metadata: input.contentType ? { contentType: input.contentType } : undefined,
    });
    const parseJob = await this.parseQueue.enqueueParse(context, {
      examId,
      rawImportId: rawImport.id,
      sha256,
    });
    await this.auditLogs?.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      entityType: "RawImport",
      entityId: rawImport.id,
      action: "raw_import.uploaded",
      diff: {
        examId,
        sourceType,
        parserConfigVersion,
        contentType: input.contentType,
        byteLength: body.byteLength,
        sha256,
        parseJobId: parseJob.jobId,
      },
    });

    return {
      rawImport,
      parseJob,
      status: "uploaded",
    };
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
    input.fileName,
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
