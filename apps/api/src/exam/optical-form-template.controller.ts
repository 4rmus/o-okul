import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { OpticalFormTemplateRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { OpticalFormTemplateService } from "./optical-form-template.service.js";
import type { ParserConfigSuggestion } from "@uzman-hocam/shared-types";
import type { SavedParserConfig } from "./parser-config-approval.service.js";

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
    @Body() body: { name?: string; version?: string; suggestion?: ParserConfigSuggestion },
  ): Promise<OpticalFormTemplateRecord> {
    return this.templates.create(getRequestContext(), {
      name: body.name,
      version: body.version,
      suggestion: body.suggestion,
    });
  }

  @Post(":templateId/apply")
  @RequireCapability("academic:manage")
  apply(
    @Param("templateId") templateId: string,
    @Body() body: { examId?: string; version?: string },
  ): Promise<SavedParserConfig> {
    return this.templates.applyToExam(getRequestContext(), {
      templateId,
      examId: body.examId,
      version: body.version,
    });
  }
}
