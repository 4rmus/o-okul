"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { RefreshCw } from "lucide-react";
import { apiUrl } from "../../../../src/api-client.js";
import { EvidenceTrustPanel } from "../../kurum/_shared/evidence-panels.js";
import { PageFrame } from "../../kurum/_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../../kurum/_shared/operation-summary.js";

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

// ponytail: platform metrikleri Grafana'da; bu ekran yalnız /health ve /health/ready okur (DEC-20260930-02).
interface SystemHealth {
  health: EndpointState<HealthStatus>;
  ready: EndpointState<ReadyStatus>;
}

interface EndpointState<TData> {
  ok: boolean;
  status: number;
  data: TData | null;
  error: string;
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
      subtitle="Tüm kurumları etkileyen uygulama ve bağlantı durumunu canlı izleyin. Ölçümler izleme panosundadır."
      actions={
        <Button onClick={() => void healthQuery.refetch()}>
          <RefreshCw size={17} aria-hidden="true" />
          Yenile
        </Button>
      }
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Sistem sağlığı özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Sistem sağlığı doğrulama durumu"
        title="Sistem Durumu Nasıl Okunmalı?"
        description="Bu ekran seçili sistemin anlık durumunu gösterir. Canlıya geçiş kararı için ayrıca yayın öncesi kontroller tamamlanmalıdır."
        items={[
          {
            label: "Kontrol edilen sistem",
            value: sourceLabel(apiUrl),
            tone: sourceLabel(apiUrl) === "Bu bilgisayar" ? "warning" : "info",
            scope: sourceLabel(apiUrl) === "Bu bilgisayar" ? "local-static" : "configured-api",
            detail: "Uygulama ve bağlantı bilgileri aynı sistemden okunur.",
          },
          {
            label: "Bağlantı durumu",
            value: health?.ready.ok ? "Hazır" : "Bekleniyor",
            tone: health?.ready.ok ? "success" : "warning",
            scope: "configured-api",
            detail: "Veritabanı ve hızlı erişim hizmetinin bağlantı durumu gösterilir.",
          },
          {
            label: "Yayın onayı",
            value: "Ayrı kontrol",
            tone: "warning",
            scope: "staging-prod",
            detail: "Canlı ortam ayarları, güvenli bağlantı ve temel işlemler ayrıca doğrulanır.",
          },
        ]}
      />
      <Panel
        aria-label="Sistem bağlantıları"
        description="Veritabanı ve hızlı erişim hizmeti."
        title="Bağlantılar"
      >
        <DataTable
          caption="Sistem bağlantıları"
          columns={dependencyColumns}
          density="compact"
          description="Seçili sistemden alınan anlık bağlantı bilgileri."
          getRowKey={(row) => row.key}
          rows={dependencyRows}
        />
      </Panel>
      <details>
        <summary>İleri ayrıntılar</summary>
        <Panel
          aria-label="Teknik sistem kontrolleri"
          description="Bağlantı adresleri ve yanıt kodları. Yayın onayı ayrıca verilir."
          title="Teknik Kontroller"
        >
          {healthQuery.isPending ? <p>Durum alınıyor</p> : null}
          {healthQuery.isError ? <p>Sağlık bilgisi alınamadı.</p> : null}
          <DataTable
            caption="Teknik sistem kontrol adresleri"
            columns={endpointColumns}
            density="compact"
            description="Uygulama ve bağlantı adreslerinin teknik yanıtları."
            getRowKey={(row) => row.key}
            loading={healthQuery.isPending}
            rows={endpointRows}
          />
        </Panel>
      </details>
    </PageFrame>
  );
}

const dependencyColumns: Array<DataTableColumn<DependencyStatusRow>> = [
  {
    key: "dependency",
    header: "Hizmet",
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

const endpointColumns: Array<DataTableColumn<EndpointStatusRow>> = [
  {
    key: "endpoint",
    header: "Kontrol adresi",
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

function buildSystemHealthSummaryItems(health: SystemHealth | undefined): OperationSummaryItem[] {
  const healthState = endpointStatusText(health?.health, "Çalışıyor");
  const readyState = endpointStatusText(health?.ready, "Hazır");
  return [
    {
      description: "Uygulamanın yanıt verme durumu",
      key: "api",
      label: "Uygulama",
      tone: endpointSummaryTone(health?.health),
      value: healthState,
    },
    {
      description: "Veritabanı ve hızlı erişim bağlantıları",
      key: "ready",
      label: "Bağlantılar",
      tone: endpointSummaryTone(health?.ready),
      value: readyState,
    },
  ];
}

function buildSystemHealthSummaryBadges(health: SystemHealth | undefined): OperationSummaryBadge[] {
  return [
    {
      key: "source",
      label: sourceLabel(apiUrl),
      tone: sourceLabel(apiUrl) === "Bu bilgisayar" ? "warning" : "info",
    },
    {
      key: "readiness",
      label: health?.ready.ok ? "Bağlantılar hazır" : health ? "Bağlantılarda sorun var" : "Bağlantılar bekleniyor",
      tone: health?.ready.ok ? "success" : health ? "danger" : "neutral",
    },
  ];
}

function buildSystemHealthSummaryActions(health: SystemHealth | undefined): OperationSummaryAction[] {
  return [
    {
      detail: "Uygulama ve bağlantı kontrolleri",
      key: "endpoint-coverage",
      label: "Kontrol kapsamı",
      status: health ? "Okundu" : "Bekleniyor",
      tone: health ? "info" : "neutral",
      value: "2 sinyal",
    },
    {
      detail: "Veritabanı ve hızlı erişim bağlantıları",
      key: "dependency-readiness",
      label: "Bağlantı durumu",
      status: health?.ready.ok ? "Hazır" : health ? "Kontrol" : "Bekleniyor",
      tone: health?.ready.ok ? "success" : health ? "warning" : "neutral",
      value: `${dependencyReadyCount(health)}/2 hazır`,
    },
    {
      detail: "Canlı ortam ayarları, güvenli bağlantı ve temel işlemler ayrıca kontrol edilir",
      key: "release-evidence",
      label: "Yayın onayı",
      status: "Ayrı kontrol",
      tone: "warning",
      value: "Deneme/canlı ortam",
    },
  ];
}

function buildDependencyRows(health: SystemHealth | undefined): DependencyStatusRow[] {
  const postgres = dependencyLabel(health?.ready.data?.dependencies.postgres, health?.ready.ok);
  const redis = dependencyLabel(health?.ready.data?.dependencies.redis, health?.ready.ok);
  return [
    {
      detail: "Ana veritabanı bağlantısı",
      key: "postgres",
      label: "Veritabanı",
      tone: dependencyTone(postgres),
      value: postgres,
    },
    {
      detail: "Hızlı erişim ve işlem bağlantısı",
      key: "redis",
      label: "Hızlı erişim",
      tone: dependencyTone(redis),
      value: redis,
    },
  ];
}

function buildEndpointRows(health: SystemHealth | undefined): EndpointStatusRow[] {
  return [
    {
      detail: "Uygulamanın yanıt verdiğini kontrol eder",
      key: "health",
      label: "/health",
      tone: endpointTone(health?.health),
      value: health ? endpointLabel(health.health) : "Bekleniyor",
    },
    {
      detail: "Veritabanı ve hızlı erişim bağlantılarını kontrol eder",
      key: "ready",
      label: "/health/ready",
      tone: endpointTone(health?.ready),
      value: health ? endpointLabel(health.ready) : "Bekleniyor",
    },
  ];
}

async function loadSystemHealth(): Promise<SystemHealth> {
  const [health, ready] = await Promise.all([
    loadJsonEndpoint<HealthStatus>(`${apiUrl}/health`),
    loadJsonEndpoint<ReadyStatus>(`${apiUrl}/health/ready`),
  ]);
  return { health, ready };
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
  if (!endpoint.ok && endpoint.status === 0) return "Bağlantı kurulamadı";
  return endpoint.ok ? `${endpoint.status} tamam` : `${endpoint.status} bağlantı sorunu`;
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

function sourceLabel(value: string) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value) ? "Bu bilgisayar" : "Bağlı sistem";
}
