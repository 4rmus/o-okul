"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState, LoadingState, MetricCard, MetricGrid } from "@o-okul/ui";
import { useAuth } from "../../providers.js";
import { initialListQuery } from "../../../src/list-controls.js";
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
    <PageFrame title="Sistem Paneli" subtitle="Kurumların kullanım durumunu ve lisanslarını tek yerden izleyin.">
      {tenantsQuery.isPending ? <LoadingState label="Sistem özeti yükleniyor…" /> : null}
      <MetricGrid className="next-system-summary-grid" aria-label="Sistem özeti" role="region">
        <MetricCard
          className="next-system-summary-card"
          description="Platformdaki toplam kurum"
          label="Kurum"
          value={tenantsQuery.data?.meta.total ?? tenants.length}
        />
        <MetricCard
          className="next-system-summary-card"
          description="Kullanıma açık kurum"
          label="Aktif"
          tone="success"
          value={activeCount}
        />
        <MetricCard
          className="next-system-summary-card"
          description="Deneme planındaki kurum"
          label="Deneme"
          tone="warning"
          value={trialCount}
        />
      </MetricGrid>
      {tenantsQuery.isError ? <p className="next-form-error">Sistem özeti alınamadı.</p> : null}
      {!tenantsQuery.isPending && !tenantsQuery.isError && tenants.length === 0 ? (
        <section aria-label="Sistem başlangıcı">
          <EmptyState
            title="Henüz kurum yok"
            description="İlk kurumu oluşturarak kullanıma hazırlamaya başlayın."
            primaryAction={{ label: "Kurum oluştur", href: "/sistem/kurumlar" }}
          />
        </section>
      ) : null}
    </PageFrame>
  );
}
