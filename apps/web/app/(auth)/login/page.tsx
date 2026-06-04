"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthResponse } from "@uzman-hocam/shared-types";
import { useAuth } from "../../providers.js";

const demoAccounts = [
  { label: "Sistem yöneticisi", email: "system@example.test", path: "/sistem" },
  { label: "Kurum yöneticisi", email: "admin@demo.local", path: "/kurum" },
  { label: "Öğretmen", email: "teacher@demo.local", path: "/ogretmen" },
  { label: "Öğrenci", email: "student@demo.local", path: "/ogrenci" },
  { label: "Veli", email: "guardian@demo.local", path: "/veli" },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const { auth, isBootstrapping, login } = useAuth();
  const [email, setEmail] = useState("admin@demo.local");
  const [password, setPassword] = useState("password");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isBootstrapping && auth) {
      router.replace(getAuthHomePath(auth));
    }
  }, [auth, isBootstrapping, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const formEmail = String(formData.get("email") ?? "").trim();
    const formPassword = String(formData.get("password") ?? "");

    try {
      await login(formEmail, formPassword);
    } catch {
      setError("E-posta veya şifre hatalı.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function loginAs(demoEmail: string, path: string) {
    setError("");
    setIsSubmitting(true);

    try {
      await login(demoEmail, "password");
      router.replace(path);
    } catch {
      setError("E-posta veya şifre hatalı.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="next-auth-panel" aria-labelledby="login-title">
      <div className="next-brand">
        <span className="next-brand-mark">UH</span>
        <span>Uzman Hocam</span>
      </div>
      <form className="next-form" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="login-title">Giriş</h1>
        <label>
          E-posta
          <input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Şifre
          <input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="next-form-error">{error}</p> : null}
        <button className="next-button" type="submit" disabled={isSubmitting || isBootstrapping}>
          {isSubmitting ? "Giriş yapılıyor" : "Giriş yap"}
        </button>
      </form>
      <div className="next-demo-accounts">
        <h2>Demo hesapları (şifre: password)</h2>
        <p>Hızlı önizleme için bir rol seçin.</p>
        {demoAccounts.map((account) => (
          <button
            key={account.email}
            type="button"
            className="next-demo-account"
            onClick={() => void loginAs(account.email, account.path)}
            disabled={isSubmitting || isBootstrapping}
          >
            <span>{account.label}</span>
            <span>{account.email}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function getAuthHomePath(auth: AuthResponse) {
  const { roles, subjectType } = auth.session;
  if (roles.includes("SYSTEM_ADMIN")) return "/sistem";
  if (roles.includes("TENANT_ADMIN") || roles.includes("ASSISTANT_ADMIN")) return "/kurum";
  if (roles.includes("TEACHER") && subjectType === "TEACHER") return "/ogretmen";
  if (roles.includes("STUDENT") && subjectType === "STUDENT") return "/ogrenci";
  if (roles.includes("GUARDIAN") && subjectType === "GUARDIAN") return "/veli";
  return "/login";
}
