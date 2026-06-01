import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import type { ParserConfigSuggestion } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";

export const parserConfigRepositoryToken = Symbol("ParserConfigRepository");

export interface ApprovedParserConfigInput {
  tenantId: string;
  examId: string;
  version: string;
  suggestion: ParserConfigSuggestion;
}

export interface SavedParserConfig {
  tenantId: string;
  examId: string;
  version: string;
  encoding: string;
  delimiter: string;
  skipHeaderLines: number;
  fieldMapping: ParserConfigSuggestion["fieldMapping"];
  status: "APPROVED";
}

export interface ParserConfigRepository {
  saveApproved(input: ApprovedParserConfigInput): Promise<SavedParserConfig>;
}

export interface ParserConfigApprovalInput {
  examId?: string;
  version?: string;
  suggestion?: ParserConfigSuggestion;
}

@Injectable()
export class ParserConfigApprovalService {
  constructor(
    @Inject(parserConfigRepositoryToken)
    private readonly repository: ParserConfigRepository,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async approve(
    context: RequestContext,
    input: ParserConfigApprovalInput,
  ): Promise<SavedParserConfig> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const version = required(input.version, "PARSER_CONFIG_VERSION_REQUIRED");
    const suggestion = validateSuggestion(input.suggestion);
    const examId = required(input.examId, "PARSER_CONFIG_EXAM_REQUIRED");

    try {
      const record = await this.repository.saveApproved({
        tenantId: context.tenantId,
        examId,
        version,
        suggestion,
      });
      await this.auditLogs?.record({
        tenantId: context.tenantId,
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
