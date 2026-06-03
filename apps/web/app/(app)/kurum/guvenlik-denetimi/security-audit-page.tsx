"use client";

import { EvidenceGateSection, EvidenceListSection } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

const securityGates = [
  {
    title: "Güvenlik denetimi",
    command: "SECURITY_AUDIT_TARGET=file://$PWD/docs/evidence-templates/security-audit.example.json pnpm security:audit:check",
    status: "Kanıt raporu gerekir",
    detail: "Staging veya production güvenlik raporu PASS dönmeli ve kritik bulgu içermemeli.",
  },
  {
    title: "Üretim env kontrolü",
    command: "pnpm prod:env:check",
    status: "Canlı env gerekir",
    detail: "Cookie, JWT, CORS, provider ve güvenli production ayarları doğrulanır.",
  },
  {
    title: "Canlı RLS kontrolü",
    command: "pnpm db:rls:check:live",
    status: "Canlı DB gerekir",
    detail: "Tenant tablolarında RLS ve app rol erişimi canlı veritabanında kontrol edilir.",
  },
  {
    title: "HTTPS smoke",
    command: "pnpm traefik:https:smoke",
    status: "Staging/prod domain gerekir",
    detail: "HTTPS health ve HSTS gibi güvenlik header'ları uçtan uca doğrulanır.",
  },
] as const;

const securityHeaders = [
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Content-Security-Policy",
];

const authControls = [
  "COOKIE_SECURE=true",
  "login lockout",
  "strong JWT secrets",
  "refresh session revocation",
];

const dataControls = [
  "RLS live check",
  "tenant isolation",
  "audit PII redaction",
  "SENTRY_SEND_DEFAULT_PII=false",
];

export function SecurityAuditPage() {
  return (
    <PageFrame
      title="Güvenlik Denetimi"
      subtitle="Canlıya çıkış öncesi güvenlik kanıt kapılarını ve zorunlu kontrolleri izle."
    >
      <MetricPanelGrid
        ariaLabel="Güvenlik denetimi özeti"
        metrics={[
          { label: "Denetim raporu", value: "Kanıt gerekir" },
          { label: "HTTPS", value: "2xx + HSTS" },
          { label: "RLS", value: "Canlı kontrol" },
        ]}
      />
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Güvenlik denetimi kapıları" gates={securityGates} />
      <EvidenceListSection title="Header Kontrolleri" ariaLabel="Header kontrolleri" items={securityHeaders} />
      <EvidenceListSection title="Auth Kontrolleri" ariaLabel="Auth kontrolleri" items={authControls} />
      <EvidenceListSection title="Veri Kontrolleri" ariaLabel="Veri kontrolleri" items={dataControls} />
    </PageFrame>
  );
}
