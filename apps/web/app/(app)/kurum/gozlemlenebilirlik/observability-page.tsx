"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@uzman-hocam/ui";
import { RefreshCw } from "lucide-react";
import { apiUrl } from "../../../../src/api-client.js";
import { EvidenceGateSection, EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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

interface EndpointState<TData> {
  data: TData | null;
  error: string;
  ok: boolean;
  status: number;
}

interface HealthStatus {
  status: "ok";
}

interface MetricsSummary {
  requestCount: number | null;
  uptimeSeconds: number | null;
}

interface ObservabilityStatus {
  health: EndpointState<HealthStatus>;
  metrics: EndpointState<MetricsSummary>;
  ready: EndpointState<ReadyStatus>;
}

interface ReadyStatus {
  dependencies: {
    postgres: "ok" | "down";
    redis: "ok" | "down";
  };
  status: "ready";
}

interface ObservabilitySignalRow {
  detail: string;
  key: string;
  label: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

interface ObservabilityChecklistRow {
  detail: string;
  key: string;
  label: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

export function ObservabilityPage() {
  const observabilityQuery = useQuery({
    queryKey: ["next-observability-status"],
    queryFn: loadObservabilityStatus,
    refetchOnWindowFocus: false,
  });
  const status = observabilityQuery.data;
  const summaryItems = buildObservabilitySummaryItems(status);
  const summaryBadges = buildObservabilitySummaryBadges(status);
  const summaryActions = buildObservabilitySummaryActions(status);
  const signalRows = buildObservabilitySignalRows(status);
  const dashboardRows = buildChecklistRows(dashboardPanels, "Staging/prod kanıtı", "Grafana/Loki panel kanıtı release evidence dosyasında tamamlanır.", "warning");
  const alertRows = buildChecklistRows(alertRules, "Smoke gerekir", "Webhook ve Sentry kanalları PII içermeyen canlı smoke ile doğrulanır.", "warning");
  const telemetryRows = buildChecklistRows(telemetryChecks, "Evidence gerekir", "Telemetri kontrolü staging veya production kanıtında tamamlanır.", "info");

  return (
    <PageFrame
      actions={
        <>
          <ReferenceBadge />
          <Button onClick={() => void observabilityQuery.refetch()}>
            <RefreshCw size={17} aria-hidden="true" />
            Yenile
          </Button>
        </>
      }
      title="Gözlemlenebilirlik"
      subtitle="Canlıya çıkış öncesi metrik, log ve alert kanıt kapılarını izle."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Gözlemlenebilirlik operasyon özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Gözlemlenebilirlik güven durumu"
        title="Telemetri Kanıt Gücü"
        description="Yapılandırılmış API health/metrics sinyali bu ekrandadır; Grafana, Loki, Sentry ve alert doğrulamaları ayrı evidence kapısıdır."
        items={[
          {
            label: "API kaynağı",
            value: sourceLabel(apiUrl),
            tone: sourceLabel(apiUrl) === "Lokal/dev" ? "warning" : "info",
            scope: sourceLabel(apiUrl) === "Lokal/dev" ? "local-static" : "configured-api",
            detail: "Health, readiness ve metrics endpointleri aynı kaynaktan okunur.",
          },
          {
            label: "Anlık endpoint",
            value: observabilityEndpointState(status),
            tone: observabilityEndpointTone(status),
            scope: "configured-api",
            detail: "Sonuçlar ortam kanıtı değil, yapılandırılmış endpoint yanıtıdır.",
          },
          {
            label: "Alert kanalı",
            value: "Smoke gerekir",
            tone: "warning",
            scope: "live-required",
            detail: "Webhook ve Sentry test olayları PII içermeyen ayrı smoke ile kanıtlanır.",
          },
          {
            label: "Dashboard",
            value: "Staging/prod",
            tone: "danger",
            scope: "staging-prod",
            detail: "Grafana ve Loki panel kanıtları release evidence dosyasında tamamlanır.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: temel health ve metrics yapılandırılmış API kaynağından okunur."
        reason="API yaşam, hazırlık ve Prometheus metrik endpointleri bu ekrandan okunur; Grafana/Loki ve alert doğrulaması hâlâ kanıt kapısıdır."
        nextStep="C2'nin sonraki adımı gerçek alert/webhook ve log panel durumunu ayrı kaynaklardan okumaktır."
      />
      <Panel
        aria-label="Gözlemlenebilirlik detayları"
        description="Health, readiness, metrics ve bağımlılık sinyalleri yapılandırılmış API kaynağından okunur."
        title="Anlık Durum"
      >
        {observabilityQuery.isPending ? <p>Durum alınıyor</p> : null}
        {observabilityQuery.isError ? <p>Gözlemlenebilirlik bilgisi alınamadı.</p> : null}
        <DataTable
          caption="Gözlemlenebilirlik endpointleri"
          columns={signalColumns}
          density="compact"
          description="Health, readiness, metrics, uptime ve bağımlılık sinyalleri."
          getRowKey={(row) => row.key}
          loading={observabilityQuery.isPending}
          rows={signalRows}
        />
      </Panel>
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Gözlemlenebilirlik kapıları" gates={observabilityGates} />
      <Panel
        aria-label="Dashboard panelleri"
        description="Grafana ve Loki tarafında beklenen izleme yüzeyleri; release kanıtı ayrı evidence dosyasındadır."
        title="Dashboard Panelleri"
      >
        <DataTable
          caption="Gözlemlenebilirlik dashboard panelleri"
          columns={checklistColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={dashboardRows}
        />
      </Panel>
      <Panel
        aria-label="Alert kuralları"
        description="Alert kuralları canlı webhook/Sentry smoke ile doğrulanmadan release kanıtı sayılmaz."
        title="Alert Kuralları"
      >
        <DataTable
          caption="Gözlemlenebilirlik alert kuralları"
          columns={checklistColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={alertRows}
        />
      </Panel>
      <Panel
        aria-label="Telemetri kontrolleri"
        description="Prometheus, Grafana, Loki ve alert kanal kontrolleri staging/prod evidence ile tamamlanır."
        title="Telemetri Kontrolleri"
      >
        <DataTable
          caption="Gözlemlenebilirlik telemetri kontrolleri"
          columns={checklistColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={telemetryRows}
        />
      </Panel>
    </PageFrame>
  );
}

const signalColumns: Array<DataTableColumn<ObservabilitySignalRow>> = [
  {
    key: "signal",
    header: "Sinyal",
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
    key: "detail",
    header: "Bağlam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

const checklistColumns: Array<DataTableColumn<ObservabilityChecklistRow>> = [
  {
    key: "item",
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
    key: "detail",
    header: "Kanıt bağlamı",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildObservabilitySummaryItems(status: ObservabilityStatus | undefined): OperationSummaryItem[] {
  return [
    {
      description: "API yaşam endpointi",
      key: "api",
      label: "API",
      tone: endpointSummaryTone(status?.health),
      value: endpointStatusText(status?.health, "Çalışıyor"),
    },
    {
      description: "Postgres ve Redis hazırlığı",
      key: "ready",
      label: "Hazırlık",
      tone: endpointSummaryTone(status?.ready),
      value: endpointStatusText(status?.ready, "Hazır"),
    },
    {
      description: "Prometheus HTTP request sayacı",
      key: "request-count",
      label: "HTTP istek",
      tone: status?.metrics.ok ? "info" : status ? "warning" : "default",
      value: formatCount(status?.metrics.data?.requestCount),
    },
    {
      description: "Process uptime metriği",
      key: "uptime",
      label: "Uptime",
      tone: status?.metrics.ok ? "info" : status ? "warning" : "default",
      value: formatUptime(status?.metrics.data?.uptimeSeconds),
    },
  ];
}

function buildObservabilitySummaryBadges(status: ObservabilityStatus | undefined): OperationSummaryBadge[] {
  return [
    {
      key: "source",
      label: sourceLabel(apiUrl),
      tone: sourceLabel(apiUrl) === "Lokal/dev" ? "warning" : "info",
    },
    {
      key: "endpoint",
      label: `Endpoint ${observabilityEndpointState(status).toLocaleLowerCase("tr-TR")}`,
      tone: observabilityEndpointTone(status),
    },
    {
      key: "alert",
      label: "Alert smoke gerekir",
      tone: "warning",
    },
    {
      key: "dashboard",
      label: "Dashboard kanıtı ayrı",
      tone: "warning",
    },
  ];
}

function buildObservabilitySummaryActions(status: ObservabilityStatus | undefined): OperationSummaryAction[] {
  return [
    {
      detail: "Health, readiness ve metrics endpointleri",
      key: "endpoint-coverage",
      label: "Endpoint kapsamı",
      status: status ? "Okundu" : "Bekleniyor",
      tone: status ? "info" : "neutral",
      value: "3 sinyal",
    },
    {
      detail: "Webhook ve Sentry test olayları canlı kanıt ister",
      key: "alert-channel",
      label: "Alert kanalı",
      status: "Smoke gerekir",
      tone: "warning",
      value: "Canlı kanıt",
    },
    {
      detail: "Grafana ve Loki panel ekran görüntüleri release evidence ile tamamlanır",
      key: "dashboard",
      label: "Dashboard kanıtı",
      status: "Ayrı kapı",
      tone: "warning",
      value: "Staging/prod",
    },
  ];
}

function buildObservabilitySignalRows(status: ObservabilityStatus | undefined): ObservabilitySignalRow[] {
  return [
    {
      detail: "API yaşam endpointi",
      key: "health",
      label: "/health",
      tone: endpointTone(status?.health),
      value: status ? endpointLabel(status.health) : "Bekleniyor",
    },
    {
      detail: "Readiness ve bağımlılık endpointi",
      key: "ready",
      label: "/health/ready",
      tone: endpointTone(status?.ready),
      value: status ? endpointLabel(status.ready) : "Bekleniyor",
    },
    {
      detail: "Prometheus metrics endpointi",
      key: "metrics",
      label: "/metrics",
      tone: endpointTone(status?.metrics),
      value: status ? endpointLabel(status.metrics) : "Bekleniyor",
    },
    {
      detail: "Metrics endpointinden okunan process uptime",
      key: "uptime",
      label: "Uptime",
      tone: status?.metrics.ok ? "info" : status ? "warning" : "neutral",
      value: formatUptime(status?.metrics.data?.uptimeSeconds),
    },
    {
      detail: "Readiness endpointinden gelen Postgres bağlantısı",
      key: "postgres",
      label: "Postgres",
      tone: dependencyTone(dependencyLabel(status?.ready.data?.dependencies.postgres, status?.ready.ok)),
      value: dependencyLabel(status?.ready.data?.dependencies.postgres, status?.ready.ok),
    },
    {
      detail: "Readiness endpointinden gelen Redis bağlantısı",
      key: "redis",
      label: "Redis",
      tone: dependencyTone(dependencyLabel(status?.ready.data?.dependencies.redis, status?.ready.ok)),
      value: dependencyLabel(status?.ready.data?.dependencies.redis, status?.ready.ok),
    },
  ];
}

function buildChecklistRows(
  items: readonly string[],
  value: string,
  detail: string,
  tone: StatusBadgeProps["tone"],
): ObservabilityChecklistRow[] {
  return items.map((item) => ({
    detail,
    key: item,
    label: item,
    tone,
    value,
  }));
}

async function loadObservabilityStatus(): Promise<ObservabilityStatus> {
  const [health, ready, metrics] = await Promise.all([
    loadJsonEndpoint<HealthStatus>(`${apiUrl}/health`),
    loadJsonEndpoint<ReadyStatus>(`${apiUrl}/health/ready`),
    loadMetrics(`${apiUrl}/metrics`),
  ]);
  return { health, metrics, ready };
}

async function loadJsonEndpoint<TData>(url: string): Promise<EndpointState<TData>> {
  try {
    const response = await fetch(url);
    const data = await readJson<TData>(response);
    return {
      data: response.ok ? (data as TData) : null,
      error: response.ok ? "" : readErrorMessage(data),
      ok: response.ok,
      status: response.status,
    };
  } catch {
    return failedEndpointState();
  }
}

async function loadMetrics(url: string): Promise<EndpointState<MetricsSummary>> {
  try {
    const response = await fetch(url);
    const text = await response.text();
    return {
      data: response.ok ? parseMetrics(text) : null,
      error: response.ok ? "" : text,
      ok: response.ok,
      status: response.status,
    };
  } catch {
    return failedEndpointState();
  }
}

async function readJson<TData>(response: Response): Promise<TData | unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readErrorMessage(data: unknown) {
  if (!data || typeof data !== "object") return "Endpoint yanıt vermedi.";
  const error = (data as { error?: { message?: string } }).error;
  return error?.message ?? "Endpoint başarısız döndü.";
}

function failedEndpointState<TData>(): EndpointState<TData> {
  return {
    data: null,
    error: "Endpoint yanıt vermedi.",
    ok: false,
    status: 0,
  };
}

function parseMetrics(text: string): MetricsSummary {
  const uptime = readMetricValue(text, "uzman_hocam_process_uptime_seconds");
  const requests = text
    .split("\n")
    .filter((line) => line.startsWith("uzman_hocam_http_requests_total"))
    .reduce((total, line) => total + (Number(line.split(" ").at(-1)) || 0), 0);
  return {
    requestCount: requests,
    uptimeSeconds: uptime,
  };
}

function readMetricValue(text: string, metricName: string) {
  const line = text.split("\n").find((candidate) => candidate.startsWith(`${metricName} `));
  if (!line) return null;
  const value = Number(line.split(" ").at(-1));
  return Number.isFinite(value) ? value : null;
}

function endpointStatusText(endpoint: EndpointState<unknown> | undefined, successLabel: string) {
  if (!endpoint) return "Bekleniyor";
  return endpoint.ok ? successLabel : "Sorunlu";
}

function endpointSummaryTone(endpoint: EndpointState<unknown> | undefined): NonNullable<OperationSummaryItem["tone"]> {
  if (!endpoint) return "default";
  return endpoint.ok ? "success" : "warning";
}

function endpointTone(endpoint: EndpointState<unknown> | undefined): StatusBadgeProps["tone"] {
  if (!endpoint) return "neutral";
  return endpoint.ok ? "success" : "warning";
}

function observabilityEndpointState(status: ObservabilityStatus | undefined) {
  if (!status) return "Bekleniyor";
  if (status.health.ok && status.ready.ok && status.metrics.ok) return "Okunuyor";
  if (status.health.ok || status.ready.ok || status.metrics.ok) return "Kısmi";
  return "Bekleniyor";
}

function observabilityEndpointTone(status: ObservabilityStatus | undefined): StatusBadgeProps["tone"] {
  if (!status) return "neutral";
  if (status.health.ok && status.ready.ok && status.metrics.ok) return "success";
  if (status.health.ok || status.ready.ok || status.metrics.ok) return "warning";
  return "danger";
}

function endpointLabel(endpoint: EndpointState<unknown>) {
  if (!endpoint.ok && endpoint.status === 0) return endpoint.error;
  return endpoint.ok ? `${endpoint.status} tamam` : `${endpoint.status} ${endpoint.error}`;
}

function dependencyLabel(value: "ok" | "down" | undefined, endpointOk: boolean | undefined) {
  if (value === "ok") return "Hazır";
  if (value === "down") return "Hazır değil";
  return endpointOk === false ? "Hazır değil" : "-";
}

function dependencyTone(label: string): StatusBadgeProps["tone"] {
  if (label === "Hazır") return "success";
  if (label === "Hazır değil") return "warning";
  return "neutral";
}

function formatCount(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : new Intl.NumberFormat("tr-TR").format(value);
}

function formatUptime(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  if (value < 60) return `${Math.round(value)} sn`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes} dk ${seconds} sn`;
}

function sourceLabel(value: string) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value) ? "Lokal/dev" : "Yapılandırılmış API";
}
