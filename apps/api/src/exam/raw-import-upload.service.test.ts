import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import {
  createRawImportS3Key,
  RawImportUploadService,
  type CreateRawImportInput,
  type RawImportArchiveStore,
  type RawImportParseEnqueuer,
  type RawImportRepository,
} from "./raw-import-upload.service.js";

describe("RawImportUploadService", () => {
  it("dosyayı arşivler, RawImport kaydı oluşturur ve excel-import enqueue eder", async () => {
    const archiveStore = new FakeArchiveStore();
    const repository = new FakeRawImportRepository();
    const parseQueue = new FakeParseQueue();
    const auditLogs = new FakeAuditLogService();
    const service = new RawImportUploadService(
      archiveStore,
      repository,
      parseQueue,
      auditLogs as unknown as AuditLogService,
    );
    const body = Buffer.from("ogrenci_no\tcevaplar");
    const sha256 = createSha256(body);

    const result = await service.upload(createContext(), {
      examId: "exam-a",
      sourceType: "OPTICAL_TXT",
      fileName: "../answers.dat",
      bytes: body,
      contentType: "text/plain",
      parserConfigVersion: "parser-v1",
    });

    const expectedS3Key = createRawImportS3Key({
      tenantId: "tenant-a",
      examId: "exam-a",
      parserConfigVersion: "parser-v1",
      sha256,
      fileName: "answers.dat",
    });
    expect(archiveStore.puts).toEqual([{
      s3Key: expectedS3Key,
      body,
      contentType: "text/plain",
    }]);
    expect(repository.creates).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      sourceType: "OPTICAL_TXT",
      fileName: "answers.dat",
      s3Key: expectedS3Key,
      sha256,
      parserConfigVersion: "parser-v1",
      metadata: { contentType: "text/plain" },
    }]);
    expect(parseQueue.inputs).toEqual([{
      context: createContext(),
      input: { examId: "exam-a", rawImportId: "raw-import-a", sha256 },
    }]);
    expect(result).toEqual({
      rawImport: { id: "raw-import-a", ...repository.creates[0] },
      parseJob: {
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        queueName: "excel-import",
        jobId: `raw-import-a_${sha256}`,
        status: "queued",
      },
      status: "uploaded",
    });
    expect(auditLogs.records).toEqual([{
      tenantId: "tenant-a",
      actorUserId: "user-a",
      entityType: "RawImport",
      entityId: "raw-import-a",
      action: "raw_import.uploaded",
      diff: {
        examId: "exam-a",
        sourceType: "OPTICAL_TXT",
        parserConfigVersion: "parser-v1",
        contentType: "text/plain",
        byteLength: body.byteLength,
        sha256,
        parseJobId: `raw-import-a_${sha256}`,
      },
    }]);
  });

  it("tenant context yoksa hiçbir yan etki oluşturmaz", async () => {
    const archiveStore = new FakeArchiveStore();
    const repository = new FakeRawImportRepository();
    const parseQueue = new FakeParseQueue();
    const service = new RawImportUploadService(archiveStore, repository, parseQueue);

    await expect(service.upload(
      { ...createContext(), tenantId: null },
      createInput(),
    )).rejects.toThrow(ForbiddenException);
    expect(archiveStore.puts).toHaveLength(0);
    expect(repository.creates).toHaveLength(0);
    expect(parseQueue.inputs).toHaveLength(0);
  });

  it("zorunlu dosya alanı yoksa hiçbir yan etki oluşturmaz", async () => {
    const archiveStore = new FakeArchiveStore();
    const repository = new FakeRawImportRepository();
    const parseQueue = new FakeParseQueue();
    const service = new RawImportUploadService(archiveStore, repository, parseQueue);

    await expect(service.upload(createContext(), {
      ...createInput(),
      bytes: Buffer.alloc(0),
    })).rejects.toThrow(BadRequestException);
    expect(archiveStore.puts).toHaveLength(0);
    expect(repository.creates).toHaveLength(0);
    expect(parseQueue.inputs).toHaveLength(0);
  });

  it("S3 key segmentlerini encode eder", () => {
    expect(createRawImportS3Key({
      tenantId: "tenant a",
      examId: "exam/a",
      parserConfigVersion: "parser v1",
      sha256: "hash",
      fileName: "cevap anahtari.dat",
    })).toBe("raw-imports/tenant%20a/exam%2Fa/parser%20v1/hash/cevap%20anahtari.dat");
  });
});

function createContext(): RequestContext {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}

function createInput() {
  return {
    examId: "exam-a",
    sourceType: "OPTICAL_TXT",
    fileName: "answers.dat",
    bytes: Buffer.from("answers"),
    parserConfigVersion: "parser-v1",
  };
}

function createSha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

class FakeArchiveStore implements RawImportArchiveStore {
  readonly puts: Array<{ s3Key: string; body: Buffer; contentType?: string }> = [];

  async put(input: { s3Key: string; body: Buffer; contentType?: string }): Promise<void> {
    this.puts.push(input);
  }
}

class FakeRawImportRepository implements RawImportRepository {
  readonly creates: CreateRawImportInput[] = [];

  async create(input: CreateRawImportInput) {
    this.creates.push(input);
    return { id: "raw-import-a", ...input };
  }
}

class FakeParseQueue implements RawImportParseEnqueuer {
  readonly inputs: Array<{
    context: RequestContext;
    input: { examId: string; rawImportId: string; sha256: string };
  }> = [];

  async enqueueParse(
    context: RequestContext,
    input: { examId: string; rawImportId: string; sha256: string },
  ) {
    this.inputs.push({ context, input });
    return {
      tenantId: context.tenantId ?? "",
      examId: input.examId,
      rawImportId: input.rawImportId,
      queueName: "excel-import" as const,
      jobId: `${input.rawImportId}_${input.sha256}`,
      status: "queued" as const,
    };
  }
}

class FakeAuditLogService {
  readonly records: CreateAuditLogInput[] = [];

  async record(input: CreateAuditLogInput) {
    this.records.push(input);
    return { id: "audit-a", createdAt: "2026-06-06T09:00:00.000Z", ...input };
  }
}
