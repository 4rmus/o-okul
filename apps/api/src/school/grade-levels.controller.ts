import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { GradeLevelRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";
import {
  gradeLevelCreateBodySchema,
  gradeLevelUpdateBodySchema,
  type GradeLevelCreateBody,
  type GradeLevelUpdateBody,
} from "./school-validation.js";

@Controller("grade-levels")
@UseGuards(RolesGuard)
export class GradeLevelsController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<GradeLevelRecord[]> {
    return applyListQuery(await this.school.listGradeLevels(getRequestContext()), query, gradeLevelListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<GradeLevelRecord> {
    return this.school.findGradeLevel(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("class:manage")
  create(@Body(zodBody(gradeLevelCreateBodySchema)) body: GradeLevelCreateBody): Promise<GradeLevelRecord> {
    return this.school.createGradeLevel(getRequestContext(), body);
  }

  @Patch(":id")
  @RequireCapability("class:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(gradeLevelUpdateBodySchema)) body: GradeLevelUpdateBody,
  ): Promise<GradeLevelRecord> {
    return this.school.updateGradeLevel(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("class:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteGradeLevel(getRequestContext(), id);
  }
}

const gradeLevelListFields = [
  { name: "name", read: (record: GradeLevelRecord) => record.name },
  { name: "code", read: (record: GradeLevelRecord) => record.code },
];
