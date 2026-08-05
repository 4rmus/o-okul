"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@o-okul/ui";
import { requestPasswordReset } from "../../../src/api-client.js";
import { appBrand } from "../../../src/brand.js";
import { browserTenantSlug } from "../../../src/tenant-host.js";
import { ContactSupportLink } from "../contact-support-link.js";

export default function ForgotPasswordPage() {
  const [tenantSlug, setTenantSlug] = useState("");
  const [hostTenantSlug, setHostTenantSlug] = useState("");
  const [loginName, setLoginName] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loginHref = hostTenantSlug ? "/giris" : tenantSlug ? `/k/${encodeURIComponent(tenantSlug)}/giris` : "/login";

  useEffect(() => {
    const fromHost = browserTenantSlug() ?? "";
    setHostTenantSlug(fromHost);
    setTenantSlug(fromHost || new URLSearchParams(window.location.search).get("tenant")?.trim() || "");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsSubmitting(true);
    try {
      await requestPasswordReset({
        ...(!hostTenantSlug ? { tenantSlug: tenantSlug.trim() } : {}),
        loginName: loginName.trim(),
      });
      setStatus("İsteğiniz alındı. Bilgiler eşleşiyor ve kayıtlı iletişim kanalı aktifse şifre yenileme adımları paylaşılır. Mesaj gelmezse kurum yöneticinizden şifrenizi sıfırlamasını isteyin.");
    } catch {
      setStatus("İstek şu anda tamamlanamadı. Lütfen biraz sonra tekrar deneyin.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="next-auth-panel" aria-labelledby="forgot-password-title">
      <div className="next-brand">
        <span className="next-brand-mark">{appBrand.mark}</span>
        <span>{appBrand.name}</span>
      </div>
      <form className="next-form" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="forgot-password-title">Şifremi unuttum</h1>
        <p className="next-status-note">Kullanıcı adınızı veya doğrulanmış e-postanızı girin.</p>
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
        <Field label="Kullanıcı adı veya e-posta">
          <Input
            name="loginName"
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        {status ? <p className="next-status-note" role="status">{status}</p> : null}
        <Button type="submit" disabled={isSubmitting} loading={isSubmitting} loadingLabel="Gönderiliyor">
          Yenileme bağlantısı gönder
        </Button>
        <Link className="next-auth-link" href={loginHref}>Girişe dön</Link>
        <ContactSupportLink />
      </form>
      <aside className="next-auth-context" aria-label="Şifre yenileme güven bilgisi">
        <p className="next-section-eyebrow">{tenantSlug ? "Kurum hesabı" : "Güvenli şifre yenileme"}</p>
        <h2>Bu ekran hesabın bulunup bulunmadığını göstermez.</h2>
        <p>Kurum adresi sizi doğru hesaba yönlendirir. Güvenliğiniz için hesabın ve mesaj teslimatının durumu burada açıklanmaz.</p>
      </aside>
    </section>
  );
}
