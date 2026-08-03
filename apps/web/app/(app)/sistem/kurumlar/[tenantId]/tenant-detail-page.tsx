"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Field,
  FormModal,
  InfoGrid,
  InfoItem,
  Input,
  LoadingState,
  MetricCard,
  MetricGrid,
  Panel,
  Select,
  StatusBadge,
  TabButton,
  Tabs,
  type StatusBadgeProps,
} from "@o-okul/ui";
import { useAuth } from "../../../../providers.js";
import {
  firstFormError,
  tenantUpdateFormSchema,
  type TenantUpdateFormState,
} from "../../../../../src/form-validation.js";
import { PageFrame } from "../../../kurum/_shared/page-frame.js";
import { loadTenant, updateTenant, type TenantRecord } from "../../_shared/system-api.js";

const emptyForm: TenantUpdateFormState = {
  name: "",
  slug: "",
  status: "ACTIVE",
};

export function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const tenantQuery = useQuery({
    queryKey: ["next-tenant", tenantId],
    queryFn: () => loadTenant(auth?.accessToken ?? "", tenantId),
    enabled: Boolean(auth && tenantId),
    refetchOnWindowFocus: false,
  });
  const tenant = tenantQuery.data ?? null;
  const licenseDays = tenant ? licenseDaysRemaining(tenant.licenseEndsAt) : null;
  const seatPercent = tenant ? seatUsagePercent(tenant) : null;
  const [form, setForm] = useState<TenantUpdateFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<"license" | "management">("license");

  useEffect(() => {
    if (tenant) setForm(toTenantForm(tenant));
  }, [tenant]);

  function openEditForm() {
    if (tenant) setForm(toTenantForm(tenant));
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setError("");
    if (tenant) setForm(toTenantForm(tenant));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !tenant) return;

    setError("");
    const parsedForm = tenantUpdateFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      await updateTenant(auth.accessToken, tenant.id, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: ["next-tenant", tenant.id] });
      void queryClient.invalidateQueries({ queryKey: ["next-tenants"] });
      setIsFormOpen(false);
    } catch {
      setError("Kurum güncellenemedi.");
    }
  }

  return (
    <PageFrame
      title={tenant?.name ?? "Kurum Detayı"}
      subtitle="Kurum kodunu, lisansını, kullanıcı sınırını ve kullanım durumunu yönetin."
    >
      {tenantQuery.isPending ? <LoadingState label="Kurum detayı yükleniyor…" /> : null}
      {tenantQuery.isError ? (
        <Alert tone="danger" title="Kurum detayı alınamadı">
          Sistem yönetimi verisi şu anda okunamıyor.
        </Alert>
      ) : null}
      {tenant ? (
        <MetricGrid className="next-system-summary-grid" aria-label="Kurum detayı" role="region">
          <MetricCard
            className="next-system-summary-card"
            description="Giriş bağlantılarında kullanılan kısa ad"
            label="Kurum kodu"
            value={tenant.slug}
          />
          <MetricCard
            className="next-system-summary-card"
            description="Lisans planı"
            label="Plan"
            tone={metricPlanTone(tenant.plan)}
            value={<StatusBadge tone={planTone(tenant.plan)}>{planLabel(tenant.plan)}</StatusBadge>}
          />
          <MetricCard
            className="next-system-summary-card"
            description="Kurumun kullanıma açık olup olmadığı"
            label="Durum"
            tone={metricStatusTone(tenant.status)}
            value={<StatusBadge tone={statusTone(tenant.status)}>{statusLabel(tenant.status)}</StatusBadge>}
          />
          <MetricCard
            className="next-system-summary-card"
            description="Aktif kullanıcı / sınır"
            label="Kullanıcı"
            tone={isSeatLimitExceeded(tenant) ? "warning" : "default"}
            value={formatSeatUsage(tenant)}
          />
          <MetricCard
            className="next-system-summary-card"
            description="Yenileme penceresi"
            label="Lisans bitişi"
            tone={tenantCapacityTone(tenant)}
            value={formatDate(tenant.licenseEndsAt)}
          />
        </MetricGrid>
      ) : null}
      {tenant ? (
        <Tabs label="Kurum detay bölümleri">
          <TabButton aria-controls="tenant-detail-panel-license" id="tenant-detail-tab-license" selected={activeSection === "license"} onClick={() => setActiveSection("license")}>Lisans ve kapasite</TabButton>
          <TabButton aria-controls="tenant-detail-panel-management" id="tenant-detail-tab-management" selected={activeSection === "management"} onClick={() => setActiveSection("management")}>Kurum yönetimi</TabButton>
        </Tabs>
      ) : null}
      {tenant && activeSection === "license" ? (
        <div aria-labelledby="tenant-detail-tab-license" id="tenant-detail-panel-license" role="tabpanel" tabIndex={0}>
          <Panel
            aria-label="Lisans ve kapasite"
            description="Lisans süresi, aktif kullanıcı sayısı ve önerilen işlem."
            title="Lisans ve kapasite"
            tone={tenantCapacityTone(tenant)}
          >
            <InfoGrid className="next-tenant-capacity-grid">
              <InfoItem label="Lisans penceresi" value={formatLicenseWindow(tenant)} />
              <InfoItem label="Kalan gün" value={formatLicenseDays(licenseDays)} />
              <InfoItem
                label="Kullanıcı sayısı"
                value={
                  <>
                    {formatSeatUsage(tenant)}
                    {seatPercent === null ? "" : ` · %${seatPercent}`}
                  </>
                }
              />
              <InfoItem
                label="Önerilen işlem"
                value={<StatusBadge tone={tenantCapacityTone(tenant)}>{tenantRecommendedAction(tenant)}</StatusBadge>}
              />
            </InfoGrid>
          </Panel>
        </div>
      ) : null}
      {tenant && activeSection === "management" ? (
        <div aria-labelledby="tenant-detail-tab-management" id="tenant-detail-panel-management" role="tabpanel" tabIndex={0}>
          <Panel
            actions={
              <Button onClick={openEditForm}>Düzenle</Button>
            }
            aria-label="Kurum yönetimi"
            description="Kurum kimliği ve durum bilgisi yalnız sistem yöneticisi tarafından değiştirilir."
            title="Kurum yönetimi"
            tone="muted"
          />
        </div>
      ) : null}
      {error ? (
        <Alert tone="danger" title="İşlem tamamlanamadı">
          {error}
        </Alert>
      ) : null}
      <TenantEditModal
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
      />
    </PageFrame>
  );
}

function TenantEditModal({
  form,
  onCancel,
  onChange,
  onSubmit,
  open,
}: {
  form: TenantUpdateFormState;
  onCancel(): void;
  onChange(value: TenantUpdateFormState): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  open: boolean;
}) {
  return (
    <FormModal
      description="Kurum kimliği ve durum bilgisini güncelle."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel="Kaydet"
      title="Kurum düzenle"
    >
      <Field label="Kurum adı">
        <Input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </Field>
      <Field label="Kurum kodu" description="Giriş bağlantısında kullanılacak kısa ad. Örnek: yeni-kurum.">
        <Input required value={form.slug} onChange={(event) => onChange({ ...form, slug: event.target.value })} />
      </Field>
      <Field label="Durum">
        <Select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as TenantUpdateFormState["status"] })}>
          <option value="ACTIVE">Aktif</option>
          <option value="SUSPENDED">Askıda</option>
          <option value="TRIAL">Deneme</option>
        </Select>
      </Field>
    </FormModal>
  );
}

function toTenantForm(tenant: TenantRecord): TenantUpdateFormState {
  return {
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status === "SUSPENDED" || tenant.status === "TRIAL" ? tenant.status : "ACTIVE",
  };
}

function formatDate(value: string | undefined) {
  return value ? new Date(value).toLocaleDateString("tr-TR") : "-";
}

function formatSeatUsage(tenant: TenantRecord) {
  const used = tenant.activeSeatCount ?? 0;
  return tenant.seatLimit ? `${used} / ${tenant.seatLimit}` : `${used} / Sınırsız`;
}

function seatUsagePercent(tenant: TenantRecord) {
  const used = tenant.activeSeatCount ?? 0;
  if (!tenant.seatLimit) return null;
  return Math.round((used / tenant.seatLimit) * 100);
}

function formatLicenseWindow(tenant: TenantRecord) {
  return `${formatDate(tenant.licenseStartsAt)} - ${formatDate(tenant.licenseEndsAt)}`;
}

function licenseDaysRemaining(value: string | undefined) {
  if (!value) return null;
  const end = new Date(value).getTime();
  if (Number.isNaN(end)) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.ceil((end - Date.now()) / dayMs);
}

function formatLicenseDays(days: number | null) {
  if (days === null) return "Süre tanımsız";
  if (days < 0) return `${Math.abs(days)} gün geçmiş`;
  if (days === 0) return "Bugün bitiyor";
  return `${days} gün kaldı`;
}

function tenantCapacityTone(tenant: TenantRecord): "danger" | "success" | "warning" {
  if (tenant.status === "SUSPENDED") return "danger";
  const days = licenseDaysRemaining(tenant.licenseEndsAt);
  if ((days !== null && days <= 30) || isSeatLimitExceeded(tenant)) return "warning";
  return "success";
}

function tenantRecommendedAction(tenant: TenantRecord) {
  if (tenant.status === "SUSPENDED") return "Askı durumunu incele";
  if (isSeatLimitExceeded(tenant)) return "Kullanıcı sınırını yükselt";
  const days = licenseDaysRemaining(tenant.licenseEndsAt);
  if (days !== null && days < 0) return "Lisansı yenile";
  if (days !== null && days <= 30) return "Yenileme planla";
  return "Operasyon normal";
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

function metricStatusTone(status: string): "danger" | "default" | "success" | "warning" {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "danger";
  if (status === "TRIAL") return "warning";
  return "default";
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

function metricPlanTone(plan: string): "default" | "info" | "success" | "warning" {
  if (plan === "ENTERPRISE") return "info";
  if (plan === "PRO") return "success";
  if (plan === "TRIAL") return "warning";
  return "default";
}
