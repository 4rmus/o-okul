"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DataTable, Field, FormModal, Input, LoadingState, Panel, Select, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import type { AuthResponse, TenantCleanResetStatus } from "@o-okul/shared-types";
import { ApiRequestError, apiBaseUrl, authenticatedFetchOnce } from "../../../../src/api-client.js";
import { createPurgeExport, loadPurgeCandidates, loadResetPreview, loadResetStatus, markPurgeExportDelivered, purgeExportChannelLabels, purgeStatusSchema, resetBlockerLabels, startReset, type PurgeCandidate, type PurgeExportChannel } from "../_shared/system-api.js";

// DEC-20261005-03: the list only reports. Each institution is destroyed by a separate, step-up approved request.
const preset = "LICENSE_EXPIRY_PURGE_V1" as const;
const statusLabels: Record<TenantCleanResetStatus["status"], string> = { QUEUED: "Sırada", RUNNING: "Çalışıyor", BLOCKED: "Engellendi", FAILED: "Başarısız", COMPLETED: "İmha edildi", CANCELLED: "İptal edildi (lisans yenilendi)" };
const rejectedCodes = ["TENANT_PURGE_EXPORT_RECEIPT_REQUIRED", "RESET_REQUEST_INVALID", "IDEMPOTENCY_KEY_REQUIRED", "IDEMPOTENCY_KEY_INVALID", "MFA_STEP_UP_REQUIRED", "MFA_STEP_UP_INVALID", "SYSTEM_ADMIN_REQUIRED", "SYSTEM_TENANT_PROTECTED", "TENANT_LIFECYCLE_VERSION_CONFLICT", "RESET_OPERATION_IN_PROGRESS", "RESET_PREFLIGHT_CHANGED", "RESET_REQUIRES_SUSPENDED", "RESET_PREFLIGHT_BLOCKED", "RESET_WRITE_QUIESCENCE_UNVERIFIED", "RESET_CONFIRMATION_MISMATCH", "RESET_TARGET_INVALID", "RESET_LICENSE_NOT_EXPIRED"];
const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });
const countFormat = new Intl.NumberFormat("tr-TR");

export function PurgeCandidatesPanel({ auth }: { auth: AuthResponse }) {
  const candidates = useQuery({ queryKey: ["license-expiry-purge-candidates"], queryFn: () => loadPurgeCandidates(auth.accessToken), retry: false, refetchOnWindowFocus: false });
  const client = useQueryClient();
  const [target, setTarget] = useState<PurgeCandidate | null>(null);
  const [deliveryTarget, setDeliveryTarget] = useState<PurgeCandidate | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  // Product owner decision (2026-10-05): the institution gets its full data before any purge.
  async function exportData(row: PurgeCandidate) {
    setExporting(row.tenantId); setExportError("");
    try {
      const payload = await createPurgeExport(auth.accessToken, row.tenantId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `o-okul-${row.slug}-teslim-${payload.exportedAt.slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch { setExportError("Dışa aktarım oluşturulamadı. Yeniden deneyin."); }
    finally { setExporting(null); void client.invalidateQueries({ queryKey: ["license-expiry-purge-candidates"] }); }
  }
  const columns: Array<DataTableColumn<PurgeCandidate>> = [
    { key: "name", header: "Kurum", priority: "primary", render: (row) => row.name },
    { key: "slug", header: "Kurum kodu", priority: "secondary", render: (row) => row.slug },
    { key: "licenseEndsAt", header: "Lisans bitişi", priority: "optional", render: (row) => dateFormat.format(new Date(row.licenseEndsAt)) },
    { key: "days", header: "Geçen gün", priority: "secondary", render: (row) => countFormat.format(row.daysSinceLicenseEnd) },
    { key: "rows", header: "Tahmini kayıt", priority: "optional", render: (row) => countFormat.format(row.estimatedRowCount) },
    { key: "status", header: "Erişim", priority: "optional", render: (row) => <StatusBadge tone={row.status === "SUSPENDED" ? "warning" : "danger"}>{row.status === "SUSPENDED" ? "Askıda" : "Açık"}</StatusBadge> },
    { key: "export", header: "Veri teslimi", priority: "secondary", render: (row) => row.exportDeliveredOn
      ? <StatusBadge tone="success">{`Teslim edildi · ${dateFormat.format(new Date(`${row.exportDeliveredOn}T12:00:00Z`))}`}</StatusBadge>
      : <StatusBadge tone="warning">{row.exportId ? "Dışa aktarıldı, teslim bekliyor" : "Teslim edilmedi"}</StatusBadge> },
    { key: "actions", header: "İşlem", priority: "primary", render: (row) => <span className="next-row-actions">
      {row.exportDeliveredOn ? null : <Button variant="secondary" aria-label={`${row.name} verisini dışa aktar`} disabled={exporting !== null} onClick={() => void exportData(row)}>{exporting === row.tenantId ? "Hazırlanıyor…" : "Dışa aktar"}</Button>}
      {row.exportId && !row.exportDeliveredOn ? <Button variant="secondary" aria-label={`${row.name} teslimini işaretle`} onClick={() => setDeliveryTarget(row)}>Teslimi işaretle</Button> : null}
      <Button variant="danger" aria-label={`${row.name} imha onayı`} onClick={() => setTarget(row)}>İmha onayı</Button>
    </span> },
  ];
  return <Panel title="İmha adayları" aria-label="İmha adayları" description="Lisansı bittikten 91 gün sonra yeni lisans dönemi almamış kurumlar. Bu liste hiçbir veriyi silmez. İmhadan önce kurumun bütün verisi dışa aktarılıp kuruma teslim edilmeli; her kurum ayrı onayla imha edilir.">
    {candidates.isError ? <Alert tone="danger" title="İmha adayları doğrulanamadı">Liste okunamadı. İmha başlatılamaz.</Alert> : null}
    {exportError ? <Alert tone="danger" title="Dışa aktarım başarısız">{exportError}</Alert> : null}
    <DataTable caption="İmha adayları" description="Kurum adı, lisans bitişi, geçen gün ve tahmini kayıt sayısı; kişisel veri gösterilmez." columns={columns} getRowKey={(row) => row.tenantId} loading={candidates.isPending} rows={candidates.data ?? []} emptyText="İmha adayı kurum yok" />
    {target ? <PurgeApprovalModal key={target.tenantId} auth={auth} candidate={target} onClose={() => setTarget(null)} /> : null}
    {deliveryTarget ? <ExportDeliveryModal key={deliveryTarget.tenantId} auth={auth} candidate={deliveryTarget} onClose={() => setDeliveryTarget(null)} /> : null}
  </Panel>;
}

function ExportDeliveryModal({ auth, candidate, onClose }: { auth: AuthResponse; candidate: PurgeCandidate; onClose(): void }) {
  const client = useQueryClient();
  const [deliveredOn, setDeliveredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [channel, setChannel] = useState<PurgeExportChannel>("SECURE_DOWNLOAD");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!candidate.exportId || busy) return;
    setBusy(true); setError("");
    try {
      await markPurgeExportDelivered(auth.accessToken, candidate.tenantId, candidate.exportId, { deliveredOn, channel, ...(note.trim() ? { note: note.trim() } : {}) });
      await client.invalidateQueries({ queryKey: ["license-expiry-purge-candidates"] });
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiRequestError && failure.code === "TENANT_PURGE_EXPORT_NOTE_INVALID" ? "Not kişisel veri (e-posta, telefon, kimlik numarası) içeremez." : "Teslim kaydı yazılamadı. Bilgileri kontrol edip yeniden deneyin.");
      setBusy(false);
    }
  }
  return <FormModal open title="Veri teslimini işaretle" description={`${candidate.name} kurumuna dışa aktarılan verinin teslim bilgisini kaydedin. Not alanına kişisel veri yazmayın.`}
    onCancel={onClose} onSubmit={(event) => void submit(event)} submitLabel={busy ? "Kaydediliyor…" : "Teslimi kaydet"} submitDisabled={busy || !deliveredOn} submitError={error || undefined}>
    <Field label="Teslim tarihi"><Input type="date" required value={deliveredOn} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDeliveredOn(event.target.value)} /></Field>
    <Field label="Teslim kanalı"><Select value={channel} onChange={(event) => setChannel(event.target.value as PurgeExportChannel)}>{Object.entries(purgeExportChannelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
    <Field label="Not (isteğe bağlı)"><Input autoComplete="off" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
  </FormModal>;
}

function PurgeApprovalModal({ auth, candidate, onClose }: { auth: AuthResponse; candidate: PurgeCandidate; onClose(): void }) {
  const client = useQueryClient();
  const expectedActor = { userId: auth.session.userId, sessionId: auth.session.id, membershipVersion: auth.session.membershipVersion };
  const preview = useQuery({ queryKey: ["license-expiry-purge-preview", candidate.tenantId], queryFn: () => loadResetPreview(auth.accessToken, candidate.tenantId, preset), staleTime: 0, retry: false });
  const [confirmation, setConfirmation] = useState("");
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [operation, setOperation] = useState<TenantCleanResetStatus | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const data = preview.data;
  const deletedRows = data ? data.categories.reduce((sum, row) => sum + row.deleted, 0) : 0;
  const ready = Boolean(data?.allowed && data.blockers.length === 0 && data.lifecycleVersion === candidate.lifecycleVersion) && candidate.status === "SUSPENDED";
  const canSubmit = ready && !busy && !key && confirmation === candidate.slug && Boolean(code.trim());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !data) return;
    setBusy(true); setError("");
    try {
      const target = { tenantId: candidate.tenantId, preset, expectedLifecycleVersion: data.lifecycleVersion, preflightDigest: data.preflightDigest };
      const response = await authenticatedFetchOnce(auth.accessToken, expectedActor, `${apiBaseUrl}/auth/step-up`, { method: "POST", headers: { authorization: `Bearer ${auth.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ purpose: "TENANT_CLEAN_RESET", target, ...(method === "totp" ? { totpCode: code } : { recoveryCode: code }) }) });
      const proof: unknown = response.ok ? (await response.json()).data : null;
      setCode("");
      if (!proof || typeof proof !== "object" || !("stepUpToken" in proof) || typeof proof.stepUpToken !== "string" || !proof.stepUpToken) throw new Error("MFA");
      const requestKey = crypto.randomUUID();
      setKey(requestKey);
      try {
        const result = await startReset(auth.accessToken, expectedActor, candidate.tenantId, { preset, expectedLifecycleVersion: data.lifecycleVersion, preflightDigest: data.preflightDigest, confirmationText: confirmation, reason: "LICENSE_EXPIRED" }, requestKey, proof.stepUpToken, purgeStatusSchema);
        if (mounted.current) setOperation(result);
        void client.invalidateQueries({ queryKey: ["license-expiry-purge-candidates"] });
      } catch (failure) {
        if (!mounted.current) return;
        if (failure instanceof ApiRequestError && rejectedCodes.includes(failure.code ?? "")) {
          setKey(null);
          setError(failure.code === "RESET_LICENSE_NOT_EXPIRED" ? "Kurumun lisans durumu değişti; imha reddedildi." : failure.code === "TENANT_PURGE_EXPORT_RECEIPT_REQUIRED" ? "Kuruma teslim edilmiş veri dışa aktarımı yok; imha reddedildi." : "İstek kabul edilmedi. Güncel bilgileri kontrol edip yeniden onaylayın.");
          void preview.refetch();
        } else setError("İşlem sonucu doğrulanamadı. Yeni istek gönderilmez; durumu kontrol edin.");
      }
    } catch {
      if (mounted.current) { setCode(""); setError("İkinci doğrulama tamamlanamadı. Kodu kontrol edip yeniden deneyin."); }
    } finally { if (mounted.current) setBusy(false); }
  }
  async function checkStatus() {
    if (!key) return;
    try { setOperation(await loadResetStatus(auth.accessToken, candidate.tenantId, key, undefined, purgeStatusSchema)); setError(""); }
    catch { setError("İşlem kaydı henüz doğrulanamadı."); }
  }

  return <FormModal open title="Kurum verisini imha et" description={`Bu işlem geri alınamaz. ${candidate.name} kurumunun tüm verileri, dosyaları ve denetim kayıtları silinir; yalnız kişisel veri içermeyen bir imha makbuzu kalır. Onay için kurum kodunu aynen yazın: ${candidate.slug}`}
    onCancel={onClose} onSubmit={(event) => void submit(event)} submitLabel={busy ? "Doğrulanıyor…" : "İmhayı onayla"} submitDisabled={!canSubmit} submitError={error || undefined}>
    {preview.isPending ? <LoadingState label="İmha ön kontrolü yükleniyor…" /> : null}
    {preview.isError ? <Alert tone="danger" title="Ön kontrol doğrulanamadı">İmha başlatılamaz.</Alert> : null}
    {data ? <p>Silinecek kayıt: {countFormat.format(deletedRows)} · Silinecek dosya: {countFormat.format(data.objectCount)}</p> : null}
    {candidate.status !== "SUSPENDED" ? <Alert tone="info" title="Önce kurumu askıya alın">İmha yalnız askıdaki kurumda başlatılır.</Alert> : null}
    {data?.blockerCounts.length ? <Alert tone="warning" title="İmha engelleri"><ul>{data.blockerCounts.map((row) => <li key={row.code}>{resetBlockerLabels[row.code]}{row.count === null ? "" : ` · ${row.count}`}</li>)}</ul></Alert> : null}
    {operation ? <Alert tone={operation.status === "COMPLETED" ? "success" : operation.status === "FAILED" || operation.status === "BLOCKED" ? "danger" : "info"} title={`İmha: ${statusLabels[operation.status]}`}>{operation.status === "COMPLETED" ? `${countFormat.format(operation.result?.deletedObjectCount ?? 0)} dosya silindi; imha makbuzu yazıldı.` : "İşlem kaydı izleniyor."}</Alert> : null}
    {key && !operation ? <Button variant="secondary" onClick={() => void checkStatus()}>Durumu kontrol et</Button> : null}
    <Field label="Kurum kodu onayı"><Input autoComplete="off" disabled={busy || Boolean(key)} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
    <Field label="Doğrulama yöntemi"><Select disabled={busy || Boolean(key)} value={method} onChange={(event) => { setMethod(event.target.value as "totp" | "recovery"); setCode(""); }}><option value="totp">Doğrulama uygulaması</option><option value="recovery">Yedek kod</option></Select></Field>
    <Field label={method === "totp" ? "Doğrulama kodu" : "Yedek kod"}><Input type="password" autoComplete="one-time-code" disabled={busy || Boolean(key)} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
  </FormModal>;
}
