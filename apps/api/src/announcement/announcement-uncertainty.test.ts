import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: undefined as undefined | { id: string; referenceId: string; status: string } }));
vi.mock("../context/tenant-mutation-activity.js", async (original) => {
  const { runTenantMutationActivity } = await import("@o-okul/db");
  const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const rows = (items: unknown[]) => ({ rows: items as T[] });
    if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
    if (sql.includes('FROM "Tenant"')) return rows([{ status: "ACTIVE", lifecycleVersion: 2 }]);
    if (sql.includes('FROM "AuthSession"')) return rows([{ id: "session" }]);
    if (sql.includes('"referenceId" = $4')) return rows((state.row as { referenceId: string } | undefined)?.referenceId === values[3] ? [state.row] : []);
    if (sql.startsWith('INSERT INTO "TenantMutationActivity"')) { state.row = { id: String(values[0]), referenceId: String(values[4]), status: "RUNNING" }; return rows([{ id: state.row.id }]); }
    if (sql.startsWith('UPDATE "TenantMutationActivity"')) { if (state.row) state.row.status = "UNCERTAIN"; return rows(state.row ? [{ id: state.row.id }] : []); }
    if (sql.startsWith('DELETE FROM "TenantMutationActivity"')) { const row = state.row; state.row = undefined; return rows(row ? [{ id: row.id }] : []); }
    return rows([]);
  }, release() {} };
  return { ...await original<typeof import("../context/tenant-mutation-activity.js")>(), runVerifiedTenantMutation: <T>(admission: Parameters<typeof runTenantMutationActivity>[1], run: () => Promise<T>) => runTenantMutationActivity({ query: db.query, connect: async () => db }, admission, run) };
});
import { AnnouncementService } from "./announcement.service.js";
describe("notification once-only receipt lifetime", () => {
  it("lost idempotency receipt ACK keeps activity and same-key retry never calls provider twice", async () => {
    state.row = undefined;
    const provider = vi.fn(async () => ({ status: "queued" }));
    const service = Object.assign(Object.create(AnnouncementService.prototype), {
      idempotency: { async run(_context: unknown, _request: unknown, operation: () => Promise<unknown>) { await operation(); throw new Error("RECEIPT_ACK_LOST"); } },
      sendExternalDeliveryOnce: provider,
    }) as AnnouncementService;
    const context = { tenantId: "tenant-a", tenantLifecycleVersion: 2, userId: "admin", sessionId: "session", membershipVersion: 1, roles: ["TENANT_ADMIN"], bypassRls: false };
    const key = "caller-controlled-key";
    await expect(service.sendExternalDelivery(context, "announcement-a", { channel: "EMAIL" }, key)).rejects.toThrow("RECEIPT_ACK_LOST");
    expect((state.row as { status: string } | undefined)?.status).toBe("UNCERTAIN"); expect((state.row as { referenceId: string } | undefined)?.referenceId).not.toContain(key);
    await expect(service.sendExternalDelivery(context, "announcement-a", { channel: "EMAIL" }, key)).rejects.toThrow("TENANT_ACTIVITY_UNRESOLVED");
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
