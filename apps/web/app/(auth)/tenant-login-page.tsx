"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, LockKeyhole, ScanLine } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { isFinanceOnlyStaff, type AuthResponse, type MfaChallengeResponse, type MfaEnrollmentRequiredResponse, type TenantLoginContextResponse, type TenantSelectionRequiredResponse } from "@o-okul/shared-types";
import { Button, Field, Input, SegmentedControl, Select } from "@o-okul/ui";
import { useAuth } from "../providers.js";
import { appBrand } from "../../src/brand.js";
import { ApiRequestError, getTenantLoginContext, MfaEnrollmentRequiredError, MfaRequiredError, TenantSelectionRequiredError } from "../../src/api-client.js";
import { useActivationNotice } from "./activation-notice.js";
import { ContactSupportLink } from "./contact-support-link.js";
import { LogoutPendingNotice } from "./logout-pending-notice.js";
import { PasswordField, PasswordInput } from "./password-input.js";

// DEC-20261021-01: after a support MFA reset the enrollment also needs the one-time code read over the phone.
const mfaResetExpiredMessage = "MFA sıfırlamasının 24 saatlik süresi doldu. Yeni kayıt kodu için O-Okul desteğine başvurun.";
const loginUnavailableMessage = "Giriş şu anda tamamlanamadı. Bilgileriniz doğru olabilir; parolanızı sıfırlamadan birkaç dakika sonra yeniden deneyin, sorun sürerse kurumunuza bildirin.";
const enrollmentErrors: Record<string, string> = {
  MFA_REENROLLMENT_CODE_REQUIRED: "Destek ekibinin telefonla ilettiği tek kullanımlık kayıt kodunu girin.",
  MFA_REENROLLMENT_CODE_INVALID: "Kayıt kodu geçersiz. Destek ekibinin ilettiği kodu kontrol edip tekrar deneyin.",
  MFA_REENROLLMENT_LOCKED: "Çok fazla hatalı kayıt kodu denendi. 15 dakika sonra tekrar deneyin.",
  MFA_RESET_EXPIRED: mfaResetExpiredMessage,
};

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
  const [reenrollmentCode, setReenrollmentCode] = useState("");
  const [mfaSecretCopyStatus, setMfaSecretCopyStatus] = useState("");
  const [error, setError] = useState("");
  const [failedSubmitCount, setFailedSubmitCount] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tenantContext, setTenantContext] = useState<TenantLoginContextResponse | null>(null);
  const activationNotice = useActivationNotice();

  useEffect(() => {
    if (!isBootstrapping && auth) {
      router.replace(getAuthHomePath(auth));
    }
  }, [auth, isBootstrapping, router]);

  // UI/UX F8: başarısız gönderimden sonra odak hata mesajına taşınır (WCAG focus-management).
  useEffect(() => {
    if (failedSubmitCount > 0 && error) errorRef.current?.focus();
  }, [error, failedSubmitCount]);

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
        await confirmMfaEnrollment(pendingEnrollment.setupToken, mfaCode, pendingEnrollment.reenrollmentCodeRequired ? reenrollmentCode : undefined);
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
        setReenrollmentCode("");
        setError("");
        return;
      }
      if (caught instanceof TenantSelectionRequiredError) {
        setPendingTenantSelection(caught.challenge);
        setSelectedTenantId(caught.challenge.tenants[0]?.tenantId ?? "");
        setError("");
        return;
      }
      const code = caught instanceof ApiRequestError ? caught.code ?? "" : "";
      if (pendingEnrollment) setError(enrollmentErrors[code] ?? "Doğrulama kodu geçersiz.");
      else if (pendingMfa) setError("Doğrulama kodu geçersiz.");
      else if (code === "MFA_RESET_EXPIRED") setError(mfaResetExpiredMessage);
      // UAT F-25: a server failure is not a credential error; telling the user so keeps them from resetting a correct password.
      else if (!(caught instanceof ApiRequestError) || caught.status >= 500) setError(loginUnavailableMessage);
      else setError("Giriş bilgileri hatalı.");
      setFailedSubmitCount((count) => count + 1);
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetTenantSelection() {
    setPendingTenantSelection(null);
    setSelectedTenantId("");
    setError("");
  }

  async function copyMfaSecret() {
    if (!pendingEnrollment) return;

    try {
      await navigator.clipboard.writeText(pendingEnrollment.secret);
      setMfaSecretCopyStatus("Kurulum anahtarı kopyalandı.");
    } catch {
      setMfaSecretCopyStatus("Kurulum anahtarı kopyalanamadı.");
    }
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
        {activationNotice && !pendingMfa && !pendingEnrollment && !pendingTenantSelection ? (
          <p className="next-status-note" role="status">{activationNotice}</p>
        ) : null}
        <LogoutPendingNotice />
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
        <PasswordField>
          <Field label="Şifre">
            <PasswordInput
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={Boolean(pendingMfa || pendingEnrollment || pendingTenantSelection)}
              required
            />
          </Field>
        </PasswordField>
        {!pendingMfa && !pendingEnrollment && !pendingTenantSelection ? (
          <>
            <Link
              className="next-auth-link"
              href={canonicalHost ? "/parolami-unuttum" : lockedTenantSlug ? `/parolami-unuttum?tenant=${encodeURIComponent(lockedTenantSlug)}` : "/parolami-unuttum"}
            >
              Şifremi unuttum
            </Link>
            <ContactSupportLink />
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
          <div className="next-form-section" role="status" aria-live="polite">
            <p>Yönetici hesabı için iki adımlı doğrulamayı etkinleştirin.</p>
            <p className="next-mfa-enrollment-help">Doğrulama uygulamanızda yeni hesap ekleyin ve QR kodu tarayın.</p>
            <div className="next-mfa-enrollment-qr">
              <QRCodeSVG
                value={pendingEnrollment.keyUri}
                size={184}
                level="M"
                marginSize={4}
                role="img"
                aria-label="Doğrulama uygulaması kurulum QR kodu"
              />
            </div>
            <p className="next-mfa-enrollment-help">QR kodunu tarayamıyorsanız aşağıdaki anahtarı elle girebilirsiniz.</p>
            <Field label="Kurulum anahtarı">
              <Input value={pendingEnrollment.secret} readOnly />
            </Field>
            <Button type="button" variant="ghost" onClick={() => void copyMfaSecret()}>
              Kurulum anahtarını kopyala
            </Button>
            {mfaSecretCopyStatus ? <p className="next-mfa-enrollment-help">{mfaSecretCopyStatus}</p> : null}
            {pendingEnrollment.reenrollmentCodeRequired ? (
              <Field
                label="Tek kullanımlık kayıt kodu"
                description="MFA'nız destek ekibi tarafından sıfırlandı. Ekip kurumunuzun kayıtlı telefonunu arayarak size 8 haneli bir kod iletir; kod 24 saat geçerlidir."
              >
                <Input
                  name="mfaReenrollmentCode"
                  type="text"
                  value={reenrollmentCode}
                  onChange={(event) => setReenrollmentCode(event.target.value)}
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="1234-5678"
                  maxLength={12}
                  required
                />
              </Field>
            ) : null}
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
              <code className="next-mfa-recovery-codes">{pendingEnrollment.recoveryCodes.join(" ")}</code>
            </div>
          </div>
        ) : null}
        {error ? <p className="next-form-error" ref={errorRef} role="alert" tabIndex={-1}>{error}</p> : null}
        <Button type="submit" disabled={isSubmitDisabled} loading={isSubmitting} loadingLabel="Giriş yapılıyor">
          {pendingEnrollment ? "Etkinleştir ve giriş yap" : pendingMfa ? "Doğrula" : pendingTenantSelection ? "Devam et" : "Giriş yap"}
        </Button>
      </form>
      <aside className="next-auth-context" aria-label="Güvenli giriş bilgisi">
        <p className="next-section-eyebrow">{lockedTenantSlug === "system" ? "Sistem girişi" : lockedTenantSlug ? "Kurum girişi" : "Güvenli oturum"}</p>
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
  if (isFinanceOnlyStaff(roles)) return "/kurum/finans";
  if (roles.some((role) => ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF"].includes(role))) return "/kurum";
  if (roles.includes("TEACHER") && subjectType === "TEACHER") return "/ogretmen";
  if (roles.includes("STUDENT") && subjectType === "STUDENT") return "/ogrenci";
  if (roles.includes("GUARDIAN") && subjectType === "GUARDIAN") return "/veli";
  return "/login";
}
