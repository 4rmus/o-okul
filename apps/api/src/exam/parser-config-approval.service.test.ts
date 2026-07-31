import { describe, expect, it } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import type { ReportSnapshotStore } from "../report/report-snapshot-store.js";
import {
  ParserConfigApprovalService,
  type ApprovedParserConfigInput,
  type ParserConfigRepository,
} from "./parser-config-approval.service.js";

describe("ParserConfigApprovalService", () => {
  it("tenant context ile onaylanmış ParserConfig kaydını repository'ye verir", async () => {
    const repository = new FakeRepository();
    const auditLogs = new FakeAuditLogService();
    const snapshots = new FakeReportSnapshotStore();
    const service = new ParserConfigApprovalService(
      repository,
      auditLogs as unknown as AuditLogService,
      snapshots,
    );

    const result = await service.approve(createContext(), {
      examId: "exam-a",
      version: " parser-v1 ",
      suggestion: createSuggestion(),
    });

    expect(repository.inputs).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      suggestion: createSuggestion(),
    }]);
    expect(result).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      status: "APPROVED",
    });
    expect(auditLogs.records).toEqual([{
      tenantId: "tenant-a",
      actorUserId: "user-a",
      entityType: "ParserConfig",
      entityId: "exam-a:parser-v1",
      action: "parser_config.approved",
      diff: {
        examId: "exam-a",
        version: "parser-v1",
        encoding: "UTF-8",
        delimiter: "TAB",
        skipHeaderLines: 1,
        mappedFields: ["studentNo", "bookletType", "answers"],
      },
    }]);
    expect(snapshots.markStaleInputs).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      reason: "parser_config.approved",
    }]);
  });

  it("öneri eksikse repository'ye gitmeden reddeder", async () => {
    const repository = new FakeRepository();
    const service = new ParserConfigApprovalService(repository);

    await expect(service.approve(createContext(), {
      examId: "exam-a",
      version: "parser-v1",
    })).rejects.toMatchObject({ status: 400 });
    expect(repository.inputs).toHaveLength(0);
  });

  it("öneri eksikse snapshot STALE yazmaz", async () => {
    const repository = new FakeRepository();
    const snapshots = new FakeReportSnapshotStore();
    const service = new ParserConfigApprovalService(repository, undefined, snapshots);

    await expect(service.approve(createContext(), {
      examId: "exam-a",
      version: "parser-v1",
    })).rejects.toMatchObject({ status: 400 });
    expect(snapshots.markStaleInputs).toEqual([]);
  });

  it("versiyon çakışmasını 409 olarak döndürür", async () => {
    const repository = new FakeRepository("PARSER_CONFIG_VERSION_CONFLICT");
    const service = new ParserConfigApprovalService(repository);

    await expect(service.approve(createContext(), {
      examId: "exam-a",
      version: "parser-v1",
      suggestion: createSuggestion(),
    })).rejects.toMatchObject({ status: 409 });
  });
});

function createContext(): RequestContext {
  return {
    userId: "user-a",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}

function createSuggestion() {
  return {
    encoding: "UTF-8" as const,
    delimiter: "TAB" as const,
    skipHeaderLines: 1,
    fieldMapping: {
      studentNo: { kind: "delimited" as const, column: 0 },
      bookletType: { kind: "delimited" as const, column: 1 },
      answers: { kind: "delimited" as const, column: 2, estimatedQuestionCount: 5 },
    },
    version: 1 as const,
    confidence: "high" as const,
    warnings: [],
  };
}

class FakeRepository implements ParserConfigRepository {
  readonly inputs: ApprovedParserConfigInput[] = [];

  constructor(private readonly error?: string) {}

  async saveApproved(input: ApprovedParserConfigInput) {
    this.inputs.push(input);
    if (this.error) {
      throw new Error(this.error);
    }
    return {
      tenantId: input.tenantId,
      examId: input.examId,
      version: input.version,
      encoding: input.suggestion.encoding,
      delimiter: input.suggestion.delimiter,
      skipHeaderLines: input.suggestion.skipHeaderLines,
      fieldMapping: input.suggestion.fieldMapping,
      status: "APPROVED" as const,
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

class FakeReportSnapshotStore implements ReportSnapshotStore {
  readonly markStaleInputs: Array<{ tenantId: string; examId: string; reason: string }> = [];

  async listByExam() {
    return [];
  }

  async listByTenant() {
    return [];
  }

  async listReadyByStudent() {
    return [];
  }

  async findById() {
    return undefined;
  }

  async markStaleByExam(tenantId: string, examId: string, reason: string) {
    this.markStaleInputs.push({ tenantId, examId, reason });
    return 1;
  }
}
