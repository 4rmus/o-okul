import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { InstitutionDashboardSummary } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { resolveCampusRestriction } from "../tenant/tenant-access.js";
import {
  institutionDashboardStoreToken,
  type InstitutionDashboardStore,
} from "./me-institution-dashboard.store.js";

@Injectable()
export class MeInstitutionDashboardService {
  constructor(
    @Inject(institutionDashboardStoreToken) private readonly store: InstitutionDashboardStore,
  ) {}

  async get(context: RequestContext): Promise<InstitutionDashboardSummary> {
    if (!context.tenantId) throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    const restriction = campusRestriction(context);
    const dashboard = await this.store.load(
      context.tenantId,
      istanbulDate(new Date()),
      restriction ? { campusIds: [...restriction] } : undefined,
      // DEC-20261102-04: academic-ops counts only for academic:manage viewers, under the same campus scope.
      { academicOps: hasCapability(context, "academic:manage") },
    );
    return {
      generatedAt: new Date().toISOString(),
      ...dashboard,
      ...(restriction ? { campusScoped: true } : {}),
    };
  }
}

function campusRestriction(context: RequestContext): ReadonlySet<string> | undefined {
  try {
    return resolveCampusRestriction(context);
  } catch {
    throw new ForbiddenException("INSTITUTION_DASHBOARD_CAMPUS_SCOPE_MISSING");
  }
}

function istanbulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
