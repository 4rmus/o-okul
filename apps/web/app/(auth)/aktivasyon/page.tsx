"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@o-okul/ui";
import { useAuth } from "../../providers.js";
import { ApiRequestError, acceptIdentityInvitation, activateStudentPortal } from "../../../src/api-client.js";
import { appBrand } from "../../../src/brand.js";
import { browserTenantSlug } from "../../../src/tenant-host.js";
import { activationNoticeHref } from "../activation-notice.js";
import { ContactSupportLink } from "../contact-support-link.js";
import { PasswordField, PasswordInput } from "../password-input.js";

export default function ActivationPage() {
  const router = useRouter();
  const { auth, isBootstrapping, logout } = useAuth();
  const [token, setToken] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [hostTenantSlug, setHostTenantSlug] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [isEmployeeInvitation, setIsEmployeeInvitation] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [previousSessionOpen, setPreviousSessionOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loginPath = hostTenantSlug ? "/giris" : "/login";

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const fragmentParams = new URLSearchParams(window.location.hash.slice(1));
    const invitationToken = fragmentParams.get("token")?.trim() || searchParams.get("token")?.trim() || "";
    const fromHost = browserTenantSlug() ?? "";
    setToken(invitationToken);
    setIsEmployeeInvitation(Boolean(invitationToken));
    setHostTenantSlug(fromHost);
    setTenantSlug(fromHost || (fragmentParams.get("tenant") ?? searchParams.get("tenant"))?.trim() || "");
    setStudentNo((fragmentParams.get("student") ?? searchParams.get("student"))?.trim() ?? "");
    setActivationCode((fragmentParams.get("code") ?? searchParams.get("code"))?.trim().toUpperCase() ?? "");
    if (window.location.hash || ["token", "tenant", "student", "code"].some((name) => searchParams.has(name))) {
      searchParams.delete("token");
      searchParams.delete("tenant");
      searchParams.delete("student");
      searchParams.delete("code");
      const query = searchParams.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (isEmployeeInvitation && !token) {
      setError("Aktivasyon bağlantısı geçersiz.");
      return;
    }
    if (!isEmployeeInvitation && (!tenantSlug.trim() || !studentNo.trim() || !/^[A-HJ-NP-Z2-9]{12}$/.test(activationCode))) {
      setError("Kurum adresi, öğrenci numarası ve 12 karakterlik aktivasyon kodunu kontrol edin.");
      return;
    }
    if (password.length < 8 || password.length > 128 || !/\p{Lu}/u.test(password) || !/\p{Ll}/u.test(password)) {
      setError("Şifre 8-128 karakter olmalı, büyük ve küçük harf içermelidir.");
      return;
    }
    if (password !== passwordAgain) {
      setError("Şifreler eşleşmiyor.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEmployeeInvitation) {
        await acceptIdentityInvitation({ token, password });
      } else {
        await activateStudentPortal({
          ...(!hostTenantSlug ? { tenantSlug: tenantSlug.trim() } : {}),
          studentNo: studentNo.trim(),
          code: activationCode,
          password,
        });
      }
    } catch (caught) {
      setError(isEmployeeInvitation
        ? invitationAcceptErrorMessage(caught)
        : "Aktivasyon bilgileri geçersiz, kullanılmış veya süresi dolmuş.");
      setIsSubmitting(false);
      return;
    }
    setIsComplete(true);
    await leaveForLogin(Boolean(auth));
  }

  // UAT F-20: the activated person must never continue in a session this browser already holds (another user's);
  // it is ended through the normal logout (refresh cookie, CSRF), then the new account signs in on the login page.
  // There is no auto-login after activation. The notice travels as a plain flag, never as account data. If the server
  // does not confirm the logout, the page stays here: the login page would resume the surviving session.
  async function leaveForLogin(hasSession: boolean) {
    if (hasSession && !(await logout())) {
      setPreviousSessionOpen(true);
      setIsSubmitting(false);
      return;
    }
    setPreviousSessionOpen(false);
    router.replace(activationNoticeHref(loginPath, isEmployeeInvitation ? "invitation" : "student"));
  }

  async function retryPreviousSessionLogout() {
    setIsSubmitting(true);
    await leaveForLogin(true);
  }

  return (
    <section className="next-auth-panel" aria-labelledby="activation-title">
      <div className="next-brand">
        <span className="next-brand-mark">{appBrand.mark}</span>
        <span>{appBrand.name}</span>
      </div>
      <form className="next-form" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="activation-title">Hesabı etkinleştir</h1>
        {isComplete && previousSessionOpen ? (
          <>
            <p className="next-form-error" role="alert">
              Hesabınız etkinleştirildi, ancak bu tarayıcıdaki önceki oturum kapatılamadı. Önce önceki oturumu kapatın,
              sonra yeni şifrenizle giriş yapın.
            </p>
            <Button type="button" disabled={isSubmitting} loading={isSubmitting} loadingLabel="Oturum kapatılıyor" onClick={() => void retryPreviousSessionLogout()}>
              Önceki oturumu kapat
            </Button>
          </>
        ) : isComplete ? (
          <>
            <p className="next-status-note" role="status">
              Hesabınız etkinleştirildi. Giriş sayfasına yönlendiriliyorsunuz.
            </p>
            <Link className="uh-button uh-button--primary uh-button--md" href={activationNoticeHref(loginPath, isEmployeeInvitation ? "invitation" : "student")}>Giriş yap</Link>
          </>
        ) : (
          <>
            {!isEmployeeInvitation ? (
              <>
                {!hostTenantSlug ? (
                  <Field label="Kurum kodu">
                    <Input
                      name="tenantSlug"
                      value={tenantSlug}
                      onChange={(event) => setTenantSlug(event.target.value)}
                      autoComplete="organization"
                      required
                    />
                  </Field>
                ) : null}
                <Field label="Öğrenci numarası">
                  <Input
                    name="studentNo"
                    value={studentNo}
                    onChange={(event) => setStudentNo(event.target.value)}
                    autoComplete="username"
                    required
                  />
                </Field>
                <Field label="Aktivasyon kodu">
                  <Input
                    name="activationCode"
                    value={activationCode}
                    onChange={(event) => setActivationCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 12))}
                    autoCapitalize="characters"
                    autoComplete="one-time-code"
                    inputMode="text"
                    minLength={12}
                    maxLength={12}
                    required
                  />
                </Field>
              </>
            ) : null}
            <PasswordField>
              <Field label="Şifre">
                <PasswordInput
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </Field>
            </PasswordField>
            <PasswordField>
              <Field label="Şifre tekrar">
                <PasswordInput
                  name="passwordAgain"
                  type="password"
                  value={passwordAgain}
                  onChange={(event) => setPasswordAgain(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </Field>
            </PasswordField>
            {error ? <p className="next-form-error" role="alert">{error}</p> : null}
            <Button type="submit" disabled={isSubmitting || isBootstrapping} loading={isSubmitting} loadingLabel="Etkinleştiriliyor">
              Hesabı etkinleştir
            </Button>
          </>
        )}
      </form>
      <section className="next-auth-context" aria-label="Hesap aktivasyonu güven bilgisi">
        <p className="next-section-eyebrow">Tek kullanımlık davet</p>
        <h2>Bağlantı ve kod 24 saat geçerlidir.</h2>
        <p>Şifrenizi yalnız bu ekranda belirleyin. Süresi dolan, kullanılan veya deneme limiti dolan kod yeniden kullanılamaz.</p>
        {/* The login page would resume a session whose logout failed; the page offers the retry instead. */}
        {previousSessionOpen ? null : <Link className="next-auth-link" href={loginPath}>Girişe dön</Link>}
        <ContactSupportLink />
      </section>
    </section>
  );
}

const askAdminForNewInvitation = "İşlem tamamlanamadı. Kurum yöneticinizden yeni davet isteyin.";

// UAT F-20: refusals the invitee cannot fix alone name the reason and the next step.
const invitationAcceptErrorMessages: Record<string, string> = {
  IDENTITY_INVITATION_EXPIRED: "Davet bağlantısının süresi doldu. Kurum yöneticinizden yeni davet isteyin.",
  IDENTITY_INVITATION_NOT_PENDING: "Bu davet bağlantısı daha önce kullanılmış. Hesabınız etkinse giriş yapın.",
  IDENTITY_INVITATION_REVOKED: "Bu davet iptal edildi. Kurum yöneticinizden yeni davet isteyin.",
  IDENTITY_INVITATION_NOT_FOUND: "Davet bağlantısı geçersiz.",
  EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND: "Bu e-posta kurumda başka bir çalışanın hesabında kullanılıyor. Kurum yöneticinizden farklı bir e-postaya yeni davet isteyin.",
  EMPLOYEE_EMAIL_ACCOUNT_INCOMPATIBLE: "Bu e-posta çalışan hesabıyla birleştirilemeyen bir hesaba ait (ör. öğrenci veya veli). Kurum yöneticinizden farklı bir e-postaya yeni davet isteyin.",
  EMPLOYEE_ALREADY_LINKED: "Bu çalışan kaydı zaten bir hesaba bağlı. Hesabınız etkinse giriş yapın; değilse kurum yöneticinize başvurun.",
  EMPLOYEE_INVITATION_REQUIRES_ACTIVE_PROFILE: "Çalışan kaydınız aktif olmadığı için hesap açılamadı. Kurum yöneticinize başvurun.",
};

// UAT F-08: a server error must never read as an expired link.
function invitationAcceptErrorMessage(error: unknown): string {
  const status = error instanceof ApiRequestError ? error.status : 0;
  const code = error instanceof ApiRequestError ? error.code : undefined;
  const known = code ? invitationAcceptErrorMessages[code] : undefined;
  if (known) return known;
  if (code?.startsWith("PASSWORD_")) return "Şifre kabul edilmedi. Daha güçlü ve tahmin edilmesi zor bir şifre seçin.";
  if (code === "TENANT_ACTIVITY_UNRESOLVED" || (status >= 400 && status < 500)) return askAdminForNewInvitation;
  return "Beklenmeyen bir hata oluştu. Lütfen biraz sonra tekrar deneyin.";
}
