import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { OpticalFormTemplateRecord, ParserConfigSuggestion } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import {
  parserConfigRepositoryToken,
  type ParserConfigRepository,
  type SavedParserConfig,
} from "./parser-config-approval.service.js";
import {
  opticalFormTemplateStoreToken,
  type OpticalFormTemplateStore,
} from "./optical-form-template-store.js";

export interface CreateOpticalFormTemplateInput {
  name?: string;
  version?: string;
  suggestion?: ParserConfigSuggestion;
}

export interface ApplyOpticalFormTemplateInput {
  templateId?: string;
  examId?: string;
  version?: string;
}

@Injectable()
export class OpticalFormTemplateService {
  constructor(
    @Inject(opticalFormTemplateStoreToken)
    private readonly templates: OpticalFormTemplateStore,
    @Inject(parserConfigRepositoryToken)
    private readonly parserConfigs: ParserConfigRepository,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async list(context: RequestContext): Promise<OpticalFormTemplateRecord[]> {
    const tenantId = requireTenant(context);
    return this.templates.list(tenantId);
  }

  async create(
    context: RequestContext,
    input: CreateOpticalFormTemplateInput,
    idempotencyKey?: string,
  ): Promise<OpticalFormTemplateRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "optical-form-template.create", request: input },
        () => this.createOnce(context, input),
      );
    }

    return this.createOnce(context, input);
  }

  private async createOnce(context: RequestContext, input: CreateOpticalFormTemplateInput): Promise<OpticalFormTemplateRecord> {
    const tenantId = requireTenant(context);
    const name = required(input.name, "OPTICAL_FORM_TEMPLATE_NAME_REQUIRED");
    const version = required(input.version, "OPTICAL_FORM_TEMPLATE_VERSION_REQUIRED");
    const suggestion = validateSuggestion(input.suggestion);
    try {
      const record = await this.templates.create({ tenantId, name, version, suggestion });
      await this.auditLogs?.record({
        tenantId,
        actorUserId: context.userId,
        entityType: "OpticalFormTemplate",
        entityId: record.id,
        action: "optical_form_template.created",
        diff: {
          name: record.name,
          version: record.version,
          delimiter: record.delimiter,
          skipHeaderLines: record.skipHeaderLines,
        },
      });
      return record;
    } catch (error) {
      if (error instanceof Error && error.message === "OPTICAL_FORM_TEMPLATE_NAME_CONFLICT") {
        throw new ConflictException("OPTICAL_FORM_TEMPLATE_NAME_CONFLICT");
      }
      throw error;
    }
  }

  async applyToExam(
    context: RequestContext,
    input: ApplyOpticalFormTemplateInput,
    idempotencyKey?: string,
  ): Promise<SavedParserConfig> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "optical-form-template.apply", request: input },
        () => this.applyToExamOnce(context, input),
      );
    }

    return this.applyToExamOnce(context, input);
  }

  private async applyToExamOnce(context: RequestContext, input: ApplyOpticalFormTemplateInput): Promise<SavedParserConfig> {
    const tenantId = requireTenant(context);
    const templateId = required(input.templateId, "OPTICAL_FORM_TEMPLATE_ID_REQUIRED");
    const examId = required(input.examId, "OPTICAL_FORM_TEMPLATE_EXAM_REQUIRED");
    const version = required(input.version, "PARSER_CONFIG_VERSION_REQUIRED");
    const template = await this.templates.findById(tenantId, templateId);
    if (!template) {
      throw new NotFoundException("OPTICAL_FORM_TEMPLATE_NOT_FOUND");
    }
    try {
      const record = await this.parserConfigs.saveApproved({
        tenantId,
        examId,
        templateId: template.id,
        version,
        suggestion: {
          encoding: template.encoding,
          delimiter: template.delimiter,
          skipHeaderLines: template.skipHeaderLines,
          fieldMapping: template.fieldMapping,
          version: 1,
          confidence: "high",
          warnings: [],
        },
      });
      await this.auditLogs?.record({
        tenantId,
        actorUserId: context.userId,
        entityType: "ParserConfig",
        entityId: `${record.examId}:${record.version}`,
        action: "parser_config.applied_from_template",
        diff: { examId, version, templateId: template.id, templateName: template.name },
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

function validateSuggestion(suggestion: ParserConfigSuggestion | undefined): ParserConfigSuggestion {
  if (
    !suggestion ||
    suggestion.encoding !== "UTF-8" ||
    !suggestion.delimiter ||
    suggestion.skipHeaderLines === undefined ||
    !suggestion.fieldMapping?.studentNo ||
    !suggestion.fieldMapping.bookletType ||
    !suggestion.fieldMapping.answers
  ) {
    throw new BadRequestException("OPTICAL_FORM_TEMPLATE_SUGGESTION_INVALID");
  }
  return suggestion;
}
