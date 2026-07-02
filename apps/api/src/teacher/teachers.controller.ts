import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  TeacherAssignmentRecord,
  TeacherImportDryRunResult,
  TeacherImportResult,
  TeacherRecord,
} from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  teacherAssignmentCreateBodySchema,
  teacherAssignmentUpdateBodySchema,
  teacherCreateBodySchema,
  teacherImportBodySchema,
  teacherUpdateBodySchema,
  type TeacherAssignmentCreateBody,
  type TeacherAssignmentUpdateBody,
  type TeacherCreateBody,
  type TeacherImportBody,
  type TeacherUpdateBody,
} from "../school/school-validation.js";
import { TeacherImportService } from "./teacher-import.service.js";
import { TeacherService } from "./teacher.service.js";

@Controller("teachers")
@UseGuards(RolesGuard)
export class TeachersController {
  constructor(
    private readonly teachers: TeacherService,
    private readonly imports: TeacherImportService,
  ) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<TeacherRecord[]> {
    return applyListQuery(await this.teachers.listTeachers(getRequestContext()), query, teacherListFields).map(toTeacherResponse);
  }

  @Get(":id")
  @Roles("TEACHER")
  async findOne(@Param("id") id: string): Promise<TeacherRecord> {
    return toTeacherResponse(await this.teachers.findTeacher(getRequestContext(), id));
  }

  @Get(":id/assignments")
  @Roles("TEACHER")
  assignments(@Param("id") id: string): Promise<TeacherAssignmentRecord[]> {
    return this.teachers.listTeacherAssignments(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("staff:manage")
  async create(
    @Body(zodBody(teacherCreateBodySchema)) body: TeacherCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<TeacherRecord> {
    return toTeacherResponse(await this.teachers.createTeacher(getRequestContext(), body, idempotencyKey));
  }

  @Post("imports/dry-run")
  @RequireCapability("staff:manage")
  dryRunImport(@Body(zodBody(teacherImportBodySchema)) body: TeacherImportBody): Promise<TeacherImportDryRunResult> {
    return this.imports.dryRun(getRequestContext(), body);
  }

  @Post("imports")
  @RequireCapability("staff:manage")
  async import(
    @Body(zodBody(teacherImportBodySchema)) body: TeacherImportBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<TeacherImportResult> {
    const result = await this.imports.import(getRequestContext(), body, idempotencyKey);
    return {
      ...result,
      teachers: result.teachers.map(toTeacherResponse),
    };
  }

  @Post(":id/assignments")
  @RequireCapability("staff:manage")
  createAssignment(
    @Param("id") id: string,
    @Body(zodBody(teacherAssignmentCreateBodySchema)) body: TeacherAssignmentCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<TeacherAssignmentRecord> {
    return this.teachers.createTeacherAssignment(getRequestContext(), id, body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("staff:manage")
  async update(@Param("id") id: string, @Body(zodBody(teacherUpdateBodySchema)) body: TeacherUpdateBody): Promise<TeacherRecord> {
    return toTeacherResponse(await this.teachers.updateTeacher(getRequestContext(), id, body));
  }

  @Patch(":id/assignments/:assignmentId")
  @RequireCapability("staff:manage")
  updateAssignment(
    @Param("id") id: string,
    @Param("assignmentId") assignmentId: string,
    @Body(zodBody(teacherAssignmentUpdateBodySchema)) body: TeacherAssignmentUpdateBody,
  ): Promise<TeacherAssignmentRecord> {
    return this.teachers.updateTeacherAssignment(getRequestContext(), id, assignmentId, body);
  }

  @Post(":id/purge-pii")
  @RequireCapability("privacy:manage")
  async purgePii(@Param("id") id: string): Promise<TeacherRecord> {
    return toTeacherResponse(await this.teachers.purgeTeacherPii(getRequestContext(), id));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("staff:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.teachers.deleteTeacher(getRequestContext(), id);
  }

  @Delete(":id/assignments/:assignmentId")
  @HttpCode(204)
  @RequireCapability("staff:manage")
  async deleteAssignment(@Param("id") id: string, @Param("assignmentId") assignmentId: string): Promise<void> {
    await this.teachers.deleteTeacherAssignment(getRequestContext(), id, assignmentId);
  }
}

const teacherListFields = [
  { name: "firstName", read: (record: TeacherRecord) => record.firstName },
  { name: "lastName", read: (record: TeacherRecord) => record.lastName },
  { name: "branch", read: (record: TeacherRecord) => record.branch },
];

function toTeacherResponse(record: TeacherRecord): TeacherRecord {
  const response = { ...record } as TeacherRecord & { nationalIdEncrypted?: string; nationalIdHash?: string };
  delete response.nationalIdEncrypted;
  delete response.nationalIdHash;
  delete response.userId;
  return response;
}
