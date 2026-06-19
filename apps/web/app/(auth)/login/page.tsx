"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthResponse, MfaChallengeResponse } from "@uzman-hocam/shared-types";
import { Button, Checkbox, Field, Input, SegmentedControl } from "@uzman-hocam/ui";
import { useAuth } from "../../providers.js";
import { MfaRequiredError } from "../../../src/api-client.js";

const demoAccounts = [
  { label: "Kurum yöneticisi", email: "admin@demo.local", path: "/kurum" },
  { label: "Öğretmen", email: "teacher@demo.local", path: "/ogretmen" },
  { label: "Öğrenci", email: "student@demo.local", path: "/ogrenci" },
  { label: "Veli", email: "guardian@demo.local", path: "/veli" },
] as const;

const rememberedEmailStorageKey = "des.rememberedLoginEmail";
const demoLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === "true" || process.env.NODE_ENV !== "production";

export default function LoginPage() {
  const router = useRouter();
  const { auth, isBootstrapping, login, verifyMfa } = useAuth();
  const [email, setEmail] = useState(demoLoginEnabled ? "admin@demo.local" : "");
  const [password, setPassword] = useState(demoLoginEnabled ? "password" : "");
  const [rememberMe, setRememberMe] = useState(false);
  const [pendingMfa, setPendingMfa] = useState<MfaChallengeResponse | null>(null);
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery_code">("totp");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const rememberedEmail = readRememberedEmail();
    if (!rememberedEmail) return;
    setEmail(rememberedEmail);
    setRememberMe(true);
  }, []);

  useEffect(() => {
    if (!isBootstrapping && auth) {
      router.replace(getAuthHomePath(auth));
    }
  }, [auth, isBootstrapping, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const formEmail = String(formData.get("email") ?? "").trim();
    const formPassword = String(formData.get("password") ?? "");

    try {
      if (pendingMfa) {
        await verifyMfa(pendingMfa.challengeToken, mfaMethod === "totp" ? { totpCode: mfaCode } : { recoveryCode: mfaCode });
      } else {
        await login(formEmail, formPassword);
      }
      saveRememberedEmail(formEmail, rememberMe);
    } catch (caught) {
      if (caught instanceof MfaRequiredError) {
        setPendingMfa(caught.challenge);
        setMfaCode("");
        setError("");
        return;
      }
      setError(pendingMfa ? "Doğrulama kodu geçersiz." : "E-posta veya şifre hatalı.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function loginAs(demoEmail: string, path: string) {
    setError("");
    setIsSubmitting(true);

    try {
      await login(demoEmail, "password");
      saveRememberedEmail(demoEmail, rememberMe);
      router.replace(path);
    } catch (caught) {
      if (caught instanceof MfaRequiredError) {
        setEmail(demoEmail);
        setPendingMfa(caught.challenge);
        setMfaCode("");
        return;
      }
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
      <form className="next-form" aria-label="Giriş formu" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="login-title">Giriş</h1>
        <Field label="E-posta" description="Kurum hesabınız veya portal e-postanız.">
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </Field>
        <Field label="Şifre">
          <Input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={Boolean(pendingMfa)}
          />
        </Field>
        {pendingMfa ? (
          <div className="next-form-section">
            <SegmentedControl className="next-segmented" label="Doğrulama yöntemi">
              <button
                type="button"
                aria-pressed={mfaMethod === "totp"}
                onClick={() => setMfaMethod("totp")}
              >
                TOTP
              </button>
              <button
                type="button"
                aria-pressed={mfaMethod === "recovery_code"}
                onClick={() => setMfaMethod("recovery_code")}
              >
                Kurtarma
              </button>
            </SegmentedControl>
            <Field label={mfaMethod === "totp" ? "Doğrulama kodu" : "Kurtarma kodu"}>
              <Input
                name="mfaCode"
                type="text"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode={mfaMethod === "totp" ? "numeric" : "text"}
              />
            </Field>
          </div>
        ) : null}
        <Checkbox
          checked={rememberMe}
          description="Bu tarayıcıda yalnız e-posta adresi saklanır."
          label="Beni hatırla"
          name="rememberMe"
          onChange={(event) => setRememberMe(event.target.checked)}
        />
        {error ? <p className="next-form-error">{error}</p> : null}
        <Button type="submit" disabled={isSubmitting || isBootstrapping}>
          {isSubmitting ? "Giriş yapılıyor" : pendingMfa ? "Doğrula" : "Giriş yap"}
        </Button>
      </form>
      {demoLoginEnabled ? (
        <div className="next-demo-accounts" aria-label="Demo ortam hesapları">
          <h2>Demo ortam hesapları</h2>
          <p>Yalnız demo/local ortamda hızlı önizleme için bir rol seçin.</p>
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
      ) : null}
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

function readRememberedEmail() {
  try {
    return window.localStorage.getItem(rememberedEmailStorageKey) ?? "";
  } catch {
    return "";
  }
}

function saveRememberedEmail(email: string, remember: boolean) {
  try {
    if (remember) {
      window.localStorage.setItem(rememberedEmailStorageKey, email);
    } else {
      window.localStorage.removeItem(rememberedEmailStorageKey);
    }
  } catch {
    // Local storage kapalıysa giriş akışı etkilenmemeli.
  }
}
