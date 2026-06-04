"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CrudPage, EmptyState, type DataTableColumn } from "@uzman-hocam/ui";
import type { AuditLogRecord } from "@uzman-hocam/shared-types";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest } from "../../../../src/api-client.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

export function AuditLogsPage() {
  const { auth } = useAuth();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const auditLogsQuery = useQuery({
    queryKey: ["next-audit-logs", auth?.session.tenantId ?? "anonymous", listQuery],
    queryFn: () => loadAuditLogs(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const rows = auditLogsQuery.data?.data ?? [];
  const columns: Array<DataTableColumn<AuditLogRecord>> = [
    {
      key: "action",
      header: "Aksiyon",
      render: (record) => record.action,
    },
    {
      key: "entityType",
      header: "Kayıt",
      render: (record) => record.entityType,
    },
    {
      key: "actor",
      header: "Kullanıcı",
      render: (record) => record.actorUserId ?? "-",
    },
    {
      key: "createdAt",
      header: "Tarih",
      render: (record) => new Date(record.createdAt).toLocaleDateString("tr-TR"),
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
      description="Kurum içindeki önemli işlem kayıtlarını salt okunur olarak izle."
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
  return apiListRequest<AuditLogRecord>(accessToken, buildListUrl(`${apiBaseUrl}/audit-logs`, listQuery));
}
