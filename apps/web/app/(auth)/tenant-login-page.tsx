"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, LockKeyhole, ScanLine } from "lucide-react";
import type { AuthResponse, MfaChallengeResponse, MfaEnrollmentRequiredResponse, TenantLoginContextResponse, TenantSelectionRequiredResponse } from "@o-okul/shared-types";
import { Button, Field, Input, SegmentedControl, Select } from "@o-okul/ui";
import { useAuth } from "../providers.js";
import { appBrand } from "../../src/brand.js";
import { getTenantLoginContext, MfaEnrollmentRequiredError, MfaRequiredError, TenantSelectionRequiredError } from "../../src/api-client.js";

interface TenantLoginPageProps {
  tenantSlug?: string;
  canonicalHost?: boolean;
}

export function TenantLoginPage({ tenantSlug: initialTenantSlug, canonicalHost = false }: TenantLoginPageProps) {
  const router = useRouter();
  const { auth, confirmMfaEnrollment, isBootstrapping, login, selectTenant, verifyMfa } = useAuth();
  const lockedTenantSlug = initialTenantSlug?.trim() ?? "";
  const [tenantSlug, setTenantSlug] = useState(lockedTenantSlug);
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [pendingTenantSelection, setPendingTenantSelection] = useState<TenantSelectionRequiredResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [pendingMfa, setPendingMfa] = useState<MfaChallengeResponse | null>(null);
  const [pendingEnrollment, setPendingEnrollment] = useState<MfaEnrollmentRequiredResponse | null>(null);
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery_code">("totp");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tenantContext, setTenantContext] = useState<TenantLoginContextResponse | null>(null);

  useEffect(() => {
    if (!isBootstrapping && auth) {
      router.replace(getAuthHomePath(auth));
    }
  }, [auth, isBootstrapping, router]);

  useEffect(() => {
    if (!canonicalHost) return;
    getTenantLoginContext().then(setTenantContext).catch(() => setError("Kurum adresi doğrulanamadı."));
  }, [canonicalHost]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const formTenantSlug = String(formData.get("tenantSlug") ?? lockedTenantSlug).trim();
    const formLoginName = String(formData.get("loginName") ?? "").trim();
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
          ...(!canonicalHost ? { tenantSlug: lockedTenantSlug || formTenantSlug } : {}),
          loginName: formLoginName,
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
        {tenantContext?.logoUrl ? <img className="next-brand-logo" src={tenantContext.logoUrl} alt="" width="32" height="32" /> : <span className="next-brand-mark">{appBrand.mark}</span>}
        <span>{tenantContext?.name ?? appBrand.name}</span>
      </div>
      <form className="next-form" aria-label="Giriş formu" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="login-title">Giriş</h1>
        {!lockedTenantSlug ? (
          <Field label="Kurum Kodu">
            <Input
              name="tenantSlug"
              type="text"
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              autoComplete="organization"
              disabled={Boolean(pendingMfa || pendingEnrollment || pendingTenantSelection)}
              required
            />
          </Field>
        ) : null}
        <Field label="Kullanıcı adı veya e-posta">
          <Input
            name="loginName"
            type="text"
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
            autoComplete="username"
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
        {!pendingMfa && !pendingEnrollment && !pendingTenantSelection ? (
          <>
            <Link
              className="next-auth-link"
              href={canonicalHost ? "/parolami-unuttum" : lockedTenantSlug ? `/parolami-unuttum?tenant=${encodeURIComponent(lockedTenantSlug)}` : "/parolami-unuttum"}
            >
              Şifremi unuttum
            </Link>
          </>
        ) : null}
        {pendingTenantSelection ? (
          <div className="next-form-section">
            <Field label="Kurum">
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
                Doğrulama uygulaması
              </button>
              <button
                type="button"
                aria-pressed={mfaMethod === "recovery_code"}
                onClick={() => setMfaMethod("recovery_code")}
              >
                Kurtarma kodu
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
        <Button type="submit" disabled={isSubmitDisabled} loading={isSubmitting} loadingLabel="Giriş yapılıyor">
          {pendingEnrollment ? "Etkinleştir ve giriş yap" : pendingMfa ? "Doğrula" : pendingTenantSelection ? "Devam et" : "Giriş yap"}
        </Button>
      </form>
      <aside className="next-auth-context" aria-label="Güvenli giriş bilgisi">
        <p className="next-section-eyebrow">{lockedTenantSlug ? "Kurum girişi" : "Güvenli oturum"}</p>
        <h2>Görevinize ait çalışma alanına ilerleyin.</h2>
        <p>Kurumunuz ve kullanıcı göreviniz girişten sonra doğrulanır; yalnız görmeye yetkili olduğunuz bilgiler gösterilir.</p>
        <ul>
          <li>
            <LockKeyhole size={17} aria-hidden="true" />
            Her kurumun verisi ayrı tutulur
          </li>
          <li>
            <CheckCircle2 size={17} aria-hidden="true" />
            Her kullanıcı yalnız yetkili olduğu bilgileri görür
          </li>
          <li>
            <ScanLine size={17} aria-hidden="true" />
            Sınav sonuçları ilgili öğrenci ve velilere açılır
          </li>
        </ul>
      </aside>
    </section>
  );
}

function getAuthHomePath(auth: AuthResponse) {
  if (auth.session.mustChangePassword) return "/sifre-degistir";
  const { roles, subjectType } = auth.session;
  if (roles.includes("SYSTEM_ADMIN")) return "/sistem";
  if (roles.some((role) => ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF"].includes(role))) return "/kurum";
  if (roles.includes("TEACHER") && subjectType === "TEACHER") return "/ogretmen";
  if (roles.includes("STUDENT") && subjectType === "STUDENT") return "/ogrenci";
  if (roles.includes("GUARDIAN") && subjectType === "GUARDIAN") return "/veli";
  return "/login";
}
