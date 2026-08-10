import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import type {
  ParserConfigApprovalRequest,
  ParserConfigRecord,
  ParserConfigSuggestion,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "../report/report-snapshot-store.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";

export const parserConfigRepositoryToken = Symbol("ParserConfigRepository");

export interface ApprovedParserConfigInput {
  tenantId: string;
  examId: string;
  templateId?: string;
  version: string;
  suggestion: ParserConfigSuggestion;
}

export interface SavedParserConfig extends ParserConfigRecord {}

export interface ParserConfigRepository {
  findApproved(tenantId: string, examId: string, version: string): Promise<SavedParserConfig | undefined>;
  saveApproved(input: ApprovedParserConfigInput): Promise<SavedParserConfig>;
}

export interface ParserConfigApprovalInput extends Partial<ParserConfigApprovalRequest> {
  examId?: string;
}

@Injectable()
export class ParserConfigApprovalService {
  constructor(
    @Inject(parserConfigRepositoryToken)
    private readonly repository: ParserConfigRepository,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional()
    @Inject(reportSnapshotStoreToken)
    private readonly snapshots?: ReportSnapshotStore,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async approve(
    context: RequestContext,
    input: ParserConfigApprovalInput,
    idempotencyKey?: string,
  ): Promise<SavedParserConfig> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "parser-config.approve", request: input },
        () => this.approveOnce(context, input),
      );
    }

    return this.approveOnce(context, input);
  }

  private async approveOnce(
    context: RequestContext,
    input: ParserConfigApprovalInput,
  ): Promise<SavedParserConfig> {
    let tenantId: string;
    try {
      tenantId = requireTenantWideStaffContext(context, "PARSER_CONFIG_CAMPUS_SCOPE_FORBIDDEN");
    } catch (error) {
      throw new ForbiddenException(error instanceof Error ? error.message : "PARSER_CONFIG_CAMPUS_SCOPE_FORBIDDEN");
    }

    const version = required(input.version, "PARSER_CONFIG_VERSION_REQUIRED");
    const suggestion = validateSuggestion(input.suggestion);
    const examId = required(input.examId, "PARSER_CONFIG_EXAM_REQUIRED");

    try {
      const record = await this.repository.saveApproved({
        tenantId,
        examId,
        version,
        suggestion,
      });
      await this.snapshots?.markStaleByExam(tenantId, examId, "parser_config.approved");
      await this.auditLogs?.record({
        tenantId,
        actorUserId: context.userId,
        entityType: "ParserConfig",
        entityId: `${record.examId}:${record.version}`,
        action: "parser_config.approved",
        diff: {
          examId: record.examId,
          version: record.version,
          encoding: record.encoding,
          delimiter: record.delimiter,
          skipHeaderLines: record.skipHeaderLines,
          mappedFields: Object.keys(record.fieldMapping),
        },
      });
      return record;
    } catch (error) {
      if (error instanceof Error && error.message === "PARSER_CONFIG_VERSION_CONFLICT") {
        throw new ConflictException("PARSER_CONFIG_VERSION_CONFLICT");
      }
      throw error;
    }
  }
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function validateSuggestion(suggestion: ParserConfigSuggestion | undefined): ParserConfigSuggestion {
  if (
    !suggestion ||
    !suggestion.encoding ||
    !suggestion.delimiter ||
    suggestion.skipHeaderLines === undefined ||
    !suggestion.fieldMapping?.studentNo ||
    !suggestion.fieldMapping.bookletType ||
    !suggestion.fieldMapping.answers
  ) {
    throw new BadRequestException("PARSER_CONFIG_SUGGESTION_INVALID");
  }
  return suggestion;
}
