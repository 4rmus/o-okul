import { runWithJobContext } from "../context/job-context.js";
import type { TenantDbAccess, TenantWrite } from "../db/tenant-db.js";
import { assertTenantJobPayload, type QueueJob } from "../queue/queues.js";

export function processTenantJob(job: QueueJob, db: TenantDbAccess): TenantWrite {
  assertTenantJobPayload(job.payload);

  return runWithJobContext(
    {
      tenantId: job.payload.tenantId,
      userId: job.payload.userId,
      jobId: job.id,
    },
    () => db.writeTenantEntity(job.payload.entityId, job.name),
  );
}
