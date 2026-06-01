import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { TeacherNoteRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { TeacherNoteService, type TeacherNoteInput } from "./teacher-note.service.js";

@Controller("teacher-notes")
@UseGuards(RolesGuard)
export class TeacherNoteController {
  constructor(private readonly notes: TeacherNoteService) {}

  @Get()
  @Roles("TEACHER")
  list(@Query("studentId") studentId?: string): Promise<TeacherNoteRecord[]> {
    return this.notes.list(getRequestContext(), studentId);
  }

  @Post()
  @Roles("TEACHER")
  create(@Body() body: Partial<TeacherNoteInput>): Promise<TeacherNoteRecord> {
    return this.notes.create(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TEACHER")
  update(
    @Param("id") id: string,
    @Body() body: Partial<Pick<TeacherNoteRecord, "body" | "visibility" | "developmentStatus">>,
  ): Promise<TeacherNoteRecord> {
    return this.notes.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TEACHER")
  async delete(@Param("id") id: string): Promise<void> {
    await this.notes.delete(getRequestContext(), id);
  }
}
