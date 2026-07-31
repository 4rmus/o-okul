"use client";

import { useQuery } from "@tanstack/react-query";
import type { InstitutionDashboardSummary } from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";

export function useKurumDashboardDataQuery(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-kurum-dashboard-data", tenantId],
    queryFn: () => apiRequest<InstitutionDashboardSummary>(accessToken, `${apiBaseUrl}/me/institution-dashboard`),
    enabled,
    refetchOnWindowFocus: false,
  });
}
