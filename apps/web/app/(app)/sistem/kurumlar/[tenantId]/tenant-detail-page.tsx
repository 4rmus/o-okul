"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
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
  StatusBadge,
  TabButton,
  Tabs,
  Select,
  type StatusBadgeProps,
} from "@o-okul/ui";
import type { TenantStatusUpdateRequest, TenantLifecycleReason } from "@o-okul/shared-types";
import { ApiRequestError } from "../../../../../src/api-client.js";
import { useAuth } from "../../../../providers.js";
import {
  firstFormError,
  tenantUpdateFormSchema,
  type TenantUpdateFormState,
} from "../../../../../src/form-validation.js";
import { PageFrame } from "../../../kurum/_shared/page-frame.js";
import { TenantResetPanel } from "./tenant-reset-panel.js";
import { tenantManagementSchema, createLifecycleStepUp, loadTenant, updateTenant, updateTenantStatus, type TenantRecord } from "../../_shared/system-api.js";

const emptyForm: TenantUpdateFormState = {
  name: "",
};

export function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { auth } = useAuth();
  const scope = `${tenantId}:${auth?.session.userId}:${auth?.session.id}:${auth?.session.membershipVersion}`;
  return <ScopedTenantDetailPage key={scope} tenantId={tenantId} scope={scope} />;
}

function ScopedTenantDetailPage({ tenantId, scope }: { tenantId: string; scope: string }) {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const alive = useRef(true);
  const statusAttempt = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; statusAttempt.current++; }; }, []);
  const [resetPending, setResetPending] = useState(false);
  const tenantQuery = useQuery({
    queryKey: ["next-tenant", tenantId, scope],
    queryFn: () => loadTenant(auth?.accessToken ?? "", tenantId),
    enabled: Boolean(auth && tenantId),
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const tenant = tenantQuery.data?.id === tenantId ? tenantQuery.data : null;
  const management = tenantManagementSchema.safeParse(tenant?.management);
  const canChangeStatus = !resetPending && !tenantQuery.isError && !tenantQuery.isFetching && management.success && management.data.verified && (tenant?.status === "ACTIVE" ? management.data.allowedActions.suspend : management.data.allowedActions.reactivate) && (!management.data.currentReset || management.data.currentReset.status === "COMPLETED") && tenant?.id !== "system" && Number.isInteger(tenant?.lifecycleVersion) && (tenant?.lifecycleVersion ?? -1) >= 0 && (tenant?.lifecycleVersion ?? -1) < 2147483647 && (tenant?.status === "ACTIVE" || tenant?.status === "SUSPENDED");
  const licenseDays = tenant ? licenseDaysRemaining(tenant.licenseEndsAt) : null;
  const seatPercent = tenant ? seatUsagePercent(tenant) : null;
  const [form, setForm] = useState<TenantUpdateFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusPending, setStatusPending] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<TenantRecord | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [reason, setReason] = useState<TenantLifecycleReason>("SECURITY_REVIEW");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery">("totp");
  const [statusRequest, setStatusRequest] = useState<{ id: string; body: TenantStatusUpdateRequest; key: string; proof?: string; expiresAt?: string } | null>(null);
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
      setNotice("Kurum adı güncellendi.");
    } catch {
      setError("Kurum güncellenemedi.");
    }
  }

  function openStatusForm() {
    if (!tenant || !canChangeStatus) return;
    setStatusTarget(statusRequest ? statusTarget : tenant);
    setStatusOpen(true);
    if (!statusRequest) {
      setConfirmationText("");
      setMfaCode("");
      setError("");
    }
  }

  async function handleStatusChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canChangeStatus || !auth || !statusTarget || statusPending || confirmationText !== statusTarget.slug) return;
    const pending = statusRequest ?? {
      id: statusTarget.id,
      body: { status: statusTarget.status === "ACTIVE" ? "SUSPENDED" as const : "ACTIVE" as const,
        expectedLifecycleVersion: statusTarget.lifecycleVersion, reason, confirmationText },
      key: crypto.randomUUID(),
    };
    setStatusRequest(pending);
    setError("");
    setNotice("");
    setStatusPending(true);
    const attemptId = ++statusAttempt.current;
    const active = () => alive.current && statusAttempt.current === attemptId;
    let attempted = false;
    try {
      if (!pending.proof || !Number.isFinite(Date.parse(pending.expiresAt ?? "")) || Date.parse(pending.expiresAt ?? "") <= Date.now()) {
        const proof = await createLifecycleStepUp(auth.accessToken, {
          purpose: "TENANT_LIFECYCLE_CHANGE",
          target: { tenantId: pending.id, status: pending.body.status, expectedLifecycleVersion: pending.body.expectedLifecycleVersion },
          ...(mfaMethod === "totp" ? { totpCode: mfaCode } : { recoveryCode: mfaCode }),
        });
        if (!active()) return;
        if (!Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= Date.now()) throw new Error("MFA_EXPIRED");
        pending.proof = proof.stepUpToken;
        pending.expiresAt = proof.expiresAt;
        setStatusRequest({ ...pending });
        setMfaCode("");
      }
      if (!active()) return;
      attempted = true;
      const result = await updateTenantStatus(auth.accessToken, pending.id, pending.body, pending.key, pending.proof);
      if (!active()) return;
      setStatusRequest(null);
      setStatusOpen(false);
      setStatusTarget(null);
      setNotice(pending.body.status === "SUSPENDED"
        ? `Kurum askıya alındı; ${result.sessionsRevoked} açık oturum kapatıldı.`
        : "Kurum erişime açıldı; kullanıcıların yeniden giriş yapması gerekir.");
      await queryClient.invalidateQueries({ queryKey: ["next-tenant", pending.id] });
      void queryClient.invalidateQueries({ queryKey: ["next-tenants"] });
    } catch (failure) {
      if (!active()) return;
      if (failure instanceof ApiRequestError && failure.status === 409 && failure.code !== "IDEMPOTENCY_KEY_IN_PROGRESS") {
        setStatusRequest(null);
        setStatusOpen(false);
        setStatusTarget(null);
        setError("Kurum bilgisi değişmiş. Güncel durumu okuyup işlemi yeniden onaylayın.");
      } else if (!attempted || (failure instanceof ApiRequestError && failure.status === 401)) {
        setStatusRequest({ ...pending, proof: undefined, expiresAt: undefined });
        setMfaCode("");
        setError("İkinci doğrulama başarısız veya süresi dolmuş. Yeni doğrulama koduyla tekrar deneyin.");
      } else {
        setError("İşlem sonucu doğrulanamadı. Aynı işlemle tekrar deneyin; tekrar gönderim ikinci bir değişiklik yapmaz.");
      }
      await tenantQuery.refetch();
    } finally {
      if (active()) setStatusPending(false);
    }
  }

  return (
    <PageFrame
      title={tenant?.name ?? "Kurum Detayı"}
      subtitle="Kurum adı ve erişim durumunu yönetin; kurum kodu, lisans ve kapasiteyi görüntüleyin."
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
              <>
                <Button disabled={statusPending} onClick={openEditForm} variant="secondary">Adı düzenle</Button>
                {canChangeStatus ? <Button
                  disabled={statusPending}
                  onClick={openStatusForm}
                  variant={tenant.status === "ACTIVE" ? "danger" : "primary"}
                >
                  {statusPending ? "İşleniyor…" : statusRequest ? "İşlemi sonuçlandır" : tenant.status === "ACTIVE" ? "Askıya al" : "Yeniden aç"}
                </Button> : null}
              </>
            }
            aria-label="Kurum yönetimi"
            description="Kurum adı ve erişim durumu yalnız sistem yöneticisi tarafından değiştirilir."
            title="Kurum yönetimi"
            tone="muted"
          />
          {auth ? <TenantResetPanel tenant={tenant} auth={auth} scope={scope} authoritative={!tenantQuery.isError && !tenantQuery.isFetching && tenantQuery.isFetchedAfterMount} onPendingChange={setResetPending} /> : null}
        </div>
      ) : null}
      {error ? (
        <Alert tone="danger" title="İşlem tamamlanamadı">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success" title="İşlem tamamlandı">{notice}</Alert> : null}
      <TenantEditModal
        form={form}
        onCancel={closeForm}
        onChange={setForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
      />
      <FormModal
        open={statusOpen}
        title={statusTarget?.status === "ACTIVE" ? "Kurum erişimini askıya al" : "Kurum erişimini yeniden aç"}
        description={`Tüm açık oturumlar kapatılır. Eski oturumlar yeniden açmada da kapalı kalır. Onay için kurum kodunu aynen yazın: ${statusTarget?.slug ?? ""}`}
        onCancel={() => { statusAttempt.current++; setStatusPending(false); setMfaCode(""); setStatusOpen(false); }}
        cancelLabel="Kapat"
        onSubmit={(event) => void handleStatusChange(event)}
        submitting={statusPending}
        submitDisabled={confirmationText !== statusTarget?.slug || (!statusRequest?.proof && !mfaCode.trim())}
        submitLabel={statusRequest ? "Aynı işlemi tekrar dene" : statusTarget?.status === "ACTIVE" ? "Askıya al" : "Yeniden aç"}
        submitError={error || undefined}
      >
        <Field label="Kurum kodu onayı"><Input autoComplete="off" disabled={Boolean(statusRequest)} required value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} /></Field>
        <Field label="İşlem gerekçesi"><Select disabled={Boolean(statusRequest)} value={reason} onChange={(event) => setReason(event.target.value as TenantLifecycleReason)}>
          <option value="SECURITY_REVIEW">Güvenlik incelemesi</option>
          <option value="INSTITUTION_REQUEST">Kurum talebi</option>
          <option value="OPERATIONS_REVIEW">Operasyon incelemesi</option>
        </Select></Field>
        <Field label="Doğrulama yöntemi"><Select disabled={statusPending} value={mfaMethod} onChange={(event) => { setMfaMethod(event.target.value as "totp" | "recovery"); setMfaCode(""); }}>
          <option value="totp">Doğrulama uygulaması</option><option value="recovery">Yedek kod</option>
        </Select></Field>
        <Field label={mfaMethod === "totp" ? "Doğrulama kodu" : "Yedek kod"}><Input type="password" autoComplete="one-time-code" disabled={statusPending} value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /></Field>
      </FormModal>
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
      description="Kurum adını güncelle."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel="Kaydet"
      title="Kurum düzenle"
    >
      <Field label="Kurum adı">
        <Input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </Field>
    </FormModal>
  );
}

function toTenantForm(tenant: TenantRecord): TenantUpdateFormState {
  return {
    name: tenant.name,
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
  return "Durum bilgisi alınamadı";
}

function statusTone(status: string): StatusBadgeProps["tone"] {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "danger";
  return "neutral";
}

function metricStatusTone(status: string): "danger" | "default" | "success" | "warning" {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "danger";
  return "default";
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

function metricPlanTone(plan: string): "default" | "info" | "success" | "warning" {
  if (plan === "ENTERPRISE") return "info";
  if (plan === "PRO") return "success";
  if (plan === "TRIAL") return "warning";
  return "default";
}
