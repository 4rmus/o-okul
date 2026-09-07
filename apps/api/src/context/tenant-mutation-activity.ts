import pg from "pg";
import { runTenantMutationActivity, type TenantMutationAdmission } from "@o-okul/db";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { getRequestContext } from "./request-context.js";
let pool: pg.Pool | undefined;
export function currentTenantMutationVersion(tenantId?: string): number {
  const durable = resolvePersistenceDriver(process.env.TENANT_STORE) === "postgres";
  let context;
  try { context = getRequestContext(); } catch { if (!durable) return 0; throw new Error("TENANT_ACTIVITY_CONTEXT_INVALID"); }
  if (!durable) return context.tenantLifecycleVersion ?? 0;
  if (!context.tenantId || (tenantId !== undefined && tenantId !== context.tenantId) || !Number.isInteger(context.tenantLifecycleVersion)) throw new Error("TENANT_ACTIVITY_CONTEXT_INVALID");
  return context.tenantLifecycleVersion!;
}
export async function runApiTenantMutation<T>(kind: TenantMutationAdmission["kind"], run: () => Promise<T>, tenantId?: string): Promise<T> {
  // The existing resolver forces PostgreSQL in production regardless of memory flags.
  if (resolvePersistenceDriver(process.env.TENANT_STORE) !== "postgres") return run();
  const version = currentTenantMutationVersion(tenantId);
  const context = getRequestContext();
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return runTenantMutationActivity(pool, { tenantId: context.tenantId!, lifecycleVersion: version, kind, actor: { userId: context.userId, sessionId: context.sessionId!, membershipVersion: context.membershipVersion! } }, run);
}
export async function closeTenantMutationPool(): Promise<void> { const previous = pool; pool = undefined; await previous?.end(); }

export async function runVerifiedTenantMutation<T>(admission: TenantMutationAdmission, run: () => Promise<T>): Promise<T> {
  if (resolvePersistenceDriver(process.env.TENANT_STORE) !== "postgres" || admission.tenantId === "system") return run();
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return runTenantMutationActivity(pool, admission, run);
}
