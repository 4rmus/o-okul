import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { StudySessionRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { StudySessionService } from "./study-session.service.js";

@Controller("study-sessions")
@UseGuards(RolesGuard)
export class StudySessionController {
  constructor(private readonly studySessions: StudySessionService) {}

  @Get()
  @Roles("TEACHER")
  list(): Promise<StudySessionRecord[]> {
    return this.studySessions.list(getRequestContext());
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<StudySessionRecord> {
    return this.studySessions.findOne(getRequestContext(), id);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<StudySessionRecord>): Promise<StudySessionRecord> {
    return this.studySessions.create(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TENANT_ADMIN")
  update(@Param("id") id: string, @Body() body: Partial<StudySessionRecord>): Promise<StudySessionRecord> {
    return this.studySessions.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TENANT_ADMIN")
  delete(@Param("id") id: string): Promise<void> {
    return this.studySessions.delete(getRequestContext(), id);
  }
}
