import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import type {
  AcademicCalendarActivateRequest,
  AcademicCalendarActivateResult,
  AcademicTermRecord,
  AcademicYearRecord,
} from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
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

const academicCalendarActivateBodySchema = z.object({
  academicYearId: requiredTrimmedString,
  termId: requiredTrimmedString,
}).strict() satisfies z.ZodType<AcademicCalendarActivateRequest>;

@Controller()
export class AcademicCalendarController {
  constructor(private readonly school: SchoolService) {}

  @Get("academic-years")
  @RequireCapability("academic:read")
  async listYears(@Query() query: ListQuery): Promise<AcademicYearRecord[]> {
    return applyListQuery(await this.school.listAcademicYears(getRequestContext()), query, academicYearListFields);
  }

  @Get("academic-years/:id")
  @RequireCapability("academic:read")
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

  // DEC-20261102-08: last step of the term-transition wizard; one transaction, explicit tenant predicates.
  @Post("academic-calendar/activate")
  @RequireCapability("academic:manage")
  async activate(
    @Body(zodBody(academicCalendarActivateBodySchema)) body: AcademicCalendarActivateRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<AcademicCalendarActivateResult> {
    const result = await this.school.activateAcademicCalendar(getRequestContext(), body, idempotencyKey);
    return {
      academicYear: toAcademicYearResponse(result.academicYear),
      term: toAcademicTermResponse(result.term),
      deactivatedAcademicYearIds: result.deactivatedAcademicYearIds,
      deactivatedTermIds: result.deactivatedTermIds,
    };
  }

  @Get("academic-terms")
  @RequireCapability("academic:read-catalog")
  async listTerms(@Query() query: ListQuery): Promise<AcademicTermRecord[]> {
    return applyListQuery(await this.school.listAcademicTerms(getRequestContext()), query, academicTermListFields);
  }

  @Get("academic-terms/:id")
  @RequireCapability("academic:read-catalog")
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

function toAcademicYearResponse(record: AcademicYearRecord): AcademicYearRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    isActive: record.isActive,
  };
}

function toAcademicTermResponse(record: AcademicTermRecord): AcademicTermRecord {
  return { ...toAcademicYearResponse(record), academicYearId: record.academicYearId };
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
