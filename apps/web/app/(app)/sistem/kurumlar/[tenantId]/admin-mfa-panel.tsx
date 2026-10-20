"use client";

import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, DataTable, Field, FormModal, Input, Panel, Select, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import type { AuthResponse } from "@o-okul/shared-types";
import { ApiRequestError } from "../../../../../src/api-client.js";
import { createLifecycleStepUp, loadTenantAdminAccounts, resetTenantAdminMfa, type TenantAdminAccount } from "../../_shared/system-api.js";

// KV-9b (staging UAT F-04): a tenant owner/admin who lost their phone is helped from this screen.
const roleLabels = { TENANT_OWNER: "Kurum sahibi", TENANT_ADMIN: "Kurum yöneticisi" } as const;
const resetErrors: Record<string, string> = {
  MFA_NOT_ENABLED: "Bu hesapta MFA zaten kapalı.",
  MFA_RESET_TARGET_STALE: "Hesap bilgisi değişmiş. Listeyi yenileyip tekrar deneyin.",
  MFA_STEP_UP_INVALID: "Doğrulama kodunuz geçersiz veya süresi dolmuş.",
  MFA_STEP_UP_REQUIRED: "Doğrulama kodunuz geçersiz veya süresi dolmuş.",
  MFA_RESET_TARGET_NOT_FOUND: "Hesap bulunamadı veya artık kurum sahibi/yöneticisi değil.",
};
const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });

export function AdminMfaPanel({ auth, tenantId }: { auth: AuthResponse; tenantId: string }) {
  const accounts = useQuery({ queryKey: ["system-tenant-admin-accounts", tenantId, auth.session.id], queryFn: () => loadTenantAdminAccounts(auth.accessToken, tenantId), retry: false, refetchOnWindowFocus: false });
  const [target, setTarget] = useState<TenantAdminAccount | null>(null);
  const [notice, setNotice] = useState("");
  const columns: Array<DataTableColumn<TenantAdminAccount>> = [
    { key: "name", header: "Ad", priority: "primary", render: (row) => row.name },
    { key: "email", header: "E-posta (maskeli)", priority: "secondary", render: (row) => row.emailMasked ?? "-" },
    { key: "roles", header: "Rol", priority: "secondary", render: (row) => row.roles.map((role) => roleLabels[role]).join(", ") },
    { key: "mfa", header: "MFA durumu", priority: "primary", render: (row) => row.mfaEnabled
      ? <StatusBadge tone="success">{row.mfaEnabledAt ? `Açık · ${dateFormat.format(new Date(row.mfaEnabledAt))}` : "Açık"}</StatusBadge>
      : <StatusBadge tone="neutral">Kapalı</StatusBadge> },
    { key: "actions", header: "İşlem", priority: "primary", render: (row) => row.mfaEnabled
      ? <Button variant="danger" aria-label={`${row.name} için MFA'yı sıfırla`} onClick={() => { setNotice(""); setTarget(row); }}>MFA&apos;yı sıfırla</Button>
      : null },
  ];
  return <Panel title="Yönetici hesapları ve MFA" aria-label="Yönetici hesapları ve MFA" description="Kurum sahibi ve yöneticilerinin iki aşamalı doğrulama durumu. Telefonunu kaybeden yetkilinin MFA kaydı buradan sıfırlanır.">
    {accounts.isError ? <Alert tone="danger" title="Yönetici hesapları alınamadı">Liste okunamadı. Sayfayı yenileyip tekrar deneyin.</Alert> : null}
    {notice ? <Alert tone="success" title="MFA sıfırlandı">{notice}</Alert> : null}
    <DataTable caption="Yönetici hesapları" description="Ad, maskeli e-posta, rol ve MFA durumu." columns={columns} getRowKey={(row) => row.userId} loading={accounts.isPending} rows={accounts.data ?? []} emptyText="Kurum sahibi veya yöneticisi hesabı yok" />
    {target ? <AdminMfaResetModal key={target.userId} auth={auth} tenantId={tenantId} account={target} onClose={() => setTarget(null)}
      onDone={async () => { setTarget(null); setNotice(`${target.name} için MFA sıfırlandı; açık oturumları kapatıldı.`); await accounts.refetch(); }} /> : null}
  </Panel>;
}

function AdminMfaResetModal({ auth, tenantId, account, onClose, onDone }: { auth: AuthResponse; tenantId: string; account: TenantAdminAccount; onClose(): void; onDone(): Promise<void> }) {
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true); setError("");
    try {
      const proof = await createLifecycleStepUp(auth.accessToken, { purpose: "OWNER_ADMIN_CHANGE", target: { tenantId, userId: account.userId }, ...(method === "totp" ? { totpCode: code } : { recoveryCode: code }) });
      setCode("");
      if (proof.purpose !== "OWNER_ADMIN_CHANGE" || !proof.stepUpToken) throw new ApiRequestError("MFA", 401, "MFA_STEP_UP_INVALID");
      await resetTenantAdminMfa(auth.accessToken, { userId: auth.session.userId, sessionId: auth.session.id, membershipVersion: auth.session.membershipVersion }, tenantId, account.userId, proof.stepUpToken);
      await onDone();
    } catch (failure) {
      setCode("");
      const code = failure instanceof ApiRequestError ? failure.code ?? "" : "";
      setError(resetErrors[code] ?? (failure instanceof ApiRequestError && failure.status === 401 ? resetErrors.MFA_STEP_UP_INVALID! : "MFA sıfırlanamadı. Tekrar deneyin."));
      setBusy(false);
    }
  }
  return <FormModal open title="MFA'yı sıfırla" description={`${account.name} (${account.emailMasked ?? "e-posta yok"}) hesabının MFA kaydı silinir. Kişinin bütün açık oturumları kapatılır; bir sonraki girişte MFA'yı yeniden kurması gerekir. Onay için kendi doğrulama kodunuzu girin.`}
    cancelLabel="Vazgeç" onCancel={onClose} onSubmit={(event) => void submit(event)} submitting={busy} submitLabel="MFA'yı sıfırla" submitDisabled={busy || !code.trim()} submitError={error || undefined}>
    <Field label="Doğrulama yöntemi"><Select disabled={busy} value={method} onChange={(event) => { setMethod(event.target.value as "totp" | "recovery"); setCode(""); }}><option value="totp">Doğrulama uygulaması</option><option value="recovery">Yedek kod</option></Select></Field>
    <Field label={method === "totp" ? "Doğrulama kodu" : "Yedek kod"}><Input type="password" autoComplete="one-time-code" disabled={busy} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
  </FormModal>;
}
