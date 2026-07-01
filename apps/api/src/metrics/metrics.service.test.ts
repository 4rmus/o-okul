import { describe, expect, it } from "vitest";
import { MetricsService } from "./metrics.service.js";
import { isQueueMetricsEnabled, type QueueMetricsCollector } from "./queue-metrics.js";

describe("MetricsService", () => {
  it("renders queue depth and failed-count gauges", async () => {
    const service = new MetricsService(new FakeQueueMetricsCollector([
      { queueName: "exam-evaluation", status: "waiting", count: 2 },
      { queueName: "exam-evaluation", status: "failed", count: 1 },
    ]));

    const output = await service.render();

    expect(output).toContain("# TYPE o_okul_queue_jobs gauge");
    expect(output).toContain('o_okul_queue_jobs{queue="exam-evaluation",status="waiting"} 2');
    expect(output).toContain('o_okul_queue_jobs{queue="exam-evaluation",status="failed"} 1');
    expect(output).toContain("o_okul_queue_metrics_scrape_error 0");
  });

  it("keeps /metrics available when queue metrics collection fails", async () => {
    const service = new MetricsService({
      async collect() {
        throw new Error("REDIS_DOWN");
      },
      async close() {
        return;
      },
    });

    const output = await service.render();

    expect(output).toContain("o_okul_queue_metrics_scrape_error 1");
    expect(output).not.toContain("queue=\"exam-evaluation\"");
  });

  it("normalizes dynamic path labels before rendering", async () => {
    const service = new MetricsService();

    service.recordRequest({
      method: "GET",
      path: "/api/v1/tenants/dna-egitim/users/a@example.test/students/123",
      statusCode: 200,
      durationSeconds: 0.01,
    });
    const output = await service.render();

    expect(output).toContain('path="/api/v1/tenants/:slug/users/:slug/students/:id"');
    expect(output).not.toContain("dna-egitim");
    expect(output).not.toContain("a@example.test");
  });

  it("enables queue metrics by default only for durable deployments", () => {
    expect(isQueueMetricsEnabled({ NODE_ENV: "test", PERSISTENCE_DRIVER: "memory" })).toBe(false);
    expect(isQueueMetricsEnabled({ NODE_ENV: "production", PERSISTENCE_DRIVER: "postgres" })).toBe(true);
    expect(isQueueMetricsEnabled({ NODE_ENV: "test", QUEUE_METRICS_ENABLED: "true" })).toBe(true);
    expect(isQueueMetricsEnabled({ NODE_ENV: "production", QUEUE_METRICS_ENABLED: "false" })).toBe(false);
  });
});

class FakeQueueMetricsCollector implements QueueMetricsCollector {
  constructor(private readonly metrics: Awaited<ReturnType<QueueMetricsCollector["collect"]>>) {}

  async collect(): ReturnType<QueueMetricsCollector["collect"]> {
    return this.metrics;
  }

  async close(): Promise<void> {
    return;
  }
}
