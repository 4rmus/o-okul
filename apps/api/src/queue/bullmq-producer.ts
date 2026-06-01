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
      const job = createTenantQueueJob(input);
      const queue = getQueue(job.queueName, queues, createQueue, queueOptions);
      await queue.add(job.name, job.payload, job.options);
      return job;
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
