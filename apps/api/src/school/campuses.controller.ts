import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { CampusRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";

@Controller("campuses")
@UseGuards(RolesGuard)
export class CampusesController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<CampusRecord[]> {
    return applyListQuery(await this.school.listCampuses(getRequestContext()), query, campusListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<CampusRecord> {
    return this.school.findCampus(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("class:manage")
  create(@Body() body: Partial<CampusRecord>): Promise<CampusRecord> {
    return this.school.createCampus(getRequestContext(), body);
  }

  @Patch(":id")
  @RequireCapability("class:manage")
  update(@Param("id") id: string, @Body() body: Partial<CampusRecord>): Promise<CampusRecord> {
    return this.school.updateCampus(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("class:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteCampus(getRequestContext(), id);
  }
}

const campusListFields = [
  { name: "name", read: (record: CampusRecord) => record.name },
  { name: "code", read: (record: CampusRecord) => record.code },
];
