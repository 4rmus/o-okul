"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@o-okul/ui";
import { requestPasswordReset } from "../../../src/api-client.js";
import { appBrand } from "../../../src/brand.js";

export default function ForgotPasswordPage() {
  const [tenantSlug, setTenantSlug] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setTenantSlug(new URLSearchParams(window.location.search).get("tenant")?.trim() ?? "");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsSubmitting(true);
    try {
      await requestPasswordReset({ tenantSlug: tenantSlug.trim(), nationalId: nationalId.trim() });
      setStatus("Bilgiler eşleşiyor ve kayıtlı iletişim kanalı aktifse parola yenileme bağlantısı gönderildi. Mesaj gelmezse kurum yöneticinizden parolanızı sıfırlamasını isteyin.");
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
        <h1 id="forgot-password-title">Parolamı unuttum</h1>
        <p className="next-status-note">Kurum kodunuzu ve kullanıcı adınız olan TC kimlik numaranızı girin.</p>
        <Field label="Kurum kodu">
          <Input
            name="tenantSlug"
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
            autoComplete="organization"
            required
          />
        </Field>
        <Field label="Kullanıcı Adı">
          <Input
            name="nationalId"
            value={nationalId}
            onChange={(event) => setNationalId(event.target.value)}
            autoComplete="username"
            inputMode="numeric"
            required
          />
        </Field>
        {status ? <p className="next-status-note" role="status">{status}</p> : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Gönderiliyor" : "Yenileme bağlantısı gönder"}
        </Button>
        <Link className="next-auth-link" href="/login">Girişe dön</Link>
      </form>
    </section>
  );
}
