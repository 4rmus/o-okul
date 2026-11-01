"use client";

import { type FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trialLicenseLimits } from "@o-okul/shared-types";
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
import { PageFrame } from "../../_shared/page-frame.js";
import { createTenant, loadTenants, type TenantRecord } from "../_shared/system-api.js";
import { PurgeCandidatesPanel } from "./purge-candidates-panel.js";

const emptyForm: TenantFormState = {
  name: "",
  slug: "",
  plan: "TRIAL",
  licenseStartsAt: "",
  licenseEndsAt: "",
  activeStudentLimit: "",
};

// Trials open with "Deneme aç"; a regular institution starts as a paid plan.
const emptyCreateForm: TenantCreateFormState = {
  ...emptyForm,
  plan: "PRO",
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
  const createAttempt = useRef<{ body: string; idempotencyKey: string } | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const rows = tenantsQuery.data?.data ?? [];
  const activeTenantCount = rows.filter((tenant) => tenant.status === "ACTIVE").length;
  const suspendedTenantCount = rows.filter((tenant) => tenant.status === "SUSPENDED").length;
  const expiringTenantCount = rows.filter((tenant) => licenseDaysRemaining(tenant.licenseEndsAt) <= 30).length;
  const fullStudentQuotaCount = rows.filter((tenant) => isStudentQuotaFull(tenant)).length;
  const tenantSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtreye uyan kurumlar",
      key: "total",
      label: "Kurum toplamı",
      value: formatCount(tenantsQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Bu sayfadaki aktif / askıda kurumlar",
      key: "status",
      label: "Durum dağılımı",
      tone: suspendedTenantCount > 0 ? "warning" : "success",
      value: `${formatCount(activeTenantCount)} / ${formatCount(suspendedTenantCount)}`,
    },
    {
      description: "Lisansı 30 gün içinde biten kurumlar",
      key: "license",
      label: "Yaklaşan lisans bitişi",
      tone: expiringTenantCount > 0 ? "warning" : "success",
      value: formatCount(expiringTenantCount),
    },
    {
      description: "Aktif öğrenci kotası dolan kurumlar",
      key: "students",
      label: "Öğrenci kotası",
      tone: fullStudentQuotaCount > 0 ? "warning" : "success",
      value: formatCount(fullStudentQuotaCount),
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
    { key: "activeStudents", header: "Aktif öğrenci", priority: "secondary", render: (tenant) => formatStudentUsage(tenant) },
    { key: "accounts", header: "Kullanıcı", priority: "optional", render: (tenant) => formatCount(tenant.activeSeatCount ?? 0) },
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

  function openCreateForm(initial: TenantCreateFormState = emptyCreateForm) {
    createAttempt.current = null;
    setForm(initial);
    setFormError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    createAttempt.current = null;
    setIsFormOpen(false);
    setForm(emptyCreateForm);
    setFormError("");
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
    if (!auth || isSaving) return;

    setFormError("");
    const parsedForm = tenantCreateFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setFormError(firstFormError(parsedForm.error));
      return;
    }

    const requestBody = JSON.stringify(parsedForm.data);
    if (createAttempt.current?.body !== requestBody) {
      createAttempt.current = { body: requestBody, idempotencyKey: crypto.randomUUID() };
    }

    setIsSaving(true);
    try {
      const created = await createTenant(auth.accessToken, parsedForm.data, createAttempt.current.idempotencyKey);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", created.tenant.id] });
    } catch (createError) {
      setFormError(tenantCreateErrorMessage(createError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <PageFrame title="Kurumlar" subtitle="Kurumları görüntüleyin ve yeni kurum kaydı oluşturun.">
      <CrudPage
        actions={
          <>
            <ListControls meta={tenantsQuery.data?.meta} onChange={setListQuery} sortOptions={tenantSortOptions} state={listQuery} />
            <Button onClick={() => openCreateForm(withPlanDefaults(emptyCreateForm, "TRIAL"))} variant="secondary">
              Deneme aç
            </Button>
            <Button onClick={() => openCreateForm()}>
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
            primaryAction={{ label: "Kurum oluştur", onClick: () => openCreateForm() }}
          />
        }
        emptyText="Kurum kaydı yok"
        error={tenantsQuery.isError ? "Kurumlar alınamadı." : undefined}
        getRowKey={(tenant) => tenant.id}
        hasActiveFilters={Boolean(listQuery.q.trim())}
        loading={tenantsQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary ariaLabel="Kurum listesi özeti" badges={tenantSummaryBadges} items={tenantSummaryItems} />
        }
        tableCaption="Kurum listesi"
        tableDescription="Kurumların plan, lisans, aktif öğrenci kotası ve erişim durumu."
        hideTitle
        title="Kurumlar"
      />
      {auth ? <PurgeCandidatesPanel auth={auth} /> : null}
      <TenantFormModal
        error={formError}
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onNameChange={updateName}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Oluştur"
        submitting={isSaving}
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
  submitting,
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
  submitting: boolean;
  title: string;
}) {
  return (
    <FormModal
      description="Kurum ve ilk yönetici hesabı birlikte oluşturulur."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel={submitLabel}
      submitting={submitting}
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
        <Select value={form.plan} onChange={(event) => onChange(withPlanDefaults(form, event.target.value as TenantFormState["plan"]))}>
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
          value={form.activeStudentLimit ?? ""}
          onChange={(event) => onChange({ ...form, activeStudentLimit: event.target.value })}
        />
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
      <p className="next-status-note">İlk kurum sahibine 24 saat geçerli parola kurulum bağlantısı e-posta ile gönderilir.</p>
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

function formatStudentUsage(tenant: TenantRecord) {
  return `${formatCount(tenant.activeStudentCount ?? 0)} / ${tenant.activeStudentLimit ? formatCount(tenant.activeStudentLimit) : "Lisans yok"}`;
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

function isStudentQuotaFull(tenant: TenantRecord) {
  return Boolean(tenant.activeStudentLimit && (tenant.activeStudentCount ?? 0) >= tenant.activeStudentLimit);
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Aktif";
  if (status === "SUSPENDED") return "Askıda";
  return "Durum bilgisi alınamadı";
}

function statusTone(status: string): StatusBadgeProps["tone"] {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "danger";
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

/** "Deneme" fills today + 7 days and 100 students (DEC-20261004-02); other plans keep what was typed. */
function withPlanDefaults<TForm extends TenantFormState>(form: TForm, plan: TenantFormState["plan"]): TForm {
  if (plan !== "TRIAL") return { ...form, plan };
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + trialLicenseLimits.maxDays);
  return { ...form, plan, licenseStartsAt: localDate(today), licenseEndsAt: localDate(end), activeStudentLimit: String(trialLicenseLimits.maxActiveStudents) };
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
