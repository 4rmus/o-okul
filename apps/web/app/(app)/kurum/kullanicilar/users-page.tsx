"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CrudPage,
  EmptyState,
  StatusBadge,
  type DataTableColumn,
} from "@o-okul/ui";
import { tenantRoleLabel, type TenantAssignableRoleName } from "@o-okul/shared-types";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest } from "../../../../src/api-client.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

type Role = TenantAssignableRoleName;

interface TenantUserRecord {
  id: string;
  tenantId: string;
  email?: string;
  name: string;
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

export function UsersPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [userListQuery, setUserListQuery] = useUrlListState(searchParams, { namespace: "users", sortOptions: tenantUserSortOptions });
  const usersQueryKey = ["next-tenant-users", tenantId, userListQuery];
  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: () => loadTenantUsers(auth?.accessToken ?? "", userListQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const users = usersQuery.data?.data ?? [];
  const userColumns: Array<DataTableColumn<TenantUserRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      mobilePriority: "primary",
      priority: "primary",
      render: (user) => user.name,
      sticky: "left",
    },
    {
      key: "email",
      header: "E-posta",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (user) => maskEmail(user.email),
    },
    {
      key: "roles",
      header: "Roller",
      mobilePriority: "secondary",
      priority: "primary",
      render: (user) => (
        <div className="next-role-checks" aria-label={`${user.name} rolleri`}>
          {user.roles.map((role) => <StatusBadge key={role} tone="neutral">{tenantRoleLabel(role)}</StatusBadge>)}
        </div>
      ),
    },
  ];
  const userSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş yönetim hesabı",
      key: "users",
      label: "Kullanıcı toplamı",
      value: formatCount(usersQuery.data?.meta?.total ?? users.length),
    },
    {
      description: "Yeni çalışan ve yetki yönetimi",
      key: "managementSurface",
      label: "Yetki yönetimi",
      tone: "success",
      value: "Çalışanlar",
    },
  ];
  const userSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "login",
      label: "Mevcut hesaplar",
      tone: "warning",
    },
    {
      key: "state",
      label: "Yazma kapalı",
      tone: "neutral",
    },
  ];

  return (
    <div className="next-users-page">
      <CrudPage
        actions={
          <>
            <ListControls
              meta={usersQuery.data?.meta}
              onChange={setUserListQuery}
              sortOptions={tenantUserSortOptions}
              state={userListQuery}
            />
            <Link className="uh-button uh-button--primary uh-button--md" href="/kurum/calisanlar">
              Çalışan erişimlerini yönet
            </Link>
          </>
        }
        aria-label="Kullanıcı ve rol yönetimi"
        columns={userColumns}
        density="compact"
        description="Bu liste yalnız mevcut hesapları gösterir. Görev, çalışma alanı ve erişim Çalışanlar ve Yetkiler ekranından yönetilir."
        emptyState={
          <EmptyState
            title="Kullanıcı yok"
            description="Yönetim hesabı bulunmuyor. Yeni hesap için güvenli davet akışını kullan."
          />
        }
        emptyText="Kullanıcı kaydı yok"
        error={usersQuery.isError ? apiErrorMessage(usersQuery.error, "Kullanıcılar alınamadı.") : undefined}
        getRowKey={(user) => user.id}
        hasActiveFilters={Boolean(userListQuery.q.trim())}
        loading={usersQuery.isPending}
        rows={users}
        tableCaption="Kurum kullanıcıları"
        tableDescription="Panel kullanıcıları ve kurum rolleri."
        summary={
          <OperationSummary ariaLabel="Kullanıcı operasyon özeti" badges={userSummaryBadges} items={userSummaryItems} />
        }
        title="Kullanıcılar"
      />
    </div>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function maskEmail(value: string | undefined) {
  if (!value) return "-";
  const [localPart = "", domain = ""] = value.split("@");
  if (!domain) return "E-posta kayıtlı";
  return `${localPart.slice(0, 2) || "••"}••@${domain.replace(/^[^.]*/, "•••")}`;
}

const tenantUserSortOptions = [
  { label: "Ad A-Z", value: "name" },
  { label: "Ad Z-A", value: "-name" },
  { label: "E-posta A-Z", value: "email" },
  { label: "E-posta Z-A", value: "-email" },
];

async function loadTenantUsers(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<TenantUserRecord>(accessToken, buildListUrl(`${apiBaseUrl}/tenant-users`, listQuery));
}
