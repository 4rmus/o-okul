"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@o-okul/ui";
import { acceptIdentityInvitation, activateStudentPortal } from "../../../src/api-client.js";
import { appBrand } from "../../../src/brand.js";
import { browserTenantSlug } from "../../../src/tenant-host.js";
import { ContactSupportLink } from "../contact-support-link.js";

export default function ActivationPage() {
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
  const [loginName, setLoginName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        const accepted = await activateStudentPortal({
          ...(!hostTenantSlug ? { tenantSlug: tenantSlug.trim() } : {}),
          studentNo: studentNo.trim(),
          code: activationCode,
          password,
        });
        setLoginName(accepted.loginName);
      }
      setIsComplete(true);
    } catch {
      setError(isEmployeeInvitation
        ? "Bağlantı geçersiz, kullanılmış veya süresi dolmuş."
        : "Aktivasyon bilgileri geçersiz, kullanılmış veya süresi dolmuş.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="next-auth-panel" aria-labelledby="activation-title">
      <div className="next-brand">
        <span className="next-brand-mark">{appBrand.mark}</span>
        <span>{appBrand.name}</span>
      </div>
      <form className="next-form" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="activation-title">Hesabı etkinleştir</h1>
        {isComplete ? (
          <>
            <p className="next-status-note" role="status">
              Hesabınız etkinleştirildi. {loginName ? `Öğrenci numaranız (${loginName}) ile giriş yapabilirsiniz.` : "Kurum kodunuzla giriş yapabilirsiniz."}
            </p>
            <Link className="uh-button uh-button--primary uh-button--md" href={hostTenantSlug ? "/giris" : "/login"}>Giriş yap</Link>
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
            <Field label="Şifre">
              <Input
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
            <Field label="Şifre tekrar">
              <Input
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
            {error ? <p className="next-form-error" role="alert">{error}</p> : null}
            <Button type="submit" disabled={isSubmitting} loading={isSubmitting} loadingLabel="Etkinleştiriliyor">
              Hesabı etkinleştir
            </Button>
          </>
        )}
      </form>
      <aside className="next-auth-context" aria-label="Hesap aktivasyonu güven bilgisi">
        <p className="next-section-eyebrow">Tek kullanımlık davet</p>
        <h2>Bağlantı ve kod 24 saat geçerlidir.</h2>
        <p>Şifrenizi yalnız bu ekranda belirleyin. Süresi dolan, kullanılan veya deneme limiti dolan kod yeniden kullanılamaz.</p>
        <Link className="next-auth-link" href={hostTenantSlug ? "/giris" : "/login"}>Girişe dön</Link>
        <ContactSupportLink />
      </aside>
    </section>
  );
}
