import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { LearningOutcomeRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";
import {
  learningOutcomeCreateBodySchema,
  learningOutcomeUpdateBodySchema,
  type LearningOutcomeCreateBody,
  type LearningOutcomeUpdateBody,
} from "./school-validation.js";

@Controller("learning-outcomes")
@UseGuards(RolesGuard)
export class LearningOutcomesController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @Roles("TEACHER", "STUDENT", "GUARDIAN")
  async list(@Query() query: ListQuery): Promise<LearningOutcomeRecord[]> {
    return applyListQuery(await this.school.listLearningOutcomes(getRequestContext()), query, learningOutcomeListFields);
  }

  @Get(":id")
  @Roles("TEACHER", "STUDENT", "GUARDIAN")
  findOne(@Param("id") id: string): Promise<LearningOutcomeRecord> {
    return this.school.findLearningOutcome(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("academic:manage")
  create(@Body(zodBody(learningOutcomeCreateBodySchema)) body: LearningOutcomeCreateBody): Promise<LearningOutcomeRecord> {
    return this.school.createLearningOutcome(getRequestContext(), body);
  }

  @Patch(":id")
  @RequireCapability("academic:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(learningOutcomeUpdateBodySchema)) body: LearningOutcomeUpdateBody,
  ): Promise<LearningOutcomeRecord> {
    return this.school.updateLearningOutcome(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteLearningOutcome(getRequestContext(), id);
  }
}

const learningOutcomeListFields = [
  { name: "code", read: (record: LearningOutcomeRecord) => record.code },
  { name: "branch", read: (record: LearningOutcomeRecord) => record.branch },
  { name: "title", read: (record: LearningOutcomeRecord) => record.title },
  { name: "level", read: (record: LearningOutcomeRecord) => record.level },
];
