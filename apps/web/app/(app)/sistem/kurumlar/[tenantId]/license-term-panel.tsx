"use client";

import { type FormEvent, useState } from "react";
import { Alert, Button, Field, FormModal, Input, Select } from "@o-okul/ui";
import { licensePlanCodes, trialLicenseLimits, type LicensePlanCode, type LicenseTermCreateRequest } from "@o-okul/shared-types";
import { ApiRequestError } from "../../../../../src/api-client.js";
import { createLicenseTerm } from "../../_shared/system-api.js";

// UAT F-18: the tenant detail screen said "Lisansı yenile" but offered no way to do it; the system admin opens a new
// licence term here (POST /tenants/:id/license-terms). Terms never overlap, so a renewal starts on or after the
// current term's end.
const planLabels: Record<LicensePlanCode, string> = { TRIAL: "Deneme", PRO: "Pro", ENTERPRISE: "Kurumsal" };
const dayMs = 24 * 60 * 60 * 1000;
const serverErrors: Record<string, string> = {
  LICENSE_TERM_OVERLAP: "Bu tarihler mevcut bir lisans dönemiyle çakışıyor. Başlangıcı mevcut dönemin bitişinden sonraya alın.",
  LICENSE_TERM_PLATFORM_ACCOUNT_REQUIRED: "Sistem hesabınız lisans açmak için hazır değil. Destek ekibine bildirin.",
  TENANT_NOT_FOUND: "Kurum bulunamadı. Sayfayı yenileyin.",
};

export interface LicenseTermFormState {
  planCode: LicensePlanCode;
  startsOn: string;
  endsOn: string;
  activeStudentLimit: string;
}

export function defaultLicenseTermForm(currentEndsAt: string | undefined, now = Date.now()): LicenseTermFormState {
  const currentEnd = currentEndsAt ? Date.parse(currentEndsAt) : Number.NaN;
  const start = Number.isNaN(currentEnd) || currentEnd < now ? now : currentEnd;
  return { planCode: "PRO", startsOn: isoDay(start), endsOn: isoDay(start + 365 * dayMs), activeStudentLimit: "" };
}

/** Mirrors licenseTermCreateBodySchema so the admin sees the rule before the API answers VALIDATION_FAILED. */
export function validateLicenseTermForm(form: LicenseTermFormState): { request?: LicenseTermCreateRequest; error?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(form.endsOn)) return { error: "Başlangıç ve bitiş tarihini seçin." };
  const startsAt = `${form.startsOn}T00:00:00.000Z`;
  const endsAt = `${form.endsOn}T00:00:00.000Z`;
  if (Date.parse(startsAt) >= Date.parse(endsAt)) return { error: "Bitiş tarihi başlangıçtan sonra olmalı." };
  const activeStudentLimit = Number(form.activeStudentLimit);
  if (!Number.isInteger(activeStudentLimit) || activeStudentLimit <= 0) return { error: "Aktif öğrenci sınırı pozitif bir tam sayı olmalı." };
  if (form.planCode === "TRIAL") {
    if (Date.parse(endsAt) - Date.parse(startsAt) > trialLicenseLimits.maxDays * dayMs) return { error: `Deneme dönemi en çok ${trialLicenseLimits.maxDays} gün olabilir.` };
    if (activeStudentLimit > trialLicenseLimits.maxActiveStudents) return { error: `Deneme döneminde öğrenci sınırı en çok ${trialLicenseLimits.maxActiveStudents} olabilir.` };
  }
  return { request: { planCode: form.planCode, startsAt, endsAt, activeStudentLimit } };
}

export function LicenseTermAction({ accessToken, tenantId, tenantName, currentEndsAt, onCreated }: {
  accessToken: string;
  tenantId: string;
  tenantName: string;
  currentEndsAt?: string;
  onCreated(term: { planCode: string; startsAt: string; endsAt: string }): Promise<void> | void;
}) {
  const [form, setForm] = useState<LicenseTermFormState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || busy) return;
    const checked = validateLicenseTermForm(form);
    if (!checked.request) { setError(checked.error ?? ""); return; }
    setBusy(true); setError("");
    try {
      const term = await createLicenseTerm(accessToken, tenantId, checked.request);
      setForm(null);
      await onCreated(term);
    } catch (failure) {
      const code = failure instanceof ApiRequestError ? failure.code ?? "" : "";
      setError(serverErrors[code] ?? (failure instanceof ApiRequestError && failure.status === 403 ? "Lisans açmak için sistem yöneticisi yetkisi gerekir." : "Lisans dönemi açılamadı. Bilgileri kontrol edip tekrar deneyin."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Button onClick={() => { setError(""); setForm(defaultLicenseTermForm(currentEndsAt)); }}>Lisans dönemi aç</Button>
    {form ? <FormModal open title="Lisans dönemi aç" description={`${tenantName} için yeni bir lisans dönemi açılır. Dönemler çakışamaz; yenilemede başlangıç mevcut dönemin bitişinden sonra olmalı. Tarihler UTC gün başlangıcıdır.`}
      cancelLabel="Vazgeç" onCancel={() => setForm(null)} onSubmit={(event) => void submit(event)} submitting={busy} submitLabel="Dönemi aç" submitDisabled={busy} submitError={error || undefined}>
      <Field label="Plan"><Select disabled={busy} value={form.planCode} onChange={(event) => setForm({ ...form, planCode: event.target.value as LicensePlanCode })}>
        {licensePlanCodes.map((code) => <option key={code} value={code}>{planLabels[code]}</option>)}
      </Select></Field>
      <Field label="Başlangıç tarihi"><Input type="date" disabled={busy} value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} /></Field>
      <Field label="Bitiş tarihi"><Input type="date" disabled={busy} value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} /></Field>
      <Field label="Aktif öğrenci sınırı"><Input type="number" inputMode="numeric" min={1} disabled={busy} value={form.activeStudentLimit} onChange={(event) => setForm({ ...form, activeStudentLimit: event.target.value })} /></Field>
    </FormModal> : null}
  </>;
}

export function LicenseTermNotice({ message }: { message: string }) {
  return message ? <Alert tone="success" title="Lisans dönemi açıldı">{message}</Alert> : null;
}

function isoDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}
