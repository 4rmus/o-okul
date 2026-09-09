import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { tenantResetColumns, tenantResetTableNames, resetBytesHash, type TenantResetSnapshot } from "@o-okul/db";
import { DeviceBackupService, validateDeviceBackupPayload, type DeviceBackupPayload } from "./device-backup.service.js";
import { deviceBackupKeyId, openDeviceBackup, sealDeviceBackup } from "./device-backup-archive.js";
import { encryptTcIdentity } from "../student/tc-identity.js";
import type { RequestContext } from "../context/request-context.js";
const state = vi.hoisted(() => ({ snapshots: [] as unknown[], reads: 0, calls: [] as string[], body: Buffer.from("synthetic attachment"), sourceError: false }));
vi.mock("pg", () => ({ default: { Pool: class { async end() {} } } }));
vi.mock("@o-okul/db", async original => {
  const actual = await original<typeof import("@o-okul/db")>();
  return { ...actual,
    withTenantDb: async (_pool: unknown, context: { tenantId: string }, run: (db: unknown) => unknown) => {
      const tenantId = context.tenantId;
      expect(context).toMatchObject({ bypassRls: false, readOnly: true, repeatableRead: true });
      const snapshot = state.snapshots[Math.min(state.reads++, state.snapshots.length-1)] as TenantResetSnapshot;
      expect(tenantId).toBe("tenant-a");
      return run({ query: async (sql: string, values: unknown[] = []) => {
        state.calls.push(sql);
        if (sql.startsWith("SET")) return { rows: [] };
        if (sql.includes("FROM pg_constraint c")) { expect(values).toEqual([]); return { rows: [] }; }
        expect(values[0]).toBe(tenantId);
        if (sql.includes("device_restore_plan")) return { rows: [] };
        if (sql.includes("device_restore_domain")) return { rows: [] };
        if (sql.includes('FROM "LicenseTerm" term')) return { rows: [{activeStudentLimit:100,matches:true}] };
        if (sql.startsWith("SELECT true AS valid")) return { rows: snapshot.tables.User[0]?.accountStatus === "ACTIVE" ? [{ valid: true }] : [] };
        if (sql.includes("sum(octet_length")) return { rows: [{ bytes: "100" }] };
        const table = sql.match(/FROM "([A-Za-z]+)"/)![1] as keyof typeof snapshot.tables;
        expect(sql).toContain(`t."${table === "Tenant" ? "id" : "tenantId"}" = $1`);
        return { rows: snapshot.tables[table].map(row => {
          const projected = Object.fromEntries(Object.entries(row).filter(([key]) => !(values[1] as string[]).includes(key)));
          let text = JSON.stringify(projected);
          if (table === "PaymentTransaction") text = text.replace('"amount":null', '"amount":123456789012345678.123456789');
          return { row: text, encrypted: row.nationalIdEncrypted ?? null };
        }) };
      } });
    },
    readTenantBackupSchema: async () => "c".repeat(64),
    resetS3Config: () => ({ bucket: "source" }), resetS3Client: () => ({ destroy() {} }),
    referencedResetObjectInventory: async () => [{ key: `support-ticket-attachments/tenant-a/ticket/${actual.resetBytesHash(state.body)}/source`, sha256: actual.resetBytesHash(state.body), size: state.body.length }],
    readResetObject: async () => { if (state.sourceError) throw new Error("private-provider-token"); return state.body; },
  };
});
const pair = generateKeyPairSync("ed25519");
const trusted = new Map([[deviceBackupKeyId(pair.publicKey), pair.publicKey]]);
const password = "my private archive password";
const context: RequestContext = { userId: "admin", tenantId: "tenant-a", sessionId: "session", membershipId: "member", membershipVersion: 1, roles: ["TENANT_ADMIN"], activePersona: "STAFF", bypassRls: false };
function fixture(): TenantResetSnapshot {
  const tables = Object.fromEntries(tenantResetTableNames.map(table => [table, []])) as unknown as TenantResetSnapshot["tables"];
  const row = (table: keyof typeof tables, data: Record<string, unknown>) => ({ ...Object.fromEntries(tenantResetColumns[table].map(column => [column, null])), tenantId: "tenant-a", ...data });
  tables.Tenant = [Object.fromEntries(tenantResetColumns.Tenant.map(key => [key,null]))];
  Object.assign(tables.Tenant[0]!, { id: "tenant-a", status: "ACTIVE", lifecycleVersion: 2, name: "Fixture School", slug: "fixture" });
  tables.User = [row("User", { id: "admin", accountStatus: "ACTIVE", membershipVersion: 1, passwordHash: "DO_NOT_EXPORT_PASSWORD", totpSecretEncrypted: "DO_NOT_EXPORT_MFA", nationalIdEncrypted: encryptTcIdentity("10000000146") })];
  tables.AuthSession = [row("AuthSession", { id: "session", userId: "admin", membershipId: "member", membershipVersion: 1, status: "ACTIVE", expiresAt: "2099-01-01", refreshTokenHash: "DO_NOT_EXPORT_REFRESH" })];
  tables.TenantMembership = [row("TenantMembership", { id: "member", userId: "admin", version: 1, scopeMode: "TENANT", staffRole: "TENANT_ADMIN", status: "ACTIVE", startsAt: "2020-01-01" })];
  tables.PaymentTransaction = [row("PaymentTransaction", { id: "payment" })];
  tables.SupportTicketAttachment = [row("SupportTicketAttachment", { id: "attachment", ticketId: "ticket", sha256: resetBytesHash(state.body), storageKey: `support-ticket-attachments/tenant-a/ticket/${resetBytesHash(state.body)}/source` })];
  return { tenantId: "tenant-a", lifecycleVersion: 2, tables, migrationRows: [JSON.stringify({ migration_name: "schema", checksum: "a".repeat(64), finished_at: "2026-01-01" })] } as TenantResetSnapshot;
}
beforeEach(() => {
  vi.stubEnv("TENANT_STORE", "postgres"); vi.stubEnv("PERSISTENCE_DRIVER", "postgres"); vi.stubEnv("DATABASE_URL", "postgresql://unused/fixture");
  vi.stubEnv("TENANT_DEVICE_BACKUP_SIGNING_PRIVATE_KEY", pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  state.snapshots = [fixture()]; state.reads = 0; state.calls = []; state.sourceError = false;
});
afterEach(() => vi.unstubAllEnvs());
describe("portable institution backup", () => {
  it("includes complete file bytes and exact decimal JSON, without account secrets or server-key dependencies", async () => {
    const service = new DeviceBackupService();
    const archive = await service.download(context, password);
    const { payload: plain } = await openDeviceBackup(archive, "tenant-a", password, trusted);
    const payload = JSON.parse(plain.toString()) as DeviceBackupPayload;
    expect(plain.toString()).not.toMatch(/DO_NOT_EXPORT|nationalIdEncrypted|nationalIdHash|passwordHash|refreshTokenHash|totpSecretEncrypted/);
    expect(payload.tables.User?.[0]?.nationalId).toBe("10000000146");
    expect(payload.tables.PaymentTransaction?.[0]?.row).toContain('123456789012345678.123456789');
    expect(Buffer.from(payload.files[0]!.contentBase64,"base64")).toEqual(state.body);
    expect(payload.tables.AuthSession).toBeUndefined(); expect(payload.tables.LicenseTerm).toBeUndefined();
    const preview = await service.preview(context, archive, password);
    expect(preview).toMatchObject({ fileCount: 1, fileBytes: state.body.length, integrityVerified: true, schemaCompatible: true, restoreVerified: false, canRestore: false });
    expect(JSON.stringify(preview)).not.toContain("10000000146");
    expect(state.calls.every(sql => /^(SELECT|SET)/.test(sql))).toBe(true);
  });
  it.each(["TEACHER", "STUDENT", "GUARDIAN", "SYSTEM_ADMIN"])("rejects %s before reading source or parsing a file", async role => {
    const service = new DeviceBackupService();
    await expect(service.download({ ...context, roles: [role] },password)).rejects.toMatchObject({ status: 403 });
    await expect(service.preview({ ...context, roles: [role] },Buffer.alloc(0),password)).rejects.toMatchObject({ status: 403 });
    expect(state.reads).toBe(0);
  });
  it.each(["revoked", "changed"])("refuses a %s source during collection", async variant => {
    const next = fixture();
    if (variant === "revoked") next.tables.User[0]!.accountStatus = "DISABLED"; else next.tables.Tenant[0]!.name = "Changed";
    state.snapshots.push(next);
    await expect(new DeviceBackupService().download(context,password)).rejects.toMatchObject({ status: variant === "revoked" ? 403 : 409 });
  });
  it("rejects missing files, foreign rows and credential columns even in a signed package", async () => {
    const service = new DeviceBackupService();
    const archive = await service.download(context,password);
    const { payload: plain } = await openDeviceBackup(archive,"tenant-a",password,trusted);
    const payload = JSON.parse(plain.toString()) as DeviceBackupPayload;
    expect(() => validateDeviceBackupPayload({ ...payload, files: [] },"tenant-a")).toThrow("DEVICE_BACKUP_OBJECT_INVALID");
    const invalid = structuredClone(payload); const row = JSON.parse(invalid.tables.User![0]!.row); row.passwordHash = "injected"; invalid.tables.User![0]!.row = JSON.stringify(row);
    const signed = await sealDeviceBackup(Buffer.from(JSON.stringify(invalid)),"tenant-a",password,pair.privateKey);
    await expect(service.preview(context,signed,password)).rejects.toMatchObject({ status: 400 });
    const foreign = structuredClone(payload); const attachment = JSON.parse(foreign.tables.SupportTicketAttachment![0]!.row); attachment.tenantId = "tenant-b"; foreign.tables.SupportTicketAttachment![0]!.row = JSON.stringify(attachment);
    expect(() => validateDeviceBackupPayload(foreign,"tenant-a")).toThrow("DEVICE_BACKUP_TENANT_MISMATCH");
  });
  it("does not disclose provider errors", async () => {
    state.sourceError = true;
    await expect(new DeviceBackupService().download(context,password)).rejects.toMatchObject({ status: 503, message: "DEVICE_BACKUP_SOURCE_UNAVAILABLE" });
  });
});
