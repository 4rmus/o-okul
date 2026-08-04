"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { Building2, ExternalLink } from "lucide-react";
import { Button, Field, Input } from "@o-okul/ui";
import { appBrand } from "../../src/brand.js";
import { tenantLoginOrigin } from "../../src/tenant-host.js";

export function TenantLocatorPage({ domain }: { domain: string }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const slug = locatorSlug(value, domain);
      window.location.assign(tenantLoginOrigin(slug, domain, window.location.protocol));
    } catch {
      setError("Geçerli kurum adresini yazın.");
    }
  }

  return (
    <section className="next-auth-panel" aria-labelledby="locator-title">
      <div className="next-brand">
        <span className="next-brand-mark">{appBrand.mark}</span>
        <span>{appBrand.name}</span>
      </div>
      <form className="next-form" aria-label="Kurum adresi bulma formu" onSubmit={submit}>
        <h1 id="locator-title">Kurumunuza ilerleyin</h1>
        <p>Okulunuzun size verdiği kurum adresini yazın.</p>
        <Field label="Kurum adresi">
          <Input
            name="tenantSlug"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={`ornek-okul veya ornek-okul.${domain}`}
            autoComplete="organization"
            required
          />
        </Field>
        {error ? <p className="next-form-error" role="alert">{error}</p> : null}
        <Button type="submit">Kurum girişini aç</Button>
        <Link className="next-auth-link" href={`https://sistem.${domain}/giris`}>
          Sistem yöneticisi girişi <ExternalLink size={14} aria-hidden="true" />
        </Link>
      </form>
      <aside className="next-auth-context" aria-label="Kurum adresi bilgisi">
        <p className="next-section-eyebrow">Kuruma özel güvenli giriş</p>
        <h2>Her kurum kendi adresinde çalışır.</h2>
        <p>Öğrenci veya personel numaranızı ve şifrenizi yalnız kurumunuzun giriş sayfasında kullanın.</p>
        <ul><li><Building2 size={17} aria-hidden="true" />Kurum ve oturum bağlamı birlikte doğrulanır</li></ul>
      </aside>
    </section>
  );
}

function locatorSlug(value: string, domain: string): string {
  const raw = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const suffix = `.${domain}`;
  return raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw;
}
