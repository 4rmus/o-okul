import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AlanRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";
import { alanCreateBodySchema, alanUpdateBodySchema, type AlanCreateBody, type AlanUpdateBody } from "./school-validation.js";

@Controller("alanlar")
@UseGuards(RolesGuard)
export class AlanlarController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<AlanRecord[]> {
    return applyListQuery(await this.school.listAlanlar(getRequestContext()), query, alanListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<AlanRecord> {
    return this.school.findAlan(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("class:manage")
  create(@Body(zodBody(alanCreateBodySchema)) body: AlanCreateBody): Promise<AlanRecord> {
    return this.school.createAlan(getRequestContext(), body);
  }

  @Patch(":id")
  @RequireCapability("class:manage")
  update(@Param("id") id: string, @Body(zodBody(alanUpdateBodySchema)) body: AlanUpdateBody): Promise<AlanRecord> {
    return this.school.updateAlan(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("class:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteAlan(getRequestContext(), id);
  }
}

const alanListFields = [
  { name: "name", read: (record: AlanRecord) => record.name },
  { name: "code", read: (record: AlanRecord) => record.code },
  { name: "gradeLevelId", read: (record: AlanRecord) => record.gradeLevelId },
];
