import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const queueScenarios = ["active-job-blocks-reset", "suspended-tenant-admission-and-other-tenant-progress", "old-epoch-queue-rejected", "provider-timeout-no-automatic-resend", "manual-retry-preserves-uncertainty"];

// Only called by the approved disposable PG runner; no external DSNs or provider endpoints.
export async function verifyQueueDrill({ pool, app, tsImport, docker, evidence, root, validateContainer }) {
  const image = "redis:7", nonce = randomBytes(12).toString("hex");
  const name = `o-okul-reset-drill-${nonce}-redis`;
  const images = JSON.parse(await docker(["image", "inspect", image]));
  assert.equal(images.length, 1); assert.match(images[0].Id, /^sha256:[a-f0-9]{64}$/);
  const owned = { name, nonce, image, imageId: images[0].Id, id: "" };
  const password = randomBytes(24).toString("hex");
  evidence.queue = { status: "FAIL", provider: "LOCAL_STUB_NO_EXTERNAL_SEND", scenarios: queueScenarios, checks: [], container: owned, cleanup: "NOT_CREATED" };
  let queue, worker, releaseActive;
  let connectionError = false, completed = false;
  try {
    evidence.queue.cleanup = "CREATION_OUTCOME_REQUIRES_INSPECTION";
    owned.id = await docker(["run", "--detach", "--pull=never", "--name", name, "--label", `com.o-okul.tenant-reset-drill=${nonce}`, "--publish", "127.0.0.1::6379", "--tmpfs", "/data:rw,noexec,nosuid,size=128m", "--memory", "256m", "--cpus", "1", "--env", "REDIS_PASSWORD", image, "sh", "-c", 'printf "requirepass %s\\n" "$REDIS_PASSWORD" | exec redis-server -'], { REDIS_PASSWORD: password });
    evidence.queue.cleanup = "RETAINED_NO_AUTOMATIC_RETRY";
    const inspected = JSON.parse(await docker(["inspect", owned.id])); assert.equal(inspected.length, 1);
    const port = validateContainer(inspected[0], owned);
    evidence.queue.port = port;
    const require = createRequire(resolve(root, "apps/worker/package.json"));
    const { Queue } = require("bullmq");
    const { createSmsBatchBullWorker } = await tsImport(resolve(root, "apps/worker/src/queue/bullmq-worker.ts"), import.meta.url);
    const { processSmsBatchJob } = await tsImport(resolve(root, "apps/worker/src/jobs/sms-batch-job.ts"), import.meta.url);
    const { runTenantMutationActivity, requireNoTenantMutationActivity } = await tsImport(resolve(root, "packages/db/src/tenant-mutation-activity.ts"), import.meta.url);
    const connection = { host: "127.0.0.1", port, password, maxRetriesPerRequest: null, connectTimeout: 5000, retryStrategy: () => null };
    const prefix = `drill-${nonce}`;
    queue = new Queue("sms-batch", { connection, prefix });
    queue.on("error", () => { connectionError = true; });
    await queue.waitUntilReady();
    await pool.query('INSERT INTO "Tenant" ("id","name","slug","updatedAt") VALUES (\'queue-drill-a\',\'Synthetic A\',\'queue-drill-a\',now()),(\'queue-drill-b\',\'Synthetic B\',\'queue-drill-b\',now())');
    const calls = new Map();
    let providerCalls = 0;
    const held = new Promise((resolve) => { releaseActive = resolve; });
    worker = createSmsBatchBullWorker({ connection, workerOptions: { prefix, concurrency: 2 }, activityRunner: (admission, run) => runTenantMutationActivity(app, admission, run), processor: async (job) => {
      calls.set(job.id, (calls.get(job.id) ?? 0) + 1);
      if (job.id === "drill-active") await held;
      if (job.id === "drill-uncertain") return processSmsBatchJob(job, { sendBatch: async () => { providerCalls++; throw new Error("DRILL_PROVIDER_TIMEOUT_AFTER_ACCEPTANCE"); } });
      return { tenantId: job.payload.tenantId, templateId: "synthetic", sentCount: 0, failedCount: 0, billableSegments: 0, status: "completed" };
    } });
    worker.on("error", () => { connectionError = true; });
    const add = (id, tenantId = "queue-drill-a", lifecycleVersion = 0, attempts = 1) => queue.add("sms-batch", { tenantId, lifecycleVersion, userId: "synthetic", entityId: id, contentHash: "synthetic", templateId: "synthetic", messageBody: "Local drill only", recipients: [{ to: "synthetic-recipient" }] }, { jobId: id, attempts, backoff: { type: "fixed", delay: 20 } });
    const until = async (predicate) => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error("QUEUE_DRILL_TIMEOUT"); };
    const settled = async (job, state) => { await until(async () => await job.getState() === state); return queue.getJob(job.id); };
    const active = await add("drill-active");
    await until(() => calls.has("drill-active"));
    await assert.rejects(requireNoTenantMutationActivity(pool, "queue-drill-a"), /RESET_MUTATION_ACTIVITY_PRESENT/);
    evidence.queue.checks.push("active-job-blocks-reset");
    await pool.query('UPDATE "Tenant" SET "status" = \'SUSPENDED\', "lifecycleVersion" = 1 WHERE "id" = \'queue-drill-a\'');
    const blocked = await settled(await add("drill-suspended"), "failed");
    assert.equal(blocked.failedReason, "TENANT_ACTIVITY_INACTIVE"); assert.equal(calls.has("drill-suspended"), false);
    await settled(await add("drill-other", "queue-drill-b"), "completed"); assert.equal(calls.get("drill-other"), 1);
    await assert.rejects(requireNoTenantMutationActivity(pool, "queue-drill-a"), /RESET_MUTATION_ACTIVITY_PRESENT/);
    releaseActive(); await settled(active, "completed");
    await requireNoTenantMutationActivity(pool, "queue-drill-a");
    evidence.queue.checks.push("suspended-tenant-admission-and-other-tenant-progress");
    await pool.query('UPDATE "Tenant" SET "status" = \'ACTIVE\', "lifecycleVersion" = 2 WHERE "id" = \'queue-drill-a\'');
    const stale = await settled(await add("drill-stale"), "failed");
    assert.equal(stale.failedReason, "TENANT_ACTIVITY_STALE"); assert.equal(calls.has("drill-stale"), false);
    evidence.queue.checks.push("old-epoch-queue-rejected");
    let uncertain = await settled(await add("drill-uncertain", "queue-drill-a", 2, 3), "failed");
    assert.equal(uncertain.failedReason, "TENANT_ACTIVITY_UNRESOLVED"); assert.equal(providerCalls, 1); assert.equal(uncertain.attemptsMade, 2);
    const uncertainty = () => pool.query('SELECT "status", "lifecycleVersion", "referenceId" FROM "TenantMutationActivity" WHERE "tenantId" = \'queue-drill-a\'');
    const expected = [{ status: "UNCERTAIN", lifecycleVersion: 2, referenceId: "sms-batch:drill-uncertain" }];
    assert.deepEqual((await uncertainty()).rows, expected);
    evidence.queue.checks.push("provider-timeout-no-automatic-resend");
    await uncertain.retry();
    await until(async () => (await queue.getJob("drill-uncertain")).attemptsMade === 3);
    uncertain = await settled(uncertain, "failed");
    assert.equal(uncertain.failedReason, "TENANT_ACTIVITY_UNRESOLVED"); assert.equal(providerCalls, 1);
    assert.deepEqual((await uncertainty()).rows, expected);
    await assert.rejects(requireNoTenantMutationActivity(pool, "queue-drill-a"), /RESET_MUTATION_ACTIVITY_PRESENT/);
    evidence.queue.checks.push("manual-retry-preserves-uncertainty");
    assert.equal(connectionError, false, "QUEUE_CONNECTION_ERROR");
    assert.deepEqual(evidence.queue.checks, queueScenarios);
    completed = true;
  } finally {
    releaseActive?.();
    await worker?.close(); await queue?.close();
    if (completed) {
      const inspected = JSON.parse(await docker(["inspect", owned.id])); assert.equal(inspected.length, 1); validateContainer(inspected[0], owned);
      await docker(["rm", "--force", owned.id]);
      evidence.queue.cleanup = "OWNED_CONTAINER_REMOVED"; evidence.queue.status = "PASS";
    }
  }
}
