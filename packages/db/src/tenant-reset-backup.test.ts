import { describe, expect, it, vi } from "vitest";
import { resetDigest, tenantResetTableNames } from "@o-okul/db";
import { decryptResetPackage, encryptResetPackage, resetBytesHash, verifyResetPackage, verifyRestoredRowsAndObjects, assertPrivateBucket, type TenantResetPackage } from "./tenant-reset-backup.js";

function packageFixture(): TenantResetPackage {
  const rawTables = Object.fromEntries(tenantResetTableNames.map((table) => [table, table === "Tenant" ? ['{"id": "tenant-a", "lifecycleVersion": 1}'] : table === "PaymentTransaction" ? ['{"amount": 9007199254740993123.1234}'] : []])) as TenantResetPackage["rawTables"];
  const bytes = Buffer.from("real object bytes");
  const migrationRows = ['{"migration_name":"test","finished_at":"2026-01-01"}'];
  const schemaDigest = resetDigest(migrationRows);
  return { rawTables, migrationRows, schemaArchive: Buffer.from("schema archive").toString("base64"), objects: [{ key: "owned/source", base64: bytes.toString("base64") }],
    manifest: { format: "TENANT_RESET_BACKUP_V1", tenantId: "tenant-a", lifecycleVersion: 1, schemaDigest, dependencyProjection: "DISABLED_PLATFORM_ACCOUNT_V1", sourceIdentity: "source", dataDigest: resetDigest({ schemaDigest, rawTables }),
      schemaArchiveSha256: resetBytesHash(Buffer.from("schema archive")), tables: tenantResetTableNames.map((table) => ({ table, count: rawTables[table].length, sha256: resetDigest(rawTables[table]) })), objects: [{ key: "owned/source", size: bytes.length, sha256: resetBytesHash(bytes) }] } };
}
describe("tenant reset package integrity", () => {
  it("encrypts and authenticates exact raw JSON bytes without decimal rounding", () => {
    const pkg = packageFixture();
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptResetPackage(Buffer.from(JSON.stringify(pkg)), key);
    expect(encrypted.toString()).not.toContain("9007199254740993123");
    const restored = JSON.parse(decryptResetPackage(encrypted, key).toString());
    expect(restored.rawTables.PaymentTransaction[0]).toContain("9007199254740993123.1234");
    expect(() => verifyResetPackage(restored, pkg.manifest)).not.toThrow();
    encrypted[30] = encrypted[30]! ^ 1;
    expect(() => decryptResetPackage(encrypted, key)).toThrow("RESET_PACKAGE_INTEGRITY_FAILED");
  });
  it.each(["tenantId", "lifecycleVersion", "schemaDigest", "dataDigest", "sourceIdentity"] as const)("binds %s to expected operation context", (field) => {
    const pkg = packageFixture();
    expect(() => verifyResetPackage(pkg, { ...pkg.manifest, [field]: "different" } as never)).toThrow("RESET_PACKAGE_INTEGRITY_FAILED");
  });
  it("rejects altered contents with unchanged counts", () => {
    const pkg = packageFixture();
    pkg.rawTables.PaymentTransaction[0] = '{"amount": 0}';
    expect(() => verifyResetPackage(pkg, pkg.manifest)).toThrow("RESET_PACKAGE_INTEGRITY_FAILED");
  });
  it.each(["row", "object", "constraint"])("reads actual restored %s data and rejects mismatch", async (failure) => {
    const pkg = packageFixture();
    const db = { async connect() { return { async query(sql: string) {
      if (sql.includes('FROM "_prisma_migrations"')) return { rows: pkg.migrationRows.map((row) => ({ row })) };
      if (sql.includes("pg_constraint")) return { rows: [{ count: failure === "constraint" ? "1" : "0" }] };
      const table = sql.match(/FROM "(\w+)" t/)?.[1] as keyof typeof pkg.rawTables;
      if (table) return { rows: pkg.rawTables[table].map((row) => ({ row: failure === "row" && table === "Tenant" ? '{}' : row })) };
      return { rows: [] };
    }, release() {} }; } };
    const s3 = { async send(command: { constructor: { name: string } }) {
      if (command.constructor.name === "ListObjectsV2Command") return { Contents: [{ Key: "owned/source", Size: 17, ETag: "etag" }] };
      return { Body: { transformToByteArray: async () => Buffer.from(failure === "object" ? "evil object bytes" : "real object bytes") } };
    } };
    await expect(verifyRestoredRowsAndObjects(db as never, s3 as never, "target", pkg)).rejects.toThrow(failure === "row" ? "RESET_RESTORE_ROW_MISMATCH" : failure === "object" ? "RESET_RESTORE_OBJECT_MISMATCH" : "RESET_RESTORE_CONSTRAINT_UNVERIFIED");
  });
  it("requires provider evidence of private storage", async () => {
    const s3 = { send: vi.fn().mockResolvedValueOnce({ Owner: { ID: "owner" }, Grants: [{ Grantee: { Type: "Group", URI: "public" } }] }) };
    await expect(assertPrivateBucket(s3 as never, "backup")).rejects.toThrow("RESET_DESTINATION_NOT_PRIVATE");
  });
});
