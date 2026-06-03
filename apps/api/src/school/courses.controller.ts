import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { CourseRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";

@Controller("courses")
@UseGuards(RolesGuard)
export class CoursesController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @Roles("TEACHER", "STUDENT", "GUARDIAN")
  async list(@Query() query: ListQuery): Promise<CourseRecord[]> {
    return applyListQuery(await this.school.listCourses(getRequestContext()), query, courseListFields);
  }

  @Get(":id")
  @Roles("TEACHER", "STUDENT", "GUARDIAN")
  findOne(@Param("id") id: string): Promise<CourseRecord> {
    return this.school.findCourse(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("academic:manage")
  create(@Body() body: Partial<CourseRecord>): Promise<CourseRecord> {
    return this.school.createCourse(getRequestContext(), body);
  }

  @Patch(":id")
  @RequireCapability("academic:manage")
  update(@Param("id") id: string, @Body() body: Partial<CourseRecord>): Promise<CourseRecord> {
    return this.school.updateCourse(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteCourse(getRequestContext(), id);
  }
}

const courseListFields = [
  { name: "name", read: (record: CourseRecord) => record.name },
  { name: "code", read: (record: CourseRecord) => record.code },
];
