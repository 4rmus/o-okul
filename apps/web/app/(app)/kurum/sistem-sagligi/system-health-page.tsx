"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@uzman-hocam/ui";
import { RefreshCw } from "lucide-react";
import { apiUrl } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

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

export function SystemHealthPage() {
  const healthQuery = useQuery({
    queryKey: ["next-system-health"],
    queryFn: loadSystemHealth,
    refetchOnWindowFocus: false,
  });
  const health = healthQuery.data;

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
      <MetricPanelGrid
        ariaLabel="Sistem sağlık özeti"
        metrics={[
          { label: "API", value: health?.health.ok ? "Çalışıyor" : "Sorunlu" },
          { label: "Hazırlık", value: health?.ready.ok ? "Hazır" : "Hazır değil" },
          { label: "Uptime", value: formatUptime(health?.metrics.data?.uptimeSeconds) },
        ]}
      />
      <section className="next-report-list" aria-label="Bağımlılık durumu">
        <h2>Bağımlılıklar</h2>
        <p>Postgres: {dependencyLabel(health?.ready.data?.dependencies.postgres, health?.ready.ok)}</p>
        <p>Redis: {dependencyLabel(health?.ready.data?.dependencies.redis, health?.ready.ok)}</p>
        <p>HTTP istek sayacı: {health?.metrics.data?.requestCount ?? "-"}</p>
      </section>
      <section className="next-report-list" aria-label="Sistem sağlık detayları">
        <h2>Detay</h2>
        {healthQuery.isPending ? <p>Durum alınıyor</p> : null}
        {healthQuery.isError ? <p>Sağlık bilgisi alınamadı.</p> : null}
        {health ? (
          <>
            <p>/health: {endpointLabel(health.health)}</p>
            <p>/health/ready: {endpointLabel(health.ready)}</p>
            <p>/metrics: {endpointLabel(health.metrics)}</p>
          </>
        ) : null}
      </section>
    </PageFrame>
  );
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
  const response = await fetch(url);
  const data = await readJson<TData>(response);
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? (data as TData) : null,
    error: response.ok ? "" : readErrorMessage(data),
  };
}

async function loadMetrics(url: string): Promise<EndpointState<MetricsSummary>> {
  const response = await fetch(url);
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? parseMetrics(text) : null,
    error: response.ok ? "" : text,
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

function formatUptime(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  if (value < 60) return `${Math.round(value)} sn`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes} dk ${seconds} sn`;
}
