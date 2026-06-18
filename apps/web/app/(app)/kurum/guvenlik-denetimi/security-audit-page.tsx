"use client";

import { useQuery } from "@tanstack/react-query";
import type { AuditLogListItemRecord } from "@uzman-hocam/shared-types";
import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@uzman-hocam/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest } from "../../../../src/api-client.js";
import { EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const securityGates = [
  {
    title: "Güvenlik denetimi",
    command: "SECURITY_AUDIT_TARGET=file://$PWD/docs/evidence-templates/security-audit.example.json pnpm security:audit:check",
    status: "Kanıt raporu gerekir",
    evidenceState: "Release kararına yetmez",
    scope: "Yerel/statik",
    tone: "warning",
    detail: "Staging veya production güvenlik raporu PASS dönmeli ve kritik bulgu içermemeli.",
  },
  {
    title: "Üretim env kontrolü",
    command: "pnpm prod:env:check",
    status: "Canlı env gerekir",
    evidenceState: "Staging/prod",
    scope: "Staging/prod",
    tone: "danger",
    detail: "Cookie, JWT, CORS, provider ve güvenli production ayarları doğrulanır.",
  },
  {
    title: "Canlı RLS kontrolü",
    command: "pnpm db:rls:check:live",
    status: "Canlı DB gerekir",
    evidenceState: "Canlı kanıt",
    scope: "RLS canlı",
    tone: "danger",
    detail: "Tenant tablolarında RLS ve app rol erişimi canlı veritabanında kontrol edilir.",
  },
  {
    title: "HTTPS smoke",
    command: "pnpm traefik:https:smoke",
    status: "Staging/prod domain gerekir",
    evidenceState: "Staging/prod",
    scope: "Staging/prod",
    tone: "danger",
    detail: "HTTPS health ve HSTS gibi güvenlik header'ları uçtan uca doğrulanır.",
  },
] as const;

const securityHeaders = [
  buildSecurityControl("Strict-Transport-Security", "Header gerekir", "Staging/prod", "HTTPS smoke ve production response header kanıtında doğrulanır.", "warning"),
  buildSecurityControl("X-Content-Type-Options", "Header gerekir", "Staging/prod", "MIME sniffing koruması production response header kanıtında doğrulanır.", "warning"),
  buildSecurityControl("X-Frame-Options", "Header gerekir", "Staging/prod", "Clickjacking koruması production response header kanıtında doğrulanır.", "warning"),
  buildSecurityControl("Referrer-Policy", "Header gerekir", "Staging/prod", "Referrer sızıntı azaltımı production response header kanıtında doğrulanır.", "warning"),
  buildSecurityControl("Permissions-Policy", "Header gerekir", "Staging/prod", "Tarayıcı yetki yüzeyi production response header kanıtında doğrulanır.", "warning"),
  buildSecurityControl("Content-Security-Policy", "Header gerekir", "Staging/prod", "CSP politikası production response header kanıtında doğrulanır.", "warning"),
] as const;

const authControls = [
  buildSecurityControl("COOKIE_SECURE=true", "Prod env", "Production config", "Secure cookie ayarı prod env kapısında doğrulanır.", "warning"),
  buildSecurityControl("login lockout", "Auth kapısı", "Auth/session", "Brute force lockout davranışı auth güvenlik testlerinde doğrulanır.", "warning"),
  buildSecurityControl("strong JWT secrets", "Prod env", "Production config", "JWT secret gücü ve rotasyonu prod env kontrolünde kanıtlanır.", "warning"),
  buildSecurityControl("refresh session revocation", "Auth kapısı", "Auth/session", "Refresh session iptal akışı auth/session testlerinde doğrulanır.", "warning"),
] as const;

const dataControls = [
  buildSecurityControl("RLS live check", "Canlı kanıt", "RLS canlı", "Tenant tablolarında RLS canlı veritabanında doğrulanır.", "danger"),
  buildSecurityControl("tenant isolation", "Tenant/PII", "Tenant/PII", "Server/RLS tenant izolasyonu client filtresine güvenmeden kanıtlanır.", "warning"),
  buildSecurityControl("audit PII redaction", "PII ham gösterilmez", "Sunucu/audit", "Safe-list audit yanıtı ham aktör, değişiklik içeriği ve PII değerlerini basmaz.", "success"),
  buildSecurityControl("SENTRY_SEND_DEFAULT_PII=false", "PII kapalı", "Production config", "Sentry varsayılan PII gönderimi production config kanıtında kapalı tutulur.", "warning"),
] as const;

interface SecurityControlRow {
  detail: string;
  key: string;
  label: string;
  scope: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

interface SecurityControlDefinition {
  detail: string;
  label: string;
  scope: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

export function SecurityAuditPage() {
  const { auth } = useAuth();
  const securityEventsQuery = useQuery({
    queryKey: ["next-security-audit-events", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadSecurityEvents(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const securityEvents = securityEventsQuery.data ?? [];
  const securitySummaryItems = buildSecuritySummaryItems(securityEvents);
  const securitySummaryBadges = buildSecuritySummaryBadges(securityEvents);
  const securitySummaryActions = buildSecuritySummaryActions(securityEvents);
  const securityGateRows = buildSecurityGateRows();
  const securityHeaderRows = buildSecurityControlRows(securityHeaders);
  const authControlRows = buildSecurityControlRows(authControls);
  const dataControlRows = buildSecurityControlRows(dataControls);

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Güvenlik Denetimi"
      subtitle="Canlıya çıkış öncesi güvenlik kanıt kapılarını ve zorunlu kontrolleri izle."
    >
      <OperationSummary
        actions={securitySummaryActions}
        ariaLabel="Güvenlik denetimi operasyon özeti"
        badges={securitySummaryBadges}
        items={securitySummaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Güvenlik güven durumu"
        title="Güvenlik Kanıt Gücü"
        description="Panel canlı audit olaylarını okur; release kararını yalnız staging/prod güvenlik, env ve RLS kanıtları tamamlar."
        items={[
          {
            label: "Panel verisi",
            value: "Salt-okuma",
            tone: "info",
            scope: "server-audit",
            detail: "Audit log özetidir; gizli bulgu veya ham PII göstermez.",
          },
          {
            label: "Repo kontrolü",
            value: "Statik kapı",
            tone: "warning",
            scope: "local-static",
            detail: "security:audit:check dosya hedefiyle çalışır, canlı kanıt yerine geçmez.",
          },
          {
            label: "Canlı kanıt",
            value: "Staging/prod",
            tone: "danger",
            scope: "staging-prod",
            detail: "HTTPS, prod env ve RLS canlı smoke sonuçları ayrı evidence olarak gerekir.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: son güvenlik olayları canlı okunur."
        reason="Panel audit log üzerinden auth, kullanıcı, davet, KVKK ve tenant olaylarını salt-okunur gösterir; gizli production denetimi hâlâ CLI kanıt kapısıdır."
        nextStep="C3'ün sonraki adımı güvenlik denetim raporundaki uyarıları ayrı, PII içermeyen bir kaynakla bağlamaktır."
      />
      <Panel
        aria-label="Son güvenlik olayları"
        description="Safe-list audit kaynağından gelen kategori, kayıt ve tarih bilgisi ham aktör anahtarı veya değişiklik içeriği göstermeden listelenir."
        title="Son Güvenlik Olayları"
      >
        {securityEventsQuery.isPending ? <p>Olaylar alınıyor</p> : null}
        {securityEventsQuery.isError ? <p>Güvenlik olayları alınamadı.</p> : null}
        <DataTable
          caption="Güvenlik olayları"
          columns={securityEventColumns}
          density="compact"
          description="Kimlik, davet, KVKK, kurum ve kullanıcı olayları PII-safe etiketlerle listelenir."
          emptyText="Güvenlik olayı yok"
          error={securityEventsQuery.isError ? "Güvenlik olayları alınamadı." : undefined}
          getRowKey={(event) => event.id}
          loading={securityEventsQuery.isPending}
          rows={securityEventsQuery.isError ? [] : securityEvents}
        />
      </Panel>
      <Panel
        aria-label="Güvenlik denetimi kapıları"
        description="Security audit, prod env, canlı RLS ve HTTPS smoke release evidence olarak ayrı doğrulanır."
        title="Kanıt Kapıları"
      >
        <DataTable
          caption="Güvenlik denetimi kanıt kapıları"
          columns={securityControlColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={securityGateRows}
        />
      </Panel>
      <Panel
        aria-label="Header kontrolleri"
        description="Response header güvenliği staging/prod domain üzerinde doğrulanır; local/static sonuç release kararı değildir."
        title="Header Kontrolleri"
      >
        <DataTable
          caption="Güvenlik header kontrolleri"
          columns={securityControlColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={securityHeaderRows}
        />
      </Panel>
      <Panel
        aria-label="Auth kontrolleri"
        description="Cookie, lockout, JWT ve refresh session davranışı production env kapısında kanıtlanır."
        title="Auth Kontrolleri"
      >
        <DataTable
          caption="Güvenlik auth kontrolleri"
          columns={securityControlColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={authControlRows}
        />
      </Panel>
      <Panel
        aria-label="Veri kontrolleri"
        description="Tenant isolation, RLS ve PII redaction UI güvenli görünümün ötesinde server/RLS evidence ister."
        title="Veri Kontrolleri"
      >
        <DataTable
          caption="Güvenlik veri kontrolleri"
          columns={securityControlColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={dataControlRows}
        />
      </Panel>
    </PageFrame>
  );
}

const securityEventColumns: Array<DataTableColumn<AuditLogListItemRecord>> = [
  {
    key: "event",
    header: "Olay",
    mobilePriority: "primary",
    priority: "primary",
    render: (event) => (
      <span className="next-report-student-name">
        {formatSecurityEventAction(event)}
        <small>{formatSecurityActionLabel(event)}</small>
      </span>
    ),
    sticky: "left",
  },
  {
    key: "category",
    header: "Kategori",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (event) => <StatusBadge tone={securityEventCategoryTone(event.category)}>{formatSecurityCategory(event.category)}</StatusBadge>,
  },
  {
    key: "entity",
    header: "Kayıt",
    mobilePriority: "primary",
    priority: "primary",
    render: formatSecurityEntityType,
  },
  {
    key: "created",
    header: "Tarih",
    mobilePriority: "hidden",
    priority: "optional",
    render: (event) => formatDate(event.createdAt),
  },
];

const securityControlColumns: Array<DataTableColumn<SecurityControlRow>> = [
  {
    key: "control",
    header: "Kontrol",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => row.label,
    sticky: "left",
  },
  {
    key: "status",
    header: "Durum",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => <StatusBadge tone={row.tone}>{row.value}</StatusBadge>,
  },
  {
    key: "scope",
    header: "Kapsam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.scope,
  },
  {
    key: "detail",
    header: "Bağlam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildSecurityGateRows(): SecurityControlRow[] {
  return securityGates.map((gate) => ({
    detail: `${gate.detail} ${gate.command}`,
    key: gate.title,
    label: gate.title,
    scope: gate.scope,
    tone: gate.tone,
    value: gate.evidenceState,
  }));
}

function buildSecurityControlRows(items: readonly SecurityControlDefinition[]): SecurityControlRow[] {
  return items.map((item) => ({
    detail: item.detail,
    key: item.label,
    label: item.label,
    scope: item.scope,
    tone: item.tone,
    value: item.value,
  }));
}

function buildSecurityControl(
  label: string,
  value: string,
  scope: string,
  detail: string,
  tone: StatusBadgeProps["tone"],
): SecurityControlDefinition {
  return {
    detail,
    label,
    scope,
    tone,
    value,
  };
}

function buildSecuritySummaryItems(securityEvents: AuditLogListItemRecord[]): OperationSummaryItem[] {
  return [
    {
      description: "Safe-list audit kaynağından son güvenlik kategorisi",
      key: "latest-event",
      label: "Son olay",
      tone: securityEvents[0] ? "info" : "default",
      value: securityEvents[0] ? formatSecurityEventAction(securityEvents[0]) : "Yok",
    },
    {
      description: "HTTPS ve HSTS canlı smoke ile kanıtlanır",
      key: "https",
      label: "HTTPS",
      tone: "warning",
      value: "Staging/prod kanıt bekliyor",
    },
    {
      description: "PII-safe listeye düşen güvenlik olayı",
      key: "event-count",
      label: "Okunan olay",
      value: formatCount(securityEvents.length),
    },
    {
      description: "Ham audit değişiklik içeriği ve aktör anahtarları gösterilmez",
      key: "pii",
      label: "PII",
      tone: "success",
      value: "Maskeli",
    },
  ];
}

function buildSecuritySummaryBadges(securityEvents: AuditLogListItemRecord[]): OperationSummaryBadge[] {
  return [
    {
      key: "source",
      label: "Safe-list audit",
      tone: "success",
    },
    {
      key: "pii",
      label: "PII ham gösterilmez",
      tone: "success",
    },
    {
      key: "release",
      label: "Release kanıtı ayrı",
      tone: "warning",
    },
    {
      key: "events",
      label: securityEvents.length > 0 ? "Olay akışı var" : "Olay bekleniyor",
      tone: securityEvents.length > 0 ? "info" : "neutral",
    },
  ];
}

function buildSecuritySummaryActions(securityEvents: AuditLogListItemRecord[]): OperationSummaryAction[] {
  const latestCategory = securityEvents[0] ? formatSecurityCategory(securityEvents[0].category) : "Yok";
  return [
    {
      detail: "Ham audit endpointi yerine PII-safe liste kullanılır",
      key: "audit-source",
      label: "Audit kaynağı",
      status: "Safe-list",
      tone: "success",
      value: "/audit-logs/safe-list",
    },
    {
      detail: "Staging/prod güvenlik raporu ve prod env kapıları ayrı kalır",
      key: "evidence",
      label: "Kanıt kapsamı",
      status: "Ayrı kapı",
      tone: "warning",
      value: "Staging/prod",
    },
    {
      detail: "Son olay kategorisi release kararı değil, görünür operasyon sinyalidir",
      key: "latest-category",
      label: "Son kategori",
      status: securityEvents[0] ? "Okundu" : "Bekleniyor",
      tone: securityEvents[0] ? "info" : "neutral",
      value: latestCategory,
    },
  ];
}

async function loadSecurityEvents(accessToken: string) {
  const url = new URL(`${apiBaseUrl}/audit-logs/safe-list`);
  url.searchParams.set("sort", "-createdAt");
  url.searchParams.set("limit", "20");
  const auditLogs = await apiListRequest<AuditLogListItemRecord>(accessToken, url);
  return auditLogs.data.filter(isSecurityEvent).slice(0, 5);
}

function isSecurityEvent(record: AuditLogListItemRecord) {
  return ["identity", "invitation", "kvkk", "tenant", "user"].includes(record.category);
}

function formatSecurityCategory(category: AuditLogListItemRecord["category"]) {
  if (category === "identity") return "Kimlik";
  if (category === "invitation") return "Davet";
  if (category === "kvkk") return "KVKK";
  if (category === "tenant") return "Kurum";
  if (category === "user") return "Kullanıcı";
  return "Güvenlik";
}

function securityEventCategoryTone(category: AuditLogListItemRecord["category"]): StatusBadgeProps["tone"] {
  if (category === "identity" || category === "kvkk") return "warning";
  if (category === "tenant") return "info";
  return "neutral";
}

function formatSecurityEventAction(event: AuditLogListItemRecord) {
  if (event.category === "identity") return "Kimlik olayı";
  if (event.category === "invitation") return "Davet olayı";
  if (event.category === "kvkk") return "KVKK olayı";
  if (event.category === "tenant") return "Kurum olayı";
  if (event.category === "user") return "Kullanıcı olayı";
  return "Güvenlik olayı";
}

function formatSecurityActionLabel(record: AuditLogListItemRecord) {
  return record.actionLabel;
}

function formatSecurityEntityType(event: AuditLogListItemRecord) {
  return event.entityLabel;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}
