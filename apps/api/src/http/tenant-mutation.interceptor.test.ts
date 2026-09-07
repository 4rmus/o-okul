import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastValueFrom, Observable, of, throwError } from "rxjs";
import type { ExecutionContext } from "@nestjs/common";
const state = vi.hoisted(() => ({ version: 2, status: "ACTIVE", actorActive: true, rows: new Map<string, { id: string; tenantId: string; version: number; status: string }>() }));
vi.mock("pg", () => ({ default: { Pool: class {
  async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const rows = (items: unknown[]) => ({ rows: items as T[] });
    if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
    if (sql.includes('FROM "AuthSession"')) return rows(state.actorActive ? [{ id: "session" }] : []);
    if (sql.includes('FROM "Tenant"')) return rows([{ lifecycleVersion: state.version, status: state.status }]);
    if (sql.startsWith('INSERT INTO "TenantMutationActivity"')) { const record = { id: String(values[0]), tenantId: String(values[1]), version: Number(values[2]), status: "RUNNING" }; state.rows.set(record.id, record); return rows([{ id: record.id }]); }
    if (sql.startsWith('UPDATE "TenantMutationActivity"')) { const record = state.rows.get(String(values[0])); if (record) { record.status = "UNCERTAIN"; return rows([{ id: record.id }]); } }
    if (sql.startsWith('DELETE FROM "TenantMutationActivity"')) { const record = state.rows.get(String(values[0])); if (record) { state.rows.delete(record.id); return rows([{ id: record.id }]); } }
    return rows([]);
  }
  async connect() { return { query: this.query.bind(this), release() {} }; }
  async end() {}
} } }));
import { TenantMutationInterceptor } from "./tenant-mutation.interceptor.js";
import { closeTenantMutationPool } from "../context/tenant-mutation-activity.js";
import { runWithRequestContext } from "../context/request-context.js";
import { S3RawImportArchiveStore } from "../exam/s3-raw-import-archive-store.js";
import { createBullTenantQueueProducer } from "../queue/bullmq-producer.js";
const context = { sessionId: "session", membershipVersion: 1, userId: "admin", tenantId: "tenant-a", tenantLifecycleVersion: 2, roles: ["TENANT_ADMIN"], bypassRls: false };
const execution = { switchToHttp: () => ({ getRequest: () => ({ method: "POST" }) }) } as ExecutionContext;
beforeEach(() => { state.version = 2; state.status = "ACTIVE"; state.actorActive = true; state.rows.clear(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("PERSISTENCE_DRIVER", "memory"); vi.stubEnv("TENANT_STORE", "memory"); });
afterEach(async () => { await closeTenantMutationPool(); vi.unstubAllEnvs(); });
describe("HTTP durable lifetime with real activity adapter and injected SQL", () => {
  it("unsubscribe retains row until controller actually finishes, despite production memory flags", async () => {
    let finish!: () => void, started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const handle = () => new Observable((subscriber) => { finish = () => { subscriber.next("done"); subscriber.complete(); }; started(); });
    const subscription = runWithRequestContext(context, () => new TenantMutationInterceptor().intercept(execution, { handle }).subscribe());
    await began; expect([...state.rows.values()]).toMatchObject([{ status: "RUNNING", tenantId: "tenant-a", version: 2 }]);
    subscription.unsubscribe(); expect(state.rows.size).toBe(1);
    finish(); await vi.waitFor(() => expect(state.rows.size).toBe(0));
  });
  it.each(["SUSPENDED", "STALE"])("rejects %s before controller or external effect", async (mode) => {
    if (mode === "SUSPENDED") state.status = mode; else state.version = 3;
    const handle = vi.fn(() => of("effect"));
    await expect(runWithRequestContext(context, () => lastValueFrom(new TenantMutationInterceptor().intercept(execution, { handle })))).rejects.toThrow(mode === "STALE" ? "TENANT_ACTIVITY_STALE" : "TENANT_ACTIVITY_INACTIVE");
    expect(handle).not.toHaveBeenCalled(); expect(state.rows.size).toBe(0);
  });
  it("previously verified session cannot use newly captured current lifecycle after reset revoked it", async () => {
    state.actorActive = false; // Middleware had verified this actor before reset, but captured the new epoch afterward.
    const handle = vi.fn(() => of("effect"));
    await expect(runWithRequestContext(context, () => lastValueFrom(new TenantMutationInterceptor().intercept(execution, { handle })))).rejects.toThrow("TENANT_ACTIVITY_ACTOR_STALE");
    const send = vi.fn(async () => ({})); const archive = new S3RawImportArchiveStore({ bucket: "private", client: { send } });
    await expect(runWithRequestContext(context, () => archive.put({ s3Key: "raw-imports/tenant-a/exam/parser/hash/source", body: Buffer.from("x") }))).rejects.toThrow("TENANT_ACTIVITY_ACTOR_STALE");
    const add = vi.fn(async () => ({})); const producer = createBullTenantQueueProducer({ connection: { host: "localhost" }, createQueue: () => ({ add, close: async () => {} }) });
    await expect(runWithRequestContext(context, () => producer.enqueue({ queueName: "excel-import", tenantId: "tenant-a", userId: "admin", entityId: "import", contentHash: "hash" }))).rejects.toThrow("TENANT_ACTIVITY_ACTOR_STALE");
    expect(handle).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled(); expect(state.rows.size).toBe(0);
  });
  it("controller rejection leaves uncertainty instead of assuming no side effect", async () => {
    await expect(runWithRequestContext(context, () => lastValueFrom(new TenantMutationInterceptor().intercept(execution, { handle: () => throwError(() => new Error("REMOTE_UNKNOWN")) })))).rejects.toThrow("REMOTE_UNKNOWN");
    expect([...state.rows.values()]).toMatchObject([{ status: "UNCERTAIN" }]);
  });
  it("raw archive key must belong to the activity's trusted tenant before S3 PUT or DELETE", async () => {
    const send = vi.fn(async () => ({})); const archive = new S3RawImportArchiveStore({ bucket: "private", client: { send } });
    const key = "raw-imports/tenant-b/exam/parser/hash/source";
    await expect(runWithRequestContext(context, () => archive.put({ s3Key: key, body: Buffer.from("x") }))).rejects.toThrow("TENANT_ACTIVITY_CONTEXT_INVALID");
    await expect(runWithRequestContext(context, () => archive.delete(key))).rejects.toThrow("TENANT_ACTIVITY_CONTEXT_INVALID");
    expect(send).not.toHaveBeenCalled(); expect(state.rows.size).toBe(0);
  });
  it("queue stamps captured lifecycle, rejects retained stale Redis payload before retry, and retains uncertainty", async () => {
    let submitted: unknown; const retry = vi.fn(async () => {});
    const producer = createBullTenantQueueProducer({ connection: { host: "localhost" }, createQueue: () => ({ async add(_name, payload) { submitted = payload; return { data: { tenantId: "tenant-a", lifecycleVersion: 1 }, getState: async () => "failed", retry }; }, async close() {} }) });
    await expect(runWithRequestContext(context, () => producer.enqueue({ queueName: "exam-evaluation", tenantId: "tenant-a", lifecycleVersion: 999, userId: "admin", entityId: "import", contentHash: "hash", participantId: "participant", rawImportId: "import", answerKeyId: "key" }))).rejects.toThrow("TENANT_QUEUE_JOB_STALE");
    expect(submitted).toMatchObject({ tenantId: "tenant-a", lifecycleVersion: 2 }); expect(retry).not.toHaveBeenCalled();
    expect([...state.rows.values()]).toMatchObject([{ status: "UNCERTAIN" }]);
  });
});
