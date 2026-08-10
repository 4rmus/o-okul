import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { StudentOverviewRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { StudentOverviewService } from "./student-overview.service.js";

@Controller("students")
@UseGuards(RolesGuard)
export class StudentOverviewController {
  constructor(private readonly overviews: StudentOverviewService) {}

  @Get(":studentId/overview")
  @RequireCapability("student:read")
  get(@Param("studentId") studentId: string): Promise<StudentOverviewRecord> {
    return this.overviews.get(getRequestContext(), studentId);
  }
}
