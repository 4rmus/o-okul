import { Injectable } from "@nestjs/common";

interface RequestMetric {
  method: string;
  path: string;
  statusCode: number;
  count: number;
  totalDurationSeconds: number;
}

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, RequestMetric>();

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

  render(): string {
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
    ];

    return `${lines.join("\n")}\n`;
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
