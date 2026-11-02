import { Controller, Get, Param } from "@nestjs/common";
import type { ClassOverview } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { ClassOverviewService } from "./class-overview.service.js";

// DEC-20261102-04: read-only Class 360 counts for academic:manage roles (TENANT_OWNER, TENANT_ADMIN, ASSISTANT_ADMIN,
// OPERATIONS_STAFF); the service enforces tenant and campus scope.
@Controller("classes")
export class ClassOverviewController {
  constructor(private readonly overviews: ClassOverviewService) {}

  @Get(":classId/overview")
  @RequireCapability("academic:manage")
  get(@Param("classId") classId: string): Promise<ClassOverview> {
    return this.overviews.get(getRequestContext(), classId);
  }
}
