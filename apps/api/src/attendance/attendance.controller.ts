import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import type {
  AttendanceAggregateRecord,
  AttendanceDailyRosterResponse,
  AttendanceDailyUpsertResponse,
  AttendanceRecord,
  AttendanceSummaryRecord,
} from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { AttendanceService } from "./attendance.service.js";
import {
  type AttendanceCreateBody,
  type AttendanceDailyUpsertBody,
  type AttendanceUpdateBody,
  attendanceCreateBodySchema,
  attendanceDailyUpsertBodySchema,
  attendanceUpdateBodySchema,
} from "./attendance-validation.js";

interface AttendanceListQuery extends ListQuery {
  classId?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  studentId?: string;
}

@Controller("attendance")
@UseGuards(RolesGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: AttendanceListQuery): Promise<AttendanceRecord[]> {
    const records = await this.attendance.list(getRequestContext(), {
      classId: query.classId,
      date: query.date,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      studentId: query.studentId,
    });
    return applyListQuery(records, query, attendanceListFields);
  }

  @Get("aggregate")
  @Roles("TEACHER")
  aggregate(@Query() query: AttendanceListQuery): Promise<AttendanceAggregateRecord> {
    return this.attendance.aggregate(getRequestContext(), {
      classId: query.classId,
      date: query.date,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      studentId: query.studentId,
    });
  }

  @Get("summary")
  @Roles("TEACHER")
  summary(@Query("studentId") studentId: string): Promise<AttendanceSummaryRecord> {
    return this.attendance.summarizeForTenantStudent(getRequestContext(), studentId);
  }

  @Get("daily")
  @Roles("TEACHER")
  daily(
    @Query("classId") classId: string,
    @Query("date") date: string,
  ): Promise<AttendanceDailyRosterResponse> {
    return this.attendance.getDailyRoster(getRequestContext(), classId, date);
  }

  @Post()
  @Roles("TEACHER")
  create(@Body(zodBody(attendanceCreateBodySchema)) body: AttendanceCreateBody): Promise<AttendanceRecord> {
    return this.attendance.create(getRequestContext(), body);
  }

  @Put("daily")
  @RequireCapability("attendance:write-assigned")
  upsertDaily(
    @Body(zodBody(attendanceDailyUpsertBodySchema)) body: AttendanceDailyUpsertBody,
  ): Promise<AttendanceDailyUpsertResponse> {
    return this.attendance.upsertDaily(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TEACHER")
  update(
    @Param("id") id: string,
    @Body(zodBody(attendanceUpdateBodySchema)) body: AttendanceUpdateBody,
  ): Promise<AttendanceRecord> {
    return this.attendance.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TEACHER")
  async delete(@Param("id") id: string): Promise<void> {
    await this.attendance.delete(getRequestContext(), id);
  }
}

const attendanceListFields = [
  { name: "studentId", read: (record: AttendanceRecord) => record.studentId },
  { name: "courseId", read: (record: AttendanceRecord) => record.courseId },
  { name: "termId", read: (record: AttendanceRecord) => record.termId },
  { name: "date", read: (record: AttendanceRecord) => record.date },
  { name: "status", read: (record: AttendanceRecord) => record.status },
];
