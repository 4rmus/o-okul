import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { ClassRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";
import {
  classCreateBodySchema,
  classUpdateBodySchema,
  type ClassCreateBody,
  type ClassUpdateBody,
} from "./school-validation.js";

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
  @RequireCapability("class:manage")
  create(
    @Body(zodBody(classCreateBodySchema)) body: ClassCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ClassRecord> {
    return this.school.createClass(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("class:manage")
  update(@Param("id") id: string, @Body(zodBody(classUpdateBodySchema)) body: ClassUpdateBody): Promise<ClassRecord> {
    return this.school.updateClass(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("class:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteClass(getRequestContext(), id);
  }
}

const classListFields = [
  { name: "name", read: (record: ClassRecord) => record.name },
  { name: "alanId", read: (record: ClassRecord) => record.alanId },
  { name: "campusId", read: (record: ClassRecord) => record.campusId },
  { name: "gradeLevelId", read: (record: ClassRecord) => record.gradeLevelId },
  { name: "section", read: (record: ClassRecord) => record.section },
];
