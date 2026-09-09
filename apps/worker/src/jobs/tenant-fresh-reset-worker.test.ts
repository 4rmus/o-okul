import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ workers: [] as Array<{ name: string; run: (job: unknown) => Promise<unknown>; on: ReturnType<typeof vi.fn> }> }));
vi.mock("bullmq", () => ({ Queue: class {}, Worker: class {
  on = vi.fn();
  constructor(name: string, run: (job: unknown) => Promise<unknown>) { state.workers.push({ name, run, on: this.on }); }
} }));
vi.mock("@o-okul/db", async (original) => ({ ...await original<typeof import("@o-okul/db")>(), createTenantPgPool: vi.fn(() => ({})), runFreshReset: vi.fn(async () => ({ status: "COMPLETED" })) }));
import { createTenantFreshResetWorker } from "./tenant-fresh-reset-worker.js";
afterEach(() => { vi.unstubAllEnvs(); state.workers = []; });
describe("fresh reset worker wiring", () => {
  it("missing dedicated configuration leaves unrelated workers untouched", () => {
    vi.stubEnv("TENANT_RESET_DATABASE_URL", ""); expect(createTenantFreshResetWorker({ host: "localhost" })).toBeUndefined(); expect(state.workers).toHaveLength(0);
  });
  it("requires dedicated role and rejects jobs that do not match deterministic operation id", async () => {
    vi.stubEnv("TENANT_RESET_DATABASE_URL", "postgres://app:secret@localhost/db"); expect(() => createTenantFreshResetWorker({ host: "localhost" })).toThrow("RESET_DATABASE_ROLE_INVALID");
    vi.stubEnv("TENANT_RESET_DATABASE_URL", "postgres://o_okul_reset_worker:secret@localhost/db"); createTenantFreshResetWorker({ host: "localhost" });
    const worker = state.workers[0]!; expect(worker.on).toHaveBeenCalledWith("error", expect.any(Function));
    await expect(worker.run({ id: "wrong", data: { tenantId: "tenant-a", operationId: "a".repeat(32) } })).rejects.toThrow("RESET_JOB_INVALID");
    await expect(worker.run({ id: `tenant-fresh-reset-${"a".repeat(32)}`, data: { tenantId: "tenant-a", operationId: "a".repeat(32) } })).resolves.toEqual({ status: "COMPLETED" });
  });
});
