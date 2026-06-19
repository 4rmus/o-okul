import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  TeacherAssignmentRecord,
  TeacherImportDryRunResult,
  TeacherImportResult,
  TeacherRecord,
} from "@uzman-hocam/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";
import {
  teacherAssignmentCreateBodySchema,
  teacherAssignmentUpdateBodySchema,
  teacherCreateBodySchema,
  teacherUpdateBodySchema,
  type TeacherAssignmentCreateBody,
  type TeacherAssignmentUpdateBody,
  type TeacherCreateBody,
  type TeacherUpdateBody,
} from "./school-validation.js";
import { TeacherImportService } from "./teacher-import.service.js";

const teacherImportBodySchema = z.object({
  fileBase64: requiredTrimmedString,
}).strict();

@Controller("teachers")
@UseGuards(RolesGuard)
export class TeachersController {
  constructor(
    private readonly school: SchoolService,
    private readonly imports: TeacherImportService,
  ) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<TeacherRecord[]> {
    return applyListQuery(await this.school.listTeachers(getRequestContext()), query, teacherListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<TeacherRecord> {
    return this.school.findTeacher(getRequestContext(), id);
  }

  @Get(":id/assignments")
  @Roles("TEACHER")
  assignments(@Param("id") id: string): Promise<TeacherAssignmentRecord[]> {
    return this.school.listTeacherAssignments(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("staff:manage")
  create(@Body(zodBody(teacherCreateBodySchema)) body: TeacherCreateBody): Promise<TeacherRecord> {
    return this.school.createTeacher(getRequestContext(), body);
  }

  @Post("imports/dry-run")
  @RequireCapability("staff:manage")
  dryRunImport(@Body(zodBody(teacherImportBodySchema)) body: { fileBase64: string }): Promise<TeacherImportDryRunResult> {
    return this.imports.dryRun(getRequestContext(), body);
  }

  @Post("imports")
  @RequireCapability("staff:manage")
  import(@Body(zodBody(teacherImportBodySchema)) body: { fileBase64: string }): Promise<TeacherImportResult> {
    return this.imports.import(getRequestContext(), body);
  }

  @Post(":id/assignments")
  @RequireCapability("staff:manage")
  createAssignment(
    @Param("id") id: string,
    @Body(zodBody(teacherAssignmentCreateBodySchema)) body: TeacherAssignmentCreateBody,
  ): Promise<TeacherAssignmentRecord> {
    return this.school.createTeacherAssignment(getRequestContext(), id, body);
  }

  @Patch(":id")
  @RequireCapability("staff:manage")
  update(@Param("id") id: string, @Body(zodBody(teacherUpdateBodySchema)) body: TeacherUpdateBody): Promise<TeacherRecord> {
    return this.school.updateTeacher(getRequestContext(), id, body);
  }

  @Patch(":id/assignments/:assignmentId")
  @RequireCapability("staff:manage")
  updateAssignment(
    @Param("id") id: string,
    @Param("assignmentId") assignmentId: string,
    @Body(zodBody(teacherAssignmentUpdateBodySchema)) body: TeacherAssignmentUpdateBody,
  ): Promise<TeacherAssignmentRecord> {
    return this.school.updateTeacherAssignment(getRequestContext(), id, assignmentId, body);
  }

  @Post(":id/purge-pii")
  @RequireCapability("privacy:manage")
  purgePii(@Param("id") id: string): Promise<TeacherRecord> {
    return this.school.purgeTeacherPii(getRequestContext(), id);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("staff:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteTeacher(getRequestContext(), id);
  }

  @Delete(":id/assignments/:assignmentId")
  @HttpCode(204)
  @RequireCapability("staff:manage")
  async deleteAssignment(@Param("id") id: string, @Param("assignmentId") assignmentId: string): Promise<void> {
    await this.school.deleteTeacherAssignment(getRequestContext(), id, assignmentId);
  }
}

const teacherListFields = [
  { name: "firstName", read: (record: TeacherRecord) => record.firstName },
  { name: "lastName", read: (record: TeacherRecord) => record.lastName },
  { name: "branch", read: (record: TeacherRecord) => record.branch },
];
