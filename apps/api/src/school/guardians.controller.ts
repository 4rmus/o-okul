import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { GuardianRecord, GuardianStudentDetailsResponse, GuardianStudentRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";
import {
  guardianCreateBodySchema,
  guardianStudentLinkBodySchema,
  guardianStudentRelationBodySchema,
  guardianUpdateBodySchema,
  type GuardianCreateBody,
  type GuardianStudentLinkBody,
  type GuardianStudentRelationBody,
  type GuardianUpdateBody,
} from "./school-validation.js";

@Controller("guardians")
@UseGuards(RolesGuard)
export class GuardiansController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<GuardianRecord[]> {
    return applyListQuery(await this.school.listGuardians(getRequestContext()), query, guardianListFields).map(toGuardianResponse);
  }

  @Get(":id")
  @Roles("TEACHER")
  async findOne(@Param("id") id: string): Promise<GuardianRecord> {
    return toGuardianResponse(await this.school.findGuardian(getRequestContext(), id));
  }

  @Get(":id/students")
  @Roles("TEACHER")
  listStudents(@Param("id") id: string): Promise<GuardianStudentRecord[]> {
    return this.school.listGuardianStudents(getRequestContext(), id);
  }

  @Get(":id/student-details")
  @RequireCapability("student:manage")
  listStudentDetails(@Param("id") id: string): Promise<GuardianStudentDetailsResponse> {
    return this.school.listGuardianStudentDetails(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("student:manage")
  async create(@Body(zodBody(guardianCreateBodySchema)) body: GuardianCreateBody): Promise<GuardianRecord> {
    return toGuardianResponse(await this.school.createGuardian(getRequestContext(), body));
  }

  @Patch(":id")
  @RequireCapability("student:manage")
  async update(@Param("id") id: string, @Body(zodBody(guardianUpdateBodySchema)) body: GuardianUpdateBody): Promise<GuardianRecord> {
    return toGuardianResponse(await this.school.updateGuardian(getRequestContext(), id, body));
  }

  @Post(":id/purge-pii")
  @RequireCapability("privacy:manage")
  async purgePii(@Param("id") id: string): Promise<GuardianRecord> {
    return toGuardianResponse(await this.school.purgeGuardianPii(getRequestContext(), id));
  }

  @Post(":id/students")
  @RequireCapability("student:manage")
  linkStudent(
    @Param("id") id: string,
    @Body(zodBody(guardianStudentLinkBodySchema)) body: GuardianStudentLinkBody,
  ): Promise<GuardianStudentRecord> {
    return this.school.linkGuardianStudent(getRequestContext(), id, body.studentId, body);
  }

  @Patch(":id/students/:studentId")
  @RequireCapability("student:manage")
  updateStudentLink(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @Body(zodBody(guardianStudentRelationBodySchema)) body: GuardianStudentRelationBody,
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

function toGuardianResponse(record: GuardianRecord): GuardianRecord {
  const response = { ...record } as GuardianRecord & { nationalIdEncrypted?: string; nationalIdHash?: string };
  delete response.nationalIdEncrypted;
  delete response.nationalIdHash;
  return response;
}
