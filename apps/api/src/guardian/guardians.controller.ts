import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  GuardianRecord,
  GuardianStudentDetailsResponse,
  GuardianStudentRecord,
} from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { GuardianService } from "./guardian.service.js";
import { toGuardianResponse } from "./guardian-response.js";
import {
  guardianCreateBodySchema,
  guardianStudentLinkBodySchema,
  guardianStudentRelationBodySchema,
  guardianUpdateBodySchema,
  type GuardianCreateBody,
  type GuardianStudentLinkBody,
  type GuardianStudentRelationBody,
  type GuardianUpdateBody,
} from "../school/school-validation.js";

@Controller("guardians")
@UseGuards(RolesGuard)
export class GuardiansController {
  constructor(private readonly guardians: GuardianService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<GuardianRecord[]> {
    const context = getRequestContext();
    const fields = hasCapability(context, "privacy:manage") ? guardianListFields : guardianPublicListFields;
    return applyListQuery(await this.guardians.listGuardians(context), query, fields).map((record) => toGuardianResponse(record, context));
  }

  @Get(":id")
  @Roles("TEACHER")
  async findOne(@Param("id") id: string): Promise<GuardianRecord> {
    const context = getRequestContext();
    return toGuardianResponse(await this.guardians.findGuardian(context, id), context);
  }

  @Get(":id/students")
  @Roles("TEACHER")
  listStudents(@Param("id") id: string): Promise<GuardianStudentRecord[]> {
    return this.guardians.listGuardianStudents(getRequestContext(), id);
  }

  @Get(":id/student-details")
  @RequireCapability("student:manage")
  listStudentDetails(@Param("id") id: string): Promise<GuardianStudentDetailsResponse> {
    return this.guardians.listGuardianStudentDetails(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("student:manage")
  async create(
    @Body(zodBody(guardianCreateBodySchema)) body: GuardianCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<GuardianRecord> {
    const context = getRequestContext();
    return toGuardianResponse(await this.guardians.createGuardian(context, body, idempotencyKey), context);
  }

  @Patch(":id")
  @RequireCapability("student:manage")
  async update(@Param("id") id: string, @Body(zodBody(guardianUpdateBodySchema)) body: GuardianUpdateBody): Promise<GuardianRecord> {
    const context = getRequestContext();
    return toGuardianResponse(await this.guardians.updateGuardian(context, id, body), context);
  }

  @Post(":id/purge-pii")
  @RequireCapability("privacy:manage")
  async purgePii(@Param("id") id: string): Promise<GuardianRecord> {
    const context = getRequestContext();
    return toGuardianResponse(await this.guardians.purgeGuardianPii(context, id), context);
  }

  @Post(":id/students")
  @RequireCapability("student:manage")
  linkStudent(
    @Param("id") id: string,
    @Body(zodBody(guardianStudentLinkBodySchema)) body: GuardianStudentLinkBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<GuardianStudentRecord> {
    return this.guardians.linkGuardianStudent(getRequestContext(), id, body.studentId, body, idempotencyKey);
  }

  @Patch(":id/students/:studentId")
  @RequireCapability("student:manage")
  updateStudentLink(
    @Param("id") id: string,
    @Param("studentId") studentId: string,
    @Body(zodBody(guardianStudentRelationBodySchema)) body: GuardianStudentRelationBody,
  ): Promise<GuardianStudentRecord> {
    return this.guardians.updateGuardianStudent(getRequestContext(), id, studentId, body);
  }

  @Delete(":id/students/:studentId")
  @HttpCode(204)
  @RequireCapability("student:manage")
  async unlinkStudent(@Param("id") id: string, @Param("studentId") studentId: string): Promise<void> {
    await this.guardians.unlinkGuardianStudent(getRequestContext(), id, studentId);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("student:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.guardians.deleteGuardian(getRequestContext(), id);
  }
}

const guardianListFields = [
  { name: "firstName", read: (record: GuardianRecord) => record.firstName },
  { name: "lastName", read: (record: GuardianRecord) => record.lastName },
  { name: "phone", read: (record: GuardianRecord) => record.phone },
];
const guardianPublicListFields = guardianListFields.filter((field) => field.name !== "phone");
