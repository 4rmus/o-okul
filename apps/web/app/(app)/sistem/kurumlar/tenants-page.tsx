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
} from "@o-okul/ui";
import { Plus } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiErrorMessage } from "../../../../src/api-client.js";
import {
  firstFormError,
  tenantCreateFormSchema,
  type TenantCreateFormState,
  type TenantFormState,
} from "../../../../src/form-validation.js";
import { ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../../kurum/_shared/operation-summary.js";
import { PageFrame } from "../../kurum/_shared/page-frame.js";
import { createTenant, loadTenants, type TenantRecord } from "../_shared/system-api.js";

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
  auditReference: "",
  campus: {
    code: "MRK",
    name: "",
    unitType: "SCHOOL",
  },
  firstOwner: {
    name: "",
    email: "",
    nationalId: "",
  },
};

export function TenantsPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
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
  const [error, setError] = useState("");
  const rows = tenantsQuery.data?.data ?? [];
  const activeTenantCount = rows.filter((tenant) => tenant.status === "ACTIVE").length;
  const trialTenantCount = rows.filter((tenant) => tenant.status === "TRIAL").length;
  const suspendedTenantCount = rows.filter((tenant) => tenant.status === "SUSPENDED").length;
  const expiringTenantCount = rows.filter((tenant) => licenseDaysRemaining(tenant.licenseEndsAt) <= 30).length;
  const overSeatLimitCount = rows.filter((tenant) => isSeatLimitExceeded(tenant)).length;
  const tenantSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtreye uyan kurumlar",
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
      description: "Lisansı 30 gün içinde biten kurumlar",
      key: "license",
      label: "Yaklaşan lisans bitişi",
      tone: expiringTenantCount > 0 ? "warning" : "success",
      value: formatCount(expiringTenantCount),
    },
    {
      description: "Kullanıcı sınırını aşan kurumlar",
      key: "seats",
      label: "Kullanıcı sınırı",
      tone: overSeatLimitCount > 0 ? "danger" : "success",
      value: formatCount(overSeatLimitCount),
    },
  ];
  const tenantSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "scope",
      label: "Sistem yöneticisi görünümü",
      tone: "info",
    },
    {
      key: "sort",
      label: `Sıralama: ${formatTenantSort(listQuery.sort)}`,
      tone: "neutral",
    },
  ];

  const columns: Array<DataTableColumn<TenantRecord>> = [
    { key: "name", header: "Kurum", priority: "primary", render: (tenant) => tenant.name, sticky: "left" },
    { key: "slug", header: "Kurum kodu", priority: "secondary", render: (tenant) => tenant.slug },
    {
      key: "plan",
      header: "Plan",
      priority: "secondary",
      render: (tenant) => <StatusBadge tone={planTone(tenant.plan)}>{planLabel(tenant.plan)}</StatusBadge>,
    },
    { key: "licenseEndsAt", header: "Lisans bitişi", priority: "optional", render: (tenant) => formatDate(tenant.licenseEndsAt) },
    { key: "seatLimit", header: "Kullanıcı", priority: "secondary", render: (tenant) => formatSeatUsage(tenant) },
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
        </div>
      ),
      sticky: "right",
    },
  ];

  function openCreateForm() {
    setForm(emptyCreateForm);
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
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", created.tenant.id] });
    } catch (createError) {
      setError(tenantCreateErrorMessage(createError));
    }
  }

  return (
    <PageFrame title="Kurumlar" subtitle="Kurumları görüntüleyin ve yeni kurum kaydı oluşturun.">
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
        description="Sistem yöneticileri kurum kayıtlarını bu ekrandan yönetir."
        emptyState={
          <EmptyState
            title="Henüz kurum yok"
            description="İlk kurum kaydını oluşturarak başlayın."
            primaryAction={{ label: "Kurum oluştur", onClick: openCreateForm }}
          />
        }
        emptyText="Kurum kaydı yok"
        error={!isFormOpen && error ? error : tenantsQuery.isError ? "Kurumlar alınamadı." : undefined}
        getRowKey={(tenant) => tenant.id}
        hasActiveFilters={Boolean(listQuery.q.trim())}
        loading={tenantsQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary ariaLabel="Kurum listesi özeti" badges={tenantSummaryBadges} items={tenantSummaryItems} />
        }
        tableCaption="Kurum listesi"
        tableDescription="Kurumların plan, lisans, kullanıcı sınırı ve erişim durumu."
        title="Kurumlar"
      />
      <TenantFormModal
        error={error}
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onNameChange={updateName}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Oluştur"
        title="Kurum oluştur"
      />
    </PageFrame>
  );
}

function TenantFormModal({
  form,
  error,
  onCancel,
  onChange,
  onNameChange,
  onSubmit,
  open,
  submitLabel,
  title,
}: {
  form: TenantCreateFormState;
  error: string;
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
      {error ? <p className="next-form-error" role="alert">{error}</p> : null}
      <Field label="Kurum adı">
        <Input required value={form.name} onChange={(event) => onNameChange(event.target.value)} />
      </Field>
      <Field label="Kurum kodu" description="Giriş bağlantısında kullanılacak kısa ad. Örnek: yeni-kurum.">
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
      <Field label="Aktif öğrenci limiti" description="Lisans döneminde aynı anda aktif olabilecek öğrenci sayısı.">
        <Input
          inputMode="numeric"
          min={1}
          required
          type="number"
          value={form.seatLimit ?? ""}
          onChange={(event) => onChange({ ...form, seatLimit: event.target.value })}
        />
      </Field>
      <Field label="Sözleşme referansı">
        <Input required value={form.auditReference} onChange={(event) => onChange({ ...form, auditReference: event.target.value })} />
      </Field>
      <Field label="İlk kampüs adı">
        <Input required value={form.campus.name} onChange={(event) => onChange({ ...form, campus: { ...form.campus, name: event.target.value } })} />
      </Field>
      <Field label="Kampüs kodu">
        <Input value={form.campus.code} onChange={(event) => onChange({ ...form, campus: { ...form.campus, code: event.target.value } })} />
      </Field>
      <Field label="Kampüs birim tipi">
        <Select value={form.campus.unitType} onChange={(event) => onChange({ ...form, campus: { ...form.campus, unitType: event.target.value as TenantCreateFormState["campus"]["unitType"] } })}>
          <option value="SCHOOL">Okul</option>
          <option value="COURSE">Kurs</option>
          <option value="MIXED">Karma</option>
        </Select>
      </Field>
      <Field label="Durum">
        <Select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as TenantFormState["status"] })}>
          <option value="ACTIVE">Aktif</option>
          <option value="SUSPENDED">Askıda</option>
          <option value="TRIAL">Deneme</option>
        </Select>
      </Field>
      <Field label="İlk kurum sahibi ad soyad">
        <Input
          required
          value={form.firstOwner.name}
          onChange={(event) => onChange({ ...form, firstOwner: { ...form.firstOwner, name: event.target.value } })}
        />
      </Field>
      <Field label="İlk kurum sahibi e-posta">
        <Input
          required
          type="email"
          value={form.firstOwner.email}
          onChange={(event) => onChange({ ...form, firstOwner: { ...form.firstOwner, email: event.target.value } })}
        />
      </Field>
      <Field label="Kurum sahibi TC kimlik no" description="İsteğe bağlıdır; hesap açmak için zorunlu değildir.">
        <Input
          inputMode="numeric"
          maxLength={11}
          value={form.firstOwner.nationalId}
          onChange={(event) => onChange({ ...form, firstOwner: { ...form.firstOwner, nationalId: event.target.value } })}
        />
      </Field>
      <p className="next-status-note">İlk yöneticiye 24 saat geçerli parola kurulum bağlantısı e-posta ile gönderilir.</p>
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
  return "Durum bilgisi alınamadı";
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
  if (plan === "TRIAL") return "Deneme";
  return "Tanımsız plan";
}

function planTone(plan: string): StatusBadgeProps["tone"] {
  if (plan === "ENTERPRISE") return "info";
  if (plan === "PRO") return "success";
  if (plan === "TRIAL") return "warning";
  return "neutral";
}

function tenantCreateErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.code === "TENANT_SLUG_ALREADY_EXISTS") {
    return "Bu kurum kodu zaten kullanımda. Farklı bir kurum kodu girin.";
  }
  if (error instanceof ApiRequestError && error.code === "TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS") {
    return "Bu yönetici e-postası zaten kullanımda. Farklı bir e-posta girin.";
  }
  return apiErrorMessage(error, "Kurum oluşturulamadı.");
}

function formatTenantSort(sort: string) {
  const option = tenantSortOptions.find((candidate) => candidate.value === sort);
  return option?.label ?? "Varsayılan";
}

const tenantSortOptions = [
  { label: "Kurum A-Z", value: "name" },
  { label: "Kurum Z-A", value: "-name" },
  { label: "Kurum kodu A-Z", value: "slug" },
  { label: "Kurum kodu Z-A", value: "-slug" },
];
