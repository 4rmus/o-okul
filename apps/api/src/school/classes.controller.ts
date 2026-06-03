import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { ClassRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";

@Controller("classes")
@UseGuards(RolesGuard)
export class ClassesController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<ClassRecord[]> {
    return applyListQuery(await this.school.listClasses(getRequestContext()), query, classListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<ClassRecord> {
    return this.school.findClass(getRequestContext(), id);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<ClassRecord>): Promise<ClassRecord> {
    return this.school.createClass(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TENANT_ADMIN")
  update(@Param("id") id: string, @Body() body: Partial<ClassRecord>): Promise<ClassRecord> {
    return this.school.updateClass(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TENANT_ADMIN")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteClass(getRequestContext(), id);
  }
}

const classListFields = [
  { name: "name", read: (record: ClassRecord) => record.name },
  { name: "level", read: (record: ClassRecord) => record.level },
  { name: "campusId", read: (record: ClassRecord) => record.campusId },
  { name: "gradeLevelId", read: (record: ClassRecord) => record.gradeLevelId },
  { name: "section", read: (record: ClassRecord) => record.section },
];
