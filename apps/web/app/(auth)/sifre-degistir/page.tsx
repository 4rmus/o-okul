"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@o-okul/ui";
import type { AuthResponse } from "@o-okul/shared-types";
import { appBrand } from "../../../src/brand.js";
import { useAuth } from "../../providers.js";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { auth, changePassword, isBootstrapping, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isBootstrapping) return;
    if (!auth) {
      router.replace("/login");
      return;
    }
    if (!auth.session.mustChangePassword) {
      router.replace(getAuthHomePath(auth));
    }
  }, [auth, isBootstrapping, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 15 || newPassword.length > 128) {
      setError("Yeni şifre 15-128 karakter olmalıdır.");
      return;
    }
    if (newPassword !== newPasswordAgain) {
      setError("Yeni şifreler aynı olmalı.");
      return;
    }
    setIsSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      router.replace(auth ? getAuthHomePath(auth) : "/login");
    } catch {
      setError("Şifre değiştirilemedi.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="next-auth-panel" aria-labelledby="change-password-title">
      <div className="next-brand">
        <span className="next-brand-mark">{appBrand.mark}</span>
        <span>{appBrand.name}</span>
      </div>
      <form className="next-form" aria-label="Şifre değiştirme formu" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="change-password-title">Şifre değiştir</h1>
        <Field label="Mevcut şifre">
          <Input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label="Yeni şifre">
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
          />
        </Field>
        <Field label="Yeni şifre tekrar">
          <Input
            type="password"
            value={newPasswordAgain}
            onChange={(event) => setNewPasswordAgain(event.target.value)}
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
          />
        </Field>
        {error ? <p className="next-form-error">{error}</p> : null}
        <Button type="submit" disabled={isSubmitting || isBootstrapping} loading={isSubmitting} loadingLabel="Kaydediliyor">
          Kaydet
        </Button>
        <Button type="button" variant="secondary" onClick={() => void logout()} disabled={isSubmitting}>
          Çıkış yap
        </Button>
      </form>
      <aside className="next-auth-context" aria-label="Zorunlu şifre değişikliği güven bilgisi">
        <p className="next-section-eyebrow">Doğrulanmış oturum</p>
        <h2>Devam etmeden önce geçici şifrenizi değiştirin.</h2>
        <p>Kurum ve rol kapsamınız mevcut oturumdan korunur; yeni şifre kaydedilene kadar çalışma alanına geçilmez.</p>
      </aside>
    </section>
  );
}

function getAuthHomePath(auth: AuthResponse) {
  const { roles, subjectType } = auth.session;
  if (roles.includes("SYSTEM_ADMIN")) return "/sistem";
  if (roles.some((role) => ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF"].includes(role))) return "/kurum";
  if (roles.includes("TEACHER") && subjectType === "TEACHER") return "/ogretmen";
  if (roles.includes("STUDENT") && subjectType === "STUDENT") return "/ogrenci";
  if (roles.includes("GUARDIAN") && subjectType === "GUARDIAN") return "/veli";
  return "/login";
}
