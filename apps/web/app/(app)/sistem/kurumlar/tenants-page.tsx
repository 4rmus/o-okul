"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  Input,
  Select,
  StatusBadge,
  type DataTableColumn,
  type StatusBadgeProps,
  useConfirmDialog,
} from "@uzman-hocam/ui";
import { Plus } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { ApiRequestError } from "../../../../src/api-client.js";
import {
  firstFormError,
  tenantCreateFormSchema,
  type TenantCreateFormState,
  type TenantFormState,
} from "../../../../src/form-validation.js";
import { ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../../kurum/_shared/operation-summary.js";
import { PageFrame } from "../../kurum/_shared/page-frame.js";
import { createTenant, deleteTenant, loadTenants, type TenantRecord } from "../_shared/system-api.js";

const emptyForm: TenantFormState = {
  name: "",
  slug: "",
  plan: "TRIAL",
  licenseStartsAt: "",
  licenseEndsAt: "",
  seatLimit: "",
  status: "ACTIVE",
};

const emptyCreateForm: TenantCreateFormState = {
  ...emptyForm,
  firstAdmin: {
    name: "",
    email: "",
    mode: "password",
    password: "",
  },
};

export function TenantsPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: tenantSortOptions });
  const queryKey = ["next-tenants", listQuery];
  const listQueryKey = ["next-tenants"];
  const tenantsQuery = useQuery({
    queryKey,
    queryFn: () => loadTenants(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [form, setForm] = useState<TenantCreateFormState>(emptyCreateForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<{ email: string; tenantId: string; token: string } | null>(null);
  const [isIssuedTokenRevealed, setIsIssuedTokenRevealed] = useState(false);
  const [deletingTenantId, setDeletingTenantId] = useState("");
  const [error, setError] = useState("");
  const rows = tenantsQuery.data?.data ?? [];
  const activeTenantCount = rows.filter((tenant) => tenant.status === "ACTIVE").length;
  const trialTenantCount = rows.filter((tenant) => tenant.status === "TRIAL").length;
  const suspendedTenantCount = rows.filter((tenant) => tenant.status === "SUSPENDED").length;
  const expiringTenantCount = rows.filter((tenant) => licenseDaysRemaining(tenant.licenseEndsAt) <= 30).length;
  const overSeatLimitCount = rows.filter((tenant) => isSeatLimitExceeded(tenant)).length;
  const tenantSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş platform kurumu",
      key: "total",
      label: "Kurum toplamı",
      value: formatCount(tenantsQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Aktif / deneme / askıda",
      key: "status",
      label: "Durum dağılımı",
      tone: suspendedTenantCount > 0 ? "warning" : "success",
      value: `${formatCount(activeTenantCount)} / ${formatCount(trialTenantCount)} / ${formatCount(suspendedTenantCount)}`,
    },
    {
      description: "30 gün içinde biten lisans",
      key: "license",
      label: "Lisans riski",
      tone: expiringTenantCount > 0 ? "warning" : "success",
      value: formatCount(expiringTenantCount),
    },
    {
      description: "Koltuk limiti aşımı",
      key: "seats",
      label: "Koltuk riski",
      tone: overSeatLimitCount > 0 ? "danger" : "success",
      value: formatCount(overSeatLimitCount),
    },
  ];
  const tenantSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "scope",
      label: "SYSTEM_ADMIN kapsamı",
      tone: "info",
    },
    {
      key: "token",
      label: issuedToken ? (isIssuedTokenRevealed ? "Token açık" : "Token maskeli") : "Token beklemede yok",
      tone: issuedToken ? (isIssuedTokenRevealed ? "warning" : "neutral") : "neutral",
    },
    {
      key: "sort",
      label: `Sıralama: ${formatTenantSort(listQuery.sort)}`,
      tone: "neutral",
    },
  ];

  const columns: Array<DataTableColumn<TenantRecord>> = [
    { key: "name", header: "Kurum", priority: "primary", render: (tenant) => tenant.name, sticky: "left" },
    { key: "slug", header: "Slug", priority: "secondary", render: (tenant) => tenant.slug },
    {
      key: "plan",
      header: "Plan",
      priority: "secondary",
      render: (tenant) => <StatusBadge tone={planTone(tenant.plan)}>{planLabel(tenant.plan)}</StatusBadge>,
    },
    { key: "licenseEndsAt", header: "Lisans bitişi", priority: "optional", render: (tenant) => formatDate(tenant.licenseEndsAt) },
    { key: "seatLimit", header: "Koltuk", priority: "secondary", render: (tenant) => formatSeatUsage(tenant) },
    {
      key: "status",
      header: "Durum",
      priority: "secondary",
      render: (tenant) => <StatusBadge tone={statusTone(tenant.status)}>{statusLabel(tenant.status)}</StatusBadge>,
    },
    {
      key: "actions",
      header: "İşlem",
      priority: "primary",
      render: (tenant) => (
        <div className="next-row-actions">
          <Link href={`/sistem/kurumlar/${encodeURIComponent(tenant.id)}`} aria-label={`${tenant.name} detay`}>
            Detay
          </Link>
          <button type="button" disabled={deletingTenantId === tenant.id} onClick={() => void handleDeleteTenant(tenant)} aria-label={`${tenant.name} sil`}>
            Sil
          </button>
        </div>
      ),
      sticky: "right",
    },
  ];

  function openCreateForm() {
    setForm(emptyCreateForm);
    setIssuedToken(null);
    setIsIssuedTokenRevealed(false);
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setForm(emptyCreateForm);
  }

  function updateName(value: string) {
    setForm((current) => ({
      ...current,
      name: value,
      slug: current.slug || slugify(value),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = tenantCreateFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const created = await createTenant(auth.accessToken, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
      setIssuedToken(
        created.admin.activationToken
          ? { email: created.admin.email, tenantId: created.tenant.id, token: created.admin.activationToken }
          : null,
      );
      setIsIssuedTokenRevealed(false);
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", created.tenant.id] });
    } catch (createError) {
      setError(tenantCreateErrorMessage(createError));
    }
  }

  async function handleDeleteTenant(tenant: TenantRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      description: "Kurum listeden kaldırılır, kayıtlar korunur.",
      message: `${tenant.name} kurumunu silmek istiyor musun?`,
      title: "Kurumu sil",
    });
    if (!confirmed) return;

    setError("");
    setDeletingTenantId(tenant.id);
    try {
      await deleteTenant(auth.accessToken, tenant.id);
      if (issuedToken?.tenantId === tenant.id) {
        setIssuedToken(null);
        setIsIssuedTokenRevealed(false);
      }
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", tenant.id] });
    } catch {
      setError("Kurum silinemedi.");
    } finally {
      setDeletingTenantId("");
    }
  }

  return (
    <PageFrame title="Kurumlar" subtitle="Platformdaki kurumları listele ve yeni kurum aç.">
      <CrudPage
        actions={
          <>
            <ListControls meta={tenantsQuery.data?.meta} onChange={setListQuery} sortOptions={tenantSortOptions} state={listQuery} />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Kurum oluştur
            </Button>
          </>
        }
        aria-label="Kurum yönetimi"
        columns={columns}
        description="SYSTEM_ADMIN kurum kayıtlarını buradan yönetir."
        emptyState={
          <EmptyState
            title="Henüz kurum yok"
            description="İlk kurumunu oluşturarak sıfır-veri kurulum zincirini başlat."
            primaryAction={{ label: "Kurum oluştur", onClick: openCreateForm }}
          />
        }
        emptyText="Kurum kaydı yok"
        error={error || (tenantsQuery.isError ? "Kurumlar alınamadı." : undefined)}
        getRowKey={(tenant) => tenant.id}
        loading={tenantsQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary ariaLabel="Sistem kurum operasyon özeti" badges={tenantSummaryBadges} items={tenantSummaryItems} />
        }
        tableCaption="Kurum operasyon listesi"
        tableDescription="Platform kurumlarının plan, lisans, koltuk ve erişim durumu."
        title="Kurumlar"
      />
      {issuedToken ? (
        <section
          aria-label="İlk admin aktivasyon tokenı"
          aria-live="polite"
          className="next-token-panel"
          data-token-state={isIssuedTokenRevealed ? "revealed" : "masked"}
        >
          <div className="next-token-panel__body">
            <div className="next-token-panel__status" aria-label="İlk admin token güven durumu">
              <StatusBadge tone="warning">Tek seferlik</StatusBadge>
              <StatusBadge tone={isIssuedTokenRevealed ? "warning" : "neutral"}>
                {isIssuedTokenRevealed ? "Token açık" : "Token maskeli"}
              </StatusBadge>
              <StatusBadge tone="info">SYSTEM_ADMIN işlemi</StatusBadge>
            </div>
            <strong>{issuedToken.email}</strong>
            <p>İlk admin aktivasyon tokenı yalnız paylaşılacağı anda gösterilir; işlem tamamlanınca panelden kaldır.</p>
          </div>
          <code className="next-token-panel__token">
            {isIssuedTokenRevealed ? issuedToken.token : maskActivationToken(issuedToken.token)}
          </code>
          <div className="next-token-panel__actions">
            <Button type="button" variant="secondary" onClick={() => setIsIssuedTokenRevealed((current) => !current)}>
              {isIssuedTokenRevealed ? "Tokenı gizle" : "Tokenı göster"}
            </Button>
            <Button
              type="button"
              variant={isIssuedTokenRevealed ? "primary" : "secondary"}
              onClick={() => {
                setIssuedToken(null);
                setIsIssuedTokenRevealed(false);
              }}
            >
              Tokenı kapat
            </Button>
          </div>
        </section>
      ) : null}
      <TenantFormModal
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onNameChange={updateName}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Oluştur"
        title="Kurum oluştur"
      />
      {confirmationDialog}
    </PageFrame>
  );
}

function TenantFormModal({
  form,
  onCancel,
  onChange,
  onNameChange,
  onSubmit,
  open,
  submitLabel,
  title,
}: {
  form: TenantCreateFormState;
  onCancel(): void;
  onChange(value: TenantCreateFormState): void;
  onNameChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  open: boolean;
  submitLabel: string;
  title: string;
}) {
  return (
    <FormModal
      description="Kurum ve ilk yönetici hesabı birlikte oluşturulur."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel={submitLabel}
      title={title}
    >
      <Field label="Kurum adı">
        <Input required value={form.name} onChange={(event) => onNameChange(event.target.value)} />
      </Field>
      <Field label="Slug" description="Kurumun teknik kısa adı. Örn: yeni-kurum. URL ve sistem kimliği için kullanılır.">
        <Input required value={form.slug} onChange={(event) => onChange({ ...form, slug: event.target.value })} />
      </Field>
      <Field label="Plan">
        <Select value={form.plan} onChange={(event) => onChange({ ...form, plan: event.target.value as TenantFormState["plan"] })}>
          <option value="TRIAL">Deneme</option>
          <option value="PRO">Pro</option>
          <option value="ENTERPRISE">Enterprise</option>
        </Select>
      </Field>
      <Field label="Lisans başlangıç">
        <Input type="date" value={form.licenseStartsAt ?? ""} onChange={(event) => onChange({ ...form, licenseStartsAt: event.target.value })} />
      </Field>
      <Field label="Lisans bitiş">
        <Input type="date" value={form.licenseEndsAt ?? ""} onChange={(event) => onChange({ ...form, licenseEndsAt: event.target.value })} />
      </Field>
      <Field label="Koltuk limiti" description="Bu kuruma tanımlanabilecek aktif kullanıcı sayısı. Boş bırakırsan sınırsız olur.">
        <Input
          inputMode="numeric"
          min={1}
          type="number"
          value={form.seatLimit ?? ""}
          onChange={(event) => onChange({ ...form, seatLimit: event.target.value })}
        />
      </Field>
      <Field label="Durum">
        <Select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as TenantFormState["status"] })}>
          <option value="ACTIVE">Aktif</option>
          <option value="SUSPENDED">Askıda</option>
          <option value="TRIAL">Deneme</option>
        </Select>
      </Field>
      <Field label="Admin ad soyad">
        <Input
          required
          value={form.firstAdmin.name}
          onChange={(event) => onChange({ ...form, firstAdmin: { ...form.firstAdmin, name: event.target.value } })}
        />
      </Field>
      <Field label="Admin e-posta">
        <Input
          required
          type="email"
          value={form.firstAdmin.email}
          onChange={(event) => onChange({ ...form, firstAdmin: { ...form.firstAdmin, email: event.target.value } })}
        />
      </Field>
      <Field label="İlk admin modu">
        <Select
          value={form.firstAdmin.mode}
          onChange={(event) =>
            onChange({
              ...form,
              firstAdmin: {
                ...form.firstAdmin,
                mode: event.target.value as TenantCreateFormState["firstAdmin"]["mode"],
                password: "",
              },
            })
          }
        >
          <option value="password">Şifre belirle</option>
          <option value="invitation">Davet gönder</option>
        </Select>
      </Field>
      {form.firstAdmin.mode === "password" ? (
        <Field label="Admin şifre">
          <Input
            required
            minLength={8}
            type="password"
            value={form.firstAdmin.password}
            onChange={(event) => onChange({ ...form, firstAdmin: { ...form.firstAdmin, password: event.target.value } })}
          />
        </Field>
      ) : null}
    </FormModal>
  );
}

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(value: string | undefined) {
  return value ? new Date(value).toLocaleDateString("tr-TR") : "-";
}

function formatSeatUsage(tenant: TenantRecord) {
  const used = tenant.activeSeatCount ?? 0;
  return tenant.seatLimit ? `${used} / ${tenant.seatLimit}` : `${used} / Sınırsız`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function licenseDaysRemaining(value: string | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const end = new Date(value).getTime();
  if (Number.isNaN(end)) return Number.POSITIVE_INFINITY;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.ceil((end - Date.now()) / dayMs);
}

function isSeatLimitExceeded(tenant: TenantRecord) {
  return Boolean(tenant.seatLimit && (tenant.activeSeatCount ?? 0) > tenant.seatLimit);
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Aktif";
  if (status === "SUSPENDED") return "Askıda";
  if (status === "TRIAL") return "Deneme";
  return status;
}

function statusTone(status: string): StatusBadgeProps["tone"] {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "danger";
  if (status === "TRIAL") return "warning";
  return "neutral";
}

function planLabel(plan: string) {
  if (plan === "ENTERPRISE") return "Enterprise";
  if (plan === "PRO") return "Pro";
  if (plan === "TRIAL") return "Trial";
  return plan;
}

function planTone(plan: string): StatusBadgeProps["tone"] {
  if (plan === "ENTERPRISE") return "info";
  if (plan === "PRO") return "success";
  if (plan === "TRIAL") return "warning";
  return "neutral";
}

function tenantCreateErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.code === "TENANT_SLUG_ALREADY_EXISTS") {
    return "Bu slug zaten kullanımda. Farklı bir slug gir.";
  }
  return "Kurum oluşturulamadı.";
}

function formatTenantSort(sort: string) {
  const option = tenantSortOptions.find((candidate) => candidate.value === sort);
  return option?.label ?? "Varsayılan";
}

function maskActivationToken(token: string) {
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

const tenantSortOptions = [
  { label: "Kurum A-Z", value: "name" },
  { label: "Kurum Z-A", value: "-name" },
  { label: "Slug A-Z", value: "slug" },
  { label: "Slug Z-A", value: "-slug" },
];
