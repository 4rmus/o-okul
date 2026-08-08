"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { RefreshCw } from "lucide-react";
import { apiUrl } from "../../../../src/api-client.js";
import { EvidenceGateSection, EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const observabilityGates = [
  {
    title: "Sistem izleme kabulü",
    command: "OBSERVABILITY_UAT_TARGET=file://$PWD/docs/evidence-templates/observability-uat.example.json pnpm observability:uat:check",
    status: "Kanıt raporu gerekir",
    detail: "Sistem ölçümleri, izleme panoları, kayıtlar ve uyarılar deneme veya canlı ortam raporuyla doğrulanır.",
  },
  {
    title: "Uyarı bildirim denemesi",
    command: "ALERT_WEBHOOK_URL=https://alerts.example.test pnpm alert:webhook:smoke",
    status: "Bildirim adresi gerekir",
    detail: "Uyarı kanalına kişisel veri içermeyen bir test bildirimi gönderilir ve başarılı yanıt beklenir.",
  },
  {
    title: "Hata izleme denemesi",
    command: "SENTRY_SMOKE_CONFIRM=send pnpm sentry:smoke",
    status: "Hata izleme bağlantısı gerekir",
    detail: "Hata izleme kanalına kişisel veri içermeyen bir test olayı gönderilir.",
  },
] as const;

const dashboardPanels = [
  "Uygulama çalışma durumu",
  "İstek yoğunluğu",
  "Ortalama yanıt süresi",
  "Bağlantı sorunları",
  "Uygulama kayıtları",
];

const alertRules = [
  "Uygulama yanıt vermiyor",
  "Bağlantılar hazır değil",
  "Bağlantı sorunu arttı",
  "Yanıt süresi uzadı",
];

const telemetryChecks = [
  "Sistem ölçümleri alınıyor",
  "İzleme panosu açılıyor",
  "Uygulama kayıtları görüntüleniyor",
  "Uyarı bildirimi ulaşıyor",
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
  const technicalEndpointRows = buildTechnicalEndpointRows(status);
  const dashboardRows = buildChecklistRows(dashboardPanels, "Ortam doğrulaması gerekir", "İzleme panosu ve uygulama kayıtları deneme veya canlı ortam raporuyla doğrulanır.", "warning");
  const alertRows = buildChecklistRows(alertRules, "Deneme gerekir", "Uyarı ve hata izleme kanalları kişisel veri içermeyen bir test olayıyla doğrulanır.", "warning");
  const telemetryRows = buildChecklistRows(telemetryChecks, "Doğrulama gerekir", "Bu teknik kontrol deneme veya canlı ortam raporunda tamamlanır.", "info");

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
      title="Sistem İzleme"
      subtitle="Uygulamanın çalışma durumunu, kayıtlarını ve uyarı kanallarını tek yerden izleyin."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Sistem izleme özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Sistem izleme doğrulama durumu"
        title="İzleme Bilgileri Nasıl Doğrulanır?"
        description="Uygulama ve bağlantı durumu bu ekrandan okunur. İzleme panoları, kayıtlar ve uyarı kanalları ayrıca deneme ortamında doğrulanır."
        items={[
          {
            label: "Kontrol edilen sistem",
            value: sourceLabel(apiUrl),
            tone: sourceLabel(apiUrl) === "Bu bilgisayar" ? "warning" : "info",
            scope: sourceLabel(apiUrl) === "Bu bilgisayar" ? "local-static" : "configured-api",
            detail: "Uygulama, bağlantılar ve temel kullanım bilgileri aynı sistemden okunur.",
          },
          {
            label: "Anlık durum",
            value: observabilityEndpointState(status),
            tone: observabilityEndpointTone(status),
            scope: "configured-api",
            detail: "Bu sonuçlar anlık durumu gösterir; yayın onayının yerini tutmaz.",
          },
          {
            label: "Uyarı kanalı",
            value: "Deneme gerekir",
            tone: "warning",
            scope: "live-required",
            detail: "Uyarı ve hata izleme kanalları kişisel veri içermeyen bir test olayıyla doğrulanır.",
          },
          {
            label: "İzleme panoları",
            value: "Deneme/canlı ortam",
            tone: "danger",
            scope: "staging-prod",
            detail: "İzleme panosu ve uygulama kayıtları ortam raporuyla doğrulanır.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Anlık uygulama ve bağlantı durumu bu ekrandan izlenebilir."
        reason="İzleme panoları, uygulama kayıtları ve uyarı kanalları ayrı sistemlerde tutulduğu için ayrıca doğrulanır."
        nextStep="Uyarı ve kayıt panolarının gerçek durumu bu ekrana bağlandığında tek yerden izlenebilir."
      />
      <Panel
        aria-label="Anlık sistem durumu"
        description="Uygulama, bağlantılar, çalışma süresi ve kullanım bilgileri seçili sistemden okunur."
        title="Anlık Durum"
      >
        {observabilityQuery.isPending ? <p>Durum alınıyor</p> : null}
        {observabilityQuery.isError ? <p>Sistem izleme bilgisi alınamadı.</p> : null}
        <DataTable
          caption="Anlık sistem kontrol adresleri"
          columns={signalColumns}
          density="compact"
          description="Uygulama, bağlantı, çalışma süresi ve kullanım bilgileri."
          getRowKey={(row) => row.key}
          loading={observabilityQuery.isPending}
          rows={signalRows}
        />
      </Panel>
      <Panel
        aria-label="İzleme panoları"
        description="Temel sistem göstergeleri ve uygulama kayıtları."
        title="İzleme Panoları"
      >
        <DataTable
          caption="Sistem izleme panoları"
          columns={checklistColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={dashboardRows}
        />
      </Panel>
      <Panel
        aria-label="Uyarı kuralları"
        description="Uyarı kuralları, bildirim ve hata izleme kanallarında denenmeden yayın onayı verilmez."
        title="Uyarı Kuralları"
      >
        <DataTable
          caption="Sistem uyarı kuralları"
          columns={checklistColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={alertRows}
        />
      </Panel>
      <details>
        <summary>İleri ayrıntılar</summary>
        <EvidenceGateSection title="Yayın Öncesi Teknik Kontroller" ariaLabel="Sistem izleme teknik kontrolleri" gates={observabilityGates} />
        <Panel
          aria-label="Teknik bağlantı adresleri"
          description="Bağlantı adresleri ve yanıt kodları."
          title="Bağlantı Adresleri"
        >
          <DataTable
            caption="Teknik bağlantı adresleri"
            columns={signalColumns}
            density="compact"
            getRowKey={(row) => row.key}
            rows={technicalEndpointRows}
          />
        </Panel>
        <Panel
          aria-label="Teknik izleme kontrolleri"
          description="Sistem ölçümleri, izleme panoları, kayıtlar ve uyarı kanalları ortam raporuyla doğrulanır."
          title="Teknik İzleme Kontrolleri"
        >
          <DataTable
            caption="Teknik sistem izleme kontrolleri"
            columns={checklistColumns}
            density="compact"
            getRowKey={(row) => row.key}
            rows={telemetryRows}
          />
        </Panel>
      </details>
    </PageFrame>
  );
}

const signalColumns: Array<DataTableColumn<ObservabilitySignalRow>> = [
  {
    key: "signal",
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
    header: "Açıklama",
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
    header: "Açıklama",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildObservabilitySummaryItems(status: ObservabilityStatus | undefined): OperationSummaryItem[] {
  return [
    {
      description: "Uygulamanın yanıt verme durumu",
      key: "api",
      label: "Uygulama",
      tone: endpointSummaryTone(status?.health),
      value: endpointStatusText(status?.health, "Çalışıyor"),
    },
    {
      description: "Veritabanı ve hızlı erişim bağlantıları",
      key: "ready",
      label: "Bağlantılar",
      tone: endpointSummaryTone(status?.ready),
      value: endpointStatusText(status?.ready, "Hazır"),
    },
    {
      description: "Sistemin işlediği toplam web isteği",
      key: "request-count",
      label: "Web istekleri",
      tone: status?.metrics.ok ? "info" : status ? "warning" : "default",
      value: formatCount(status?.metrics.data?.requestCount),
    },
    {
      description: "Uygulamanın kesintisiz çalışma süresi",
      key: "uptime",
      label: "Çalışma süresi",
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
      tone: sourceLabel(apiUrl) === "Bu bilgisayar" ? "warning" : "info",
    },
    {
      key: "endpoint",
      label: `Anlık durum ${observabilityEndpointState(status).toLocaleLowerCase("tr-TR")}`,
      tone: observabilityEndpointTone(status),
    },
    {
      key: "alert",
      label: "Uyarı denemesi gerekir",
      tone: "warning",
    },
    {
      key: "dashboard",
      label: "İzleme panosu doğrulaması ayrı",
      tone: "warning",
    },
  ];
}

function buildObservabilitySummaryActions(status: ObservabilityStatus | undefined): OperationSummaryAction[] {
  return [
    {
      detail: "Uygulama, bağlantı ve kullanım kontrolleri",
      key: "endpoint-coverage",
      label: "Kontrol kapsamı",
      status: status ? "Okundu" : "Bekleniyor",
      tone: status ? "info" : "neutral",
      value: "3 sinyal",
    },
    {
      detail: "Uyarı ve hata izleme kanalları test olayıyla doğrulanır",
      key: "alert-channel",
      label: "Uyarı kanalı",
      status: "Deneme gerekir",
      tone: "warning",
      value: "Canlı kanıt",
    },
    {
      detail: "İzleme panosu ve uygulama kayıtları ortam raporuyla doğrulanır",
      key: "dashboard",
      label: "İzleme panoları",
      status: "Ayrı kontrol",
      tone: "warning",
      value: "Deneme/canlı ortam",
    },
  ];
}

function buildObservabilitySignalRows(status: ObservabilityStatus | undefined): ObservabilitySignalRow[] {
  return [
    {
      detail: "Uygulamanın yanıt verdiğini kontrol eder",
      key: "health",
      label: "Uygulama",
      tone: endpointTone(status?.health),
      value: endpointStatusText(status?.health, "Çalışıyor"),
    },
    {
      detail: "Veritabanı ve hızlı erişim bağlantılarını kontrol eder",
      key: "ready",
      label: "Bağlantılar",
      tone: endpointTone(status?.ready),
      value: endpointStatusText(status?.ready, "Hazır"),
    },
    {
      detail: "Çalışma süresi ve istek sayısını verir",
      key: "metrics",
      label: "Kullanım bilgileri",
      tone: endpointTone(status?.metrics),
      value: endpointStatusText(status?.metrics, "Alınıyor"),
    },
    {
      detail: "Uygulamanın kesintisiz çalışma süresi",
      key: "uptime",
      label: "Çalışma süresi",
      tone: status?.metrics.ok ? "info" : status ? "warning" : "neutral",
      value: formatUptime(status?.metrics.data?.uptimeSeconds),
    },
    {
      detail: "Ana veritabanı bağlantısı",
      key: "postgres",
      label: "Veritabanı",
      tone: dependencyTone(dependencyLabel(status?.ready.data?.dependencies.postgres, status?.ready.ok)),
      value: dependencyLabel(status?.ready.data?.dependencies.postgres, status?.ready.ok),
    },
    {
      detail: "Hızlı erişim ve işlem bağlantısı",
      key: "redis",
      label: "Hızlı erişim",
      tone: dependencyTone(dependencyLabel(status?.ready.data?.dependencies.redis, status?.ready.ok)),
      value: dependencyLabel(status?.ready.data?.dependencies.redis, status?.ready.ok),
    },
  ];
}

function buildTechnicalEndpointRows(status: ObservabilityStatus | undefined): ObservabilitySignalRow[] {
  return [
    {
      detail: "Uygulamanın yanıt verdiğini kontrol eder",
      key: "health-endpoint",
      label: "/health",
      tone: endpointTone(status?.health),
      value: status ? endpointLabel(status.health) : "Bekleniyor",
    },
    {
      detail: "Veritabanı ve hızlı erişim bağlantılarını kontrol eder",
      key: "ready-endpoint",
      label: "/health/ready",
      tone: endpointTone(status?.ready),
      value: status ? endpointLabel(status.ready) : "Bekleniyor",
    },
    {
      detail: "Çalışma süresi ve istek sayısını verir",
      key: "metrics-endpoint",
      label: "/metrics",
      tone: endpointTone(status?.metrics),
      value: status ? endpointLabel(status.metrics) : "Bekleniyor",
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
  const uptime = readMetricValue(text, "o_okul_process_uptime_seconds");
  const requests = text
    .split("\n")
    .filter((line) => line.startsWith("o_okul_http_requests_total"))
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
  if (!endpoint.ok && endpoint.status === 0) return "Bağlantı kurulamadı";
  return endpoint.ok ? `${endpoint.status} tamam` : `${endpoint.status} bağlantı sorunu`;
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
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value) ? "Bu bilgisayar" : "Bağlı sistem";
}
