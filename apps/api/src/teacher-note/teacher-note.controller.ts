import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { TeacherNoteRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { TeacherNoteService } from "./teacher-note.service.js";
import {
  type TeacherNoteCreateBody,
  type TeacherNoteUpdateBody,
  teacherNoteCreateBodySchema,
  teacherNoteUpdateBodySchema,
} from "./teacher-note-validation.js";

interface TeacherNoteListQuery extends ListQuery {
  classId?: string;
  studentId?: string;
}

@Controller("teacher-notes")
@UseGuards(RolesGuard)
export class TeacherNoteController {
  constructor(private readonly notes: TeacherNoteService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: TeacherNoteListQuery): Promise<TeacherNoteRecord[]> {
    return applyListQuery(await this.notes.list(getRequestContext(), {
      classId: query.classId,
      studentId: query.studentId,
    }), query, teacherNoteListFields);
  }

  @Post()
  @Roles("TEACHER")
  create(@Body(zodBody(teacherNoteCreateBodySchema)) body: TeacherNoteCreateBody): Promise<TeacherNoteRecord> {
    return this.notes.create(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TEACHER")
  update(
    @Param("id") id: string,
    @Body(zodBody(teacherNoteUpdateBodySchema)) body: TeacherNoteUpdateBody,
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

const teacherNoteListFields = [
  { name: "studentId", read: (record: TeacherNoteRecord) => record.studentId },
  { name: "teacherId", read: (record: TeacherNoteRecord) => record.teacherId },
  { name: "courseId", read: (record: TeacherNoteRecord) => record.courseId },
  { name: "termId", read: (record: TeacherNoteRecord) => record.termId },
  { name: "visibility", read: (record: TeacherNoteRecord) => record.visibility },
  { name: "developmentStatus", read: (record: TeacherNoteRecord) => record.developmentStatus },
  { name: "body", read: (record: TeacherNoteRecord) => record.body },
  { name: "createdAt", read: (record: TeacherNoteRecord) => record.createdAt },
];
