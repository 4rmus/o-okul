import { workerLogger } from "../observability/logging.js";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { createFreshResetServices, createTenantPgPool, freshResetJobId, freshResetQueue, resetWorkerDatabaseUrl, runFreshReset, tenantResetQueues } from "@o-okul/db";

export function createTenantFreshResetWorker(connection: ConnectionOptions) {
  // Dedicated configuration enables only this worker; missing config leaves existing workers usable.
  if (!process.env.TENANT_RESET_DATABASE_URL) return undefined;
  const pool = createTenantPgPool(resetWorkerDatabaseUrl());
  const prefix = process.env.QUEUE_PREFIX;
  const services = createFreshResetServices(async (tenantId, operationId) => {
    for (const name of [...tenantResetQueues, freshResetQueue]) {
      const queue = new Queue(name, { connection, prefix, skipMetasUpdate: true });
      try {
        for (let start = 0; ; start += 100) {
          const jobs = await queue.getJobs(["active", "wait", "delayed", "prioritized", "paused", "waiting-children", "failed"], start, start + 99);
          for (const job of jobs) {
            if (name === freshResetQueue && job.id === freshResetJobId(operationId) && job.data?.operationId === operationId && job.data?.tenantId === tenantId) continue;
            const owner = job.data?.tenantId ?? job.data?.snapshot?.tenantId;
            if (!owner || owner === tenantId) throw new Error("RESET_QUEUE_WORK_UNVERIFIED");
          }
          if (jobs.length < 100) break;
        }
        if ((await queue.getJobSchedulers(0, -1)).length || (await queue.getRepeatableJobs(0, -1)).length) throw new Error("RESET_QUEUE_WORK_UNVERIFIED");
      } finally { await queue.close(); }
    }
  });
  const worker = new Worker(freshResetQueue, async (job) => {
    const data = job.data as { tenantId?: string; operationId?: string };
    if (!data.operationId || !data.tenantId || job.id !== freshResetJobId(data.operationId)) throw new Error("RESET_JOB_INVALID");
    return runFreshReset(pool, data.tenantId, data.operationId, services);
  }, { connection, prefix, concurrency: 1 });
  worker.on("error", () => workerLogger.error({ queueName: freshResetQueue, errorCode: "RESET_WORKER_CONNECTION_FAILED" }, "reset_worker_error"));
  return worker;
}
