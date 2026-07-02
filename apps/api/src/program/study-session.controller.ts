import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { StudySessionRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  studySessionCreateBodySchema,
  studySessionUpdateBodySchema,
  type StudySessionCreateBody,
  type StudySessionUpdateBody,
} from "./study-session-validation.js";
import { StudySessionService } from "./study-session.service.js";

@Controller("study-sessions")
@UseGuards(RolesGuard)
export class StudySessionController {
  constructor(private readonly studySessions: StudySessionService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<StudySessionRecord[]> {
    return applyListQuery(await this.studySessions.list(getRequestContext()), query, studySessionListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<StudySessionRecord> {
    return this.studySessions.findOne(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("academic:manage")
  create(
    @Body(zodBody(studySessionCreateBodySchema)) body: StudySessionCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudySessionRecord> {
    return this.studySessions.create(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("academic:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(studySessionUpdateBodySchema)) body: StudySessionUpdateBody,
  ): Promise<StudySessionRecord> {
    return this.studySessions.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  delete(@Param("id") id: string): Promise<void> {
    return this.studySessions.delete(getRequestContext(), id);
  }
}

const studySessionListFields = [
  { name: "title", read: (record: StudySessionRecord) => record.title },
  { name: "classId", read: (record: StudySessionRecord) => record.classId },
  { name: "teacherId", read: (record: StudySessionRecord) => record.teacherId },
  { name: "courseId", read: (record: StudySessionRecord) => record.courseId },
  { name: "termId", read: (record: StudySessionRecord) => record.termId },
  { name: "capacity", read: (record: StudySessionRecord) => record.capacity },
  { name: "startsAt", read: (record: StudySessionRecord) => record.startsAt },
  { name: "endsAt", read: (record: StudySessionRecord) => record.endsAt },
];
