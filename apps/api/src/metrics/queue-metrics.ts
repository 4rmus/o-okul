import { Queue, type JobType, type QueueOptions } from "bullmq";
import { parseRedisUrl } from "../config/env.js";
import { resolvePersistenceDriver } from "../config/persistence.js";

export const queueMetricsCollectorToken = Symbol("queueMetricsCollector");

export type QueueMetricStatus = Extract<JobType, "active" | "delayed" | "failed" | "paused" | "waiting" | "waiting-children">;

export interface QueueMetric {
  queueName: string;
  status: QueueMetricStatus;
  count: number;
}

export interface QueueMetricsCollector {
  collect(): Promise<QueueMetric[]>;
  close(): Promise<void>;
}

const queueMetricStatuses: QueueMetricStatus[] = ["waiting", "active", "delayed", "waiting-children", "paused", "failed"];
const queueMetricNames = [
  "announcement-delivery",
  "backup-restore",
  "exam-evaluation",
  "excel-import",
  "report-generation",
  "report-pdf-render",
  "sms-batch",
];

export function createQueueMetricsCollector(env: NodeJS.ProcessEnv = process.env): QueueMetricsCollector {
  if (!isQueueMetricsEnabled(env)) {
    return new DisabledQueueMetricsCollector();
  }

  return new BullQueueMetricsCollector({
    connection: {
      ...parseRedisUrl(env.REDIS_URL),
      connectTimeout: 500,
      maxRetriesPerRequest: 1,
    },
    prefix: env.QUEUE_PREFIX,
  });
}

export function isQueueMetricsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.QUEUE_METRICS_ENABLED === "true") return true;
  if (env.QUEUE_METRICS_ENABLED === "false") return false;
  return resolvePersistenceDriver(undefined, env) === "postgres";
}

class DisabledQueueMetricsCollector implements QueueMetricsCollector {
  async collect(): Promise<QueueMetric[]> {
    return [];
  }

  async close(): Promise<void> {
    return;
  }
}

export class BullQueueMetricsCollector implements QueueMetricsCollector {
  private readonly queues: Array<Queue<unknown, unknown, string>>;

  constructor(options: QueueOptions) {
    this.queues = queueMetricNames.map((queueName) => new Queue(queueName, options));
  }

  async collect(): Promise<QueueMetric[]> {
    const metrics: QueueMetric[] = [];
    for (const queue of this.queues) {
      const counts = await queue.getJobCounts(...queueMetricStatuses);
      for (const status of queueMetricStatuses) {
        metrics.push({
          queueName: queue.name,
          status,
          count: Number(counts[status] ?? 0),
        });
      }
    }
    return metrics;
  }

  async close(): Promise<void> {
    await Promise.all(this.queues.map((queue) => queue.close()));
  }
}
