import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { loginAsSettled, testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import type { TenantStatusUpdateRequest } from "@o-okul/shared-types";
import { Queue } from "bullmq";
import { TenantFreshResetService } from "./tenant-fresh-reset.service.js";
import { AppModule } from "../app.module.js";

describe("TenantController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let systemToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];

    systemToken = await login("system@example.test");
    adminToken = await login("admin-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password?: string): Promise<string> {
    return loginAsSettled(server, email, password);
  }

  function changeStatus(id: string, slug: string, status: "ACTIVE" | "SUSPENDED", version: number, key = `lifecycle-${id}-${version}`, overrides: Partial<TenantStatusUpdateRequest> = {}) {
    const actor = JSON.parse(Buffer.from(systemToken.split(".")[0]!, "base64url").toString());
    const body = { status, expectedLifecycleVersion: version, reason: "SECURITY_REVIEW" as const, confirmationText: slug, ...overrides };
    const proof = createAdminMfaStepUpProof({ userId: actor.sub, sessionId: actor.sessionId, membershipVersion: actor.membershipVersion,
      purpose: "TENANT_LIFECYCLE_CHANGE", target: { tenantId: id, status: body.status, expectedLifecycleVersion: body.expectedLifecycleVersion } });
    return request(server).patch(`/tenants/${id}/status`).set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", key).set("X-Step-Up-Token", proof.stepUpToken).send(body);
  }

  it("detail exposes authoritative management without object inventory", async () => {
    await request(server).get("/tenants/tenant-a").set("Authorization", `Bearer ${adminToken}`).expect(403);
    const response = await request(server).get("/tenants/tenant-a").set("Authorization", `Bearer ${systemToken}`).expect(200);
    expect(response.body.management).toEqual({ verified: true, currentReset: null, allowedActions: { suspend: true, reactivate: false, cleanReset: false } });
  });

  it("receipt diagnosis is system-only, source-bound and no-store", async () => {
    const service = app.get(TenantFreshResetService);
    const originalPool = (service as unknown as { pool: unknown }).pool;
    const query = vi.fn(async (sql: string, values?: unknown[]) => ({ rows: sql.includes('FROM "SecretDeliveryOutbox"') && values?.[1] === "tenant-a" ? [{ id: "outbox-1", tenantId: "tenant-a", sourceScope: "TENANT", lifecycleVersion: 1, providerMessageId: null }] : [] }));
    Object.defineProperty(service, "pool", { value: { connect: async () => ({ query, release: vi.fn() }) }, configurable: true });
    const route = "/tenants/tenant-a/reset-diagnostics/deliveries/outbox-1/receipt";
    try {
      await request(server).get(route).expect(401);
      await request(server).get(route).set("Authorization", `Bearer ${adminToken}`).expect(403);
      expect(query).not.toHaveBeenCalled();
      await request(server).get(route.replace("tenant-a", "tenant-b")).set("Authorization", `Bearer ${systemToken}`).expect(404);
      const response = await request(server).get(route).set("Authorization", `Bearer ${systemToken}`).expect(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({ deliveryId: "outbox-1", lifecycleVersion: 1, status: "UNAVAILABLE", reconciliation: "EXTERNAL_PROOF_REQUIRED" });
      expect(query.mock.calls.every(([sql]) => !/^(UPDATE|DELETE|INSERT)/.test(sql))).toBe(true);
    } finally { Object.defineProperty(service, "pool", { value: originalPool, configurable: true }); }
  });

  it("reset jobs are platform-only and system protected", async () => {
    const body = { preset: "CLEAN_SETUP_V1", expectedLifecycleVersion: 0, preflightDigest: "a".repeat(64), reason: "OPERATIONS_REVIEW", confirmationText: "dna-egitim" };
    await request(server).post("/tenants/tenant-a/clean-reset-jobs").set("Authorization", `Bearer ${adminToken}`).send(body).expect(403);
    await request(server).get(`/tenants/tenant-a/clean-reset-jobs/${"a".repeat(32)}`).set("Authorization", `Bearer ${adminToken}`).expect(403);
    await request(server).post("/tenants/system/clean-reset-jobs").set("Authorization", `Bearer ${systemToken}`).send(body).expect(403);
    const post = () => request(server).post("/tenants/tenant-a/clean-reset-jobs").set("Authorization", `Bearer ${systemToken}`);
    await post().send(body).expect(400).expect(({ body }) => expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED"));
    await post().set("Idempotency-Key", "invalid/key").send(body).expect(400).expect(({ body }) => expect(body.error.code).toBe("IDEMPOTENCY_KEY_INVALID"));
    await post().set("Idempotency-Key", "reset-idempotency-a").send(body).expect(401).expect(({ body }) => expect(body.error.code).toBe("MFA_STEP_UP_REQUIRED"));
    await post().set("Idempotency-Key", "reset-idempotency-a").set("X-Step-Up-Token", "invalid-proof").send(body).expect(401).expect(({ body }) => expect(body.error.code).toBe("MFA_STEP_UP_INVALID"));
    const actor = JSON.parse(Buffer.from(systemToken.split(".")[0]!, "base64url").toString());
    const proof = createAdminMfaStepUpProof({ userId: actor.sub, sessionId: actor.sessionId, membershipVersion: actor.membershipVersion,
      purpose: "TENANT_CLEAN_RESET", target: { tenantId: "tenant-a", preset: "CLEAN_SETUP_V1", expectedLifecycleVersion: 0, preflightDigest: body.preflightDigest } });
    await post().set("Idempotency-Key", "reset-idempotency-a").set("X-Step-Up-Token", proof.stepUpToken).send(body).expect(503).expect(({ body }) => expect(body.error.code).toBe("RESET_SOURCE_UNVERIFIED"));
  });

  it("looks up a lost reset response by actor/tenant/key using GET without creating or enqueuing", async () => {
    const service = app.get(TenantFreshResetService), originalStore = service.store;
    const actor = JSON.parse(Buffer.from(systemToken.split(".")[0]!, "base64url").toString());
    const operation = { id: "b".repeat(32), status: "QUEUED", phase: "PREFLIGHT", errorCode: null, result: null,
      actorUserId: actor.sub, tenantId: "tenant-a", idempotencyKey: "reset-lost-response-a", backupReceipt: { private: "hidden" } };
    const create = vi.fn(), add = vi.spyOn(Queue.prototype, "add");
    const findByKey = vi.fn(async (tenantId: string, actorUserId: string, key: string) => tenantId === operation.tenantId && actorUserId === operation.actorUserId && key === operation.idempotencyKey ? operation : undefined);
    Object.defineProperty(service, "store", { value: { findByKey, create }, configurable: true });
    const get = (tenantId = "tenant-a") => request(server).get(`/tenants/${tenantId}/clean-reset-jobs`).set("Authorization", `Bearer ${systemToken}`);
    try {
      await request(server).get("/tenants/tenant-a/clean-reset-jobs").set("Authorization", `Bearer ${adminToken}`).set("Idempotency-Key", operation.idempotencyKey).expect(403);
      await get("system").set("Idempotency-Key", operation.idempotencyKey).expect(403);
      await get().expect(400).expect(({ body }) => expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED"));
      await get().set("Idempotency-Key", "invalid/key").expect(400).expect(({ body }) => expect(body.error.code).toBe("IDEMPOTENCY_KEY_INVALID"));
      expect(findByKey).not.toHaveBeenCalled();
      await get().set("Idempotency-Key", "unknown-key").expect(404).expect(({ body }) => expect(body.error.code).toBe("RESET_OPERATION_NOT_FOUND"));
      await get("tenant-b").set("Idempotency-Key", operation.idempotencyKey).expect(404);
      const found = await get().set("Idempotency-Key", operation.idempotencyKey).expect(200);
      expect(found.body).toEqual({ operationId: operation.id, status: "QUEUED", phase: "PREFLIGHT", errorCode: null, result: null });
      expect(findByKey).toHaveBeenLastCalledWith("tenant-a", actor.sub, operation.idempotencyKey);
      operation.actorUserId = "another-platform-actor";
      await get().set("Idempotency-Key", operation.idempotencyKey).expect(404);
      expect(create).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
    } finally { Object.defineProperty(service, "store", { value: originalStore, configurable: true }); add.mockRestore(); }
  });

  it("license-expiry purge candidates are SYSTEM_ADMIN-only, read-only and carry no personal data", async () => {
    const route = "/tenants/license-expiry-purge-candidates";
    await request(server).get(route).expect(401);
    await request(server).get(route).set("Authorization", `Bearer ${adminToken}`).expect(403);
    await request(server).get(route).set("Authorization", `Bearer ${systemToken}`).expect(503);
    const service = app.get(TenantFreshResetService);
    const originalPool = (service as unknown as { pool: unknown }).pool;
    const day = 86_400_000;
    const query = vi.fn(async (sql: string) => ({ rows:
      sql.includes('FROM "Tenant" t') ? [{ id: "tenant-old", name: "Eski Kurum", slug: "eski-kurum", status: "SUSPENDED", lifecycleVersion: 2 }, { id: "tenant-90", name: "Sinir", slug: "sinir", status: "ACTIVE", lifecycleVersion: 0 }]
        : sql.includes('FROM "LicenseTerm"') ? [{ tenantId: "tenant-old", startsAt: new Date(Date.now() - 500 * day), endsAt: new Date(Date.now() - 92.5 * day), cancelledAt: null }, { tenantId: "tenant-90", startsAt: new Date(Date.now() - 500 * day), endsAt: new Date(Date.now() - 90 * day), cancelledAt: null }]
          : sql.includes("AS count") ? [{ count: "42" }] : [] }));
    Object.defineProperty(service, "pool", { value: { connect: async () => ({ query, release: vi.fn() }) }, configurable: true });
    try {
      const response = await request(server).get(route).set("Authorization", `Bearer ${systemToken}`).expect(200);
      expect(response.body).toEqual([expect.objectContaining({ tenantId: "tenant-old", slug: "eski-kurum", daysSinceLicenseEnd: 92, estimatedRowCount: 42 })]);
      expect(Object.keys(response.body[0]).sort()).toEqual(["daysSinceLicenseEnd", "estimatedRowCount", "exportDeliveredOn", "exportId", "licenseEndsAt", "lifecycleVersion", "name", "slug", "status", "tenantId"]);
      expect(query.mock.calls.every(([sql]) => !/^\s*(INSERT|UPDATE|DELETE)/.test(sql))).toBe(true);
    } finally { Object.defineProperty(service, "pool", { value: originalPool, configurable: true }); }
  });

  it("purge handover export and delivery mark are SYSTEM_ADMIN-only, validated and audited (product owner decision 2026-10-05)", async () => {
    const exportRoute = "/tenants/tenant-a/purge-exports";
    const exportId = "e".repeat(32);
    const delivery = (id = exportId) => `/tenants/tenant-a/purge-exports/${id}/delivery`;
    const body = { deliveredOn: "2026-10-01", channel: "SECURE_DOWNLOAD", note: "Kurum müdürüne şifreli bağlantı" };
    const system = (route: string) => request(server).post(route).set("Authorization", `Bearer ${systemToken}`);
    // Security review 2026-10-06: the full institution export needs a step-up bound to { tenantId, TENANT_PURGE_EXPORT }.
    const actor = JSON.parse(Buffer.from(systemToken.split(".")[0]!, "base64url").toString());
    const exportProof = (tenantId = "tenant-a", purpose: "TENANT_PURGE_EXPORT" | "TENANT_CLEAN_RESET" = "TENANT_PURGE_EXPORT") => createAdminMfaStepUpProof({ userId: actor.sub, sessionId: actor.sessionId, membershipVersion: actor.membershipVersion, purpose,
      target: purpose === "TENANT_PURGE_EXPORT" ? { tenantId } : { tenantId, preset: "LICENSE_EXPIRY_PURGE_V1", expectedLifecycleVersion: 0, preflightDigest: "a".repeat(64) } }).stepUpToken;
    const exportWith = (proof: string, route = exportRoute) => system(route).set("X-Step-Up-Token", proof);
    await request(server).post(exportRoute).expect(401);
    await request(server).post(exportRoute).set("Authorization", `Bearer ${adminToken}`).set("X-Step-Up-Token", exportProof()).expect(403);
    await exportWith(exportProof("system"), "/tenants/system/purge-exports").expect(403);
    await system(exportRoute).expect(401).expect(({ body: error }) => expect(error.error.code).toBe("MFA_STEP_UP_REQUIRED"));
    await exportWith("invalid-proof").expect(401).expect(({ body: error }) => expect(error.error.code).toBe("MFA_STEP_UP_INVALID"));
    await exportWith(exportProof("tenant-b")).expect(401).expect(({ body: error }) => expect(error.error.code).toBe("MFA_STEP_UP_INVALID"));
    await exportWith(exportProof("tenant-a", "TENANT_CLEAN_RESET")).expect(401).expect(({ body: error }) => expect(error.error.code).toBe("MFA_STEP_UP_INVALID"));
    await exportWith(exportProof()).expect(503);
    await request(server).post(delivery()).set("Authorization", `Bearer ${adminToken}`).send(body).expect(403);
    await system(delivery()).send({ ...body, channel: "FAX" }).expect(422);
    await system(delivery()).send({ ...body, studentName: "x" }).expect(422);
    await system(delivery("not-an-export")).send(body).expect(400).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_INVALID"));
    await system(delivery()).send({ ...body, note: "veli ali@example.com" }).expect(400).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_NOTE_INVALID"));
    await system(delivery()).send({ ...body, note: "tel 0555 123 45 67" }).expect(400).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_NOTE_INVALID"));
    await system(delivery()).send({ ...body, deliveredOn: "2999-01-01" }).expect(400).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_DELIVERY_INVALID"));
    await system(delivery()).send(body).expect(503);

    const service = app.get(TenantFreshResetService);
    const originalPool = (service as unknown as { pool: unknown }).pool;
    const audit: Array<{ tenantId: string; actorUserId: string; entityType: string; entityId: string; action: string; diff: Record<string, unknown>; createdAt: string }> = [];
    const day = 86_400_000;
    let licenseEndedDaysAgo = 120; let purged = false;
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] };
      if (sql.includes('FROM "LicenseTerm"')) return { rows: [{ startsAt: new Date(Date.now() - (licenseEndedDaysAgo + 365) * day), endsAt: new Date(Date.now() - licenseEndedDaysAgo * day), cancelledAt: null }] };
      if (sql.includes('FROM "TenantFreshResetOperation"')) return { rows: purged ? [{ "?column?": 1 }] : [] };
      if (sql.includes('FROM "Tenant" WHERE "id" = $1')) return { rows: values[0] === "tenant-a" ? [{ id: "tenant-a" }] : [] };
      if (sql.includes("jsonb_agg")) return { rows: [{ rows: sql.includes('"PaymentTransaction"') ? [{ id: "tx-1", amount: 100 }] : [] }] };
      if (sql.startsWith('INSERT INTO "AuditLog"')) { audit.push({ tenantId: String(values[1]), actorUserId: String(values[2]), entityType: String(values[3]), entityId: String(values[4]), action: String(values[5]), diff: JSON.parse(String(values[6])), createdAt: "2026-09-30T10:00:00.000Z" }); return { rows: [] }; }
      if (sql.includes('FROM "AuditLog"')) return { rows: audit.filter((row) => row.tenantId === values[0] && row.entityType === values[1] && row.entityId === values[2]) };
      return { rows: [] };
    });
    Object.defineProperty(service, "pool", { value: { query, connect: async () => ({ query, release: vi.fn() }) }, configurable: true });
    try {
      // Only a purge candidate: license ended 91+ days ago, no live or future term, not purged yet.
      licenseEndedDaysAgo = 90;
      await exportWith(exportProof()).expect(409).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_NOT_CANDIDATE"));
      licenseEndedDaysAgo = -30;
      await exportWith(exportProof()).expect(409).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_NOT_CANDIDATE"));
      licenseEndedDaysAgo = 120; purged = true;
      await exportWith(exportProof()).expect(409).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_NOT_CANDIDATE"));
      purged = false;
      expect(query.mock.calls.some(([sql]) => sql.includes("jsonb_agg"))).toBe(false);
      expect(audit).toEqual([]);
      const created = await exportWith(exportProof()).expect(201);
      expect(created.headers["cache-control"]).toBe("no-store");
      expect(created.headers.pragma).toBe("no-cache");
      expect(created.body).toMatchObject({ exportId: expect.stringMatching(/^[a-f0-9]{32}$/), tenantId: "tenant-a", scope: "license-expiry-purge-handover", rowLimitPerTable: null });
      expect(created.body.tables.paymentTransactions).toEqual([{ id: "tx-1", amount: 100 }]);
      // Handover export has no row limit; the institution's own export keeps its limit.
      expect(query.mock.calls.filter(([sql]) => sql.includes("jsonb_agg")).every(([, values]) => (values as unknown[])[0] === null)).toBe(true);
      expect(audit).toEqual([expect.objectContaining({ actorUserId: actor.sub, entityType: "TenantDataExport", entityId: created.body.exportId, action: "tenant.data-export.created", diff: expect.objectContaining({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) })]);
      // Who, when and row counts only; no row content.
      expect(Object.keys(audit[0]!.diff).sort()).toEqual(["exportedAt", "exportedByUserId", "formatVersion", "rowCounts", "scope", "sha256"]);
      expect(audit[0]!.diff).toMatchObject({ exportedByUserId: actor.sub, exportedAt: created.body.exportedAt, rowCounts: expect.objectContaining({ paymentTransactions: 1 }) });
      expect(Object.values(audit[0]!.diff.rowCounts as Record<string, unknown>).every((count) => Number.isInteger(count))).toBe(true);
      expect(JSON.stringify(audit[0]!.diff)).not.toContain("tx-1");
      await exportWith(exportProof("missing"), "/tenants/missing/purge-exports").expect(404);
      await system(delivery()).send(body).expect(404).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_NOT_FOUND"));
      await system(delivery(created.body.exportId)).send({ ...body, deliveredOn: "2026-09-29" }).expect(400);
      // The delivery mark applies the same candidate rule.
      licenseEndedDaysAgo = -30;
      await system(delivery(created.body.exportId)).send(body).expect(409).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_NOT_CANDIDATE"));
      licenseEndedDaysAgo = 120;
      const marked = await system(delivery(created.body.exportId)).send(body).expect(201);
      expect(marked.body).toMatchObject({ exportId: created.body.exportId, deliveredOn: "2026-10-01", channel: "SECURE_DOWNLOAD" });
      expect(audit.at(-1)).toMatchObject({ action: "tenant.data-export.delivered", diff: { deliveredOn: "2026-10-01", channel: "SECURE_DOWNLOAD", note: body.note } });
      await system(delivery(created.body.exportId)).send(body).expect(409).expect(({ body: error }) => expect(error.error.code).toBe("TENANT_PURGE_EXPORT_ALREADY_DELIVERED"));
    } finally { Object.defineProperty(service, "pool", { value: originalPool, configurable: true }); }
  });

  it("license-expiry purge reuses the reset job endpoint with a preset-bound step-up", async () => {
    const body = { preset: "LICENSE_EXPIRY_PURGE_V1", expectedLifecycleVersion: 0, preflightDigest: "a".repeat(64), reason: "LICENSE_EXPIRED", confirmationText: "dna-egitim" };
    const post = (token = systemToken) => request(server).post("/tenants/tenant-a/clean-reset-jobs").set("Authorization", `Bearer ${token}`).set("Idempotency-Key", "purge-a");
    await post(adminToken).send(body).expect(403);
    await post().send(body).expect(401).expect(({ body }) => expect(body.error.code).toBe("MFA_STEP_UP_REQUIRED"));
    await post().send({ ...body, reason: "OPERATIONS_REVIEW" }).expect(422);
    const actor = JSON.parse(Buffer.from(systemToken.split(".")[0]!, "base64url").toString());
    const bound = (preset: "CLEAN_SETUP_V1" | "LICENSE_EXPIRY_PURGE_V1") => createAdminMfaStepUpProof({ userId: actor.sub, sessionId: actor.sessionId, membershipVersion: actor.membershipVersion,
      purpose: "TENANT_CLEAN_RESET", target: { tenantId: "tenant-a", preset, expectedLifecycleVersion: 0, preflightDigest: body.preflightDigest } }).stepUpToken;
    await post().set("X-Step-Up-Token", bound("CLEAN_SETUP_V1")).send(body).expect(401).expect(({ body }) => expect(body.error.code).toBe("MFA_STEP_UP_INVALID"));
    await post().set("X-Step-Up-Token", bound("LICENSE_EXPIRY_PURGE_V1")).send(body).expect(503).expect(({ body }) => expect(body.error.code).toBe("RESET_SOURCE_UNVERIFIED"));
    await request(server).get("/tenants/tenant-a/clean-reset-preview?preset=DROP_ALL").set("Authorization", `Bearer ${systemToken}`).expect(400);
    const preview = await request(server).get("/tenants/tenant-a/clean-reset-preview?preset=LICENSE_EXPIRY_PURGE_V1").set("Authorization", `Bearer ${systemToken}`).expect(200);
    expect(preview.body).toMatchObject({ preset: "LICENSE_EXPIRY_PURGE_V1", allowed: false });
  });

  it("reset preview is platform-only, PII-safe and remains blocked without verified sources", async () => {
    await request(server).get("/tenants/tenant-a/clean-reset-preview").set("Authorization", `Bearer ${adminToken}`).expect(403);
    await request(server).get("/tenants/system/clean-reset-preview").set("Authorization", `Bearer ${systemToken}`).expect(404);
    const response = await request(server).get("/tenants/tenant-a/clean-reset-preview").set("Authorization", `Bearer ${systemToken}`).expect(200);
    expect(response.body).toMatchObject({ preset: "CLEAN_SETUP_V1", allowed: false, blockers: expect.arrayContaining(["SOURCE_UNVERIFIED", "INSTITUTION_REQUEST_REQUIRED"]) });
    expect(JSON.stringify(response.body)).not.toMatch(/email|password|tokenHash|objectKey/);
  });

  it("SYSTEM_ADMIN tenant listesini görür, oluşturur ve operasyonel alanları günceller", async () => {
    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "tenant-a", plan: "PRO" })]));
      });

    const created = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", "tenant-e2e-1")
      .send(canonicalOnboardingBody("TENANT E2E", "tenant-e2e", "tenant-e2e-owner@example.test", {
        activeStudentLimit: 250,
        endsAt: "2030-01-01T00:00:00.000Z",
        planCode: "PRO",
        startsAt: "2029-01-01T00:00:00.000Z",
      }))
      .expect(201);
    const tenantId = created.body.tenant.id as string;
    expect(created.body).toMatchObject({
      tenant: { plan: "PRO", seatLimit: 250, status: "ACTIVE" },
      owner: { roles: ["TENANT_OWNER"] },
    });

    await request(server)
      .patch(`/tenants/${tenantId}`)
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ name: "TENANT E2E UPDATED" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: tenantId, name: "TENANT E2E UPDATED", plan: "PRO" });
      });

    await changeStatus(tenantId, "tenant-e2e", "SUSPENDED", 0)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ tenant: { id: tenantId, status: "SUSPENDED" } });
      });

    await request(server)
      .delete(`/tenants/${tenantId}`)
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(410)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          error: { code: "TENANT_HARD_DELETE_RETIRED" },
        });
      });

    await request(server)
      .get(`/tenants/${tenantId}`)
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: tenantId, status: "SUSPENDED" });
      });

    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: tenantId })]));
      });
  });

  it("tenant erişim durumunu iki değerle sınırlar ve system tenantı korur", async () => {
    await request(server)
      .patch("/tenants/tenant-a/status")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ status: "TRIAL" })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: "VALIDATION_FAILED",
          details: { fields: expect.arrayContaining([expect.objectContaining({ path: "status" })]) },
        });
      });

    await request(server)
      .patch("/tenants/system/status")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ status: "SUSPENDED", expectedLifecycleVersion: 0, reason: "SECURITY_REVIEW", confirmationText: "system" })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "SYSTEM_TENANT_IMMUTABLE" });
      });

    await request(server)
      .patch("/tenants/tenant-a")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ status: "SUSPENDED" })
      .expect(422);

    await request(server)
      .get("/tenants/system")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(404);

    await request(server)
      .post("/tenants/system/license-terms")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        planCode: "PRO",
        startsAt: "2031-01-01T00:00:00.000Z",
        endsAt: "2032-01-01T00:00:00.000Z",
        activeStudentLimit: 1,
      })
      .expect(400);
  });

  it("askıya alma eski access ve refresh oturumlarını yeniden açma sonrasında da geçersiz tutar", async () => {
    const issued = await request(server).post("/auth/login").send(testLoginBody("admin-a@example.test")).expect(200);
    const refreshCookie = getCookie(issued.headers["set-cookie"], "refreshToken");
    const csrfCookie = getCookie(issued.headers["set-cookie"], "csrfToken");
    const csrfToken = readCookieValue(csrfCookie, "csrfToken");

    const suspended = await changeStatus("tenant-a", "dna-egitim", "SUSPENDED", 0)
      .expect(200);
    expect(suspended.body).toMatchObject({ tenant: { id: "tenant-a", status: "SUSPENDED" } });
    expect(suspended.body.sessionsRevoked).toBeGreaterThan(0);

    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${issued.body.accessToken}`)
      .expect(401);

    await changeStatus("tenant-a", "dna-egitim", "ACTIVE", 1)
      .expect(200);

    await request(server)
      .post("/auth/refresh")
      .set("Cookie", [refreshCookie, csrfCookie])
      .set("X-CSRF-Token", csrfToken)
      .expect(401);

    adminToken = await login("admin-a@example.test");
  });

  it("lifecycle anahtarı tek geçiş yapar, gövde/sürüm/slug uyuşmazlığını reddeder", async () => {
    const first = await changeStatus("tenant-a", "dna-egitim", "SUSPENDED", 2, "lifecycle-idempotency-a").expect(200);
    const replay = await changeStatus("tenant-a", "dna-egitim", "SUSPENDED", 2, "lifecycle-idempotency-a").expect(200);
    expect(replay.body).toEqual(first.body);
    expect(first.body.tenant).toMatchObject({ lifecycleVersion: 3, suspendedReason: "SECURITY_REVIEW" });
    await changeStatus("tenant-a", "dna-egitim", "SUSPENDED", 2, "lifecycle-idempotency-a", { reason: "INSTITUTION_REQUEST" }).expect(409);
    await changeStatus("tenant-b", "demo-kurum-b", "SUSPENDED", 0, "lifecycle-idempotency-a").expect(409);
    await changeStatus("tenant-a", "dna-egitim", "ACTIVE", 2).expect(409);
    await changeStatus("tenant-a", " DNA-EGITIM ", "ACTIVE", 3).expect(400);
    const noop = await changeStatus("tenant-a", "dna-egitim", "SUSPENDED", 3, "lifecycle-noop").expect(200);
    expect(noop.body).toMatchObject({ sessionsRevoked: 0, tenant: { lifecycleVersion: 3 } });
    await changeStatus("tenant-a", "dna-egitim", "ACTIVE", 3).expect(200);
    adminToken = await login("admin-a@example.test");
  });

  it("lifecycle MFA ve anahtar zorunlu; PII içeren serbest gerekçe reddedilir", async () => {
    const body = { status: "SUSPENDED", expectedLifecycleVersion: 4, reason: "SECURITY_REVIEW", confirmationText: "dna-egitim" };
    await request(server).patch("/tenants/tenant-a/status").set("Authorization", `Bearer ${systemToken}`).send(body).expect(400);
    await request(server).patch("/tenants/tenant-a/status").set("Authorization", `Bearer ${systemToken}`).set("Idempotency-Key", "missing-proof").send(body).expect(401);
    await request(server).patch("/tenants/tenant-a/status").set("Authorization", `Bearer ${systemToken}`).set("Idempotency-Key", "wrong-proof").set("X-Step-Up-Token", "wrong").send(body).expect(401);
    await changeStatus("tenant-a", "dna-egitim", "SUSPENDED", 4, "pii-reason", { reason: "person@example.test" as never }).expect(422);
  });

  it("SYSTEM_ADMIN eklemeli LicenseTerm oluşturur ve çakışmayı reddeder", async () => {
    const created = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", "tenant-license-term-e2e-1")
      .send(canonicalOnboardingBody("LICENSE TERM TENANT", "license-term-tenant", "license-term-owner@example.test", {
        planCode: "PRO",
        startsAt: "2030-01-01T00:00:00.000Z",
        endsAt: "2031-01-01T00:00:00.000Z",
        activeStudentLimit: 500,
      }))
      .expect(201);
    const tenantId = created.body.tenant.id as string;

    const body = {
      planCode: "PRO",
      startsAt: "2031-01-01T00:00:00.000Z",
      endsAt: "2032-01-01T00:00:00.000Z",
      activeStudentLimit: 500,
    };
    await request(server)
      .post(`/tenants/${tenantId}/license-terms`)
      .set("Authorization", `Bearer ${systemToken}`)
      .send(body)
      .expect(201)
      .expect(({ body: responseBody }) => {
        expect(responseBody).toMatchObject({
          tenantId,
          ...body,
          auditReference: expect.stringMatching(/^license-[0-9a-f-]{36}$/),
        });
      });

    await request(server)
      .post(`/tenants/${tenantId}/license-terms`)
      .set("Authorization", `Bearer ${systemToken}`)
      .send(body)
      .expect(400)
      .expect(({ body: responseBody }) => {
        expect(JSON.stringify(responseBody)).toContain("LICENSE_TERM_OVERLAP");
      });

    await request(server)
      .post(`/tenants/${tenantId}/license-terms`)
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ ...body, startsAt: body.endsAt, endsAt: body.startsAt })
      .expect(422);

    await request(server)
      .post(`/tenants/${tenantId}/license-terms`)
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ ...body, auditReference: "manual-reference" })
      .expect(422);
  });

  it("TENANT_ADMIN tenant yönetim endpoint'lerine giremez", async () => {
    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
    await request(server)
      .patch("/tenants/tenant-a/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SUSPENDED" })
      .expect(403);
  });

  it("TENANT_ADMIN kendi lisans dönem geçmişini salt-okunur listeler", async () => {
    await request(server)
      .get("/tenants/current/license-terms")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ tenantId: "tenant-a", planCode: "PRO", state: "ACTIVE" }),
        ]);
      });
  });

  it("canonical onboarding lisans, kampüs ve TENANT_OWNER çalışanını idempotent oluşturur", async () => {
    const body = {
      name: "TENANT OWNER E2E",
      slug: "tenant-owner-e2e",
      campuses: [{ name: "MERKEZ KAMPÜS", code: "MRK", unitType: "SCHOOL" }],
      licenseTerm: {
        planCode: "PRO",
        startsAt: "2032-01-01T00:00:00.000Z",
        endsAt: "2033-01-01T00:00:00.000Z",
        activeStudentLimit: 400,
      },
      firstOwner: { name: "İLK SAHİP", email: "owner-e2e@example.test" },
    };

    const first = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", "tenant-owner-e2e-1")
      .send(body)
      .expect(201);
    const replay = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", "tenant-owner-e2e-1")
      .send(body)
      .expect(201);

    expect(replay.body).toEqual(first.body);
    const tenantId = first.body.tenant.id as string;
    expect(first.body).toMatchObject({
      tenant: { id: tenantId, plan: "PRO", seatLimit: 400 },
      campuses: [{ tenantId, name: "MERKEZ KAMPÜS", unitType: "SCHOOL" }],
      licenseTerm: {
        tenantId,
        planCode: "PRO",
        activeStudentLimit: 400,
        auditReference: expect.stringMatching(/^license-[0-9a-f-]{36}$/),
      },
      owner: { tenantId, roles: ["TENANT_OWNER"] },
    });
    expect(JSON.stringify(first.body)).not.toContain("tokenHash");
    expect(JSON.stringify(first.body)).not.toContain("owner-e2e@example.test");

    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", "tenant-owner-e2e-1")
      .send({ ...body, name: "FARKLI KURUM" })
      .expect(409);
  });

  it("canonical onboarding idempotency anahtarını zorunlu tutar", async () => {
    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send(canonicalOnboardingBody("IDEMPOTENCY TENANT", "idempotency-tenant", "idempotency-owner@example.test"))
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
      });
  });

  it("tenant yönetim gövdelerini Zod ile doğrular", async () => {
    const invalidCreate = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        firstAdmin: {
          email: "gecersiz",
          name: " ",
        },
        name: " ",
        seatLimit: 1.5,
        slug: " ",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "campuses" }),
          expect.objectContaining({ path: "firstOwner" }),
          expect.objectContaining({ path: "licenseTerm" }),
          expect.objectContaining({ path: "name" }),
          expect.objectContaining({ path: "slug" }),
          expect.objectContaining({ path: "$" }),
        ]),
      },
    });

    const invalidUpdate = await request(server)
      .patch("/tenants/tenant-a")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        contactEmail: "gecersiz",
        firstAdmin: {
          email: "ignored-admin@example.test",
          name: "Ignored Admin",
          nationalId: "10000000450",
        },
        id: "tenant-forbidden",
        licenseEndsAt: "2026-02-29T00:00:00.000Z",
        logoUrl: "ftp://cdn.example.test/logo.png",
        seatLimit: 0,
      })
      .expect(422);

    expect(invalidUpdate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "contactEmail" }),
          expect.objectContaining({ path: "$" }),
          expect.objectContaining({ path: "logoUrl" }),
        ]),
      },
    });
  });

  it("kurum profil gövdesini Zod ile doğrular", async () => {
    const invalidProfile = await request(server)
      .patch("/me/tenant")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        contactEmail: "gecersiz",
        logoUrl: "ftp://cdn.example.test/logo.png",
        name: 123,
      })
      .expect(422);

    expect(invalidProfile.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "contactEmail" }),
          expect.objectContaining({ path: "logoUrl" }),
          expect.objectContaining({ path: "name" }),
        ]),
      },
    });
  });

  it("SYSTEM_ADMIN tenant listesini arama, sıralama ve sayfalama ile alır", async () => {
    await request(server)
      .get("/tenants")
      .query({ q: "demo", sort: "slug", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ slug: "demo-kurum-b" });
      });
  });

  it("legacy lisans alanlarının PATCH ile değiştirilmesini reddeder", async () => {
    await request(server)
      .patch("/tenants/tenant-a")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ licenseEndsAt: "2020-01-01T00:00:00.000Z" })
      .expect(422);

    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tenantId: "tenant-a",
          roles: ["TENANT_ADMIN"],
        });
      });
  });
});

function canonicalOnboardingBody(
  name: string,
  slug: string,
  email: string,
  licenseTerm = {
    planCode: "PRO",
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: "2027-08-01T00:00:00.000Z",
    activeStudentLimit: 100,
  },
) {
  return {
    name,
    slug,
    campuses: [{ name: "MERKEZ KAMPÜS", code: "MRK", unitType: "SCHOOL" }],
    firstOwner: { name: "İLK SAHİP", email },
    licenseTerm,
  };
}

function getCookie(header: string | string[] | undefined, name: string): string {
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((candidate) => candidate.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return cookie ?? "";
}

function readCookieValue(cookie: string, name: string): string {
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  expect(value).toBeDefined();
  return decodeURIComponent(value?.slice(name.length + 1) ?? "");
}
