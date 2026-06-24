import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AcademicTermRecord, AcademicYearRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "./school.service.js";
import {
  academicTermCreateBodySchema,
  academicTermUpdateBodySchema,
  academicYearCreateBodySchema,
  academicYearUpdateBodySchema,
  type AcademicTermCreateBody,
  type AcademicTermUpdateBody,
  type AcademicYearCreateBody,
  type AcademicYearUpdateBody,
} from "./school-validation.js";

@Controller()
@UseGuards(RolesGuard)
export class AcademicCalendarController {
  constructor(private readonly school: SchoolService) {}

  @Get("academic-years")
  @Roles("TEACHER")
  async listYears(@Query() query: ListQuery): Promise<AcademicYearRecord[]> {
    return applyListQuery(await this.school.listAcademicYears(getRequestContext()), query, academicYearListFields);
  }

  @Get("academic-years/:id")
  @Roles("TEACHER")
  findYear(@Param("id") id: string): Promise<AcademicYearRecord> {
    return this.school.findAcademicYear(getRequestContext(), id);
  }

  @Post("academic-years")
  @RequireCapability("academic:manage")
  createYear(@Body(zodBody(academicYearCreateBodySchema)) body: AcademicYearCreateBody): Promise<AcademicYearRecord> {
    return this.school.createAcademicYear(getRequestContext(), body);
  }

  @Patch("academic-years/:id")
  @RequireCapability("academic:manage")
  updateYear(
    @Param("id") id: string,
    @Body(zodBody(academicYearUpdateBodySchema)) body: AcademicYearUpdateBody,
  ): Promise<AcademicYearRecord> {
    return this.school.updateAcademicYear(getRequestContext(), id, body);
  }

  @Delete("academic-years/:id")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  async deleteYear(@Param("id") id: string): Promise<void> {
    await this.school.deleteAcademicYear(getRequestContext(), id);
  }

  @Get("academic-terms")
  @Roles("TEACHER", "STUDENT", "GUARDIAN")
  async listTerms(@Query() query: ListQuery): Promise<AcademicTermRecord[]> {
    return applyListQuery(await this.school.listAcademicTerms(getRequestContext()), query, academicTermListFields);
  }

  @Get("academic-terms/:id")
  @Roles("TEACHER", "STUDENT", "GUARDIAN")
  findTerm(@Param("id") id: string): Promise<AcademicTermRecord> {
    return this.school.findAcademicTerm(getRequestContext(), id);
  }

  @Post("academic-terms")
  @RequireCapability("academic:manage")
  createTerm(@Body(zodBody(academicTermCreateBodySchema)) body: AcademicTermCreateBody): Promise<AcademicTermRecord> {
    return this.school.createAcademicTerm(getRequestContext(), body);
  }

  @Patch("academic-terms/:id")
  @RequireCapability("academic:manage")
  updateTerm(
    @Param("id") id: string,
    @Body(zodBody(academicTermUpdateBodySchema)) body: AcademicTermUpdateBody,
  ): Promise<AcademicTermRecord> {
    return this.school.updateAcademicTerm(getRequestContext(), id, body);
  }

  @Delete("academic-terms/:id")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  async deleteTerm(@Param("id") id: string): Promise<void> {
    await this.school.deleteAcademicTerm(getRequestContext(), id);
  }
}

const academicYearListFields = [
  { name: "name", read: (record: AcademicYearRecord) => record.name },
  { name: "startsAt", read: (record: AcademicYearRecord) => record.startsAt },
  { name: "endsAt", read: (record: AcademicYearRecord) => record.endsAt },
];

const academicTermListFields = [
  { name: "name", read: (record: AcademicTermRecord) => record.name },
  { name: "academicYearId", read: (record: AcademicTermRecord) => record.academicYearId },
  { name: "startsAt", read: (record: AcademicTermRecord) => record.startsAt },
  { name: "endsAt", read: (record: AcademicTermRecord) => record.endsAt },
];
