"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Field, FormModal, InfoGrid, InfoItem, Input, LoadingState, Panel, Select } from "@o-okul/ui";
import type { AuthResponse, TenantCleanResetStatus, TenantLifecycleReason } from "@o-okul/shared-types";
import { ApiRequestError, authenticatedFetchOnce, apiBaseUrl } from "../../../../../src/api-client.js";
import { loadResetPreview, loadResetStatus, loadTenant, resetBlockerLabels, resetCategoryLabels, startReset, tenantManagementSchema, type TenantRecord } from "../../_shared/system-api.js";

const statusLabels = { QUEUED: "Sırada", RUNNING: "Çalışıyor", BLOCKED: "Engellendi", FAILED: "Başarısız", COMPLETED: "Tamamlandı", CANCELLED: "İptal edildi" };
const phaseLabels = { PREFLIGHT: "Ön kontrol", BACKUP: "Yedek ve geri yükleme kontrolü", DATABASE: "Kurum verileri temizleniyor", OBJECTS: "Dosyalar temizleniyor", VERIFY: "Son kontroller", DONE: "Tamamlandı" };

export function TenantResetPanel({ tenant, auth, scope, authoritative, onPendingChange }: { tenant: TenantRecord; auth: AuthResponse; scope: string; authoritative: boolean; onPendingChange(value: boolean): void }) {
  const client = useQueryClient();
  const expectedActor = { userId: auth.session.userId, sessionId: auth.session.id, membershipVersion: auth.session.membershipVersion };
  const management = tenantManagementSchema.safeParse(tenant.management);
  const current = management.success ? management.data.currentReset : null;
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [operation, setOperation] = useState<TenantCleanResetStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState<TenantLifecycleReason>("INSTITUTION_REQUEST");
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const mounted = useRef(true);
  const attempt = useRef<AbortController | null>(null);
  const completed = useRef("");
  const latestTenant = useRef(tenant); latestTenant.current = tenant;
  const storageKey = `o-okul.tenant-reset.${encodeURIComponent(auth.session.userId)}.${encodeURIComponent(tenant.id)}`;
  const preview = useQuery({ queryKey: ["tenant-reset-preview", scope], queryFn: () => loadResetPreview(auth.accessToken, tenant.id), staleTime: 0, refetchOnMount: "always", retry: false });
  const displayed = operation ?? (!key ? current : null);
  const status = useQuery({ queryKey: ["tenant-reset-status", scope, key, displayed?.operationId], queryFn: () => loadResetStatus(auth.accessToken, tenant.id, key ?? "", displayed?.operationId), enabled: ready && Boolean(key || displayed), refetchInterval: displayed?.status === "COMPLETED" ? false : 5000, retry: false });
  const data = preview.data;
  const canStart = authoritative && ready && !key && !busy && (!displayed || displayed.status === "COMPLETED") && management.success && management.data.verified && management.data.allowedActions.cleanReset && tenant.status === "SUSPENDED" && !preview.isFetching && !preview.isError && Boolean(data?.allowed && data.lifecycleVersion === tenant.lifecycleVersion && data.preservedOwnerCount > 0 && data.blockers.length === 0 && data.blockerCounts.length === 0 && data.categories.length === Object.keys(resetCategoryLabels).length && data.categories.every((row) => row.blocked === 0));

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved && /^[a-f0-9-]{36}$/.test(saved)) setKey(saved);
      else if (saved) setError("Önceki işlem bilgisi doğrulanamadı. Sistem yöneticisi kontrolü gerekiyor.");
      setReady(!saved || /^[a-f0-9-]{36}$/.test(saved));
    } catch { setError("İşlem takibi bu tarayıcıda kullanılamıyor."); }
    return () => { mounted.current = false; attempt.current?.abort(); };
  }, [storageKey]);
  useEffect(() => { onPendingChange(Boolean(key || busy || (displayed && displayed.status !== "COMPLETED"))); }, [key, busy, displayed, onPendingChange]);
  useEffect(() => {
    if (!status.data) return;
    setOperation(status.data);
    if (status.data.status === "COMPLETED" && completed.current !== status.data.operationId) {
      completed.current = status.data.operationId;
      try { window.sessionStorage.removeItem(storageKey); } catch { /* Completed operation remains visible. */ }
      setKey(null);
      void client.invalidateQueries({ queryKey: ["next-tenant", tenant.id] });
      void client.invalidateQueries({ queryKey: ["next-tenants"] });
      void client.invalidateQueries({ queryKey: ["tenant-reset-preview", scope] });
    }
  }, [status.data, client, scope, storageKey, tenant.id]);

  function cancel() { attempt.current?.abort(); attempt.current = null; setBusy(false); setCode(""); setOpen(false); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canStart || !data || confirmation !== tenant.slug || !code.trim() || attempt.current) return;
    const controller = new AbortController(); attempt.current = controller; setBusy(true); setError("");
    const active = () => mounted.current && attempt.current === controller && !controller.signal.aborted;
    try {
      // Re-read both authoritative inputs immediately before collecting the bound proof.
      const [freshTenant, freshPreview] = await Promise.all([loadTenant(auth.accessToken, tenant.id), loadResetPreview(auth.accessToken, tenant.id)]);
      const freshManagement = tenantManagementSchema.safeParse(freshTenant.management);
      if (!active()) return;
      if (freshTenant.id !== tenant.id || freshTenant.slug !== tenant.slug || freshTenant.status !== "SUSPENDED" || freshTenant.lifecycleVersion !== data.lifecycleVersion || !freshManagement.success || !freshManagement.data.verified || !freshManagement.data.allowedActions.cleanReset || (freshManagement.data.currentReset && freshManagement.data.currentReset.status !== "COMPLETED") || !freshPreview.allowed || freshPreview.lifecycleVersion !== data.lifecycleVersion || freshPreview.preflightDigest !== data.preflightDigest || freshPreview.blockers.length || freshPreview.blockerCounts.length || freshPreview.preservedOwnerCount < 1 || freshPreview.categories.length !== Object.keys(resetCategoryLabels).length || freshPreview.categories.some((row) => row.blocked > 0)) throw new Error("STALE");
      const response = await authenticatedFetchOnce(auth.accessToken, expectedActor, `${apiBaseUrl}/auth/step-up`, { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${auth.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ purpose: "TENANT_CLEAN_RESET", target: { tenantId: tenant.id, preset: data.preset, expectedLifecycleVersion: data.lifecycleVersion, preflightDigest: data.preflightDigest }, ...(method === "totp" ? { totpCode: code } : { recoveryCode: code }) }) });
      const proof: unknown = response.ok ? (await response.json()).data : null;
      if (!active()) return;
      setCode("");
      if (!proof || typeof proof !== "object" || !("purpose" in proof) || proof.purpose !== "TENANT_CLEAN_RESET" || !("stepUpToken" in proof) || typeof proof.stepUpToken !== "string" || !proof.stepUpToken || !("expiresAt" in proof) || typeof proof.expiresAt !== "string" || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= Date.now()) throw new Error("MFA");
      const latest = latestTenant.current;
      const latestManagement = tenantManagementSchema.safeParse(latest.management);
      if (latest.lifecycleVersion !== data.lifecycleVersion || latest.status !== "SUSPENDED" || !latestManagement.success || !latestManagement.data.verified || !latestManagement.data.allowedActions.cleanReset || (latestManagement.data.currentReset && latestManagement.data.currentReset.status !== "COMPLETED")) throw new Error("STALE");
      const requestKey = crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, requestKey);
      setOperation(null); setKey(requestKey); setOpen(false);
      try {
        const result = await startReset(auth.accessToken, expectedActor, tenant.id, { preset: data.preset, expectedLifecycleVersion: data.lifecycleVersion, preflightDigest: data.preflightDigest, confirmationText: confirmation, reason }, requestKey, proof.stepUpToken);
        if (active()) setOperation(result);
      } catch (failure) {
        if (active()) {
          const rejected = failure instanceof ApiRequestError && [400, 401, 403, 409, 422].includes(failure.status) && ["RESET_REQUEST_INVALID", "IDEMPOTENCY_KEY_REQUIRED", "IDEMPOTENCY_KEY_INVALID", "MFA_STEP_UP_REQUIRED", "MFA_STEP_UP_INVALID", "SYSTEM_ADMIN_REQUIRED", "SYSTEM_TENANT_PROTECTED", "TENANT_LIFECYCLE_VERSION_CONFLICT", "RESET_OPERATION_IN_PROGRESS", "RESET_PREFLIGHT_CHANGED", "RESET_REQUIRES_SUSPENDED", "RESET_PREFLIGHT_BLOCKED", "RESET_INSTITUTION_REQUEST_REQUIRED", "RESET_INSTITUTION_REQUEST_INVALID", "RESET_WRITE_QUIESCENCE_UNVERIFIED", "RESET_CONFIRMATION_MISMATCH", "RESET_TARGET_INVALID"].includes(failure.code ?? "");
          if (rejected || (failure instanceof Error && failure.message === "AUTH_CONTEXT_CHANGED")) {
            window.sessionStorage.removeItem(storageKey); setKey(null); setOperation(null);
            setError("İstek kabul edilmedi. Güncel bilgileri kontrol edip işlemi yeniden onaylayın."); void preview.refetch();
          } else setError("İşlem sonucu henüz doğrulanamadı. Yeni istek gönderilmez; kayıt yalnız okunarak kontrol edilir.");
        }
      }
      if (active()) void client.invalidateQueries({ queryKey: ["next-tenant", tenant.id] });
    } catch {
      if (active()) { setCode(""); setError("Ön kontrol veya ikinci doğrulama tamamlanamadı. Güncel bilgileri okuyup yeniden onaylayın."); void preview.refetch(); }
    } finally { if (active()) { attempt.current = null; setBusy(false); } }
  }

  return <Panel title="Kurum verilerini temizle" aria-label="Kurum verilerini temizle" description="Kurum kimliği, lisans geçmişi ve aktif kurum sahipleri korunur. Diğer hesaplar, çalışma verileri ve dosyalar temizlenir.">
    {preview.isPending ? <LoadingState label="Temizleme önizlemesi yükleniyor…" /> : null}
    {preview.isError ? <Alert tone="danger" title="Önizleme doğrulanamadı">Veriler eksik veya okunamıyor. Temizleme başlatılamaz.</Alert> : null}
    {data ? <>
      {data.institutionRequest ? <p>Kurum yöneticisi talebi: {data.institutionRequest.id} · {data.institutionRequest.requestedAt}</p> : null}
      <InfoGrid><InfoItem label="Korunan kurum sahibi" value={data.preservedOwnerCount} /><InfoItem label="Temizlenecek dosya" value={data.objectCount} /></InfoGrid>
      <details><summary>Veri kategorileri ve sayımları</summary><ul>{data.categories.map((row) => <li key={row.category}>{resetCategoryLabels[row.category]}: {row.preserved} korunacak, {row.deleted} temizlenecek, {row.blocked} engelli</li>)}</ul></details>
      {data.blockerCounts.length ? <Alert tone="warning" title="Temizleme engelleri"><ul>{data.blockerCounts.map((row) => <li key={row.code}>{resetBlockerLabels[row.code]}{row.count === null ? " · Sayım doğrulanamadı" : ` · ${row.count}`}</li>)}</ul></Alert> : null}
      {!canStart && !displayed && !key ? <Alert tone="info" title="Temizleme kapalı">Kurum askıda olmalı; tüm ön kontroller ve işlem yetkisi doğrulanmalıdır.</Alert> : null}
    </> : null}
    {displayed ? <Alert tone={displayed.status === "COMPLETED" ? "success" : displayed.status === "FAILED" || displayed.status === "BLOCKED" ? "danger" : "info"} title={`Temizleme: ${statusLabels[displayed.status]}`}>
      <p>{phaseLabels[displayed.phase]}</p>
      {displayed.status === "COMPLETED" ? <p>Kurum yeniden erişime açıldı. {displayed.result?.preservedOwnerCount} kurum sahibi korundu; {displayed.result?.deletedObjectCount} dosya temizlendi. Kurum sahipleri sonraki girişte parolalarını değiştirmelidir.</p> : displayed.status === "BLOCKED" || displayed.status === "FAILED" ? <p>Kurum askıda kalır. Sistem yöneticisi incelemesi gerekiyor; yeni işlem başlatılmaz.</p> : <p>İşlem sürerken kurum yeniden açılamaz.</p>}
    </Alert> : key ? <Alert tone="warning" title="İşlem sonucu bekleniyor">İstek yeniden gönderilmez. Aynı işlem kaydı kontrol ediliyor.</Alert> : null}
    {status.isError ? <Alert tone="warning" title="İşlem kaydı doğrulanamadı">Kayıt henüz bulunamamış olabilir. Yeni temizleme isteği göndermeden tekrar kontrol edin.</Alert> : null}
    {error ? <Alert tone="danger" title="İşlem bilgisi">{error}</Alert> : null}
    <Button variant="secondary" disabled={preview.isFetching || status.isFetching} onClick={() => { void preview.refetch(); if (key || displayed) void status.refetch(); void client.invalidateQueries({ queryKey: ["next-tenant", tenant.id] }); }}>Durumu kontrol et</Button>
    {canStart ? <Button variant="danger" onClick={() => { setConfirmation(""); setCode(""); setError(""); setOpen(true); }}>Temizlemeyi başlat</Button> : null}
    <FormModal open={open} title="Kurum temizliğini onayla" description={`Bu işlem tüm çalışma verilerini temizler. Onay için kurum kodunu aynen yazın: ${tenant.slug}`} onCancel={cancel} onSubmit={(event) => void submit(event)} submitLabel={busy ? "Doğrulanıyor…" : "Temizlemeyi onayla"} submitDisabled={busy || !canStart || confirmation !== tenant.slug || !code.trim()} submitError={error || undefined}>
      <Field label="Kurum kodu onayı"><Input autoComplete="off" disabled={busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
      <Field label="Temizleme gerekçesi"><Select disabled={busy} value={reason} onChange={(event) => setReason(event.target.value as TenantLifecycleReason)}><option value="SECURITY_REVIEW">Güvenlik incelemesi</option><option value="INSTITUTION_REQUEST">Kurum talebi</option><option value="OPERATIONS_REVIEW">Operasyon incelemesi</option></Select></Field>
      <Field label="Doğrulama yöntemi"><Select disabled={busy} value={method} onChange={(event) => { setMethod(event.target.value as "totp" | "recovery"); setCode(""); }}><option value="totp">Doğrulama uygulaması</option><option value="recovery">Yedek kod</option></Select></Field>
      <Field label={method === "totp" ? "Doğrulama kodu" : "Yedek kod"}><Input type="password" autoComplete="one-time-code" disabled={busy} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
    </FormModal>
  </Panel>;
}
