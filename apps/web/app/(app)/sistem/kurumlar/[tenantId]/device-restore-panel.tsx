"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Input, Panel } from "@o-okul/ui";
import type { AuthResponse, TenantDeviceRestoreOperation } from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetchOnce } from "../../../../../src/api-client.js";

export function DeviceRestorePanel({auth,tenantId,onPendingChange,onChange}:{auth:AuthResponse;tenantId:string;onPendingChange(value:boolean):void;onChange():void}){
  const [open,setOpen]=useState(false),[code,setCode]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const query=useQuery({queryKey:["system-device-restore",tenantId,auth.session.id],enabled:open,queryFn:()=>apiRequest<{available:boolean;operation:TenantDeviceRestoreOperation|null}>(auth.accessToken,`${apiBaseUrl}/device-restores/tenants/${encodeURIComponent(tenantId)}`),retry:false,refetchInterval:open?5000:false});
  const operation=query.data?.operation;
  useEffect(()=>{onPendingChange(busy||Boolean(operation&&!["COMPLETED","ABORTED"].includes(operation.state)));},[busy,operation,onPendingChange]);
  async function approve(event:FormEvent){
    event.preventDefault();if(!operation||operation.state!=="AWAITING_APPROVAL"||busy)return;
    const controller=new AbortController();request.current=controller;setBusy(true);setError("");
    const actor={userId:auth.session.userId,sessionId:auth.session.id,membershipVersion:auth.session.membershipVersion};
    try{
      const fresh=await query.refetch();
      if(fresh.isError||fresh.data?.operation?.operationId!==operation.operationId||fresh.data.operation.state!=="AWAITING_APPROVAL"||fresh.data.operation.archiveDigest!==operation.archiveDigest)throw new Error("STALE");
      const target={tenantId,operationId:operation.operationId,archiveDigest:operation.archiveDigest,expectedLifecycleVersion:operation.expectedLifecycleVersion};
      const response=await authenticatedFetchOnce(auth.accessToken,actor,`${apiBaseUrl}/auth/step-up`,{method:"POST",signal:controller.signal,headers:{"content-type":"application/json"},body:JSON.stringify({purpose:"TENANT_DEVICE_RESTORE",target,totpCode:code})});
      const proof=response.ok?(await response.json()).data:null;
      setCode("");
      if(!proof||proof.purpose!=="TENANT_DEVICE_RESTORE"||typeof proof.stepUpToken!=="string"||!Number.isFinite(Date.parse(proof.expiresAt))||Date.parse(proof.expiresAt)<=Date.now())throw new Error("MFA");
      const applied=await authenticatedFetchOnce(auth.accessToken,actor,`${apiBaseUrl}/device-restores/tenants/${encodeURIComponent(tenantId)}/${operation.operationId}/approve`,{method:"POST",signal:controller.signal,headers:{"x-step-up-token":proof.stepUpToken}});
      if(!applied.ok)throw new Error("APPLY");
      await query.refetch();onChange();
    }catch{if(!controller.signal.aborted)setError("Talep onaylanamadı. Kaynak, oturum veya MFA değişmiş olabilir; güncel durumu kontrol edin.");}
    finally{if(!controller.signal.aborted){setBusy(false);setCode("");}}
  }
  return <Panel title="Cihaz yedeğinden geri yükleme" description="Kurum yetkilisinin gönderdiği arşiv talebini incele.">
    <Button type="button" onClick={()=>{setOpen(true);if(open)void query.refetch();}} disabled={busy}>Geri yükleme taleplerini göster</Button>
    {open&&query.isPending?<p role="status">Talep kontrol ediliyor.</p>:null}
    {query.isError?<p role="alert">Talep bilgisi alınamadı.</p>:null}
    {open&&query.data&&!query.data.available?<p>Bu kurum için geri yükleme etkin değil.</p>:null}
    {open&&query.data?.available&&!operation?<p>Bekleyen geri yükleme talebi yok.</p>:null}
    {operation?<div>
      <p role="status">Durum: {({AWAITING_APPROVAL:"Onay bekliyor",QUEUED:"Sırada",RUNNING:"Uygulanıyor",COMPLETED:"Tamamlandı",ABORTED:"Uygulanmadı; kurtarma sonucunu kontrol edin",BLOCKED:"İnceleme gerekiyor"})[operation.state]}</p>
      <p>{Object.values(operation.tableCounts).reduce((sum,n)=>sum+n,0)} kayıt ve {operation.fileCount} dosya. Talep: {new Date(operation.createdAt).toLocaleString("tr-TR")}.</p>
      {operation.state==="AWAITING_APPROVAL"?<form onSubmit={event=>void approve(event)}>
        <p>Kurum geçici olarak erişime kapanır. Mevcut durumun kurtarma kopyası alınır; işlem doğrulandıktan sonra erişim açılır. Finans ve hesap güvenliği geçmişi korunur.</p>
        <Field label="MFA doğrulama kodu"><Input type="password" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} value={code} onChange={event=>setCode(event.target.value)} disabled={busy}/></Field>
        <label><input type="checkbox" required disabled={busy}/> Kurum yetkilisinin seçtiği yedeğin uygulanmasını onaylıyorum.</label>
        <Button type="submit" disabled={busy||query.isError} variant="danger">MFA ile onayla ve geri yükle</Button>
      </form>:null}
    </div>:null}
    {error?<p role="alert">{error}</p>:null}
  </Panel>;
}
