import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import type { GradeLevelCourseRecord, GradeLevelRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { SchoolService } from "./school.service.js";
import {
  gradeLevelCreateBodySchema,
  gradeLevelUpdateBodySchema,
  type GradeLevelCreateBody,
  type GradeLevelUpdateBody,
} from "./school-validation.js";

@Controller("grade-levels")
export class GradeLevelsController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @RequireCapability("class:read")
  async list(@Query() query: ListQuery): Promise<GradeLevelRecord[]> {
    return applyListQuery(await this.school.listGradeLevels(getRequestContext()), query, gradeLevelListFields);
  }

  @Get(":id")
  @RequireCapability("class:read")
  findOne(@Param("id") id: string): Promise<GradeLevelRecord> {
    return this.school.findGradeLevel(getRequestContext(), id);
  }

  @Get(":id/courses")
  @RequireCapability("academic:read-catalog")
  listCourses(@Param("id") id: string, @Query("alanId") alanId?: string): Promise<GradeLevelCourseRecord[]> {
    return this.school.listGradeLevelCourses(getRequestContext(), id, alanId);
  }

  @Put(":id/courses/:courseId")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  ensureCourse(@Param("id") id: string, @Param("courseId") courseId: string): Promise<void> {
    return this.school.ensureGradeLevelCourse(getRequestContext(), id, courseId);
  }

  // UAT F-11 follow-up: state-guarded removal; a repeat gets 404, an in-use link 409 GRADE_LEVEL_COURSE_IN_USE.
  @Delete(":id/courses/:courseId")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  removeCourse(@Param("id") id: string, @Param("courseId") courseId: string): Promise<void> {
    return this.school.removeGradeLevelCourse(getRequestContext(), id, courseId);
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
