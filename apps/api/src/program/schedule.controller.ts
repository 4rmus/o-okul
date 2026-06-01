import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { ScheduleLessonRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ScheduleService } from "./schedule.service.js";

@Controller("schedule-lessons")
@UseGuards(RolesGuard)
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get()
  @Roles("TEACHER")
  list(): Promise<ScheduleLessonRecord[]> {
    return this.schedule.list(getRequestContext());
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<ScheduleLessonRecord> {
    return this.schedule.findOne(getRequestContext(), id);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<ScheduleLessonRecord>): Promise<ScheduleLessonRecord> {
    return this.schedule.create(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TENANT_ADMIN")
  update(@Param("id") id: string, @Body() body: Partial<ScheduleLessonRecord>): Promise<ScheduleLessonRecord> {
    return this.schedule.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TENANT_ADMIN")
  delete(@Param("id") id: string): Promise<void> {
    return this.schedule.delete(getRequestContext(), id);
  }
}
