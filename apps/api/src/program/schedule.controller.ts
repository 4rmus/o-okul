import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { ScheduleLessonRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ScheduleService } from "./schedule.service.js";

@Controller("schedule-lessons")
@UseGuards(RolesGuard)
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<ScheduleLessonRecord[]> {
    return applyListQuery(await this.schedule.list(getRequestContext()), query, scheduleLessonListFields);
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

const scheduleLessonListFields = [
  { name: "title", read: (record: ScheduleLessonRecord) => record.title },
  { name: "classId", read: (record: ScheduleLessonRecord) => record.classId },
  { name: "teacherId", read: (record: ScheduleLessonRecord) => record.teacherId },
  { name: "courseId", read: (record: ScheduleLessonRecord) => record.courseId },
  { name: "termId", read: (record: ScheduleLessonRecord) => record.termId },
  { name: "startsAt", read: (record: ScheduleLessonRecord) => record.startsAt },
  { name: "endsAt", read: (record: ScheduleLessonRecord) => record.endsAt },
];
