"use client";

import { useQuery } from "@tanstack/react-query";
import type { AnnouncementRecord, InstitutionDashboardSummary } from "@o-okul/shared-types";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../src/api-client.js";

export function useKurumDashboardDataQuery(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-kurum-dashboard-data", tenantId],
    queryFn: () => apiRequest<InstitutionDashboardSummary>(accessToken, `${apiBaseUrl}/me/institution-dashboard`),
    enabled,
    refetchOnWindowFocus: false,
  });
}

export function useKurumAnnouncementsQuery(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-kurum-dashboard-announcements", tenantId],
    queryFn: () => apiListRequest<AnnouncementRecord>(
      accessToken,
      `${apiBaseUrl}/announcements?page=1&limit=3&sort=-publishedAt`,
    ),
    enabled,
    refetchOnWindowFocus: false,
  });
}
