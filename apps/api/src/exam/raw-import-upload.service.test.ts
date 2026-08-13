import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import type { ExamRepository } from "./exam.service.js";
import type { ParserConfigRepository } from "./parser-config-approval.service.js";
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
      new FakeExamRepository(),
      new FakeParserConfigRepository(),
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
    expect(expectedS3Key).not.toContain("answers.dat");
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
    const service = createService(archiveStore, repository, parseQueue);

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
    const service = createService(archiveStore, repository, parseQueue);

    await expect(service.upload(createContext(), {
      ...createInput(),
      bytes: Buffer.alloc(0),
    })).rejects.toThrow(BadRequestException);
    expect(archiveStore.puts).toHaveLength(0);
    expect(repository.creates).toHaveLength(0);
    expect(parseQueue.inputs).toHaveLength(0);
  });

  it("kampüs sınırlı personel için tenant-geneli optik yükleme başlatmaz", async () => {
    const archiveStore = new FakeArchiveStore();
    const repository = new FakeRawImportRepository();
    const parseQueue = new FakeParseQueue();
    const service = createService(archiveStore, repository, parseQueue);

    await expect(service.upload({
      ...createContext(),
      activePersona: "STAFF",
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-a"] },
    }, createInput())).rejects.toThrow(ForbiddenException);

    expect(archiveStore.puts).toHaveLength(0);
    expect(repository.creates).toHaveLength(0);
    expect(parseQueue.inputs).toHaveLength(0);
  });

  it("tenant sınavı bulunmadan dosyayı arşivlemez", async () => {
    const archiveStore = new FakeArchiveStore();
    const repository = new FakeRawImportRepository();
    const parseQueue = new FakeParseQueue();
    const service = createService(
      archiveStore,
      repository,
      parseQueue,
      new FakeExamRepository("another-exam"),
    );

    await expect(service.upload(createContext(), createInput())).rejects.toThrow(NotFoundException);
    expect(archiveStore.puts).toHaveLength(0);
    expect(repository.creates).toHaveLength(0);
    expect(parseQueue.inputs).toHaveLength(0);
  });

  it("onaylı parser sürümü bulunmadan dosyayı arşivlemez", async () => {
    const archiveStore = new FakeArchiveStore();
    const repository = new FakeRawImportRepository();
    const parseQueue = new FakeParseQueue();
    const service = createService(
      archiveStore,
      repository,
      parseQueue,
      new FakeExamRepository(),
      new FakeParserConfigRepository("another-parser"),
    );

    await expect(service.upload(createContext(), createInput())).rejects.toThrow(BadRequestException);
    expect(archiveStore.puts).toHaveLength(0);
    expect(repository.creates).toHaveLength(0);
    expect(parseQueue.inputs).toHaveLength(0);
  });

  it("RawImport kaydı yazılamazsa arşiv nesnesini siler ve queue işi üretmez", async () => {
    const archiveStore = new FakeArchiveStore();
    const repository = new FakeRawImportRepository();
    const parseQueue = new FakeParseQueue();
    repository.failNext = true;
    const service = createService(archiveStore, repository, parseQueue);

    await expect(service.upload(createContext(), createInput())).rejects.toThrow("RAW_IMPORT_CREATE_FAILED");
    expect(archiveStore.puts).toHaveLength(1);
    expect(archiveStore.deletes).toEqual([archiveStore.puts[0]?.s3Key]);
    expect(parseQueue.inputs).toHaveLength(0);
  });

  it("S3 key segmentlerini encode eder ve ham dosya adını taşımaz", () => {
    const key = createRawImportS3Key({
      tenantId: "tenant a",
      examId: "exam/a",
      parserConfigVersion: "parser v1",
      sha256: "hash",
      fileName: "8-A Ada 12345678901 iSEM .txt",
    });

    expect(key).toBe("raw-imports/tenant%20a/exam%2Fa/parser%20v1/hash/source");
    expect(key).not.toContain("Ada");
    expect(key).not.toContain("12345678901");
    expect(key).not.toContain("iSEM");
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
  readonly deletes: string[] = [];

  async put(input: { s3Key: string; body: Buffer; contentType?: string }): Promise<void> {
    this.puts.push(input);
  }

  async delete(s3Key: string): Promise<void> {
    this.deletes.push(s3Key);
  }
}

class FakeRawImportRepository implements RawImportRepository {
  readonly creates: CreateRawImportInput[] = [];
  failNext = false;

  async create(input: CreateRawImportInput) {
    this.creates.push(input);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("RAW_IMPORT_CREATE_FAILED");
    }
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

class FakeExamRepository {
  constructor(private readonly validExamId = "exam-a") {}

  async findById(tenantId: string, examId: string) {
    return tenantId === "tenant-a" && examId === this.validExamId
      ? { id: examId, tenantId, title: "Sınav", status: "DRAFT", createdAt: "2026-06-06T09:00:00.000Z", updatedAt: "2026-06-06T09:00:00.000Z" }
      : undefined;
  }
}

class FakeParserConfigRepository {
  constructor(private readonly validVersion = "parser-v1") {}

  async findApproved(tenantId: string, examId: string, version: string) {
    return tenantId === "tenant-a" && examId === "exam-a" && version === this.validVersion
      ? { tenantId, examId, version, encoding: "UTF-8" as const, delimiter: "TAB" as const, skipHeaderLines: 0, fieldMapping: { studentNo: { kind: "delimited" as const, column: 0 }, bookletType: { kind: "delimited" as const, column: 1 }, answers: { kind: "delimited" as const, column: 2, estimatedQuestionCount: 90 } }, status: "APPROVED" as const }
      : undefined;
  }
}

function createService(
  archiveStore: RawImportArchiveStore,
  repository: RawImportRepository,
  parseQueue: RawImportParseEnqueuer,
  exams: Pick<ExamRepository, "findById"> = new FakeExamRepository(),
  parserConfigs: Pick<ParserConfigRepository, "findApproved"> = new FakeParserConfigRepository(),
) {
  return new RawImportUploadService(
    archiveStore,
    repository,
    parseQueue,
    exams,
    parserConfigs,
  );
}

class FakeAuditLogService {
  readonly records: CreateAuditLogInput[] = [];

  async record(input: CreateAuditLogInput) {
    this.records.push(input);
    return { id: "audit-a", createdAt: "2026-06-06T09:00:00.000Z", ...input };
  }
}
