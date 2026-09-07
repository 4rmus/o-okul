import type { TenantResetDeliveryReceipt, TenantResetDiagnostics, TenantResetRequestState, TenantManagement } from "@o-okul/shared-types";
import { lookupNotificationReceiptFromEnv } from "@o-okul/notification-adapter";
import { createHash } from "node:crypto";
import type { TenantRecord } from "./tenant-store.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { withTenantDb } from "@o-okul/db";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Queue } from "bullmq";
import pg from "pg";
import { PostgresInstitutionResetRequests, freshResetJobId, freshResetQueue, freshResetStatus, PostgresFreshResetStore, requireResetWriteQuiescence, type FreshResetRequest, type FreshResetOperation } from "@o-okul/db";
import { z } from "zod";
import type { RequestContext } from "../context/request-context.js";
import { verifyAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import { hashIdempotencyRequest } from "../http/idempotency.js";
import { parseRedisUrl } from "../config/env.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { TenantResetPreviewService } from "./tenant-reset-preview.service.js";
import { waitForApiMutations } from "../context/tenant-mutation-activity.js";

export const tenantResetRequestBodySchema = z.object({ expectedRequestId: z.string().regex(/^[a-f0-9]{32}$/).nullable(), preset: z.literal("CLEAN_SETUP_V1") }).strict();
export const tenantResetRevokeBodySchema = z.object({ expectedRequestId: z.string().regex(/^[a-f0-9]{32}$/) }).strict();

export const tenantCleanResetBodySchema = z.object({ preset: z.literal("CLEAN_SETUP_V1"), expectedLifecycleVersion: z.number().int().min(0).max(2147483646), preflightDigest: z.string().regex(/^[a-f0-9]{64}$/), confirmationText: z.string().min(1).max(128), reason: z.enum(["SECURITY_REVIEW", "INSTITUTION_REQUEST", "OPERATIONS_REVIEW"]) }).strict();
@Injectable()
export class TenantFreshResetService {
  private readonly pool = resolvePersistenceDriver(process.env.TENANT_STORE) === "postgres" ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
  readonly store = this.pool ? new PostgresFreshResetStore(this.pool) : undefined;
  constructor(private readonly preview: TenantResetPreviewService) {}
  private dispatchTimer?: ReturnType<typeof setInterval>;
  private dispatching?: Promise<void>;
  private stopping = false;
  onModuleInit() {
    if (!this.store || !process.env.REDIS_URL) return;
    const dispatch = () => {
      if (this.stopping || this.dispatching) return;
      this.dispatching = (async () => { for (const op of await this.store!.pending()) await enqueueFreshReset(op); })();
      // Keep the original rejection visible to shutdown; background failures remain durable and retryable.
      void this.dispatching.catch(() => {}).finally(() => { this.dispatching = undefined; });
    };
    this.dispatchTimer = setInterval(() => { void dispatch(); }, 30000);
    this.dispatchTimer.unref();
    void dispatch();
  }
  async onModuleDestroy() { this.stopping = true; if (this.dispatchTimer) clearInterval(this.dispatchTimer); await this.dispatching; }
  async onApplicationShutdown() { await waitForApiMutations(); await this.pool?.end(); }
  async institutionRequest(context: RequestContext): Promise<TenantResetRequestState> {
    assertInstitutionAdmin(context);
    if (!this.pool) throw new ServiceUnavailableException("RESET_SOURCE_UNVERIFIED");
    return { request: await new PostgresInstitutionResetRequests(this.pool).read(context.tenantId!) };
  }
  async changeInstitutionRequest(context: RequestContext, expectedRequestId: string | null, revoke = false): Promise<TenantResetRequestState> {
    assertInstitutionAdmin(context);
    if (!this.pool) throw new ServiceUnavailableException("RESET_SOURCE_UNVERIFIED");
    try {
      return { request: await new PostgresInstitutionResetRequests(this.pool).change({ tenantId: context.tenantId!, userId: context.userId, sessionId: context.sessionId!, membershipId: context.membershipId!, membershipVersion: context.membershipVersion! }, expectedRequestId, revoke) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "RESET_REQUEST_ACTOR_INVALID") throw new ForbiddenException(code);
      if (["RESET_REQUEST_TENANT_INACTIVE", "RESET_REQUEST_ALREADY_ACCEPTED", "RESET_REQUEST_CHANGED", "RESET_INSTITUTION_REQUEST_INVALID"].includes(code)) throw new ConflictException(code);
      throw new ServiceUnavailableException("RESET_SOURCE_UNVERIFIED");
    }
  }
  async create(context: RequestContext, tenantId: string, input: FreshResetRequest, key?: string, proof?: string) {
    assertResetAdmin(context, tenantId);
    const parsed = tenantCleanResetBodySchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("RESET_REQUEST_INVALID");
    if (!key) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new BadRequestException("IDEMPOTENCY_KEY_INVALID");
    if (!proof || !context.sessionId || context.membershipVersion === undefined) throw new UnauthorizedException("MFA_STEP_UP_REQUIRED");
    try { verifyAdminMfaStepUpProof(proof, { userId: context.userId, sessionId: context.sessionId, membershipVersion: context.membershipVersion, purpose: "TENANT_CLEAN_RESET", target: { tenantId, preset: input.preset, expectedLifecycleVersion: input.expectedLifecycleVersion, preflightDigest: input.preflightDigest } }); }
    catch { throw new UnauthorizedException("MFA_STEP_UP_INVALID"); }
    try {
      if (!this.store) throw new Error("RESET_SOURCE_UNVERIFIED");
      const operation = await this.store.create(tenantId, parsed.data, { userId: context.userId, sessionId: context.sessionId, membershipVersion: context.membershipVersion, key, requestHash: hashIdempotencyRequest("tenant.clean-reset.enqueue", { tenantId, ...parsed.data }) }, async () => {
        await requireResetWriteQuiescence(tenantId);
        const preview = await this.preview.preview(tenantId);
        if (!preview.allowed) throw new Error("RESET_PREFLIGHT_BLOCKED");
        if (preview.preflightDigest !== input.preflightDigest || preview.lifecycleVersion !== input.expectedLifecycleVersion) throw new Error("RESET_PREFLIGHT_CHANGED");
      });
      // Operation is durable before Redis. A lost enqueue response never creates another operation.
      try { await enqueueFreshReset(operation); } catch { /* Same accepted POST or dispatcher reconciles the durable operation. */ }
      return freshResetStatus(operation);
    } catch (error) { throw resetHttpError(error); }
  }
  async management(context: RequestContext, tenant: TenantRecord): Promise<TenantManagement> {
    assertResetAdmin(context, tenant.id);
    const closed: TenantManagement = { verified: false, allowedActions: { suspend: false, reactivate: false, cleanReset: false }, currentReset: null };
    try {
      // A bounded read, independent of the slower object/queue inventory. Never enqueue from GET.
      const current = this.pool ? await withTenantDb(this.pool, { bypassRls: true, tenantId: tenant.id, readOnly: true }, async (db) => {
        return (await db.query<FreshResetOperation>(`SELECT "id", "status", "phase", "errorCode", "result" FROM "TenantFreshResetOperation" WHERE "tenantId" = $1 ORDER BY ("status" <> 'COMPLETED') DESC, "createdAt" DESC LIMIT 1`, [tenant.id])).rows[0];
      }) : undefined;
      const currentReset = current ? freshResetStatus(current) : null;
      const idle = !current || current.status === "COMPLETED";
      const valid = Number.isInteger(tenant.lifecycleVersion) && tenant.lifecycleVersion >= 0 && tenant.lifecycleVersion < 2147483647;
      return { verified: true, currentReset, allowedActions: {
        suspend: idle && valid && tenant.status === "ACTIVE" && hasCapability(context, "tenant:lifecycle"),
        reactivate: idle && valid && tenant.status === "SUSPENDED" && hasCapability(context, "tenant:lifecycle"),
        cleanReset: Boolean(this.pool) && idle && valid && tenant.status === "SUSPENDED" && hasCapability(context, "tenant:clean-reset"),
      } };
    } catch { return closed; }
  }
  async diagnostics(context: RequestContext, tenantId: string, activityAfter = "", deliveryAfter = ""): Promise<TenantResetDiagnostics> {
    assertResetAdmin(context, tenantId);
    if ([activityAfter, deliveryAfter].some((value) => value !== "" && !/^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new BadRequestException("RESET_DIAGNOSTICS_CURSOR_INVALID");
    if (!this.pool) throw new ServiceUnavailableException("RESET_SOURCE_UNVERIFIED");
    return withTenantDb(this.pool, { tenantId, bypassRls: true, readOnly: true }, async (db) => {
      const activities = (await db.query<TenantResetDiagnostics["activities"]["items"][number]>(`SELECT "id", "kind", "status", "lifecycleVersion", "createdAt" FROM "TenantMutationActivity" WHERE "tenantId" = $1 AND "id" > $2 ORDER BY "id" LIMIT 51`, [tenantId, activityAfter])).rows;
      const deliveries = (await db.query<TenantResetDiagnostics["deliveries"]["items"][number]>(`SELECT o."id", o."purpose", o."status", o."sourceScope", o."tenantLifecycleVersion" AS "lifecycleVersion", o."createdAt", (o."attempts" > 0) AS "attempted", (o."providerMessageId" IS NOT NULL) AS "hasProviderReceipt" FROM "SecretDeliveryOutbox" o WHERE o."id" > $2 AND (o."tenantId" = $1 OR (o."sourceScope" IS NULL AND ((o."purpose" = 'PASSWORD_RESET' AND o."sourceId" IN (SELECT p."id" FROM "PasswordResetToken" p JOIN "User" u ON u."id" = p."userId" WHERE u."tenantId" = $1)) OR (o."purpose" = 'IDENTITY_INVITATION' AND o."sourceId" IN (SELECT "id" FROM "IdentityInvitation" WHERE "tenantId" = $1))))) AND (o."status" IN ('PENDING','PROCESSING','UNCERTAIN') OR (o."sourceScope" IS NULL AND o."attempts" > 0 AND o."status" <> 'DELIVERED')) ORDER BY o."id" LIMIT 51`, [tenantId, deliveryAfter])).rows;
      const page = <T extends { id: string }>(rows: T[]) => ({ items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null });
      return { activities: page(activities), deliveries: page(deliveries), reconciliation: "EXTERNAL_PROOF_REQUIRED" };
    });
  }
  async deliveryReceipt(context: RequestContext, tenantId: string, deliveryId: string): Promise<TenantResetDeliveryReceipt> {
    assertResetAdmin(context, tenantId);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(deliveryId)) throw new BadRequestException("RESET_DELIVERY_ID_INVALID");
    if (!this.pool) throw new ServiceUnavailableException("RESET_SOURCE_UNVERIFIED");
    const row = await withTenantDb(this.pool, { tenantId, bypassRls: true, readOnly: true }, async (db) => (await db.query<{ id: string; tenantId: string; sourceScope: string | null; lifecycleVersion: number | null; providerMessageId: string | null }>(`SELECT "id", "tenantId", "sourceScope", "tenantLifecycleVersion" AS "lifecycleVersion", "providerMessageId" FROM "SecretDeliveryOutbox" WHERE "id" = $1 AND "tenantId" = $2`, [deliveryId, tenantId])).rows[0]);
    if (!row || row.id !== deliveryId || row.tenantId !== tenantId) throw new NotFoundException("RESET_DELIVERY_NOT_FOUND");
    if (row.sourceScope !== "TENANT" || !Number.isInteger(row.lifecycleVersion) || row.lifecycleVersion! < 0) throw new ConflictException("RESET_DELIVERY_SOURCE_UNVERIFIED");
    const receipt = await lookupNotificationReceiptFromEnv(process.env, `secret-delivery:${row.id}`);
    let status = receipt.status;
    let correlation: TenantResetDeliveryReceipt["correlation"] = "UNVERIFIED";
    if (status === "PROVIDER_ACCEPTED") {
      if (row.providerMessageId === null) correlation = "KEY_ONLY";
      else if (typeof row.providerMessageId === "string" && row.providerMessageId.trim() && row.providerMessageId.length <= 512 && createHash("sha256").update(row.providerMessageId).digest("hex") === receipt.providerReceiptHash) correlation = "LOCAL_RECEIPT_MATCH";
      else status = "UNVERIFIED";
    }
    return { deliveryId: row.id, lifecycleVersion: row.lifecycleVersion!, status, correlation, createdAt: receipt.createdAt, expiresAt: receipt.expiresAt, providerReceiptHash: status === "PROVIDER_ACCEPTED" ? receipt.providerReceiptHash : null, reconciliation: "EXTERNAL_PROOF_REQUIRED" };
  }
  async statusByKey(context: RequestContext, tenantId: string, key?: string) {
    assertResetAdmin(context, tenantId);
    if (!key) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new BadRequestException("IDEMPOTENCY_KEY_INVALID");
    if (!this.store) throw new ServiceUnavailableException("RESET_SOURCE_UNVERIFIED");
    const operation = await this.store.findByKey(tenantId, context.userId, key);
    if (!operation) throw new NotFoundException("RESET_OPERATION_NOT_FOUND");
    return freshResetStatus(operation);
  }
  async status(context: RequestContext, tenantId: string, operationId: string) {
    assertResetAdmin(context, tenantId);
    if (!/^[a-f0-9]{32}$/.test(operationId)) throw new BadRequestException("RESET_OPERATION_INVALID");
    if (!this.store) throw new ServiceUnavailableException("RESET_SOURCE_UNVERIFIED");
    const operation = await this.store.find(tenantId, operationId);
    if (!operation) throw new NotFoundException("RESET_OPERATION_NOT_FOUND");
    return freshResetStatus(operation);
  }
}
export function assertResetAdmin(context: RequestContext, tenantId: string) {
  if (!context.roles.includes("SYSTEM_ADMIN")) throw new ForbiddenException("SYSTEM_ADMIN_REQUIRED");
  if (tenantId === "system") throw new ForbiddenException("SYSTEM_TENANT_PROTECTED");
}
export async function enqueueFreshReset(op: FreshResetOperation) {
  if (op.status === "COMPLETED") return;
  if (!process.env.REDIS_URL) throw new Error("RESET_QUEUE_UNVERIFIED");
  const queue = new Queue(freshResetQueue, { connection: parseRedisUrl(), prefix: process.env.QUEUE_PREFIX });
  try {
    const id = freshResetJobId(op.id);
    const previous = await queue.getJob(id);
    if (previous) {
      const state = await previous.getState();
      if (state === "failed") await previous.retry();
      else if (state === "completed") await previous.remove();
      else return;
      if (state === "failed") return;
    }
    await queue.add(freshResetQueue, { tenantId: op.tenantId, operationId: op.id }, { jobId: id, attempts: 3, backoff: { type: "exponential", delay: 10000 }, removeOnComplete: false, removeOnFail: false });
  } finally { await queue.close(); }
}
function resetHttpError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (["IDEMPOTENCY_KEY_BODY_MISMATCH", "TENANT_LIFECYCLE_VERSION_CONFLICT", "RESET_OPERATION_IN_PROGRESS", "RESET_PREFLIGHT_CHANGED", "RESET_REQUIRES_SUSPENDED", "RESET_PREFLIGHT_BLOCKED", "RESET_INSTITUTION_REQUEST_REQUIRED", "RESET_INSTITUTION_REQUEST_INVALID", "RESET_WRITE_QUIESCENCE_UNVERIFIED"].includes(code)) return new ConflictException(code);
  if (code === "MFA_STEP_UP_CONTEXT_INVALID") return new UnauthorizedException(code);
  if (["RESET_CONFIRMATION_MISMATCH", "RESET_TARGET_INVALID"].includes(code)) return new BadRequestException(code);
  return new ServiceUnavailableException("RESET_SOURCE_UNVERIFIED");
}

export function assertInstitutionAdmin(context: RequestContext) {
  if (!context.tenantId || context.tenantId === "system" || context.bypassRls || context.roles.includes("SYSTEM_ADMIN") || !context.roles.some((role) => ["TENANT_ADMIN", "TENANT_OWNER"].includes(role)) || context.activePersona !== "STAFF" || context.tenantAccessMode === "read_only" || context.rolePreview || !context.sessionId || !context.membershipId || !Number.isInteger(context.membershipVersion) || context.campusScope?.scopeMode === "CAMPUSES") throw new ForbiddenException("INSTITUTION_ADMIN_REQUIRED");
}
