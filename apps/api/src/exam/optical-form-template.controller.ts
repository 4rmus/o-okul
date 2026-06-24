import { Body, Controller, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
import type {
  OpticalFormTemplateApplyRequest,
  OpticalFormTemplateCreateRequest,
  OpticalFormTemplateRecord,
} from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { OpticalFormTemplateService } from "./optical-form-template.service.js";
import { parserConfigSuggestionSchema } from "./parser-config-validation.js";
import type { SavedParserConfig } from "./parser-config-approval.service.js";

const opticalFormTemplateCreateBodySchema = z.object({
  name: requiredTrimmedString,
  suggestion: parserConfigSuggestionSchema,
  version: requiredTrimmedString,
}).strict() satisfies z.ZodType<OpticalFormTemplateCreateRequest>;
const opticalFormTemplateApplyBodySchema = z.object({
  examId: requiredTrimmedString,
  version: requiredTrimmedString,
}).strict() satisfies z.ZodType<OpticalFormTemplateApplyRequest>;

type OpticalFormTemplateCreateBody = OpticalFormTemplateCreateRequest;
type OpticalFormTemplateApplyBody = OpticalFormTemplateApplyRequest;

@Controller("optical-form-templates")
@UseGuards(RolesGuard)
export class OpticalFormTemplateController {
  constructor(private readonly templates: OpticalFormTemplateService) {}

  @Get()
  @Roles("TENANT_ADMIN", "TEACHER")
  list(): Promise<OpticalFormTemplateRecord[]> {
    return this.templates.list(getRequestContext());
  }

  @Post()
  @RequireCapability("academic:manage")
  create(
    @Body(zodBody(opticalFormTemplateCreateBodySchema)) body: OpticalFormTemplateCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<OpticalFormTemplateRecord> {
    return this.templates.create(getRequestContext(), {
      name: body.name,
      version: body.version,
      suggestion: body.suggestion,
    }, idempotencyKey);
  }

  @Post(":templateId/apply")
  @RequireCapability("academic:manage")
  apply(
    @Param("templateId") templateId: string,
    @Body(zodBody(opticalFormTemplateApplyBodySchema)) body: OpticalFormTemplateApplyBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SavedParserConfig> {
    return this.templates.applyToExam(getRequestContext(), {
      templateId,
      examId: body.examId,
      version: body.version,
    }, idempotencyKey);
  }
}
