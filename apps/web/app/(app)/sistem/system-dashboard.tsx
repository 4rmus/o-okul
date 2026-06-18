"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState, LoadingState, MetricCard } from "@uzman-hocam/ui";
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
    <PageFrame title="Sistem Paneli" subtitle="Platform kurumlarını ve sistem yönetimi başlangıcını izle.">
      {tenantsQuery.isPending ? <LoadingState label="Sistem özeti yükleniyor…" /> : null}
      <section className="next-system-summary-grid" aria-label="Sistem özeti">
        <MetricCard
          className="next-system-summary-card"
          description="Platformdaki toplam kurum"
          label="Kurum"
          value={tenantsQuery.data?.meta.total ?? tenants.length}
        />
        <MetricCard
          className="next-system-summary-card"
          description="Operasyon erişimi açık"
          label="Aktif"
          tone="success"
          value={activeCount}
        />
        <MetricCard
          className="next-system-summary-card"
          description="Pilot veya deneme kapsamı"
          label="Deneme"
          tone="warning"
          value={trialCount}
        />
      </section>
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
