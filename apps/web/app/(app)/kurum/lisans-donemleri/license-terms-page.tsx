"use client";

import { useQuery } from "@tanstack/react-query";
import type { LicenseTermListRecord } from "@o-okul/shared-types";
import { CrudPage, EmptyState, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest } from "../../../../src/api-client.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

export function LicenseTermsPage() {
  const { auth } = useAuth();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const termsQuery = useQuery({
    queryKey: ["license-terms", tenantId],
    queryFn: () => apiListRequest<LicenseTermListRecord>(auth?.accessToken ?? "", `${apiBaseUrl}/tenants/current/license-terms`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const terms = termsQuery.data?.data ?? [];
  const current = terms.find((term) => term.state === "ACTIVE" || term.state === "READ_ONLY");
  const columns: Array<DataTableColumn<LicenseTermListRecord>> = [
    { key: "planCode", header: "Plan", priority: "primary", render: (term) => term.planCode, sticky: "left" },
    { key: "startsAt", header: "Başlangıç", priority: "secondary", render: (term) => formatDate(term.startsAt) },
    { key: "endsAt", header: "Bitiş", priority: "secondary", render: (term) => formatDate(term.endsAt) },
    { key: "activeStudentLimit", header: "Aktif öğrenci limiti", priority: "secondary", render: (term) => formatCount(term.activeStudentLimit) },
    {
      key: "state",
      header: "Erişim durumu",
      priority: "primary",
      render: (term) => <StatusBadge tone={stateTone(term.state)}>{stateLabel(term.state)}</StatusBadge>,
    },
    { key: "auditReference", header: "Sözleşme ref.", priority: "optional", render: (term) => term.auditReference ?? "-" },
  ];
  const summaryItems: OperationSummaryItem[] = [
    { key: "total", label: "Dönem toplamı", description: "Yenilemeler dahil geçmiş", value: formatCount(terms.length) },
    {
      key: "current",
      label: "Geçerli plan",
      description: "Aktif veya salt-okunur dönem",
      value: current?.planCode ?? "Yok",
      tone: current ? "success" : "warning",
    },
    {
      key: "limit",
      label: "Aktif öğrenci limiti",
      description: "Geçerli lisans dönemi",
      value: current ? formatCount(current.activeStudentLimit) : "-",
    },
  ];
  const badges: OperationSummaryBadge[] = [{ key: "authority", label: "Canonical LicenseTerm", tone: "info" }];

  return (
    <CrudPage
      aria-label="Lisans dönemleri"
      columns={columns}
      density="compact"
      description="Dönemler eklemeli tutulur; geçmiş lisans kayıtları geriye dönük değiştirilmez."
      emptyState={<EmptyState title="Lisans dönemi yok" description="Kurum için canonical lisans dönemi bulunamadı; sistem yöneticinizle iletişime geçin." />}
      emptyText="Lisans dönemi bulunamadı"
      error={termsQuery.isError ? "Lisans dönemleri alınamadı." : undefined}
      getRowKey={(term) => term.id}
      loading={termsQuery.isPending}
      rows={terms}
      summary={<OperationSummary ariaLabel="Lisans özeti" badges={badges} items={summaryItems} />}
      tableCaption="Kurum lisans dönemleri"
      tableDescription="Plan, tarih aralığı, aktif öğrenci limiti ve erişim durumu."
      title="Lisans Dönemleri"
    />
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function stateLabel(state: LicenseTermListRecord["state"]) {
  if (state === "SCHEDULED") return "Planlandı";
  if (state === "ACTIVE") return "Aktif";
  if (state === "READ_ONLY") return "Salt okunur";
  if (state === "FROZEN") return "Donduruldu";
  if (state === "EXPIRED") return "Sona erdi";
  return "İptal edildi";
}

function stateTone(state: LicenseTermListRecord["state"]): StatusBadgeProps["tone"] {
  if (state === "ACTIVE") return "success";
  if (state === "SCHEDULED" || state === "READ_ONLY") return "warning";
  if (state === "FROZEN" || state === "EXPIRED" || state === "CANCELLED") return "danger";
  return "neutral";
}
