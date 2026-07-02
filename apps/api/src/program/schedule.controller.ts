import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { ScheduleLessonRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  scheduleLessonCreateBodySchema,
  scheduleLessonUpdateBodySchema,
  type ScheduleLessonCreateBody,
  type ScheduleLessonUpdateBody,
} from "./schedule-validation.js";
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
  @RequireCapability("academic:manage")
  create(
    @Body(zodBody(scheduleLessonCreateBodySchema)) body: ScheduleLessonCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ScheduleLessonRecord> {
    return this.schedule.create(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("academic:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(scheduleLessonUpdateBodySchema)) body: ScheduleLessonUpdateBody,
  ): Promise<ScheduleLessonRecord> {
    return this.schedule.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("academic:manage")
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
