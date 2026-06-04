"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState, LoadingState } from "@uzman-hocam/ui";
import { useAuth } from "../../providers.js";
import { initialListQuery } from "../../../src/list-controls.js";
import { MetricPanelGrid } from "../kurum/_shared/metric-panel-grid.js";
import { PageFrame } from "../kurum/_shared/page-frame.js";
import { loadTenants } from "./_shared/system-api.js";

export function SystemDashboard() {
  const { auth } = useAuth();
  const tenantsQuery = useQuery({
    queryKey: ["next-system-dashboard-tenants"],
    queryFn: () => loadTenants(auth?.accessToken ?? "", { ...initialListQuery, limit: 100 }),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const tenants = tenantsQuery.data?.data ?? [];
  const activeCount = tenants.filter((tenant) => tenant.status === "ACTIVE").length;
  const trialCount = tenants.filter((tenant) => tenant.plan === "TRIAL" || tenant.status === "TRIAL").length;

  return (
    <PageFrame title="Sistem Paneli" subtitle="Platform kurumlarını ve sistem yönetimi başlangıcını izle.">
      {tenantsQuery.isPending ? <LoadingState label="Sistem özeti yükleniyor…" /> : null}
      <MetricPanelGrid
        ariaLabel="Sistem özeti"
        metrics={[
          { label: "Kurum", value: tenantsQuery.data?.meta.total ?? tenants.length },
          { label: "Aktif", value: activeCount },
          { label: "Deneme", value: trialCount },
        ]}
      />
      {tenantsQuery.isError ? <p className="next-form-error">Sistem özeti alınamadı.</p> : null}
      {!tenantsQuery.isPending && !tenantsQuery.isError && tenants.length === 0 ? (
        <section aria-label="Sistem başlangıcı">
          <EmptyState
            title="Henüz kurum yok"
            description="İlk kurumunu oluşturarak sıfır-veri kurulum zincirini başlat."
            primaryAction={{ label: "Kurum oluştur", href: "/sistem/kurumlar" }}
          />
        </section>
      ) : null}
    </PageFrame>
  );
}
