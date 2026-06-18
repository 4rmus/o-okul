"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { CrudPage, EmptyState, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@uzman-hocam/ui";
import type { AuditLogListItemRecord } from "@uzman-hocam/shared-types";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest } from "../../../../src/api-client.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

export function AuditLogsPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: auditLogSortOptions });
  const auditLogsQuery = useQuery({
    queryKey: ["next-audit-logs", auth?.session.tenantId ?? "anonymous", listQuery],
    queryFn: () => loadAuditLogs(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const rows = auditLogsQuery.data?.data ?? [];
  const totalCount = auditLogsQuery.data?.meta?.total ?? rows.length;
  const identityEventCount = rows.filter((record) => record.category === "identity").length;
  const userEventCount = rows.filter((record) => record.category === "user").length;
  const auditSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Kayıt toplamı",
      value: formatCount(totalCount),
    },
    {
      description: "En yeni güvenli olay etiketi",
      key: "latest",
      label: "Son olay",
      value: rows[0]?.actionLabel ?? "Yok",
    },
    {
      description: "Kimlik / kullanıcı kırılımı",
      key: "security",
      label: "Kimlik olayı",
      tone: identityEventCount > 0 ? "info" : "default",
      value: `${formatCount(identityEventCount)} / ${formatCount(userEventCount)}`,
    },
    {
      description: "Ham kanıt alanları panelde gösterilmez",
      key: "safe-display",
      label: "PII güvenliği",
      tone: "success",
      value: "PII maskeli",
    },
  ];
  const auditSummaryBadges: OperationSummaryBadge[] = [
    { key: "source", label: "Server/audit kaynağı", tone: "info" },
    { key: "mode", label: "Salt-okuma", tone: "neutral" },
    { key: "pii", label: "PII ham gösterilmez", tone: "success" },
    { key: "sort", label: `Sıralama: ${formatAuditSort(listQuery.sort)}`, tone: "neutral" },
  ];
  const columns: Array<DataTableColumn<AuditLogListItemRecord>> = [
    {
      key: "action",
      header: "Olay",
      priority: "primary",
      render: (record) => (
        <StatusBadge tone={auditCategoryTone(record.category)} title="Audit aksiyon etiketi">
          {record.actionLabel}
        </StatusBadge>
      ),
      sticky: "left",
    },
    {
      key: "entityType",
      header: "Kayıt türü",
      priority: "secondary",
      render: (record) => record.entityLabel,
    },
    {
      key: "actor",
      header: "Aktör",
      priority: "optional",
      render: (record) => record.actorLabel,
    },
    {
      key: "createdAt",
      header: "Zaman",
      priority: "secondary",
      render: (record) => formatAuditDate(record.createdAt),
    },
  ];

  return (
    <CrudPage
      actions={
        <ListControls
          meta={auditLogsQuery.data?.meta}
          onChange={setListQuery}
          sortOptions={auditLogSortOptions}
          state={listQuery}
        />
      }
      aria-label="Denetim kayıtları"
      columns={columns}
      density="compact"
      description="Kurum işlem izini salt-okunur izle; ham PII ve gizli kanıt değerleri panelde gösterilmez."
      emptyState={
        <EmptyState
          title="Denetim kaydı yok"
          description="Kayıt oluşturan işlem yapıldığında denetim izi burada görünür."
          hint="Bu liste salt okunur tutulur."
        />
      }
      emptyText="Denetim kaydı yok"
      error={auditLogsQuery.isError ? apiErrorMessage(auditLogsQuery.error, "Denetim kayıtları alınamadı.") : undefined}
      getRowKey={(record) => record.id}
      loading={auditLogsQuery.isPending}
      rows={rows}
      summary={<OperationSummary ariaLabel="Denetim operasyon özeti" badges={auditSummaryBadges} items={auditSummaryItems} />}
      tableCaption="Denetim kayıtları"
      tableDescription="Kurum içi işlem izi; aktör, kayıt türü ve zaman bilgisi PII göstermeden listelenir."
      title="Denetim"
    />
  );
}

const auditLogSortOptions = [
  { label: "Aksiyon A-Z", value: "action" },
  { label: "Aksiyon Z-A", value: "-action" },
  { label: "Tarih eski-yeni", value: "createdAt" },
  { label: "Tarih yeni-eski", value: "-createdAt" },
];

async function loadAuditLogs(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<AuditLogListItemRecord>(accessToken, buildListUrl(`${apiBaseUrl}/audit-logs/safe-list`, listQuery));
}

function auditCategoryTone(category: AuditLogListItemRecord["category"]): StatusBadgeProps["tone"] {
  if (category === "identity" || category === "invitation") return "warning";
  if (category === "kvkk" || category === "tenant") return "info";
  if (category === "finance") return "danger";
  if (category === "academic" || category === "report") return "success";
  return "neutral";
}

function formatAuditDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatAuditSort(sort: string) {
  return auditLogSortOptions.find((option) => option.value === sort)?.label ?? "Varsayılan";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}
