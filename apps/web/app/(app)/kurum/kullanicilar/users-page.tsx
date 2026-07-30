"use client";

import { type FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  Input,
  StatusBadge,
  type DataTableColumn,
} from "@o-okul/ui";
import {
  tenantRoleLabel,
  type TenantAssignableRoleName,
  type TenantUserPasswordResetResponse,
} from "@o-okul/shared-types";
import { KeyRound, Plus, RotateCcw, Save } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import {
  firstFormError,
  tenantUserFormSchema,
  userRolesSchema,
  type TenantUserFormPayload,
  type TenantUserFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { formatTurkishPhoneInput } from "../../../../src/phone-format.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

type Role = TenantAssignableRoleName;
type ManagementRole = Extract<Role, "TENANT_ADMIN" | "ASSISTANT_ADMIN">;

interface TenantUserRecord {
  id: string;
  tenantId: string;
  email?: string;
  name: string;
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

const managementRoleOptions = ["TENANT_ADMIN", "ASSISTANT_ADMIN"] as const satisfies readonly ManagementRole[];
const roleOptions = managementRoleOptions.map((role) => ({ value: role, label: tenantRoleLabel(role) }));

const roleDescriptions: Record<Role, string> = {
  TENANT_ADMIN: "Tüm kurum operasyonları",
  ASSISTANT_ADMIN: "Akademik ve destek işlemleri",
  TEACHER: "Atanmış sınıf ve dersler",
  STUDENT: "Öğrenci portalı",
  GUARDIAN: "Veli portalı",
};

const emptyUserForm: TenantUserFormState = {
  email: "",
  name: "",
  nationalId: "",
  phone: "",
  roles: ["ASSISTANT_ADMIN"],
};

export function UsersPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [userListQuery, setUserListQuery] = useUrlListState(searchParams, { namespace: "users", sortOptions: tenantUserSortOptions });
  const usersQueryKey = ["next-tenant-users", tenantId, userListQuery];
  const usersListQueryKey = ["next-tenant-users", tenantId];
  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: () => loadTenantUsers(auth?.accessToken ?? "", userListQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [roleDrafts, setRoleDrafts] = useState<Record<string, ManagementRole[]>>({});
  const [isUserFormOpen, setIsUserFormOpen] = useState(false);
  const [userForm, setUserForm] = useState<TenantUserFormState>(emptyUserForm);
  const [resettingUserId, setResettingUserId] = useState("");
  const [error, setError] = useState("");

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
        <div
          className={hasRoleDraftChanges(user) ? "next-role-checks next-role-checks--dirty" : "next-role-checks"}
          aria-label={`${user.name} rolleri`}
          aria-describedby={hasRoleDraftChanges(user) ? `role-draft-status-${user.id}` : undefined}
        >
          <RoleCheckboxGrid
            density="compact"
            selectedRoles={getDraftRoles(user)}
            onToggle={(role) => toggleRole(user.id, role)}
          />
          {hasRoleDraftChanges(user) ? (
            <span className="next-role-draft-status" id={`role-draft-status-${user.id}`}>
              <StatusBadge tone="warning">Kaydedilmemiş rol değişikliği</StatusBadge>
              <Button size="icon" variant="ghost" type="button" onClick={() => resetRoleDraft(user.id)} aria-label={`${user.name} rol taslağını sıfırla`}>
                <RotateCcw size={15} aria-hidden="true" />
              </Button>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobileLabel: "Kaydet",
      mobilePriority: "primary",
      priority: "primary",
      render: (user) => (
        <span className="next-row-actions">
          <Button size="icon" variant="ghost"
            type="button"
            disabled={!hasRoleDraftChanges(user)}
            onClick={() => void saveRoles(user)}
            aria-label={`${user.name} rollerini kaydet`}
          >
            <Save size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost"
            type="button"
            disabled={resettingUserId === user.id}
            onClick={() => void resetUserPassword(user)}
            aria-label={`${user.name} şifresini telefona sıfırla`}
            title="Şifreyi telefona sıfırla"
          >
            <KeyRound size={17} aria-hidden="true" />
          </Button>
        </span>
      ),
      sticky: "right",
    },
  ];

  function getDraftRoles(user: TenantUserRecord) {
    return roleDrafts[user.id] ?? managementRoles(user.roles);
  }

  function hasRoleDraftChanges(user: TenantUserRecord) {
    return normalizeRoles(getDraftRoles(user)).join("|") !== normalizeRoles(managementRoles(user.roles)).join("|");
  }

  function toggleRole(userId: string, role: ManagementRole) {
    setRoleDrafts((current) => {
      const user = users.find((candidate) => candidate.id === userId);
      const roles = current[userId] ?? managementRoles(user?.roles ?? []);
      const nextRoles = roles.includes(role) ? roles.filter((candidate) => candidate !== role) : [...roles, role];
      return { ...current, [userId]: nextRoles };
    });
  }

  function resetRoleDraft(userId: string) {
    setRoleDrafts((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
  }

  function openUserForm() {
    setUserForm(emptyUserForm);
    setError("");
    setIsUserFormOpen(true);
  }

  async function saveRoles(user: TenantUserRecord) {
    if (!auth) return;

    setError("");
    const parsedRoles = userRolesSchema.safeParse(getDraftRoles(user));
    if (!parsedRoles.success) {
      setError(firstFormError(parsedRoles.error));
      return;
    }
    try {
      await setTenantUserRoles(auth.accessToken, user.id, parsedRoles.data);
      void queryClient.invalidateQueries({ queryKey: usersListQueryKey });
      setRoleDrafts((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
    } catch (rolesError) {
      setError(apiErrorMessage(rolesError, "Roller kaydedilemedi."));
    }
  }

  async function resetUserPassword(user: TenantUserRecord) {
    if (!auth) return;
    const confirmed = window.confirm(`${user.name} için şifre telefon numarasına sıfırlanacak ve aktif oturumları kapatılacak. Devam edilsin mi?`);
    if (!confirmed) return;

    setError("");
    setResettingUserId(user.id);
    try {
      await resetTenantUserPassword(auth.accessToken, user.id);
      void queryClient.invalidateQueries({ queryKey: usersListQueryKey });
    } catch (resetError) {
      setError(apiErrorMessage(resetError, "Şifre sıfırlanamadı."));
    } finally {
      setResettingUserId("");
    }
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = tenantUserFormSchema.safeParse(userForm);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      await createTenantUser(auth.accessToken, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: usersListQueryKey });
      setIsUserFormOpen(false);
      setUserForm(emptyUserForm);
    } catch (userError) {
      setError(apiErrorMessage(userError, "Kullanıcı oluşturulamadı."));
    }
  }

  const draftRoleCount = users.filter((user) => hasRoleDraftChanges(user)).length;
  const userSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş yönetim hesabı",
      key: "users",
      label: "Kullanıcı toplamı",
      value: formatCount(usersQuery.data?.meta?.total ?? users.length),
    },
    {
      description: "Henüz kaydedilmemiş rol satırı",
      key: "roleDrafts",
      label: "Rol taslağı",
      tone: draftRoleCount > 0 ? "warning" : "default",
      value: formatCount(draftRoleCount),
    },
  ];
  const userSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "login",
      label: "TC + telefon girişi",
      tone: "info",
    },
    {
      key: "state",
      label: "URL state ayrışık",
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
            <div className="next-users-actions">
              <Button onClick={openUserForm} variant="secondary">
                <Plus size={17} aria-hidden="true" />
                Kullanıcı ekle
              </Button>
            </div>
          </>
        }
        aria-label="Kullanıcı ve rol yönetimi"
        columns={userColumns}
        density="compact"
        description="Yönetim hesaplarını ve tenant rollerini yönet."
        emptyState={
          <EmptyState
            title="Kullanıcı yok"
            description="Kurum yönetim paneli için ilk yönetim hesabını oluştur."
            primaryAction={{ label: "Kullanıcı ekle", onClick: openUserForm }}
          />
        }
        emptyText="Kullanıcı kaydı yok"
        error={error || (usersQuery.isError ? apiErrorMessage(usersQuery.error, "Kullanıcılar alınamadı.") : undefined)}
        getRowKey={(user) => user.id}
        loading={usersQuery.isPending}
        rows={users}
        tableCaption="Kurum kullanıcıları"
        tableDescription="Panel kullanıcıları ve tenant rolleri."
        summary={
          <OperationSummary ariaLabel="Kullanıcı operasyon özeti" badges={userSummaryBadges} items={userSummaryItems} />
        }
        title="Kullanıcılar"
      />
      <FormModal
        description="E-posta, TC kimlik no, telefon ve en az bir rol zorunludur."
        onCancel={() => setIsUserFormOpen(false)}
        onSubmit={(event) => void handleUserSubmit(event)}
        open={isUserFormOpen}
        submitLabel="Ekle"
        title="Kullanıcı ekle"
      >
        <Field label="E-posta">
          <Input
            required
            type="email"
            value={userForm.email}
            onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
          />
        </Field>
        <Field label="Ad Soyad">
          <Input
            required
            value={userForm.name}
            onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="TC kimlik no">
          <Input
            inputMode="numeric"
            maxLength={11}
            required
            value={userForm.nationalId}
            onChange={(event) => setUserForm((current) => ({ ...current, nationalId: event.target.value }))}
          />
        </Field>
        <Field label="Telefon">
          <Input
            inputMode="tel"
            placeholder="+90 5xx xxx xx xx"
            required
            value={userForm.phone}
            onChange={(event) => setUserForm((current) => ({ ...current, phone: formatTurkishPhoneInput(event.target.value) }))}
          />
        </Field>
        <fieldset className="next-role-fieldset">
          <legend>Roller</legend>
          <p className="next-role-fieldset__hint">Kullanıcının kurum yönetim kapsamını seç.</p>
          <RoleCheckboxGrid
            selectedRoles={userForm.roles}
            onToggle={(role) =>
              setUserForm((current) => ({
                ...current,
                roles: toggleRoleSelection(current.roles, role),
              }))
            }
          />
        </fieldset>
      </FormModal>
    </div>
  );
}

function RoleCheckboxGrid({
  density = "regular",
  selectedRoles,
  onToggle,
}: {
  density?: "compact" | "regular";
  selectedRoles: ManagementRole[];
  onToggle: (role: ManagementRole) => void;
}) {
  return (
    <div className={density === "compact" ? "next-role-grid next-role-grid--compact" : "next-role-grid"}>
      {roleOptions.map((role) => (
        <Checkbox
          checked={selectedRoles.includes(role.value)}
          description={roleDescriptions[role.value]}
          key={role.value}
          label={role.label}
          onChange={() => onToggle(role.value)}
        />
      ))}
    </div>
  );
}

function normalizeRoles(roles: Role[]) {
  return [...roles].sort();
}

function managementRoles(roles: Role[]) {
  return roles.filter((role): role is ManagementRole => role === "TENANT_ADMIN" || role === "ASSISTANT_ADMIN");
}

function toggleRoleSelection(roles: ManagementRole[], role: ManagementRole) {
  return roles.includes(role) ? roles.filter((candidate) => candidate !== role) : [...roles, role];
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

async function createTenantUser(accessToken: string, input: TenantUserFormPayload) {
  return apiRequest<TenantUserRecord>(accessToken, `${apiBaseUrl}/tenant-users`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function setTenantUserRoles(accessToken: string, userId: string, roles: Role[]) {
  return apiRequest<TenantUserRecord>(accessToken, `${apiBaseUrl}/tenant-users/${encodeURIComponent(userId)}/roles`, {
    body: JSON.stringify({ roles }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function resetTenantUserPassword(accessToken: string, userId: string) {
  return apiRequest<TenantUserPasswordResetResponse>(
    accessToken,
    `${apiBaseUrl}/tenant-users/${encodeURIComponent(userId)}/reset-password`,
    { method: "POST" },
  );
}
