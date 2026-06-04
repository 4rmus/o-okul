import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { GuardianRecord, GuardianStudentRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { type GuardianStudentRelationInput, SchoolService } from "./school.service.js";

@Controller("guardians")
@UseGuards(RolesGuard)
export class GuardiansController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<GuardianRecord[]> {
    return applyListQuery(await this.school.listGuardians(getRequestContext()), query, guardianListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<GuardianRecord> {
    return this.school.findGuardian(getRequestContext(), id);
  }

  @Get(":id/students")
  @Roles("TEACHER")
  listStudents(@Param("id") id: string): Promise<GuardianStudentRecord[]> {
    return this.school.listGuardianStudents(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("student:manage")
  create(@Body() body: Partial<GuardianRecord>): Promise<GuardianRecord> {
    return this.school.createGuardian(getRequestContext(), body);
  }

  @Patch(":id")
  @RequireCapability("student:manage")
  update(@Param("id") id: string, @Body() body: Partial<GuardianRecord>): Promise<GuardianRecord> {
    return this.school.updateGuardian(getRequestContext(), id, body);
  }

  @Post(":id/purge-pii")
  @RequireCapability("privacy:manage")
  purgePii(@Param("id") id: string): Promise<GuardianRecord> {
    return this.school.purgeGuardianPii(getRequestContext(), id);
  }

  @Post(":id/students")
  @RequireCapability("student:manage")
  linkStudent(
    @Param("id") id: string,
    @Body() body: { studentId?: string } & GuardianStudentRelationInput,
  ): Promise<GuardianStudentRecord> {
    return this.school.linkGuardianStudent(getRequestContext(), id, body.studentId ?? "", body);
  }

  @Patch(":id/students/:studentId")
  @RequireCapability("student:manage")
  updateStudentLink(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @Body() body: GuardianStudentRelationInput,
  ): Promise<GuardianStudentRecord> {
    return this.school.updateGuardianStudent(getRequestContext(), id, studentId, body);
  }

  @Delete(":id/students/:studentId")
  @HttpCode(204)
  @RequireCapability("student:manage")
  async unlinkStudent(@Param("id") id: string, @Param("studentId") studentId: string): Promise<void> {
    await this.school.unlinkGuardianStudent(getRequestContext(), id, studentId);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("student:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.school.deleteGuardian(getRequestContext(), id);
  }
}

const guardianListFields = [
  { name: "firstName", read: (record: GuardianRecord) => record.firstName },
  { name: "lastName", read: (record: GuardianRecord) => record.lastName },
  { name: "phone", read: (record: GuardianRecord) => record.phone },
];
