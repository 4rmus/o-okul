import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { GradeLevelAnalytics } from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { requiredTrimmedString, trimmedString, zodQuery } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { GradeLevelAnalyticsService } from "./grade-level-analytics.service.js";

const gradeLevelAnalyticsQuerySchema = z.object({
  gradeLevelId: requiredTrimmedString.max(128),
  examType: trimmedString.max(32).optional(),
  termId: trimmedString.max(128).optional(),
}).strict();

type GradeLevelAnalyticsQueryInput = z.infer<typeof gradeLevelAnalyticsQuerySchema>;

// DEC-20261102-08 (G3): read-only level analytics; tenant-wide academic:manage staff only (campus scope gets 403).
@Controller("reports")
@UseGuards(RolesGuard)
export class GradeLevelAnalyticsController {
  constructor(private readonly analytics: GradeLevelAnalyticsService) {}

  @Get("grade-level-analytics")
  @RequireCapability("academic:manage")
  getGradeLevelAnalytics(
    @Query(zodQuery(gradeLevelAnalyticsQuerySchema)) query: GradeLevelAnalyticsQueryInput,
  ): Promise<GradeLevelAnalytics> {
    return this.analytics.getGradeLevelAnalytics(getRequestContext(), query);
  }
}
