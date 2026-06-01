"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../providers.js";

const demoAccounts = [
  { label: "Kurum yöneticisi", email: "admin-a@example.test", path: "/kurum" },
  { label: "Öğretmen", email: "teacher-a@example.test", path: "/ogretmen" },
  { label: "Öğrenci", email: "student-a@example.test", path: "/ogrenci" },
  { label: "Veli", email: "guardian-a@example.test", path: "/veli" },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const { auth, isBootstrapping, login } = useAuth();
  const [email, setEmail] = useState("admin-a@example.test");
  const [password, setPassword] = useState("password");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isBootstrapping && auth) {
      router.replace("/kurum");
    }
  }, [auth, isBootstrapping, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.replace("/kurum");
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
