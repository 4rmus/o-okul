"use client";

import { EvidenceGateSection, EvidenceListSection } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

const observabilityGates = [
  {
    title: "Observability UAT",
    command: "OBSERVABILITY_UAT_TARGET=file://$PWD/docs/evidence-templates/observability-uat.example.json pnpm observability:uat:check",
    status: "Kanıt raporu gerekir",
    detail: "Prometheus, Grafana, Loki ve alert kanalları staging veya production raporuyla doğrulanır.",
  },
  {
    title: "Alert webhook smoke",
    command: "ALERT_WEBHOOK_URL=https://alerts.example.test pnpm alert:webhook:smoke",
    status: "Webhook gerekir",
    detail: "Alert bildirim kanalına test olayı gönderilir ve 2xx yanıt beklenir.",
  },
  {
    title: "Sentry smoke",
    command: "SENTRY_SMOKE_CONFIRM=send pnpm sentry:smoke",
    status: "Sentry DSN gerekir",
    detail: "Sentry'ye PII içermeyen test olayı gönderilir.",
  },
] as const;

const dashboardPanels = [
  "API up",
  "Request rate",
  "Average duration",
  "Readiness failures",
  "Docker logs",
];

const alertRules = [
  "UzmanHocamApiDown",
  "UzmanHocamReadinessFailing",
  "UzmanHocamHigh5xxRate",
  "UzmanHocamSlowRequests",
];

const telemetryChecks = [
  "prometheusScrapeOk",
  "grafanaDashboardOk",
  "lokiLogPanelOk",
  "alertWebhookStatus 2xx",
];

export function ObservabilityPage() {
  return (
    <PageFrame
      title="Gözlemlenebilirlik"
      subtitle="Canlıya çıkış öncesi metrik, log ve alert kanıt kapılarını izle."
    >
      <MetricPanelGrid
        ariaLabel="Gözlemlenebilirlik özeti"
        metrics={[
          { label: "Prometheus", value: "Scrape gerekir" },
          { label: "Grafana/Loki", value: "Panel gerekir" },
          { label: "Alert", value: "Webhook 2xx" },
        ]}
      />
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Gözlemlenebilirlik kapıları" gates={observabilityGates} />
      <EvidenceListSection title="Dashboard Panelleri" ariaLabel="Dashboard panelleri" items={dashboardPanels} />
      <EvidenceListSection title="Alert Kuralları" ariaLabel="Alert kuralları" items={alertRules} />
      <EvidenceListSection title="Telemetri Kontrolleri" ariaLabel="Telemetri kontrolleri" items={telemetryChecks} />
    </PageFrame>
  );
}
