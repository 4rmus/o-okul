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
      "# HELP uzman_hocam_process_uptime_seconds API process uptime.",
      "# TYPE uzman_hocam_process_uptime_seconds gauge",
      `uzman_hocam_process_uptime_seconds ${Math.max(0, (Date.now() - this.startedAt) / 1000).toFixed(3)}`,
      "# HELP uzman_hocam_http_requests_total HTTP requests by method, path and status.",
      "# TYPE uzman_hocam_http_requests_total counter",
      ...[...this.requests.values()].map(
        (metric) =>
          `uzman_hocam_http_requests_total{method="${escapeLabel(metric.method)}",path="${escapeLabel(metric.path)}",status="${metric.statusCode}"} ${metric.count}`,
      ),
      "# HELP uzman_hocam_http_request_duration_seconds_sum Total HTTP request duration by method, path and status.",
      "# TYPE uzman_hocam_http_request_duration_seconds_sum counter",
      ...[...this.requests.values()].map(
        (metric) =>
          `uzman_hocam_http_request_duration_seconds_sum{method="${escapeLabel(metric.method)}",path="${escapeLabel(metric.path)}",status="${metric.statusCode}"} ${metric.totalDurationSeconds.toFixed(6)}`,
      ),
      "# HELP uzman_hocam_queue_jobs BullMQ job counts by queue and status.",
      "# TYPE uzman_hocam_queue_jobs gauge",
      ...queueMetricsResult.metrics.map(
        (metric) =>
          `uzman_hocam_queue_jobs{queue="${escapeLabel(metric.queueName)}",status="${escapeLabel(metric.status)}"} ${metric.count}`,
      ),
      "# HELP uzman_hocam_queue_metrics_scrape_error Queue metrics scrape error flag.",
      "# TYPE uzman_hocam_queue_metrics_scrape_error gauge",
      `uzman_hocam_queue_metrics_scrape_error ${queueMetricsResult.error ? 1 : 0}`,
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
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\/[0-9]+(?=\/|$)/g, "/:id");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
