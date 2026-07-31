import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { InstitutionDashboardSummary } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
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
    const dashboard = await this.store.load(context.tenantId, istanbulDate(new Date()));
    return {
      generatedAt: new Date().toISOString(),
      ...dashboard,
    };
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
