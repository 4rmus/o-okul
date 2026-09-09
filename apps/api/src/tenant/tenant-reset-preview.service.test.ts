import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDigest, tenantResetTableNames, type TenantResetSnapshot } from "@o-okul/db";
import { runWithRequestContext } from "../context/request-context.js";
const state = vi.hoisted(() => ({ snapshot: null as TenantResetSnapshot | null, queues: [] as Array<{ name: string; options: unknown }>, jobs: [] as unknown[], objectFailure: false }));
vi.mock("@o-okul/db", async (original) => ({ ...await original<typeof import("@o-okul/db")>(), withResetPreviewSnapshot: async (_pool: unknown, _tenantId: string, run: (snapshot: TenantResetSnapshot, db: unknown) => Promise<unknown>) => run(state.snapshot!, {}) }));
vi.mock("pg", () => ({ default: { Pool: class { async end() {} } } }));
vi.mock("./tenant-reset-objects.js", async (original) => ({ ...await original<typeof import("./tenant-reset-objects.js")>(), resetS3Config: () => ({ bucket: "source", endpoint: "https://source.example.test" }), resetS3Client: () => ({ destroy() {} }), resetObjectInventory: async () => {
  if (state.objectFailure) throw new Error("secret object key");
  return [{ key: "private-object-key", size: 42, etag: "etag", sha256: "hash" }];
} }));
vi.mock("bullmq", () => ({ Queue: class {
  constructor(name: string, options: unknown) { state.queues.push({ name, options }); }
  async getJobs(types: string[]) { expect(types).toContain("failed"); return state.jobs; }
  async getJobSchedulers() { return []; } async getRepeatableJobs() { return []; } async close() {}
} }));
import { TenantResetPreviewService } from "./tenant-reset-preview.service.js";
beforeEach(() => {
  vi.stubEnv("TENANT_STORE", "postgres"); vi.stubEnv("REDIS_URL", "redis://localhost:6379"); vi.stubEnv("QUEUE_PREFIX", "custom");
  state.queues = []; state.jobs = []; state.objectFailure = false;
  const tables = Object.fromEntries(tenantResetTableNames.map((name) => [name, []])) as unknown as TenantResetSnapshot["tables"];
  tables.Tenant = [{ id: "tenant-a", lifecycleVersion: 2, status: "SUSPENDED" }];
  tables.User = [{ id: "owner", accountStatus: "ACTIVE", membershipVersion: 1, email: "pii@example.test", passwordHash: "private-password" }];
  tables.Employee = [{ userId: "owner", status: "ACTIVE", deletedAt: null }];
  tables.TenantMembership = [{ userId: "owner", role: "TENANT_OWNER", staffRole: "TENANT_OWNER", status: "ACTIVE", startsAt: "2026-01-01", version: 1 }];
  tables.PaymentTransaction = [{ amount: "123", deletedAt: "2026-01-01" }];
  state.snapshot = { tenantId: "tenant-a", lifecycleVersion: 2, capturedAt: "2026-09-06", objectOwners: { tenantIds: ["tenant-a"], students: [] }, schemaDigest: "schema", dataDigest: resetDigest(tables), tables, rawTables: {} as never, migrationRows: [] };
});
afterEach(() => vi.unstubAllEnvs());
const preview = () => runWithRequestContext({ userId: "system-admin", roles: ["SYSTEM_ADMIN"], tenantId: null, bypassRls: false }, () => new TenantResetPreviewService({ findOne: async () => ({ lifecycleVersion: 2 }) } as never).preview("tenant-a"));
describe("PostgreSQL preview composition (injected sources)", () => {
  it("returns only counts/blockers/digest and scans all seven queues with configured prefix", async () => {
    state.jobs = [{ id: "job-1", data: { snapshot: { tenantId: "tenant-a" } } }];
    const result = await preview();
    expect(result).toMatchObject({ allowed: false, lifecycleVersion: 2, preservedOwnerCount: 1, objectCount: 1, objectBytes: 42 });
    expect(result.blockers).toEqual(expect.arrayContaining(["INSTITUTION_REQUEST_REQUIRED", "FINANCE_RECORDS_PRESENT", "QUEUE_WORK_PRESENT"]));
    expect(result.categories.find((row) => row.category === "PaymentTransaction")).toEqual({ category: "PaymentTransaction", preserved: 0, deleted: 0, blocked: 1 });
    expect(result.blockerCounts).toEqual(expect.arrayContaining([{ code: "INSTITUTION_REQUEST_REQUIRED", count: null }, { code: "FINANCE_RECORDS_PRESENT", count: 1 }, { code: "QUEUE_WORK_PRESENT", count: 7 }]));
    expect(state.queues).toHaveLength(7);
    expect(state.queues.find((row) => row.name === "report-pdf-render")?.options).toMatchObject({ prefix: "custom", skipMetasUpdate: true });
    expect(JSON.stringify(result)).not.toMatch(/pii@example|private-password|private-object-key|tenant-a|system-admin/);
    expect((await preview()).preflightDigest).toBe(result.preflightDigest);
  });
  it("object inventory failures remain blocked without leaking provider errors", async () => {
    state.objectFailure = true;
    const result = await preview();
    expect(result.blockers).toContain("OBJECT_INVENTORY_UNVERIFIED");
    expect(result.allowed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret object key");
  });
});
