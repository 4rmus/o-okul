import { Inject, Injectable, OnModuleDestroy, Optional } from "@nestjs/common";
import {
  queueMetricsCollectorToken,
  type QueueMetric,
  type QueueMetricsCollector,
} from "./queue-metrics.js";

interface RequestMetric {
  method: string;
  path: string;
  statusCode: number;
  count: number;
  totalDurationSeconds: number;
}

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, RequestMetric>();

  constructor(
    @Optional() @Inject(queueMetricsCollectorToken) private readonly queueMetrics?: QueueMetricsCollector,
  ) {}

  recordRequest(input: { method: string; path: string; statusCode: number; durationSeconds: number }): void {
    const path = normalizePath(input.path);
    const key = `${input.method}:${path}:${input.statusCode}`;
    const current = this.requests.get(key) ?? {
      method: input.method,
      path,
      statusCode: input.statusCode,
      count: 0,
      totalDurationSeconds: 0,
    };

    current.count += 1;
    current.totalDurationSeconds += input.durationSeconds;
    this.requests.set(key, current);
  }

  async render(): Promise<string> {
    const queueMetricsResult = await this.collectQueueMetrics();
    const lines = [
      "# HELP o_okul_process_uptime_seconds API process uptime.",
      "# TYPE o_okul_process_uptime_seconds gauge",
      `o_okul_process_uptime_seconds ${Math.max(0, (Date.now() - this.startedAt) / 1000).toFixed(3)}`,
      "# HELP o_okul_http_requests_total HTTP requests by method, path and status.",
      "# TYPE o_okul_http_requests_total counter",
      ...[...this.requests.values()].map(
        (metric) =>
          `o_okul_http_requests_total{method="${escapeLabel(metric.method)}",path="${escapeLabel(metric.path)}",status="${metric.statusCode}"} ${metric.count}`,
      ),
      "# HELP o_okul_http_request_duration_seconds_sum Total HTTP request duration by method, path and status.",
      "# TYPE o_okul_http_request_duration_seconds_sum counter",
      ...[...this.requests.values()].map(
        (metric) =>
          `o_okul_http_request_duration_seconds_sum{method="${escapeLabel(metric.method)}",path="${escapeLabel(metric.path)}",status="${metric.statusCode}"} ${metric.totalDurationSeconds.toFixed(6)}`,
      ),
      "# HELP o_okul_queue_jobs BullMQ job counts by queue and status.",
      "# TYPE o_okul_queue_jobs gauge",
      ...queueMetricsResult.metrics.map(
        (metric) =>
          `o_okul_queue_jobs{queue="${escapeLabel(metric.queueName)}",status="${escapeLabel(metric.status)}"} ${metric.count}`,
      ),
      "# HELP o_okul_queue_metrics_scrape_error Queue metrics scrape error flag.",
      "# TYPE o_okul_queue_metrics_scrape_error gauge",
      `o_okul_queue_metrics_scrape_error ${queueMetricsResult.error ? 1 : 0}`,
    ];

    return `${lines.join("\n")}\n`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueMetrics?.close();
  }

  private async collectQueueMetrics(): Promise<{ metrics: QueueMetric[]; error: boolean }> {
    if (!this.queueMetrics) {
      return { metrics: [], error: false };
    }

    try {
      return { metrics: await this.queueMetrics.collect(), error: false };
    } catch {
      return { metrics: [], error: true };
    }
  }
}

function normalizePath(path: string): string {
  return path.split("/").map((segment) => {
    if (!segment) return segment;
    if (staticPathSegments.has(segment)) return segment;
    if (/^[0-9]+$/.test(segment)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
    if (/^[0-9a-f]{16,}$/i.test(segment)) return ":id";
    if (segment.includes("@") || segment.includes(".")) return ":slug";
    if (/[0-9]/.test(segment) && /[a-z]/i.test(segment)) return ":slug";
    if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(segment) && !staticPathSegments.has(segment)) return ":slug";
    return segment;
  }).join("/");
}

const staticPathSegments = new Set([
  "backup-restore-jobs",
  "grade-levels",
  "import-quarantines",
  "raw-imports",
  "report-generation",
  "role-preview",
  "teacher-notes",
  "tenant-export",
  "v1",
]);

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
