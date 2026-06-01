import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  ParserConfigApprovalService,
  type SavedParserConfig,
} from "./parser-config-approval.service.js";
import {
  ParserConfigSuggestionService,
  type ParserConfigSuggestionInput,
  type ParserConfigSuggestionResult,
} from "./parser-config-suggestion.service.js";
import type { ParserConfigSuggestion } from "@uzman-hocam/shared-types";

@Controller("exams/:examId/parser-configs")
@UseGuards(RolesGuard)
export class ParserConfigController {
  constructor(
    private readonly approvals: ParserConfigApprovalService,
    private readonly suggestions: ParserConfigSuggestionService,
  ) {}

  @Post("suggestions")
  @Roles("TENANT_ADMIN")
  suggest(
    @Param("examId") examId: string,
    @Body() body: Omit<ParserConfigSuggestionInput, "examId">,
  ): ParserConfigSuggestionResult {
    return this.suggestions.suggest(getRequestContext(), {
      examId,
      sampleText: body.sampleText,
      fileBase64: body.fileBase64,
      sampleSize: body.sampleSize,
    });
  }

  @Post("approvals")
  @Roles("TENANT_ADMIN")
  approve(
    @Param("examId") examId: string,
    @Body() body: { version?: string; suggestion?: ParserConfigSuggestion },
  ): Promise<SavedParserConfig> {
    return this.approvals.approve(getRequestContext(), {
      examId,
      version: body.version,
      suggestion: body.suggestion,
    });
  }
}
