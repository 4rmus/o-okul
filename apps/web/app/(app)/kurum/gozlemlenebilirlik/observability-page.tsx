"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@uzman-hocam/ui";
import { RefreshCw } from "lucide-react";
import { apiUrl } from "../../../../src/api-client.js";
import { EvidenceGateSection, EvidenceListSection, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
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

export function ObservabilityPage() {
  const observabilityQuery = useQuery({
    queryKey: ["next-observability-status"],
    queryFn: loadObservabilityStatus,
    refetchOnWindowFocus: false,
  });
  const status = observabilityQuery.data;

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
      <MetricPanelGrid
        ariaLabel="Gözlemlenebilirlik özeti"
        metrics={[
          { label: "API", value: status?.health.ok ? "Çalışıyor" : "Sorunlu" },
          { label: "Hazırlık", value: status?.ready.ok ? "Hazır" : "Hazır değil" },
          { label: "HTTP istek", value: formatCount(status?.metrics.data?.requestCount) },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: temel health ve metrics canlıdır."
        reason="API yaşam, hazırlık ve Prometheus metrik endpointleri bu ekrandan okunur; Grafana/Loki ve alert doğrulaması hâlâ kanıt kapısıdır."
        nextStep="C2'nin sonraki adımı gerçek alert/webhook ve log panel durumunu ayrı kaynaklardan okumaktır."
      />
      <section className="next-report-list" aria-label="Canlı gözlemlenebilirlik detayları">
        <h2>Canlı Durum</h2>
        {observabilityQuery.isPending ? <p>Durum alınıyor</p> : null}
        {observabilityQuery.isError ? <p>Gözlemlenebilirlik bilgisi alınamadı.</p> : null}
        {status ? (
          <>
            <p>/health: {endpointLabel(status.health)}</p>
            <p>/health/ready: {endpointLabel(status.ready)}</p>
            <p>/metrics: {endpointLabel(status.metrics)}</p>
            <p>Uptime: {formatUptime(status.metrics.data?.uptimeSeconds)}</p>
            <p>Postgres: {dependencyLabel(status.ready.data?.dependencies.postgres, status.ready.ok)}</p>
            <p>Redis: {dependencyLabel(status.ready.data?.dependencies.redis, status.ready.ok)}</p>
          </>
        ) : null}
      </section>
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Gözlemlenebilirlik kapıları" gates={observabilityGates} />
      <EvidenceListSection title="Dashboard Panelleri" ariaLabel="Dashboard panelleri" items={dashboardPanels} />
      <EvidenceListSection title="Alert Kuralları" ariaLabel="Alert kuralları" items={alertRules} />
      <EvidenceListSection title="Telemetri Kontrolleri" ariaLabel="Telemetri kontrolleri" items={telemetryChecks} />
    </PageFrame>
  );
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
  const response = await fetch(url);
  const data = await readJson<TData>(response);
  return {
    data: response.ok ? (data as TData) : null,
    error: response.ok ? "" : readErrorMessage(data),
    ok: response.ok,
    status: response.status,
  };
}

async function loadMetrics(url: string): Promise<EndpointState<MetricsSummary>> {
  const response = await fetch(url);
  const text = await response.text();
  return {
    data: response.ok ? parseMetrics(text) : null,
    error: response.ok ? "" : text,
    ok: response.ok,
    status: response.status,
  };
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

function endpointLabel(endpoint: EndpointState<unknown>) {
  return endpoint.ok ? `${endpoint.status} tamam` : `${endpoint.status} ${endpoint.error}`;
}

function dependencyLabel(value: "ok" | "down" | undefined, endpointOk: boolean | undefined) {
  if (value === "ok") return "Hazır";
  if (value === "down") return "Hazır değil";
  return endpointOk === false ? "Hazır değil" : "-";
}

function formatCount(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : String(value);
}

function formatUptime(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  if (value < 60) return `${Math.round(value)} sn`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes} dk ${seconds} sn`;
}
