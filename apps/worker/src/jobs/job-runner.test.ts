import { describe, expect, it } from "vitest";
import { TenantDbAccess } from "../db/tenant-db.js";
import { createJobId, queueNames, type QueueJob } from "../queue/queues.js";
import { processTenantJob } from "./job-runner.js";

describe("worker tenant job runner", () => {
  it("tenant context olmadan DB erişimini reddeder", () => {
    const db = new TenantDbAccess();

    expect(() => db.writeTenantEntity("student-1", "excel-import")).toThrow("JOB_CONTEXT_MISSING");
  });

  it("job payload tenant/user bilgisi olmadan fail eder", () => {
    const db = new TenantDbAccess();
    const job = {
      id: "bad-job",
      name: "excel-import",
      payload: { entityId: "student-1", contentHash: "hash-1" },
    } as QueueJob;

    expect(() => processTenantJob(job, db)).toThrow("TENANT_JOB_PAYLOAD_INVALID");
  });

  it("geçerli job tenant context ile DB yazımını sınırlar", () => {
    const db = new TenantDbAccess();
    const job: QueueJob = {
      id: createJobId("student-1", "hash-1"),
      name: "excel-import",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "student-1",
        contentHash: "hash-1",
      },
    };

    const write = processTenantJob(job, db);

    expect(write).toEqual({ tenantId: "tenant-a", entityId: "student-1", action: "excel-import" });
    expect(db.writes).toHaveLength(1);
  });

  it("tenant worker kuyruk adlarını sabit tutar", () => {
    expect(queueNames).toEqual(["announcement-delivery", "exam-evaluation", "excel-import", "report-generation", "sms-batch"]);
  });
});
