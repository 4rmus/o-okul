"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Input, Panel } from "@o-okul/ui";
import type { TenantDeviceBackupPreview, TenantDeviceRestoreOperation } from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetchOnce } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";

const impactMessages: Record<string,string> = {
  DEVICE_RESTORE_PLAN_SOURCE_UNVERIFIED: "Plan için gerekli kaynak bilgileri eksiksiz doğrulanamadı.",
  DEVICE_RESTORE_DOMAIN_LINK_CONFLICT: "Kimlik veya gönderim kayıtlarının bağlı olduğu bilgiler değişiyor.",
  DEVICE_RESTORE_DOMAIN_LINK_UNVERIFIED: "Bazı kimlik ve gönderim bağları henüz doğrulanamadı.",
  DEVICE_RESTORE_DELIVERIES_UNRESOLVED: "Bekleyen veya sonucu belirsiz gönderimler sonuçlandırılmalı.",
  DEVICE_RESTORE_REFERENCE_CONFLICT: "Bazı kayıtların bağlı olduğu kayıtlar geri yükleme planında bulunmuyor.",
  DEVICE_RESTORE_FOREIGN_KEYS_UNVERIFIED: "Bazı veritabanı ilişkileri henüz doğrulanamadı.",
  DEVICE_RESTORE_DOMAIN_REFERENCES_UNVERIFIED: "Veritabanı ilişkileri dışında kalan iş kuralları ayrıca incelenmeli.",
  DEVICE_RESTORE_WORK_QUIESCENCE_UNVERIFIED: "Devam eden işler ve gönderimler kontrol edilmeli.",
  DEVICE_RESTORE_FILES_UNVERIFIED: "Mevcut dosyaların korunacağı doğrulanmalı.",
  DEVICE_RESTORE_FINANCE_DIFFERENCE: "Finans geçmişi farklı; mevcut finans kayıtları korunacak.",
  DEVICE_RESTORE_CONSENT_DIFFERENCE: "İletişim izinleri farklı; eski izinler yeniden açılmayacak.",
  DEVICE_RESTORE_SUPPORT_DIFFERENCE: "Destek geçmişi farklı; mevcut destek kayıtları korunacak.",
  DEVICE_RESTORE_DELIVERY_HISTORY_DIFFERENCE: "Gönderim geçmişi farklı; eski gönderimler tekrarlanmayacak.",
  DEVICE_RESTORE_IDENTITY_RECONCILIATION_REQUIRED: "Hesap kayıtları ayrıca uzlaştırılmalı.",
  DEVICE_RESTORE_ACCOUNT_LINK_CHANGE: "Öğrenci veya personel hesap bağlantıları değişiyor.",
  DEVICE_RESTORE_PROTECTED_DEPENDENCIES_UNVERIFIED: "Korunan geçmişin bağlı olduğu kayıtlar ayrıca incelenmeli.",
  DEVICE_RESTORE_CURRENT_LICENSE_UNVERIFIED: "Geçerli lisans ve öğrenci sınırı doğrulanamadı.",
  DEVICE_RESTORE_STUDENT_LIMIT_EXCEEDED: "Yedekteki aktif öğrenci sayısı mevcut sınırı aşıyor.",
  DEVICE_RESTORE_ENROLLMENT_CONFLICT: "Bir öğrenci için birden fazla açık aktif kayıt var.",
  DEVICE_RESTORE_POLICY_UNCLASSIFIED: "Bazı veriler için geri yükleme kuralı henüz tanımlanmamış.",
};

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
  const restoreKey=useRef<string|null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const allowed = Boolean(auth?.session.roles.some(role => ["TENANT_OWNER", "TENANT_ADMIN"].includes(role)));
  const status = useQuery({ queryKey: ["device-backup-status", auth?.session.tenantId, auth?.session.id], enabled: allowed, queryFn: () => apiRequest<{ available: boolean; maxFileBytes: number; restoreAvailable?:boolean }>(auth!.accessToken, `${apiBaseUrl}/device-backups/status`), retry: false });
  const restore=useQuery({queryKey:["device-restore",auth?.session.tenantId,auth?.session.id],enabled:allowed&&status.data?.restoreAvailable===true,queryFn:()=>apiRequest<{available:boolean;operation:TenantDeviceRestoreOperation|null}>(auth!.accessToken,`${apiBaseUrl}/device-restores/current`),retry:false});
  if (!auth || !allowed) return null;
  const enabled = status.data?.available === true;
  async function submit(event: FormEvent, mode: "download" | "preview") {
    event.preventDefault(); if (!auth || pending || !enabled) return;
    const planToken = mode === "preview" ? preview?.plan?.token : undefined;
    setError(""); setNotice(""); setPreview(null);
    if (mode === "download" && password !== confirmation) { setError("Yedek parolaları eşleşmiyor."); return; }
    if (mode === "preview" && (!file || file.size > (status.data?.maxFileBytes ?? 0))) { setError("Geçerli bir yedek dosyası seçin. Bu sürümün dosya sınırı yaklaşık 32 MB."); return; }
    const controller = new AbortController(); request.current = controller; setPending(true);
    try {
      const body = new FormData();
      if (mode === "preview") { body.append("password", uploadPassword); body.append("file", file!); if (planToken) body.append("planToken", planToken); }
      const response = await authenticatedFetchOnce(auth.accessToken, { userId: auth.session.userId, sessionId: auth.session.id, membershipVersion: auth.session.membershipVersion }, `${apiBaseUrl}/device-backups/${mode}`, { method: "POST", signal: controller.signal, ...(mode === "download" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) } : { body }) });
      if (!response.ok) {
        if (response.status === 413) throw new Error("Yedek bu sürümün 32 MB sınırını aşıyor; eksik bir paket hazırlanmadı.");
        if (response.status === 503) throw new Error("Yedekleme şu an hazır değil veya başka bir işlem sürüyor. Daha sonra tekrar deneyin.");
        if (response.status === 401 || response.status === 403) throw new Error("Oturum veya yedekleme yetkisi doğrulanamadı. Yeniden giriş yapın.");
        if (response.status === 409) throw new Error("Planın süresi dolmuş veya kaynak bilgileri değişmiş olabilir. Yeni önizleme oluşturun.");
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
  async function requestRestore(event:FormEvent){
    event.preventDefault();if(!auth||!file||!preview?.plan||pending)return;
    const controller=new AbortController();request.current=controller;setPending(true);setError("");
    try{
      restoreKey.current??=crypto.randomUUID();
      const body=new FormData();body.append("file",file);body.append("password",uploadPassword);body.append("planToken",preview.plan.token);
      const response=await authenticatedFetchOnce(auth.accessToken,{userId:auth.session.userId,sessionId:auth.session.id,membershipVersion:auth.session.membershipVersion},`${apiBaseUrl}/device-restores/requests`,{method:"POST",headers:{"Idempotency-Key":restoreKey.current},body,signal:controller.signal});
      if(!response.ok)throw new Error(response.status===409?"Kaynak değişmiş veya başka bir talep var. Talep durumunu kontrol edip yeni önizleme oluşturun.":"Geri yükleme talebi doğrulanamadı.");
      await restore.refetch();setNotice("Geri yükleme talebi iletildi. Sistem yöneticisinin onayı bekleniyor.");
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Talep iletilemedi.");}
    finally{if(!controller.signal.aborted){setPending(false);setUploadPassword("");}}
  }
  async function cancelRestore(){
    if(!auth||!restore.data?.operation||pending)return;setPending(true);setError("");
    try{await apiRequest(auth.accessToken,`${apiBaseUrl}/device-restores/${restore.data.operation.operationId}/cancel`,{method:"POST"});await restore.refetch();restoreKey.current=null;}
    catch{setError("Talep iptal edilemedi; onaylanmış olabilir.");}finally{setPending(false);}
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
      <Field label="Cihazımdaki yedek dosyası"><Input type="file" accept=".ookulbackup" required onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); restoreKey.current=null; }} disabled={!enabled || pending} /></Field>
      <Field label="Dosyanın yedek parolası"><Input type="password" autoComplete="off" required minLength={12} maxLength={128} value={uploadPassword} onChange={event => setUploadPassword(event.target.value)} disabled={!enabled || pending} /></Field>
      <Button type="submit" disabled={!enabled || pending}>{preview?.plan ? "Planı yeniden doğrula" : "Yedeği yükle ve doğrula"}</Button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {preview ? <div role="status">
      {preview.plan ? <p>Veritabanı önizleme planı {new Date(preview.plan.expiresAt).toLocaleTimeString("tr-TR")} saatine kadar yeniden doğrulanabilir. Bu bir geri yükleme onayı değildir.</p> : null}
      <p>Bu kuruma ait paket bütünlüğü doğrulandı. Yedek tarihi: {new Date(preview.createdAt).toLocaleString("tr-TR")}</p>
      <p>{Object.values(preview.tableCounts).reduce((sum,count) => sum+count,0)} kayıt ve {preview.fileCount} dosya.</p>
      <p>{preview.schemaCompatible ? "Veri sürümü eşleşiyor." : "Bu yedeğin veri sürümü mevcut kurumla uyumlu değil."}</p>
      {preview.impact ? <div aria-label="Geri yükleme etki önizlemesi">
        <p>Operasyon kayıtları: {preview.impact.additions} eklenecek, {preview.impact.changes} değişecek, {preview.impact.removals} kaldırılacak kayıt.</p>
        <p>Finans, iletişim izinleri, destek ve gönderim geçmişi, hesaplar, lisanslar ve oturumlar mevcut haliyle korunur.</p>
        <p>Yedekteki aktif öğrenci: {preview.impact.activeStudents}. Doğrulanan mevcut limit: {preview.impact.activeStudentLimit ?? "doğrulanamadı"}.</p>
        {preview.impact.references ? <p>{preview.impact.references.checkedLinks} ilişki kontrol edildi; {preview.impact.references.conflicts.reduce((n,c)=>n+c.links,0)} ilişki çatışması, {preview.impact.references.unverified.length} doğrulanamayan ilişki grubu var.</p> : null}
        {preview.impact.domainLinks ? <p>Kimlik ve gönderim bağları: {preview.impact.domainLinks.checkedLinks} kontrol, {preview.impact.domainLinks.conflicts.reduce((n,c)=>n+c.links,0)} çatışma; görülen {preview.impact.domainLinks.pendingDeliveries} sonuçlandırılmamış gönderim.</p> : null}
        <p>Bu sayılar bir uygulama onayı değildir. Tamamlanması gereken kontroller:</p>
        <ul>{preview.impact.blockers.map(code => <li key={code}>{impactMessages[code] ?? "Ek inceleme gerekiyor."}</li>)}</ul>
      </div> : null}
      {status.data?.restoreAvailable ? <p>Önizleme kurum verilerini değiştirmedi. Uygulama için aşağıdaki ayrı talep ve sistem yöneticisinin MFA onayı gerekir.</p> : <p>Kurum verilerine uygulama kapalı; hiçbir kayıt değiştirilmedi.</p>}
    </div> : null}
    {status.data?.restoreAvailable ? <section aria-label="Geri yükleme talebi">
      {restore.data?.operation ? <p role="status">Talep durumu: {({AWAITING_APPROVAL:"Sistem yöneticisinin onayı bekleniyor",QUEUED:"Sırada",RUNNING:"Geri yükleniyor",COMPLETED:"Tamamlandı",ABORTED:"Uygulanmadı; kurtarma sonucu kontrol edilmeli",BLOCKED:"İşlem inceleme bekliyor"})[restore.data.operation.state]}</p> : null}
      {restore.data?.operation?.state==="AWAITING_APPROVAL" ? <Button type="button" disabled={pending} onClick={()=>void cancelRestore()}>Talebi iptal et</Button> : null}
      {preview?.plan && (!restore.data?.operation || ["COMPLETED","ABORTED"].includes(restore.data.operation.state)) ? <form onSubmit={event=>void requestRestore(event)} aria-label="Geri yükleme talebi oluştur">
        <Field label="Talep için yedek parolasını tekrar yaz"><Input type="password" autoComplete="off" minLength={12} maxLength={128} required value={uploadPassword} onChange={event=>setUploadPassword(event.target.value)} disabled={pending}/></Field>
        <label><input type="checkbox" required disabled={pending}/> Seçtiğim yedeğe dönülmesini istiyorum. Onay sırasında kurum erişiminin geçici olarak kapanacağını anlıyorum.</label>
        <p>Bu sürüm en fazla 2.000 kaydı geri yükler. Mevcut finans, izin ve hesap güvenliği kayıtları korunur; eski oturumlar yeniden açılmaz.</p>
        <Button type="submit" disabled={pending||restore.isError||restore.isPending}>Geri yükleme talebi gönder</Button>
      </form> : null}
    </section> : null}
  </Panel>;
}
