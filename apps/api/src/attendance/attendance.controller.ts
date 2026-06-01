import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AttendanceRecord, AttendanceSummaryRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { AttendanceService, type AttendanceInput } from "./attendance.service.js";

@Controller("attendance")
@UseGuards(RolesGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @Roles("TEACHER")
  list(@Query("studentId") studentId?: string): Promise<AttendanceRecord[]> {
    const context = getRequestContext();
    return studentId ? this.attendance.listForTenantStudent(context, studentId) : this.attendance.list(context);
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
  update(@Param("id") id: string, @Body() body: Partial<Pick<AttendanceRecord, "status">>): Promise<AttendanceRecord> {
    return this.attendance.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TEACHER")
  async delete(@Param("id") id: string): Promise<void> {
    await this.attendance.delete(getRequestContext(), id);
  }
}
