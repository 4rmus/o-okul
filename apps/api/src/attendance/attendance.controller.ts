import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AttendanceRecord, AttendanceSummaryRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { AttendanceService, type AttendanceInput } from "./attendance.service.js";

interface AttendanceListQuery extends ListQuery {
  classId?: string;
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
      studentId: query.studentId,
    });
    return applyListQuery(records, query, attendanceListFields);
  }

  @Get("summary")
  @Roles("TEACHER")
  summary(@Query("studentId") studentId: string): Promise<AttendanceSummaryRecord> {
    return this.attendance.summarizeForTenantStudent(getRequestContext(), studentId);
  }

  @Post()
  @Roles("TEACHER")
  create(@Body() body: Partial<AttendanceInput>): Promise<AttendanceRecord> {
    return this.attendance.create(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TEACHER")
  update(@Param("id") id: string, @Body() body: Partial<Pick<AttendanceRecord, "status" | "courseId" | "termId">>): Promise<AttendanceRecord> {
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
