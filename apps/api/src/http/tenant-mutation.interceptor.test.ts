import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastValueFrom, Observable, of, throwError } from "rxjs";
import { Controller, Post, type ExecutionContext } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AsyncLocalStorage } from "node:async_hooks";
import { readOnlyOperationMetadata } from "./read-only-operation.js";
import { request as httpRequest } from "node:http";
const state = vi.hoisted(() => ({ end: vi.fn(), version: 2, status: "ACTIVE", actorActive: true, rows: new Map<string, { id: string; tenantId: string; version: number; status: string }>() }));
const pdfQueue = vi.hoisted(() => ({ ready: vi.fn(async () => {}), complete: vi.fn(async () => ({})), close: vi.fn(async () => {}) }));
vi.mock("bullmq", () => ({ Queue: class { async add() { return { waitUntilFinished: pdfQueue.complete }; } close = pdfQueue.close; }, QueueEvents: class { waitUntilReady = pdfQueue.ready; close = pdfQueue.close; } }));
vi.mock("pg", () => ({ default: { Pool: class {
  private ended = false;
  async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    if (this.ended) throw new Error("POOL_ALREADY_CLOSED");
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
  async end() { this.ended = true; state.end(); }
} } }));
import { TenantMutationInterceptor } from "./tenant-mutation.interceptor.js";
import { closeTenantMutationPool, openApiMutationAdmission, runApiTenantMutation, stopApiMutationAdmission, trackApiMutation, waitForApiMutations } from "../context/tenant-mutation-activity.js";
import { runWithRequestContext } from "../context/request-context.js";
import { S3RawImportArchiveStore } from "../exam/s3-raw-import-archive-store.js";
import { createBullTenantQueueProducer } from "../queue/bullmq-producer.js";
import { createReportPdfRenderer, ReportGenerationService } from "../report/report-generation.service.js";
const context = { sessionId: "session", membershipVersion: 1, userId: "admin", tenantId: "tenant-a", tenantLifecycleVersion: 2, roles: ["TENANT_ADMIN"], bypassRls: false };
const execution = { switchToHttp: () => ({ getRequest: () => ({ method: "POST" }) }) } as ExecutionContext;
beforeEach(() => { openApiMutationAdmission(); state.end.mockClear(); state.version = 2; state.status = "ACTIVE"; state.actorActive = true; state.rows.clear(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("PERSISTENCE_DRIVER", "memory"); vi.stubEnv("TENANT_STORE", "memory"); });
afterEach(async () => { await closeTenantMutationPool(); vi.unstubAllEnvs(); });
describe("HTTP durable lifetime with real activity adapter and injected SQL", () => {
  it("tracks an explicitly read-only POST without creating durable mutation uncertainty", async () => {
    const handler = () => {};
    Reflect.defineMetadata(readOnlyOperationMetadata, true, handler);
    const ctx = { ...execution, getHandler: () => handler } as ExecutionContext;
    await expect(runWithRequestContext(context, () => lastValueFrom(new TenantMutationInterceptor().intercept(ctx, { handle: () => throwError(() => new Error("INVALID_BACKUP")) })))).rejects.toThrow("INVALID_BACKUP");
    expect(state.rows.size).toBe(0); expect(state.end).not.toHaveBeenCalled();
  });
  it("blocks a real disconnected HTTP request that reaches the interceptor after shutdown", async () => {
    const effect = vi.fn(() => "changed");
    @Controller("shutdown-probe") class Probe { @Post() mutate() { return effect(); } }
    const module = await Test.createTestingModule({ controllers: [Probe], providers: [TenantMutationInterceptor] }).compile();
    const app = module.createNestApplication(); app.useGlobalInterceptors(app.get(TenantMutationInterceptor));
    let release!: () => void, began!: () => void, disconnected!: () => void, resumed!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { began = resolve; });
    const gone = new Promise<void>((resolve) => { disconnected = resolve; });
    const continued = new Promise<void>((resolve) => { resumed = resolve; });
    app.use(async (req: import("express").Request, _res: import("express").Response, next: import("express").NextFunction) => {
      req.socket.once("close", disconnected); began(); await hold; next(); resumed();
    });
    await app.listen(0, "127.0.0.1");
    const request = httpRequest((await app.getUrl()) + "/shutdown-probe", { method: "POST" }); request.on("error", () => {}); request.end();
    await entered; request.destroy(); await gone;
    await app.close(); release(); await continued; await new Promise((resolve) => setImmediate(resolve));
    expect(effect).not.toHaveBeenCalled(); expect(state.rows.size).toBe(0); expect(state.end).not.toHaveBeenCalled();
  });
  it("keeps PDF QueueEvents open through delayed readiness and job completion", async () => {
    let ready!: () => void, complete!: (value: object) => void;
    pdfQueue.close.mockClear();
    pdfQueue.ready.mockImplementationOnce(() => new Promise<void>((resolve) => { ready = resolve; }));
    pdfQueue.complete.mockImplementationOnce(() => new Promise<object>((resolve) => { complete = resolve; }));
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    const renderer = createReportPdfRenderer();
    const service = new ReportGenerationService({} as never, {} as never, renderer);
    const rendering = runWithRequestContext(context, () => renderer.render({ snapshot: { tenantId: "tenant-a" } } as never));
    await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
    const shutdown = service.onApplicationShutdown();
    await new Promise((resolve) => setImmediate(resolve)); expect(pdfQueue.close).not.toHaveBeenCalled();
    ready(); await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    expect(pdfQueue.close).not.toHaveBeenCalled(); expect(state.rows.size).toBe(1);
    complete({}); await rendering; await shutdown;
    expect(pdfQueue.close).toHaveBeenCalledTimes(2); expect(state.rows.size).toBe(0);
  });
  it("Nest shutdown waits for a disconnected controller, nested work and durable settlement before closing resources", async () => {
    const closedPdf = vi.fn(async () => {});
    const report = new ReportGenerationService({} as never, {} as never, { render: vi.fn(), close: closedPdf });
    const module = await Test.createTestingModule({ providers: [TenantMutationInterceptor, { provide: ReportGenerationService, useValue: report }] }).compile();
    const app = module.createNestApplication(); await app.init();
    let finish!: () => void;
    const handle = () => new Observable((subscriber) => {
      finish = AsyncLocalStorage.bind(() => { void runApiTenantMutation("S3_MUTATION", async () => { subscriber.next("done"); subscriber.complete(); }); });
    });
    const subscription = runWithRequestContext(context, () => app.get(TenantMutationInterceptor).intercept(execution, { handle }).subscribe());
    await vi.waitFor(() => expect(state.rows.size).toBe(1));
    subscription.unsubscribe();
    let closed = false; const shutdown = app.close().then(() => { closed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(closed).toBe(false); expect(state.end).not.toHaveBeenCalled(); expect(closedPdf).not.toHaveBeenCalled();
    runWithRequestContext(context, finish);
    await shutdown;
    expect(state.rows.size).toBe(0); expect(state.end).toHaveBeenCalledOnce(); expect(closedPdf).toHaveBeenCalledOnce();
  });
  it("tracks detached platform POST work even without tenant admission", async () => {
    let finish!: () => void;
    const handle = () => new Observable((subscriber) => { finish = () => { subscriber.next("queued"); subscriber.complete(); }; });
    const subscription = runWithRequestContext({ ...context, tenantId: null, bypassRls: true }, () => new TenantMutationInterceptor().intercept(execution, { handle }).subscribe());
    await vi.waitFor(() => expect(finish).toBeTypeOf("function")); subscription.unsubscribe();
    let drained = false; const drain = waitForApiMutations().then(() => { drained = true; });
    await new Promise((resolve) => setImmediate(resolve)); expect(drained).toBe(false);
    finish(); await drain; expect(state.rows.size).toBe(0);
  });
  it("rejects late admission and expired async context without opening a new pool", async () => {
    let delayed!: () => Promise<unknown>;
    await trackApiMutation(async () => { delayed = AsyncLocalStorage.bind(() => runApiTenantMutation("S3_MUTATION", async () => "late")); });
    stopApiMutationAdmission();
    await expect(runWithRequestContext(context, () => runApiTenantMutation("HTTP_MUTATION", async () => "late"))).rejects.toMatchObject({ status: 503 });
    await expect(delayed()).rejects.toMatchObject({ status: 503 });
    expect(state.rows.size).toBe(0); await closeTenantMutationPool(); expect(state.end).not.toHaveBeenCalled();
  });
  it("does not report a successful drain when pending work rejects", async () => {
    let reject!: (error: Error) => void;
    const work = trackApiMutation(() => new Promise((_, fail) => { reject = fail; }));
    const observed = expect(work).rejects.toThrow("REMOTE_UNKNOWN");
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    const drain = expect(waitForApiMutations()).rejects.toThrow("REMOTE_UNKNOWN");
    reject(new Error("REMOTE_UNKNOWN")); await Promise.all([observed, drain]);
  });
  it("retains nested failures during concurrent drains even if the outer request handles them", async () => {
    let nested!: () => void;
    const outer = trackApiMutation(() => new Promise<void>((resolve) => {
      nested = () => { void trackApiMutation(async () => { throw new Error("NESTED_UNKNOWN"); }).catch(() => resolve()); };
    }));
    await vi.waitFor(() => expect(nested).toBeTypeOf("function"));
    const drains = [expect(waitForApiMutations()).rejects.toThrow("NESTED_UNKNOWN"), expect(waitForApiMutations()).rejects.toThrow("NESTED_UNKNOWN")];
    nested(); await outer; await Promise.all(drains);
    await expect(waitForApiMutations()).resolves.toBeUndefined();
  });
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
