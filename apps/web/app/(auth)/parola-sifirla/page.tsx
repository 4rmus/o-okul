"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@o-okul/ui";
import { confirmPasswordReset } from "../../../src/api-client.js";
import { appBrand } from "../../../src/brand.js";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token")?.trim() ?? "");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("Parola yenileme bağlantısı geçersiz.");
      return;
    }
    if (password.length < 8) {
      setError("Yeni parola en az 8 karakter olmalıdır.");
      return;
    }
    if (password !== passwordAgain) {
      setError("Parolalar eşleşmiyor.");
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
        <h1 id="reset-password-title">Yeni parola</h1>
        {isComplete ? (
          <>
            <p className="next-status-note" role="status">Parolanız yenilendi. Diğer cihazlardaki oturumlar kapatıldı.</p>
            <Link className="uh-button uh-button--primary uh-button--md" href="/login">Giriş yap</Link>
          </>
        ) : (
          <>
            <Field label="Yeni parola">
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
            <Field label="Yeni parola tekrar">
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
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Yenileniyor" : "Parolayı yenile"}
            </Button>
          </>
        )}
      </form>
    </section>
  );
}
