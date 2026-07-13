"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthResponse, MfaChallengeResponse, MfaEnrollmentRequiredResponse, TenantSelectionRequiredResponse } from "@o-okul/shared-types";
import { Button, Field, Input, SegmentedControl, Select } from "@o-okul/ui";
import { useAuth } from "../providers.js";
import { appBrand } from "../../src/brand.js";
import { MfaEnrollmentRequiredError, MfaRequiredError, TenantSelectionRequiredError } from "../../src/api-client.js";

interface TenantLoginPageProps {
  tenantSlug?: string;
}

export function TenantLoginPage({ tenantSlug: initialTenantSlug }: TenantLoginPageProps) {
  const router = useRouter();
  const { auth, confirmMfaEnrollment, isBootstrapping, login, selectTenant, verifyMfa } = useAuth();
  const lockedTenantSlug = initialTenantSlug?.trim() ?? "";
  const [nationalId, setNationalId] = useState("");
  const [password, setPassword] = useState("");
  const [pendingTenantSelection, setPendingTenantSelection] = useState<TenantSelectionRequiredResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [pendingMfa, setPendingMfa] = useState<MfaChallengeResponse | null>(null);
  const [pendingEnrollment, setPendingEnrollment] = useState<MfaEnrollmentRequiredResponse | null>(null);
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery_code">("totp");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isBootstrapping && auth) {
      router.replace(getAuthHomePath(auth));
    }
  }, [auth, isBootstrapping, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const formNationalId = String(formData.get("nationalId") ?? "").trim();
    const formPassword = String(formData.get("password") ?? "");

    try {
      if (pendingEnrollment) {
        await confirmMfaEnrollment(pendingEnrollment.setupToken, mfaCode);
      } else if (pendingMfa) {
        await verifyMfa(pendingMfa.challengeToken, mfaMethod === "totp" ? { totpCode: mfaCode } : { recoveryCode: mfaCode });
      } else if (pendingTenantSelection) {
        await selectTenant(pendingTenantSelection.selectionToken, selectedTenantId);
      } else {
        await login({
          ...(lockedTenantSlug ? { tenantSlug: lockedTenantSlug } : {}),
          nationalId: formNationalId,
          password: formPassword,
        });
      }
    } catch (caught) {
      if (caught instanceof MfaRequiredError) {
        setPendingMfa(caught.challenge);
        setPendingTenantSelection(null);
        setMfaCode("");
        setError("");
        return;
      }
      if (caught instanceof MfaEnrollmentRequiredError) {
        setPendingEnrollment(caught.challenge);
        setPendingMfa(null);
        setPendingTenantSelection(null);
        setMfaCode("");
        setError("");
        return;
      }
      if (caught instanceof TenantSelectionRequiredError) {
        setPendingTenantSelection(caught.challenge);
        setSelectedTenantId(caught.challenge.tenants[0]?.tenantId ?? "");
        setError("");
        return;
      }
      setError(pendingMfa || pendingEnrollment ? "Doğrulama kodu geçersiz." : "Giriş bilgileri hatalı.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetTenantSelection() {
    setPendingTenantSelection(null);
    setSelectedTenantId("");
    setError("");
  }

  const isSubmitDisabled = isSubmitting || isBootstrapping || Boolean(pendingTenantSelection && !selectedTenantId);

  return (
    <section className="next-auth-panel" aria-labelledby="login-title">
      <div className="next-brand">
        <span className="next-brand-mark">{appBrand.mark}</span>
        <span>{appBrand.name}</span>
      </div>
      <form className="next-form" aria-label="Giriş formu" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="login-title">Giriş</h1>
        <Field label="Kullanıcı Adı">
          <Input
            name="nationalId"
            type="text"
            value={nationalId}
            onChange={(event) => setNationalId(event.target.value)}
            autoComplete="username"
            inputMode="numeric"
            disabled={Boolean(pendingMfa || pendingEnrollment || pendingTenantSelection)}
            required
          />
        </Field>
        <Field label="Şifre">
          <Input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={Boolean(pendingMfa || pendingEnrollment || pendingTenantSelection)}
            required
          />
        </Field>
        {pendingTenantSelection ? (
          <div className="next-form-section">
            <Field label="Okul">
              <Select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)} required>
                {pendingTenantSelection.tenants.map((tenant) => (
                  <option key={tenant.tenantId} value={tenant.tenantId}>
                    {tenant.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="button" variant="ghost" onClick={resetTenantSelection}>
              Bilgileri değiştir
            </Button>
          </div>
        ) : null}
        {pendingMfa ? (
          <div className="next-form-section">
            <SegmentedControl className="next-segmented" label="Doğrulama yöntemi">
              <button
                type="button"
                aria-pressed={mfaMethod === "totp"}
                onClick={() => setMfaMethod("totp")}
              >
                TOTP
              </button>
              <button
                type="button"
                aria-pressed={mfaMethod === "recovery_code"}
                onClick={() => setMfaMethod("recovery_code")}
              >
                Kurtarma
              </button>
            </SegmentedControl>
            <Field label={mfaMethod === "totp" ? "Doğrulama kodu" : "Kurtarma kodu"}>
              <Input
                name="mfaCode"
                type="text"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode={mfaMethod === "totp" ? "numeric" : "text"}
              />
            </Field>
          </div>
        ) : null}
        {pendingEnrollment ? (
          <div className="next-form-section" role="status">
            <p>Yönetici hesabı için iki adımlı doğrulamayı etkinleştirin.</p>
            <Field label="Kurulum anahtarı">
              <Input value={pendingEnrollment.secret} readOnly />
            </Field>
            <Field label="Doğrulama kodu">
              <Input
                name="mfaEnrollmentCode"
                type="text"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                required
              />
            </Field>
            <div>
              <p>Kurtarma kodlarını güvenli bir yere kaydedin:</p>
              <code>{pendingEnrollment.recoveryCodes.join(" ")}</code>
            </div>
          </div>
        ) : null}
        {error ? <p className="next-form-error" role="alert">{error}</p> : null}
        <Button type="submit" disabled={isSubmitDisabled}>
          {isSubmitting ? "Giriş yapılıyor" : pendingEnrollment ? "Etkinleştir ve giriş yap" : pendingMfa ? "Doğrula" : pendingTenantSelection ? "Devam et" : "Giriş yap"}
        </Button>
      </form>
    </section>
  );
}

function getAuthHomePath(auth: AuthResponse) {
  if (auth.session.mustChangePassword) return "/sifre-degistir";
  const { roles, subjectType } = auth.session;
  if (roles.includes("SYSTEM_ADMIN")) return "/sistem";
  if (roles.includes("TENANT_ADMIN") || roles.includes("ASSISTANT_ADMIN")) return "/kurum";
  if (roles.includes("TEACHER") && subjectType === "TEACHER") return "/ogretmen";
  if (roles.includes("STUDENT") && subjectType === "STUDENT") return "/ogrenci";
  if (roles.includes("GUARDIAN") && subjectType === "GUARDIAN") return "/veli";
  return "/login";
}
