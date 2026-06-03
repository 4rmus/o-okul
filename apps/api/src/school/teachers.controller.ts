import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { TeacherAssignmentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";

@Controller("teachers")
@UseGuards(RolesGuard)
export class TeachersController {
  constructor(private readonly school: SchoolService) {}

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
  create(@Body() body: Partial<TeacherRecord>): Promise<TeacherRecord> {
    return this.school.createTeacher(getRequestContext(), body);
  }

  @Post(":id/assignments")
  @RequireCapability("staff:manage")
  createAssignment(@Param("id") id: string, @Body() body: Partial<TeacherAssignmentRecord>): Promise<TeacherAssignmentRecord> {
    return this.school.createTeacherAssignment(getRequestContext(), id, body);
  }

  @Patch(":id")
  @RequireCapability("staff:manage")
  update(@Param("id") id: string, @Body() body: Partial<TeacherRecord>): Promise<TeacherRecord> {
    return this.school.updateTeacher(getRequestContext(), id, body);
  }

  @Patch(":id/assignments/:assignmentId")
  @RequireCapability("staff:manage")
  updateAssignment(
    @Param("id") id: string,
    @Param("assignmentId") assignmentId: string,
    @Body() body: Partial<TeacherAssignmentRecord>,
  ): Promise<TeacherAssignmentRecord> {
    return this.school.updateTeacherAssignment(getRequestContext(), id, assignmentId, body);
  }

  @Post(":id/purge-pii")
  @Roles("TENANT_ADMIN")
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
