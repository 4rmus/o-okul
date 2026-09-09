"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Panel } from "@o-okul/ui";
import type { AuthResponse } from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetchOnce } from "../../../../src/api-client.js";
import { institutionResetRequestStateSchema } from "../../../../src/tenant-reset-request.js";

export function ResetRequestPanel({ auth }: { auth: AuthResponse }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["institution-reset-request", auth.session.tenantId, auth.session.userId], queryFn: async () => {
    const state = institutionResetRequestStateSchema.parse(await apiRequest<unknown>(auth.accessToken, `${apiBaseUrl}/tenants/current/reset-request`));
    if (state.request && state.request.tenantId !== auth.session.tenantId) throw new Error("REQUEST_SCOPE_INVALID");
    return state;
  }, retry: false });
  const request = query.data?.request;
  async function change(revoke: boolean) {
    if (busy || !query.data || query.isFetching || query.isError || (!revoke && !confirmed)) return;
    setBusy(true); setError("");
    try {
      const response = await authenticatedFetchOnce(auth.accessToken, { userId: auth.session.userId, sessionId: auth.session.id, membershipVersion: auth.session.membershipVersion }, `${apiBaseUrl}/tenants/current/reset-request${revoke ? "/revoke" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRequestId: request?.id ?? null, ...(!revoke ? { preset: "CLEAN_SETUP_V1" } : {}) }) });
      if (!response.ok) throw new Error("REQUEST_FAILED");
      setConfirmed(false);
    } catch { setError("Talep sonucu doğrulanamadı. Tekrar göndermeden kayıt durumunu kontrol edin."); }
    finally { await query.refetch(); setBusy(false); }
  }
  const stateLabels = { PENDING: "Sistem yöneticisi değerlendirmesi bekleniyor", REVOKED: "Talep geri çekildi", ACCEPTED: "Talep işleme alındı; geri çekilemez", COMPLETED: "Önceki yenileme tamamlandı" };
  return <Panel title="Kurum yenileme talebi">
    <p>Çalışma verilerinizin temizlenip kurumun yeniden kurulması için sistem yöneticisine talep gönderin. Kurum ve lisans geçmişi korunur. Bu talep tek başına veri silmez.</p>
    {request ? <p>{stateLabels[request.status]} · Talep: {request.id}</p> : null}
    {query.isError || error ? <Alert tone="warning" title="Talep bilgisi">{error || "Talep kaydı alınamadı."}</Alert> : null}
    {query.data && !query.isError && request?.status !== "PENDING" && request?.status !== "ACCEPTED" ? <>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /> Kurumumun çalışma verilerinin temizlenmesini talep ediyorum.</label>
      <Button disabled={!confirmed || busy || query.isFetching} onClick={() => void change(false)}>Yenileme talebi gönder</Button>
    </> : null}
    {request?.status === "PENDING" ? <Button variant="secondary" disabled={busy || query.isFetching || query.isError} onClick={() => void change(true)}>Talebi geri çek</Button> : null}
    <Button variant="secondary" disabled={busy || query.isFetching} onClick={() => { setError(""); void query.refetch(); }}>Talep durumunu kontrol et</Button>
  </Panel>;
}
