"use client";

import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { Alert, Button, DataTable, Dialog, Field, FormModal, Input, Panel, Select, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import type { AuthResponse } from "@o-okul/shared-types";
import { ApiRequestError } from "../../../../../src/api-client.js";
import { createLifecycleStepUp, loadTenantAdminAccounts, resetTenantAdminMfa, type TenantAdminAccount, type TenantAdminMfaReset } from "../../_shared/system-api.js";

// KV-9b (staging UAT F-04): a tenant owner/admin who lost their phone is helped from this screen.
// DEC-20261021-01: the reset returns a one-time re-enrollment code, shown here once and read to the person by phone.
const roleLabels = { TENANT_OWNER: "Kurum sahibi", TENANT_ADMIN: "Kurum yöneticisi" } as const;
const resetErrors: Record<string, string> = {
  MFA_NOT_ENABLED: "Bu hesapta MFA zaten kapalı.",
  MFA_RESET_TARGET_STALE: "Hesap bilgisi değişmiş. Listeyi yenileyip tekrar deneyin.",
  MFA_STEP_UP_INVALID: "Doğrulama kodunuz geçersiz veya süresi dolmuş.",
  MFA_STEP_UP_REQUIRED: "Doğrulama kodunuz geçersiz veya süresi dolmuş.",
  MFA_RESET_TARGET_NOT_FOUND: "Hesap bulunamadı veya artık kurum sahibi/yöneticisi değil.",
};
const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });
const dateTimeFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

interface IssuedCode extends TenantAdminMfaReset { name: string }

export function AdminMfaPanel({ auth, tenantId }: { auth: AuthResponse; tenantId: string }) {
  const accounts = useQuery({ queryKey: ["system-tenant-admin-accounts", tenantId, auth.session.id], queryFn: () => loadTenantAdminAccounts(auth.accessToken, tenantId), retry: false, refetchOnWindowFocus: false });
  const [target, setTarget] = useState<TenantAdminAccount | null>(null);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const columns: Array<DataTableColumn<TenantAdminAccount>> = [
    { key: "name", header: "Ad", priority: "primary", render: (row) => row.name },
    { key: "email", header: "E-posta (maskeli)", priority: "secondary", render: (row) => row.emailMasked ?? "-" },
    { key: "roles", header: "Rol", priority: "secondary", render: (row) => row.roles.map((role) => roleLabels[role]).join(", ") },
    { key: "mfa", header: "MFA durumu", priority: "primary", render: (row) => <MfaStatus account={row} /> },
    { key: "actions", header: "İşlem", priority: "primary", render: (row) => row.mfaEnabled
      ? <Button variant="danger" aria-label={`${row.name} için MFA'yı sıfırla`} onClick={() => setTarget(row)}>MFA&apos;yı sıfırla</Button>
      : row.mfaReenrollmentPending
        ? <Button variant="secondary" aria-label={`${row.name} için yeni kayıt kodu üret`} onClick={() => setTarget(row)}>Yeni kod üret</Button>
        : null },
  ];
  return <Panel title="Yönetici hesapları ve MFA" aria-label="Yönetici hesapları ve MFA" description="Kurum sahibi ve yöneticilerinin iki aşamalı doğrulama durumu. Telefonunu kaybeden yetkilinin MFA kaydı buradan sıfırlanır.">
    {accounts.isError ? <Alert tone="danger" title="Yönetici hesapları alınamadı">Liste okunamadı. Sayfayı yenileyip tekrar deneyin.</Alert> : null}
    <DataTable caption="Yönetici hesapları" description="Ad, maskeli e-posta, rol ve MFA durumu." columns={columns} getRowKey={(row) => row.userId} loading={accounts.isPending} rows={accounts.data ?? []} emptyText="Kurum sahibi veya yöneticisi hesabı yok" />
    {target ? <AdminMfaResetModal key={target.userId} auth={auth} tenantId={tenantId} account={target} onClose={() => setTarget(null)}
      onDone={async (result) => { setIssued({ ...result, name: target.name }); setTarget(null); await accounts.refetch(); }} /> : null}
    <ReenrollmentCodeDialog issued={issued} onClose={() => setIssued(null)} />
  </Panel>;
}

function MfaStatus({ account }: { account: TenantAdminAccount }) {
  if (account.mfaEnabled) return <StatusBadge tone="success">{account.mfaEnabledAt ? `Açık · ${dateFormat.format(new Date(account.mfaEnabledAt))}` : "Açık"}</StatusBadge>;
  if (account.mfaReenrollmentPending && account.mfaReenrollmentExpiresAt) {
    return Date.parse(account.mfaReenrollmentExpiresAt) > Date.now()
      ? <StatusBadge tone="warning">{`Yeniden kayıt bekleniyor · son ${dateTimeFormat.format(new Date(account.mfaReenrollmentExpiresAt))}`}</StatusBadge>
      : <StatusBadge tone="danger">Kayıt kodunun süresi doldu</StatusBadge>;
  }
  return <StatusBadge tone="neutral">Kapalı</StatusBadge>;
}

function ReenrollmentCodeDialog({ issued, onClose }: { issued: IssuedCode | null; onClose(): void }) {
  const [copyStatus, setCopyStatus] = useState("");
  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.reenrollmentCode);
      setCopyStatus("Kod panoya kopyalandı.");
    } catch {
      setCopyStatus("Kod panoya kopyalanamadı; ekrandan okuyun.");
    }
  }
  return <Dialog open={Boolean(issued)} onClose={() => { setCopyStatus(""); onClose(); }} title="Tek kullanımlık kayıt kodu"
    description="Bu kod yalnız bu kez gösterilir; pencereyi kapattıktan sonra yeniden görüntülenemez. Gerekirse yeni kod üretin."
    footer={<Button type="button" onClick={() => { setCopyStatus(""); onClose(); }}>Kodu ilettim, kapat</Button>}>
    {issued ? <div className="next-form">
      <Alert tone="success" title="Kayıt kodu üretildi">{`${issued.name} için MFA kaydı kapalı ve açık oturumları kapatıldı; önceki kodlar geçersiz.`}</Alert>
      <Field label="Kayıt kodu" description={`Son geçerlilik: ${dateTimeFormat.format(new Date(issued.reenrollmentExpiresAt))} (24 saat).`}>
        <Input readOnly value={issued.reenrollmentCode} />
      </Field>
      <p className="next-status-note">
        Kodu e-posta, SMS veya mesajla göndermeyin. Kurumun sistemde kayıtlı telefon numarasını siz arayın, kişiyi doğrulayın ve kodu
        sözlü okuyun. Kişi bir sonraki girişte doğrulama uygulamasını kurarken bu kodu girer.
      </p>
      <p className="next-status-note">{issued.notificationQueued
        ? "Kişinin kayıtlı e-posta adresine sıfırlama bildirimi gönderilmek üzere sıraya alındı (kod e-postada yer almaz)."
        : "Kişinin kayıtlı e-posta adresi olmadığı veya bildirim sıraya alınamadığı için e-posta bildirimi gönderilmedi."}</p>
      <Button type="button" variant="secondary" onClick={() => void copy()}>
        <Copy size={17} aria-hidden="true" />
        Kodu kopyala
      </Button>
      {copyStatus ? <p className="next-status-note" role="status">{copyStatus}</p> : null}
    </div> : null}
  </Dialog>;
}

function AdminMfaResetModal({ auth, tenantId, account, onClose, onDone }: { auth: AuthResponse; tenantId: string; account: TenantAdminAccount; onClose(): void; onDone(result: TenantAdminMfaReset): Promise<void> }) {
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reissue = !account.mfaEnabled;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true); setError("");
    try {
      const proof = await createLifecycleStepUp(auth.accessToken, { purpose: "OWNER_ADMIN_CHANGE", target: { tenantId, userId: account.userId }, ...(method === "totp" ? { totpCode: code } : { recoveryCode: code }) });
      setCode("");
      if (proof.purpose !== "OWNER_ADMIN_CHANGE" || !proof.stepUpToken) throw new ApiRequestError("MFA", 401, "MFA_STEP_UP_INVALID");
      const result = await resetTenantAdminMfa(auth.accessToken, { userId: auth.session.userId, sessionId: auth.session.id, membershipVersion: auth.session.membershipVersion }, tenantId, account.userId, proof.stepUpToken);
      await onDone(result);
    } catch (failure) {
      setCode("");
      const code = failure instanceof ApiRequestError ? failure.code ?? "" : "";
      setError(resetErrors[code] ?? (failure instanceof ApiRequestError && failure.status === 401 ? resetErrors.MFA_STEP_UP_INVALID! : "MFA sıfırlanamadı. Tekrar deneyin."));
      setBusy(false);
    }
  }
  const subject = `${account.name} (${account.emailMasked ?? "e-posta yok"})`;
  return <FormModal open title={reissue ? "Yeni kayıt kodu üret" : "MFA'yı sıfırla"}
    description={reissue
      ? `${subject} hesabı için yeni bir tek kullanımlık kayıt kodu üretilir; önceki kod geçersiz olur ve kod 24 saat geçerlidir. Onay için kendi doğrulama kodunuzu girin.`
      : `${subject} hesabının MFA kaydı silinir ve bütün açık oturumları kapatılır. Kişi yeniden kurarken sizin telefonla ileteceğiniz tek kullanımlık kodu girer; kod 24 saat geçerlidir. Onay için kendi doğrulama kodunuzu girin.`}
    cancelLabel="Vazgeç" onCancel={onClose} onSubmit={(event) => void submit(event)} submitting={busy} submitLabel={reissue ? "Yeni kod üret" : "MFA'yı sıfırla"} submitDisabled={busy || !code.trim()} submitError={error || undefined}>
    <Field label="Doğrulama yöntemi"><Select disabled={busy} value={method} onChange={(event) => { setMethod(event.target.value as "totp" | "recovery"); setCode(""); }}><option value="totp">Doğrulama uygulaması</option><option value="recovery">Yedek kod</option></Select></Field>
    <Field label={method === "totp" ? "Doğrulama kodu" : "Yedek kod"}><Input type="password" autoComplete="one-time-code" disabled={busy} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
  </FormModal>;
}
