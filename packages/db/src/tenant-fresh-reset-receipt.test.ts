import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFreshResetServices, signResetRestoreReceipt } from "./tenant-fresh-reset-runner.js";
import { encryptResetPackage, resetBytesHash, type TenantResetPackage } from "./tenant-reset-backup.js";
import { resetDataDigest } from "./tenant-reset-snapshot.js";
import { resetDigest, tenantResetTableNames } from "./tenant-reset-catalog.js";
import type { FreshResetOperation } from "./tenant-fresh-reset.js";
const state = vi.hoisted(() => ({ envelope: Buffer.alloc(0) as Buffer, calls: [] as string[], changed: false, missing: false }));
vi.mock("@aws-sdk/client-s3", async (original) => ({ ...await original<typeof import("@aws-sdk/client-s3")>(), S3Client: class {
  destroy() {}
  async send(command: { constructor: { name: string }; input: { Key?: string; IfMatch?: string } }) {
    state.calls.push(`${command.constructor.name}:${command.input.Key ?? ""}`);
    if (command.constructor.name === "HeadObjectCommand") {
      if (state.missing) throw { $metadata: { httpStatusCode: 404 } };
      return { ETag: "etag", ContentLength: 1 };
    }
    if (command.constructor.name === "DeleteObjectCommand") { expect(command.input.IfMatch).toBe("etag"); state.missing = true; return {}; }
    return { Body: { transformToByteArray: async () => command.input.Key?.startsWith("tenant-reset-backups/") ? state.envelope : Buffer.from(state.changed ? "y" : "x") } };
  }
} }));
beforeEach(() => {
  state.calls = []; state.changed = false; state.missing = false;
  vi.stubEnv("TENANT_RESET_BACKUP_KEY_BASE64", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("TENANT_RESET_BACKUP_SOURCE_DATABASE_URL", "postgres://readonly:secret@db.test/source");
  vi.stubEnv("TENANT_RESET_RESTORE_DATABASE_URL", "postgres://restore:secret@restore.test/drill");
  for (const prefix of ["TENANT_RESET_SOURCE_S3", "TENANT_RESET_BACKUP_S3", "TENANT_RESET_RESTORE_S3"]) {
    for (const [name, value] of Object.entries({ ENDPOINT: "https://objects.test", BUCKET: prefix, ACCESS_KEY_ID: "access", SECRET_ACCESS_KEY: "private" })) vi.stubEnv(`${prefix}_${name}`, value);
  }
});
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const id = "a".repeat(32), key = Buffer.alloc(32, 7);
  const rawTables = Object.fromEntries(tenantResetTableNames.map((table) => [table, []])) as unknown as TenantResetPackage["rawTables"];
  rawTables.Tenant = ['{"id":"tenant-a","lifecycleVersion":3}'];
  const migrationRows = ['{"migration_name":"fixture","finished_at":"2026-01-01"}'];
  const schemaDigest = resetDigest(migrationRows), schemaArchive = Buffer.from("schema").toString("base64");
  const pkg: TenantResetPackage = { rawTables, migrationRows, schemaArchive, objects: [{ key: "owned-object", base64: Buffer.from("x").toString("base64") }], manifest: {
    format: "TENANT_RESET_BACKUP_V1", digestOperationId: id, tenantId: "tenant-a", lifecycleVersion: 3, schemaDigest,
    dependencyProjection: "DISABLED_PLATFORM_ACCOUNT_V1", dataDigest: resetDataDigest(schemaDigest, rawTables, id), schemaArchiveSha256: resetBytesHash(Buffer.from("schema")),
    sourceIdentity: resetDigest({ database: { host: "db.test", port: "5432", database: "/source" }, objects: { endpoint: "https://objects.test", bucket: "TENANT_RESET_SOURCE_S3" } }),
    tables: tenantResetTableNames.map((table) => ({ table, count: rawTables[table].length, sha256: resetDigest(rawTables[table]) })), objects: [{ key: "owned-object", size: 1, sha256: resetBytesHash(Buffer.from("x")) }],
  } };
  state.envelope = encryptResetPackage(Buffer.from(JSON.stringify(pkg)), key);
  const body = { tenantId: "tenant-a", operationId: id, preflightDigest: "preflight", expectedLifecycleVersion: 3, verified: { result: "VERIFIED", operationId: id, packageSha256: resetBytesHash(state.envelope), manifestSha256: resetDigest(pkg.manifest), schemaDigest, dataDigest: pkg.manifest.dataDigest } };
  const reorder = (value: unknown): unknown => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  const op = { id, institutionRequestId: "b".repeat(32), tenantId: "tenant-a", expectedLifecycleVersion: 3, preflightDigest: "preflight", backupReceipt: { signature: signResetRestoreReceipt(body, key), body: reorder(body) } } as unknown as FreshResetOperation;
  return { op, pkg, services: createFreshResetServices(async () => {}) };
}
describe("real authenticated package consumer and exact object adapter", () => {
  it("reads a reordered PostgreSQL JSONB signed receipt and authenticates the encrypted package", async () => {
    const f = fixture(); expect(await f.services.package(f.op)).toEqual(f.pkg);
    expect(state.calls).toEqual([`GetObjectCommand:tenant-reset-backups/${f.op.id}.bin`]);
  });
  it("rejects forged receipt before any S3 request", async () => {
    const f = fixture(); (f.op.backupReceipt!.body as { tenantId: string }).tenantId = "tenant-b";
    await expect(f.services.package(f.op)).rejects.toThrow("RESET_RECEIPT_UNVERIFIED"); expect(state.calls).toEqual([]);
  });
  it("cannot resume deletion against a different copied bucket", async () => {
    const f = fixture(); vi.stubEnv("TENANT_RESET_SOURCE_S3_BUCKET", "copied-bucket");
    await expect(f.services.package(f.op)).rejects.toThrow("RESET_SOURCE_CHANGED");
    expect(state.calls.some((call) => call.startsWith("Delete"))).toBe(false);
  });
  it("deletes only authenticated exact keys with conditional ETag and reconciles 404", async () => {
    const f = fixture(); const fence = vi.fn(async () => {});
    await f.services.deleteObjects(f.pkg, fence); await f.services.verifyObjects(f.pkg, fence); await f.services.deleteObjects(f.pkg, fence);
    expect(state.calls.filter((call) => call.startsWith("Delete"))).toEqual(["DeleteObjectCommand:owned-object"]);
    expect(fence).toHaveBeenCalled();
  });
  it("changed bytes or a lost DB fence prevent object deletion", async () => {
    const f = fixture(); state.changed = true;
    await expect(f.services.deleteObjects(f.pkg, async () => {})).rejects.toThrow("RESET_OBJECT_CHANGED");
    expect(state.calls.some((call) => call.startsWith("Delete"))).toBe(false);
    state.calls = [];
    await expect(f.services.deleteObjects(f.pkg, async () => { throw new Error("RESET_CONNECTION_LOST"); })).rejects.toThrow("RESET_CONNECTION_LOST");
    expect(state.calls).toEqual([]);
  });
});
