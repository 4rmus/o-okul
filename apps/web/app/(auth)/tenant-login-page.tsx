"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthResponse, MfaChallengeResponse } from "@o-okul/shared-types";
import { Button, Field, Input, SegmentedControl } from "@o-okul/ui";
import { useAuth } from "../providers.js";
import { appBrand } from "../../src/brand.js";
import { MfaRequiredError } from "../../src/api-client.js";

interface TenantLoginPageProps {
  tenantSlug?: string;
}

export function TenantLoginPage({ tenantSlug: initialTenantSlug }: TenantLoginPageProps) {
  const router = useRouter();
  const { auth, isBootstrapping, login, verifyMfa } = useAuth();
  const lockedTenantSlug = initialTenantSlug?.trim() ?? "";
  const passwordLabel = lockedTenantSlug === "system" ? "Şifre" : "Telefon";
  const [tenantSlug, setTenantSlug] = useState(lockedTenantSlug);
  const [nationalId, setNationalId] = useState("");
  const [password, setPassword] = useState("");
  const [pendingMfa, setPendingMfa] = useState<MfaChallengeResponse | null>(null);
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery_code">("totp");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setTenantSlug(lockedTenantSlug);
  }, [lockedTenantSlug]);

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
    const formTenantSlug = lockedTenantSlug || String(formData.get("tenantSlug") ?? "").trim();
    const formNationalId = String(formData.get("nationalId") ?? "").trim();
    const formPassword = String(formData.get("password") ?? "");

    try {
      if (pendingMfa) {
        await verifyMfa(pendingMfa.challengeToken, mfaMethod === "totp" ? { totpCode: mfaCode } : { recoveryCode: mfaCode });
      } else {
        await login({ tenantSlug: formTenantSlug, nationalId: formNationalId, password: formPassword });
      }
    } catch (caught) {
      if (caught instanceof MfaRequiredError) {
        setPendingMfa(caught.challenge);
        setMfaCode("");
        setError("");
        return;
      }
      setError(pendingMfa ? "Doğrulama kodu geçersiz." : "Giriş bilgileri hatalı.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="next-auth-panel" aria-labelledby="login-title">
      <div className="next-brand">
        <span className="next-brand-mark">{appBrand.mark}</span>
        <span>{appBrand.name}</span>
      </div>
      <form className="next-form" aria-label="Giriş formu" onSubmit={(event) => void handleSubmit(event)}>
        <h1 id="login-title">Giriş</h1>
        {!lockedTenantSlug ? (
          <Field label="Kurum kodu">
            <Input
              name="tenantSlug"
              type="text"
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              autoComplete="organization"
              disabled={Boolean(pendingMfa)}
              required
            />
          </Field>
        ) : null}
        <Field label="TC kimlik no">
          <Input
            name="nationalId"
            type="text"
            value={nationalId}
            onChange={(event) => setNationalId(event.target.value)}
            autoComplete="username"
            inputMode="numeric"
            disabled={Boolean(pendingMfa)}
            required
          />
        </Field>
        <Field label={passwordLabel}>
          <Input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={Boolean(pendingMfa)}
            required
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
        {error ? <p className="next-form-error">{error}</p> : null}
        <Button type="submit" disabled={isSubmitting || isBootstrapping}>
          {isSubmitting ? "Giriş yapılıyor" : pendingMfa ? "Doğrula" : "Giriş yap"}
        </Button>
      </form>
    </section>
  );
}

function getAuthHomePath(auth: AuthResponse) {
  if (auth.session.mustChangePassword) return "/sifre-degistir";
  const { roles, subjectType } = auth.session;
  if (roles.includes("SYSTEM_ADMIN")) return "/sistem";
  if (roles.includes("TENANT_ADMIN") || roles.includes("ASSISTANT_ADMIN")) return "/kurum";
  if (roles.includes("TEACHER") && subjectType === "TEACHER") return "/ogretmen";
  if (roles.includes("STUDENT") && subjectType === "STUDENT") return "/ogrenci";
  if (roles.includes("GUARDIAN") && subjectType === "GUARDIAN") return "/veli";
  return "/login";
}
