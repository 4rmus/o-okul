"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@uzman-hocam/ui";
import { RefreshCw } from "lucide-react";
import { apiUrl } from "../../../../src/api-client.js";
import { EvidenceTrustPanel } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

interface HealthStatus {
  status: "ok";
}

interface ReadyStatus {
  status: "ready";
  dependencies: {
    postgres: "ok" | "down";
    redis: "ok" | "down";
  };
}

interface SystemHealth {
  health: EndpointState<HealthStatus>;
  metrics: EndpointState<MetricsSummary>;
  ready: EndpointState<ReadyStatus>;
}

interface EndpointState<TData> {
  ok: boolean;
  status: number;
  data: TData | null;
  error: string;
}

interface MetricsSummary {
  uptimeSeconds: number | null;
  requestCount: number | null;
}

interface DependencyStatusRow {
  detail: string;
  key: string;
  label: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

interface EndpointStatusRow {
  detail: string;
  key: string;
  label: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

export function SystemHealthPage() {
  const healthQuery = useQuery({
    queryKey: ["next-system-health"],
    queryFn: loadSystemHealth,
    refetchOnWindowFocus: false,
  });
  const health = healthQuery.data;
  const summaryItems = buildSystemHealthSummaryItems(health);
  const summaryBadges = buildSystemHealthSummaryBadges(health);
  const summaryActions = buildSystemHealthSummaryActions(health);
  const dependencyRows = buildDependencyRows(health);
  const endpointRows = buildEndpointRows(health);

  return (
    <PageFrame
      title="Sistem Sağlığı"
      subtitle="API yaşam, hazırlık ve temel metrik sinyallerini izle."
      actions={
        <Button onClick={() => void healthQuery.refetch()}>
          <RefreshCw size={17} aria-hidden="true" />
          Yenile
        </Button>
      }
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Sistem sağlık operasyon özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Sistem sağlık güven durumu"
        title="Sağlık Sinyali Kanıt Gücü"
        description="Bu ekran yapılandırılmış API kaynağını okur; staging/prod release kanıtı olarak yorumlanması için ayrı ortam evidence gerekir."
        items={[
          {
            label: "API kaynağı",
            value: sourceLabel(apiUrl),
            tone: sourceLabel(apiUrl) === "Lokal/dev" ? "warning" : "info",
            scope: sourceLabel(apiUrl) === "Lokal/dev" ? "local-static" : "configured-api",
            detail: "Health, readiness ve metrics endpointleri aynı kaynaktan okunur.",
          },
          {
            label: "Anlık durum",
            value: health?.ready.ok ? "Hazır" : "Bekleniyor",
            tone: health?.ready.ok ? "success" : "warning",
            scope: "configured-api",
            detail: "Postgres ve Redis readiness sonucu operasyon panelinde görünür.",
          },
          {
            label: "Release evidence",
            value: "Ayrı kapı",
            tone: "warning",
            scope: "staging-prod",
            detail: "Prod env, HTTPS ve canlı smoke sonuçları evidence dosyalarıyla kanıtlanır.",
          },
        ]}
      />
      <Panel
        aria-label="Bağımlılık durumu"
        description="Postgres, Redis ve metrik sayacı aynı yapılandırılmış API kaynağından okunur."
        title="Bağımlılıklar"
      >
        <DataTable
          caption="Sistem bağımlılık durumu"
          columns={dependencyColumns}
          density="compact"
          description="Hazırlık endpointi ve metrics kaynağından gelen anlık durum."
          getRowKey={(row) => row.key}
          rows={dependencyRows}
        />
      </Panel>
      <Panel
        aria-label="Sistem sağlık detayları"
        description="Endpoint sonuçları operasyon ekranında görünür; release evidence ayrı kanıt dosyalarıyla doğrulanır."
        title="Endpoint detayları"
      >
        {healthQuery.isPending ? <p>Durum alınıyor</p> : null}
        {healthQuery.isError ? <p>Sağlık bilgisi alınamadı.</p> : null}
        <DataTable
          caption="Sistem sağlık endpointleri"
          columns={endpointColumns}
          density="compact"
          description="Health, readiness ve metrics endpointlerinin HTTP sonucu."
          getRowKey={(row) => row.key}
          loading={healthQuery.isPending}
          rows={endpointRows}
        />
      </Panel>
    </PageFrame>
  );
}

const dependencyColumns: Array<DataTableColumn<DependencyStatusRow>> = [
  {
    key: "dependency",
    header: "Bağımlılık",
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

const endpointColumns: Array<DataTableColumn<EndpointStatusRow>> = [
  {
    key: "endpoint",
    header: "Endpoint",
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

function buildSystemHealthSummaryItems(health: SystemHealth | undefined): OperationSummaryItem[] {
  const healthState = endpointStatusText(health?.health, "Çalışıyor");
  const readyState = endpointStatusText(health?.ready, "Hazır");
  const requestCount = health?.metrics.data?.requestCount;
  return [
    {
      description: "API yaşam endpointi",
      key: "api",
      label: "API",
      tone: endpointSummaryTone(health?.health),
      value: healthState,
    },
    {
      description: "Postgres ve Redis hazırlığı",
      key: "ready",
      label: "Hazırlık",
      tone: endpointSummaryTone(health?.ready),
      value: readyState,
    },
    {
      description: "Prometheus process uptime",
      key: "uptime",
      label: "Uptime",
      tone: health?.metrics.ok ? "info" : health ? "warning" : "default",
      value: formatUptime(health?.metrics.data?.uptimeSeconds),
    },
    {
      description: "Metrics endpointinden okunan sayaç",
      key: "request-count",
      label: "HTTP istek",
      tone: requestCount === null || requestCount === undefined ? "default" : "info",
      value: formatCount(requestCount),
    },
  ];
}

function buildSystemHealthSummaryBadges(health: SystemHealth | undefined): OperationSummaryBadge[] {
  return [
    {
      key: "source",
      label: sourceLabel(apiUrl),
      tone: sourceLabel(apiUrl) === "Lokal/dev" ? "warning" : "info",
    },
    {
      key: "readiness",
      label: health?.ready.ok ? "Readiness hazır" : health ? "Readiness sorunlu" : "Readiness bekleniyor",
      tone: health?.ready.ok ? "success" : health ? "danger" : "neutral",
    },
    {
      key: "metrics",
      label: health?.metrics.ok ? "Metrics okunuyor" : health ? "Metrics bekleniyor" : "Metrics yok",
      tone: health?.metrics.ok ? "success" : health ? "warning" : "neutral",
    },
  ];
}

function buildSystemHealthSummaryActions(health: SystemHealth | undefined): OperationSummaryAction[] {
  return [
    {
      detail: "Health, readiness ve metrics endpointleri",
      key: "endpoint-coverage",
      label: "Endpoint kapsamı",
      status: health ? "Okundu" : "Bekleniyor",
      tone: health ? "info" : "neutral",
      value: "3 sinyal",
    },
    {
      detail: "Postgres ve Redis hazırlık sinyali",
      key: "dependency-readiness",
      label: "Bağımlılık hazırlığı",
      status: health?.ready.ok ? "Hazır" : health ? "Kontrol" : "Bekleniyor",
      tone: health?.ready.ok ? "success" : health ? "warning" : "neutral",
      value: `${dependencyReadyCount(health)}/2 hazır`,
    },
    {
      detail: "Prod env, HTTPS ve canlı smoke kanıtı ayrı gate olarak kalır",
      key: "release-evidence",
      label: "Release evidence",
      status: "Ayrı kapı",
      tone: "warning",
      value: "Staging/prod",
    },
  ];
}

function buildDependencyRows(health: SystemHealth | undefined): DependencyStatusRow[] {
  const postgres = dependencyLabel(health?.ready.data?.dependencies.postgres, health?.ready.ok);
  const redis = dependencyLabel(health?.ready.data?.dependencies.redis, health?.ready.ok);
  return [
    {
      detail: "Readiness endpointinden gelen Postgres bağlantısı",
      key: "postgres",
      label: "Postgres",
      tone: dependencyTone(postgres),
      value: postgres,
    },
    {
      detail: "Readiness endpointinden gelen Redis bağlantısı",
      key: "redis",
      label: "Redis",
      tone: dependencyTone(redis),
      value: redis,
    },
    {
      detail: "Metrics endpointinden toplanan HTTP istek sayacı",
      key: "request-count",
      label: "HTTP istek sayacı",
      tone: health?.metrics.ok ? "info" : health ? "warning" : "neutral",
      value: formatCount(health?.metrics.data?.requestCount),
    },
  ];
}

function buildEndpointRows(health: SystemHealth | undefined): EndpointStatusRow[] {
  return [
    {
      detail: "API yaşam endpointi",
      key: "health",
      label: "/health",
      tone: endpointTone(health?.health),
      value: health ? endpointLabel(health.health) : "Bekleniyor",
    },
    {
      detail: "Readiness ve bağımlılık endpointi",
      key: "ready",
      label: "/health/ready",
      tone: endpointTone(health?.ready),
      value: health ? endpointLabel(health.ready) : "Bekleniyor",
    },
    {
      detail: "Prometheus metrics endpointi",
      key: "metrics",
      label: "/metrics",
      tone: endpointTone(health?.metrics),
      value: health ? endpointLabel(health.metrics) : "Bekleniyor",
    },
  ];
}

async function loadSystemHealth(): Promise<SystemHealth> {
  const [health, ready, metrics] = await Promise.all([
    loadJsonEndpoint<HealthStatus>(`${apiUrl}/health`),
    loadJsonEndpoint<ReadyStatus>(`${apiUrl}/health/ready`),
    loadMetrics(`${apiUrl}/metrics`),
  ]);
  return { health, ready, metrics };
}

async function loadJsonEndpoint<TData>(url: string): Promise<EndpointState<TData>> {
  try {
    const response = await fetch(url);
    const data = await readJson<TData>(response);
    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? (data as TData) : null,
      error: response.ok ? "" : readErrorMessage(data),
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
      ok: response.ok,
      status: response.status,
      data: response.ok ? parseMetrics(text) : null,
      error: response.ok ? "" : text,
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

function endpointLabel(endpoint: EndpointState<unknown>) {
  if (!endpoint.ok && endpoint.status === 0) return endpoint.error;
  return endpoint.ok ? `${endpoint.status} tamam` : `${endpoint.status} ${endpoint.error}`;
}

function dependencyReadyCount(health: SystemHealth | undefined) {
  const dependencies = health?.ready.data?.dependencies;
  return [dependencies?.postgres, dependencies?.redis].filter((dependency) => dependency === "ok").length;
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
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("tr-TR").format(value);
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
