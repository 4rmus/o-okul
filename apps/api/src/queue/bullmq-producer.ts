import { currentTenantMutationVersion, runApiTenantMutation } from "../context/tenant-mutation-activity.js";
import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import { parseRedisUrl } from "../config/env.js";
import {
  createTenantQueueJob,
  type ProducedJob,
  type TenantQueueJobInput,
  type TenantQueueName,
} from "./job-producer.js";

export interface BullQueueClient {
  add(name: string, data: unknown, options: JobsOptions): Promise<unknown>;
  close(): Promise<void>;
}

interface RetryableQueueJob {
  getState(): Promise<string>;
  retry(state?: "failed"): Promise<unknown>;
}

export type BullQueueFactory = (
  name: TenantQueueName,
  options: QueueOptions,
) => BullQueueClient;

export interface BullTenantQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
  close(): Promise<void>;
}

export interface BullTenantQueueProducerOptions {
  connection?: QueueOptions["connection"];
  prefix?: string;
  createQueue?: BullQueueFactory;
}

export function createBullTenantQueueProducer(
  options: BullTenantQueueProducerOptions = {},
): BullTenantQueueProducer {
  const queues = new Map<TenantQueueName, BullQueueClient>();
  const createQueue = options.createQueue ?? createDefaultQueue;
  const queueOptions: QueueOptions = {
    connection: options.connection ?? parseRedisUrl(),
    prefix: options.prefix ?? process.env.QUEUE_PREFIX,
  };

  return {
    async enqueue(input) {
      const version = currentTenantMutationVersion(input.tenantId);
      const job = createTenantQueueJob({ ...input, lifecycleVersion: version });
      const queue = getQueue(job.queueName, queues, createQueue, queueOptions);
      return runApiTenantMutation("QUEUE_ADMISSION", async () => {
      const queueJob = await queue.add(job.name, job.payload, job.options);
      const stored = (queueJob as { data?: { tenantId?: string; lifecycleVersion?: number } } | null)?.data;
      if (stored?.tenantId !== input.tenantId || stored.lifecycleVersion !== version) throw new Error("TENANT_QUEUE_JOB_STALE");
      if (job.queueName === "report-generation" || job.queueName === "exam-evaluation") {
        await retryFailedQueueJob(queueJob);
      }
      return job;
      }, input.tenantId);
    },

    async close() {
      await Promise.all(Array.from(queues.values(), (queue) => queue.close()));
    },
  };
}

function getQueue(
  queueName: TenantQueueName,
  queues: Map<TenantQueueName, BullQueueClient>,
  createQueue: BullQueueFactory,
  options: QueueOptions,
): BullQueueClient {
  const existing = queues.get(queueName);
  if (existing) {
    return existing;
  }

  const queue = createQueue(queueName, options);
  queues.set(queueName, queue);
  return queue;
}

function createDefaultQueue(
  name: TenantQueueName,
  options: QueueOptions,
): BullQueueClient {
  return new Queue(name, options);
}

async function retryFailedQueueJob(queueJob: unknown): Promise<void> {
  if (!isRetryableQueueJob(queueJob)) return;
  if (await queueJob.getState() === "failed") {
    await queueJob.retry("failed");
  }
}

function isRetryableQueueJob(value: unknown): value is RetryableQueueJob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RetryableQueueJob>;
  return typeof candidate.getState === "function" && typeof candidate.retry === "function";
}
