import { Body, Controller, Get, Post, Query, Headers } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { DevelopmentService, type DevelopmentAssessmentWithScores } from "./development.service.js";
import type { DevelopmentCriterionRecord } from "./development-store.js";
import {
  developmentAssessmentBodySchema,
  developmentCriterionBodySchema,
  type DevelopmentAssessmentBody,
  type DevelopmentCriterionBody,
} from "./development-validation.js";

@Controller("development")
export class DevelopmentController {
  constructor(private readonly development: DevelopmentService) {}

  @Get("criteria")
  @RequireCapability("academic:read")
  listCriteria(): Promise<DevelopmentCriterionRecord[]> {
    return this.development.listCriteria(getRequestContext());
  }

  @Post("criteria")
  @RequireCapability("academic:manage")
  createCriterion(
    @Body(zodBody(developmentCriterionBodySchema)) body: DevelopmentCriterionBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<DevelopmentCriterionRecord> {
    return this.development.createCriterion(getRequestContext(), body, idempotencyKey);
  }

  @Get("assessments")
  @RequireCapability("academic:read")
  listAssessments(@Query("studentId") studentId?: string): Promise<DevelopmentAssessmentWithScores[]> {
    return this.development.listAssessments(getRequestContext(), studentId);
  }

  @Post("assessments")
  @RequireCapability("academic:write-assigned")
  createAssessment(
    @Body(zodBody(developmentAssessmentBodySchema)) body: DevelopmentAssessmentBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<DevelopmentAssessmentWithScores> {
    return this.development.createAssessment(getRequestContext(), body, idempotencyKey);
  }
}
