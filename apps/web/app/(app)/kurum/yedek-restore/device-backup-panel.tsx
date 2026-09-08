"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Input, Panel } from "@o-okul/ui";
import type { TenantDeviceBackupPreview } from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetchOnce } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";

export function DeviceBackupPanel() {
  const { auth } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [uploadPassword, setUploadPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<TenantDeviceBackupPreview | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const allowed = Boolean(auth?.session.roles.some(role => ["TENANT_OWNER", "TENANT_ADMIN"].includes(role)));
  const status = useQuery({ queryKey: ["device-backup-status", auth?.session.tenantId, auth?.session.id], enabled: allowed, queryFn: () => apiRequest<{ available: boolean; maxFileBytes: number }>(auth!.accessToken, `${apiBaseUrl}/device-backups/status`), retry: false });
  if (!auth || !allowed) return null;
  const enabled = status.data?.available === true;
  async function submit(event: FormEvent, mode: "download" | "preview") {
    event.preventDefault(); if (!auth || pending || !enabled) return;
    setError(""); setNotice(""); setPreview(null);
    if (mode === "download" && password !== confirmation) { setError("Yedek parolaları eşleşmiyor."); return; }
    if (mode === "preview" && (!file || file.size > (status.data?.maxFileBytes ?? 0))) { setError("Geçerli bir yedek dosyası seçin. Bu sürümün dosya sınırı yaklaşık 32 MB."); return; }
    const controller = new AbortController(); request.current = controller; setPending(true);
    try {
      const body = new FormData();
      if (mode === "preview") { body.append("password", uploadPassword); body.append("file", file!); }
      const response = await authenticatedFetchOnce(auth.accessToken, { userId: auth.session.userId, sessionId: auth.session.id, membershipVersion: auth.session.membershipVersion }, `${apiBaseUrl}/device-backups/${mode}`, { method: "POST", signal: controller.signal, ...(mode === "download" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) } : { body }) });
      if (!response.ok) {
        if (response.status === 413) throw new Error("Yedek bu sürümün 32 MB sınırını aşıyor; eksik bir paket hazırlanmadı.");
        if (response.status === 503) throw new Error("Yedekleme şu an hazır değil veya başka bir işlem sürüyor. Daha sonra tekrar deneyin.");
        if (response.status === 401 || response.status === 403) throw new Error("Oturum veya yedekleme yetkisi doğrulanamadı. Yeniden giriş yapın.");
        if (response.status === 409) throw new Error("Hazırlık sırasında kurum verileri değişti. Yeniden deneyin.");
        throw new Error("Dosya veya yedek parolası doğrulanamadı. Aynı kuruma ait, değiştirilmemiş bir yedek seçin.");
      }
      if (mode === "download") {
        const blob = await response.blob(); if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = `o-okul-${new Date().toISOString().slice(0,10)}.ookulbackup`;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("İndirme başlatıldı. Dosyanın cihazına kaydedildiğini kontrol et; yedek parolanı ayrı ve güvenli bir yerde sakla.");
      } else {
        const value = await response.json() as TenantDeviceBackupPreview | { data: TenantDeviceBackupPreview };
        if (!controller.signal.aborted) setPreview("data" in value ? value.data : value);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Yedek işlemi tamamlanamadı."); }
    finally { if (!controller.signal.aborted) { setPending(false); setPassword(""); setConfirmation(""); setUploadPassword(""); } }
  }
  return <Panel title="Cihazımda Şifreli Yedek" aria-label="Cihazda şifreli kurum yedeği" description="Kurum kayıtlarını ve bağlı dosyaları tek bir parola korumalı pakette sakla. Yüklemek kurum verilerini değiştirmez.">
    {status.isPending ? <p role="status">Yedekleme kullanılabilirliği kontrol ediliyor.</p> : !enabled ? <p role="status">Güvenli cihaz yedeği henüz etkinleştirilmedi. Mevcut JSON dışa aktarımı, tam geri yükleme paketi değildir.</p> : null}
    <form onSubmit={event => void submit(event, "download")} aria-label="Şifreli yedeği indir">
      <Field label="Yeni yedek parolası"><Input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={!enabled || pending} /></Field>
      <Field label="Yedek parolasını tekrar yaz"><Input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={!enabled || pending} /></Field>
      <p>En az 12 karakter kullan. Parola kaybolursa bu yedeği açamayabilirsin. İlk sürümün paket sınırı 32 MB; büyük kurumlar için eksik yedek üretilmez.</p>
      <Button type="submit" disabled={!enabled || pending}>{pending ? "İşlem sürüyor" : "Şifreli yedeği indir"}</Button>
    </form>
    <form onSubmit={event => void submit(event, "preview")} aria-label="Yedeği yükle ve doğrula">
      <Field label="Cihazımdaki yedek dosyası"><Input type="file" accept=".ookulbackup" required onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} disabled={!enabled || pending} /></Field>
      <Field label="Dosyanın yedek parolası"><Input type="password" autoComplete="off" required minLength={12} maxLength={128} value={uploadPassword} onChange={event => setUploadPassword(event.target.value)} disabled={!enabled || pending} /></Field>
      <Button type="submit" disabled={!enabled || pending}>Yedeği yükle ve doğrula</Button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {preview ? <div role="status">
      <p>Bu kuruma ait paket bütünlüğü doğrulandı. Yedek tarihi: {new Date(preview.createdAt).toLocaleString("tr-TR")}</p>
      <p>{Object.values(preview.tableCounts).reduce((sum,count) => sum+count,0)} kayıt ve {preview.fileCount} dosya.</p>
      <p>{preview.schemaCompatible ? "Veri sürümü eşleşiyor." : "Bu yedeğin veri sürümü mevcut kurumla uyumlu değil."}</p>
      <p>Henüz izole geri yükleme provası yapılmadı. Kurum verilerine uygulama kapalı; hiçbir kayıt değiştirilmedi.</p>
    </div> : null}
  </Panel>;
}
