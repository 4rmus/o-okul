"use client";

import { useQuery } from "@tanstack/react-query";
import type { AuditLogRecord } from "@uzman-hocam/shared-types";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest } from "../../../../src/api-client.js";
import { EvidenceGateSection, EvidenceListSection, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
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
  const { auth } = useAuth();
  const securityEventsQuery = useQuery({
    queryKey: ["next-security-audit-events", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadSecurityEvents(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const securityEvents = securityEventsQuery.data ?? [];

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Güvenlik Denetimi"
      subtitle="Canlıya çıkış öncesi güvenlik kanıt kapılarını ve zorunlu kontrolleri izle."
    >
      <MetricPanelGrid
        ariaLabel="Güvenlik denetimi özeti"
        metrics={[
          { label: "Son olay", value: securityEvents[0]?.action ?? "Yok" },
          { label: "HTTPS", value: "2xx + HSTS" },
          { label: "Okunan olay", value: String(securityEvents.length) },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: son güvenlik olayları canlı okunur."
        reason="Panel audit log üzerinden auth, kullanıcı, davet, KVKK ve tenant olaylarını salt-okunur gösterir; gizli production denetimi hâlâ CLI kanıt kapısıdır."
        nextStep="C3'ün sonraki adımı güvenlik denetim raporundaki uyarıları ayrı, PII içermeyen bir kaynakla bağlamaktır."
      />
      <section className="next-report-list" aria-label="Son güvenlik olayları">
        <h2>Son Güvenlik Olayları</h2>
        {securityEventsQuery.isPending ? <p>Olaylar alınıyor</p> : null}
        {securityEventsQuery.isError ? <p>Güvenlik olayları alınamadı.</p> : null}
        {!securityEventsQuery.isPending && securityEvents.length === 0 ? <p>Güvenlik olayı yok</p> : null}
        {securityEvents.map((event) => (
          <article key={event.id}>
            <h3>{event.action}</h3>
            <p>{event.entityType}</p>
            <p>{formatDate(event.createdAt)}</p>
          </article>
        ))}
      </section>
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Güvenlik denetimi kapıları" gates={securityGates} />
      <EvidenceListSection title="Header Kontrolleri" ariaLabel="Header kontrolleri" items={securityHeaders} />
      <EvidenceListSection title="Auth Kontrolleri" ariaLabel="Auth kontrolleri" items={authControls} />
      <EvidenceListSection title="Veri Kontrolleri" ariaLabel="Veri kontrolleri" items={dataControls} />
    </PageFrame>
  );
}

async function loadSecurityEvents(accessToken: string) {
  const url = new URL(`${apiBaseUrl}/audit-logs`);
  url.searchParams.set("sort", "-createdAt");
  url.searchParams.set("limit", "20");
  const auditLogs = await apiListRequest<AuditLogRecord>(accessToken, url);
  return auditLogs.data.filter(isSecurityEvent).slice(0, 5);
}

function isSecurityEvent(record: AuditLogRecord) {
  return [
    "auth.",
    "identity_invitation.",
    "kvkk.",
    "tenant.",
    "user.",
  ].some((prefix) => record.action.startsWith(prefix));
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}
