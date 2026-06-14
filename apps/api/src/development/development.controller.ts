import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { DevelopmentService, type DevelopmentAssessmentWithScores } from "./development.service.js";
import type { DevelopmentCriterionRecord } from "./development-store.js";
import {
  developmentAssessmentBodySchema,
  developmentCriterionBodySchema,
  type DevelopmentAssessmentBody,
  type DevelopmentCriterionBody,
} from "./development-validation.js";

@Controller("development")
@UseGuards(RolesGuard)
export class DevelopmentController {
  constructor(private readonly development: DevelopmentService) {}

  @Get("criteria")
  @Roles("TEACHER")
  listCriteria(): Promise<DevelopmentCriterionRecord[]> {
    return this.development.listCriteria(getRequestContext());
  }

  @Post("criteria")
  @RequireCapability("academic:manage")
  createCriterion(
    @Body(zodBody(developmentCriterionBodySchema)) body: DevelopmentCriterionBody,
  ): Promise<DevelopmentCriterionRecord> {
    return this.development.createCriterion(getRequestContext(), body);
  }

  @Get("assessments")
  @Roles("TEACHER")
  listAssessments(@Query("studentId") studentId?: string): Promise<DevelopmentAssessmentWithScores[]> {
    return this.development.listAssessments(getRequestContext(), studentId);
  }

  @Post("assessments")
  @Roles("TEACHER")
  createAssessment(
    @Body(zodBody(developmentAssessmentBodySchema)) body: DevelopmentAssessmentBody,
  ): Promise<DevelopmentAssessmentWithScores> {
    return this.development.createAssessment(getRequestContext(), body);
  }
}
