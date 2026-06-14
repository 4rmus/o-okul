import { Body, Controller, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  ParserConfigApprovalService,
  type SavedParserConfig,
} from "./parser-config-approval.service.js";
import {
  ParserConfigSuggestionService,
  type ParserConfigSuggestionResult,
} from "./parser-config-suggestion.service.js";
import {
  parserConfigApprovalBodySchema,
  parserConfigSuggestionBodySchema,
  type ParserConfigApprovalBody,
  type ParserConfigSuggestionBody,
} from "./parser-config-validation.js";

@Controller("exams/:examId/parser-configs")
@UseGuards(RolesGuard)
export class ParserConfigController {
  constructor(
    private readonly approvals: ParserConfigApprovalService,
    private readonly suggestions: ParserConfigSuggestionService,
  ) {}

  @Post("suggestions")
  @RequireCapability("academic:manage")
  suggest(
    @Param("examId") examId: string,
    @Body(zodBody(parserConfigSuggestionBodySchema)) body: ParserConfigSuggestionBody,
  ): ParserConfigSuggestionResult {
    return this.suggestions.suggest(getRequestContext(), {
      examId,
      sampleText: body.sampleText,
      fileBase64: body.fileBase64,
      sampleSize: body.sampleSize,
      preset: body.preset,
    });
  }

  @Post("approvals")
  @RequireCapability("academic:manage")
  approve(
    @Param("examId") examId: string,
    @Body(zodBody(parserConfigApprovalBodySchema)) body: ParserConfigApprovalBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SavedParserConfig> {
    return this.approvals.approve(getRequestContext(), {
      examId,
      version: body.version,
      suggestion: body.suggestion,
    }, idempotencyKey);
  }
}
