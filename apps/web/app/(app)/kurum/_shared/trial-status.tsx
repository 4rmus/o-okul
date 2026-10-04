"use client";

import { useQuery } from "@tanstack/react-query";
import type { TenantRecord } from "@o-okul/shared-types";
import { Alert } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";

const dayMs = 24 * 60 * 60 * 1000;

export type TrialStatus = { kind: "active"; daysLeft: number; endsAt: string } | { kind: "ended"; endsAt: string };

/** Trial countdown from the tenant's license mirror; undefined for paid plans. */
export function trialStatus(tenant: Pick<TenantRecord, "plan" | "licenseEndsAt"> | undefined, now = new Date()): TrialStatus | undefined {
  if (tenant?.plan !== "TRIAL" || !tenant.licenseEndsAt) return undefined;
  const remaining = Date.parse(tenant.licenseEndsAt) - now.getTime();
  if (!Number.isFinite(remaining)) return undefined;
  return remaining > 0
    ? { kind: "active", daysLeft: Math.ceil(remaining / dayMs), endsAt: tenant.licenseEndsAt }
    : { kind: "ended", endsAt: tenant.licenseEndsAt };
}

/**
 * Trial banner for institution staff. Shares the shell's tenant query, so it adds no request.
 * An ended trial is read-only, not deleted; the copy says so to avoid a "my data is gone" scare.
 */
export function TrialStatusBanner() {
  const { auth } = useAuth();
  const tenantQuery = useQuery({
    queryKey: ["next-shell-tenant-brand", auth?.session.tenantId ?? "anonymous"],
    queryFn: async () => {
      try {
        return await apiRequest<TenantRecord>(auth?.accessToken ?? "", `${apiBaseUrl}/me/tenant`);
      } catch {
        return undefined;
      }
    },
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const status = trialStatus(tenantQuery.data);
  if (!status) return null;
  const until = new Date(status.endsAt).toLocaleDateString("tr-TR");
  return status.kind === "active" ? (
    <Alert tone="info" title={`Deneme sürümü: ${status.daysLeft} gün kaldı`}>
      Deneme {until} tarihinde biter. Deneme bitince verileriniz silinmez; satın alırsanız aynı kayıtlarla devam edersiniz.
    </Alert>
  ) : (
    <Alert tone="warning" title="Deneme süresi doldu">
      Verileriniz silinmedi ve görüntülenebilir; yeni kayıt girmek için lisansın yenilenmesi gerekir. Devam etmek için O-Okul ile iletişime geçin.
    </Alert>
  );
}
