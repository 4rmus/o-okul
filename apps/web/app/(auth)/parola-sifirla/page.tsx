"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@o-okul/ui";
import { confirmPasswordReset } from "../../../src/api-client.js";
import { appBrand } from "../../../src/brand.js";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    setToken(searchParams.get("token")?.trim() ?? "");
    setTenantSlug(searchParams.get("tenant")?.trim() ?? "");
    if (searchParams.has("token")) {
      searchParams.delete("token");
      const query = searchParams.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
    }
  }, []);
  const loginHref = tenantSlug ? `/k/${encodeURIComponent(tenantSlug)}/giris` : "/login";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("Şifre yenileme bağlantısı geçersiz.");
      return;
    }
    if (password.length < 8) {
      setError("Yeni şifre en az 8 karakter olmalıdır.");
      return;
    }
    if (password !== passwordAgain) {
      setError("Şifreler eşleşmiyor.");
      return;
    }

    setIsSubmitting(true);
    try {
      await confirmPasswordReset({ token, password });
      setIsComplete(true);
    } catch {
      setError("Bağlantı geçersiz, kullanılmış veya süresi dolmuş.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="next-auth-panel" aria-labelledby="reset-password-title">
      <div className="next-brand">
        <span className="next-brand-mark">{appBrand.mark}</span>
        <span>{appBrand.name}</span>
      </div>
      <form className="next-form" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="reset-password-title">Yeni şifre</h1>
        {isComplete ? (
          <>
            <p className="next-status-note" role="status">Şifreniz yenilendi. Diğer cihazlardaki oturumlar kapatıldı.</p>
            <Link className="uh-button uh-button--primary uh-button--md" href={loginHref}>Giriş yap</Link>
          </>
        ) : (
          <>
            <Field label="Yeni şifre">
              <Input
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <Field label="Yeni şifre tekrar">
              <Input
                name="passwordAgain"
                type="password"
                value={passwordAgain}
                onChange={(event) => setPasswordAgain(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            {error ? <p className="next-form-error" role="alert">{error}</p> : null}
            <Button type="submit" disabled={isSubmitting} loading={isSubmitting} loadingLabel="Yenileniyor">
              Şifreyi yenile
            </Button>
          </>
        )}
      </form>
      <aside className="next-auth-context" aria-label="Yeni şifre güven bilgisi">
        <p className="next-section-eyebrow">{tenantSlug ? "Kurum hesabı" : "Güvenli şifre yenileme"}</p>
        <h2>Tek kullanımlık bağlantıyı yalnız bu ekranda kullanın.</h2>
        <p>Şifre yenilendiğinde diğer oturumlar kapatılır. Bağlantı geçersizse giriş ekranına dönüp yeniden istek oluşturun.</p>
        <Link className="next-auth-link" href={loginHref}>Girişe dön</Link>
      </aside>
    </section>
  );
}
