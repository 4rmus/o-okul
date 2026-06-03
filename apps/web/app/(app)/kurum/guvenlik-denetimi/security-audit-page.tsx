"use client";

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
    <>
      <header className="next-topbar">
        <div>
          <h1>Güvenlik Denetimi</h1>
          <p>Canlıya çıkış öncesi güvenlik kanıt kapılarını ve zorunlu kontrolleri izle.</p>
        </div>
      </header>
      <section className="next-dashboard-grid" aria-label="Güvenlik denetimi özeti">
        <article className="next-metric">
          <span>Denetim raporu</span>
          <strong>Kanıt gerekir</strong>
        </article>
        <article className="next-metric">
          <span>HTTPS</span>
          <strong>2xx + HSTS</strong>
        </article>
        <article className="next-metric">
          <span>RLS</span>
          <strong>Canlı kontrol</strong>
        </article>
      </section>
      <section className="next-report-list" aria-label="Güvenlik denetimi kapıları">
        <h2>Kanıt Kapıları</h2>
        {securityGates.map((gate) => (
          <article key={gate.title}>
            <h3>{gate.title}</h3>
            <p>{gate.status}</p>
            <p>{gate.detail}</p>
            <code>{gate.command}</code>
          </article>
        ))}
      </section>
      <AuditList title="Header Kontrolleri" ariaLabel="Header kontrolleri" items={securityHeaders} />
      <AuditList title="Auth Kontrolleri" ariaLabel="Auth kontrolleri" items={authControls} />
      <AuditList title="Veri Kontrolleri" ariaLabel="Veri kontrolleri" items={dataControls} />
    </>
  );
}

function AuditList({ ariaLabel, items, title }: { ariaLabel: string; items: readonly string[]; title: string }) {
  return (
    <section className="next-report-list" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </section>
  );
}
