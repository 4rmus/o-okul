import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDigest, tenantResetTableNames, type TenantResetSnapshot } from "@o-okul/db";

const state = vi.hoisted(() => ({ writes: [] as string[], tools: [] as string[], targetRows: {} as Record<string, string[]>, buckets: {} as Record<string, Map<string, Buffer>>, snapshot: null as TenantResetSnapshot | null, failPostData: false, tamperRows: false, tamperObjects: false, sourceChanged: false, snapshotReads: 0, fileless: false }));
vi.mock("node:dns/promises", () => ({ lookup: async (host: string) => [{ address: ({ "source-db.test": "8.8.8.8", "restore-db.test": "9.9.9.9", "source-s3.test": "8.8.4.4", "backup-s3.test": "1.1.1.1", "restore-s3.test": "1.0.0.1" } as Record<string, string>)[host] ?? "8.8.8.8" }] }));
vi.mock("./tenant-reset-snapshot.js", async (original) => ({ ...await original<typeof import("./tenant-reset-snapshot.js")>(), withResetSnapshot: async (_pool: unknown, _tenant: string, run: (snapshot: TenantResetSnapshot, db: unknown) => Promise<unknown>) => {
  state.snapshotReads++;
  const snapshot = structuredClone(state.snapshot!);
  if (state.sourceChanged && state.snapshotReads > 1) snapshot.dataDigest = "changed";
  return run(snapshot, { query: async () => ({ rows: [{ snapshot: "snapshot-1" }] }) });
} }));
vi.mock("./tenant-reset-objects.js", async (original) => ({ ...await original<typeof import("./tenant-reset-objects.js")>(), resetObjectInventory: async () => state.fileless ? [] : [{ key: "owned/source", size: 17, etag: "etag" }] }));
vi.mock("pg", () => ({ default: { Pool: class {
  async query(sql: string, values?: unknown[]) {
    if (sql.includes("current_database")) return { rows: [{ name: "o_okul_reset_drill_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] };
    if (sql.includes("pg_class")) return { rows: [{ count: "0" }] };
    if (sql.includes("pg_constraint")) return { rows: [{ count: "0" }] };
    if (sql.startsWith("INSERT")) { const table = sql.match(/INTO "(\w+)"/)![1]!; (state.targetRows[table] ??= []).push(String(values![0])); state.writes.push(`db:${table}`); }
    const table = sql.match(/FROM "(\w+)" t/)?.[1];
    if (table) return { rows: (state.targetRows[table] ?? []).map((row) => ({ row: state.tamperRows && table === "Tenant" ? '{}' : row })) };
    return { rows: [] };
  }
  async connect() { return { query: this.query.bind(this), release() {} }; }
  async end() {}
} } }));
vi.mock("@aws-sdk/client-s3", async (original) => ({ ...await original<typeof import("@aws-sdk/client-s3")>(), S3Client: class {
  async send(command: { constructor: { name: string }; input: { Bucket: string; Key?: string; Body?: Buffer } }) {
    const { Bucket: bucket, Key: key, Body: body } = command.input;
    const objects = state.buckets[bucket] ??= new Map();
    switch (command.constructor.name) {
      case "GetBucketAclCommand": return { Owner: { ID: "owner" }, Grants: [{ Grantee: { Type: "CanonicalUser", ID: "owner" } }] };
      case "GetBucketPolicyStatusCommand": return { PolicyStatus: { IsPublic: false } };
      case "GetPublicAccessBlockCommand": return { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } };
      case "ListObjectsV2Command": return { Contents: [...objects].sort(([a], [b]) => a.localeCompare(b)).map(([Key, bytes]) => ({ Key, Size: bytes.length, ETag: "etag" })) };
      case "ListObjectVersionsCommand": case "ListMultipartUploadsCommand": return {};
      case "PutObjectCommand": objects.set(key!, Buffer.from(body!)); state.writes.push(`s3:${bucket}`); return {};
      case "GetObjectCommand": return { Body: { transformToByteArray: async () => state.tamperObjects && bucket.startsWith("o-okul-reset-drill-") ? Buffer.from("evil object bytes") : objects.get(key!) } };
      default: throw new Error("unexpected command");
    }
  }
  destroy() {}
} }));
vi.mock("node:child_process", () => ({ spawn: (command: string, args: string[]) => {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: { resume(): void }; stdin: EventEmitter & { end(): void }; kill(): void };
  child.stdout = new EventEmitter(); child.stderr = { resume() {} }; child.stdin = new EventEmitter() as typeof child.stdin;
  child.kill = () => { child.emit("close", 1); };
  child.stdin.end = () => { queueMicrotask(() => {
    const stage = command === "pg_dump" ? "dump" : args.includes("--section=post-data") ? "post-data" : "pre-data";
    state.tools.push(stage);
    if (command === "pg_dump") child.stdout.emit("data", Buffer.from("schema-archive"));
    child.emit("close", state.failPostData && stage === "post-data" ? 1 : 0);
  }); };
  return child;
} }));
import { createAndVerifyTenantResetBackup, recoverTenantResetBackup, type TenantResetBackupConfig } from "./tenant-reset-backup.js";

const s3 = (host: string, bucket: string) => ({ endpoint: `https://${host}.test`, bucket, region: "us-east-1", accessKeyId: "fixture", secretAccessKey: "fixture" });
const config: TenantResetBackupConfig = { tenantId: "tenant-a", operationId: "a".repeat(32), approvalReference: "local-fixture-only", encryptionKey: Buffer.alloc(32, 2),
  sourceDatabaseUrl: "postgresql://read:fixture@source-db.test/source", restoreDatabaseUrl: `postgresql://restore:fixture@restore-db.test/o_okul_reset_drill_${"a".repeat(32)}?sslmode=require`,
  sourceObjects: s3("source-s3", "source"), backupObjects: s3("backup-s3", "backup"), restoreObjects: s3("restore-s3", `o-okul-reset-drill-${"a".repeat(32)}`) };
beforeEach(() => {
  Object.assign(state, { writes: [], tools: [], targetRows: {}, buckets: { source: new Map([["owned/source", Buffer.from("real object bytes")]]) }, failPostData: false, tamperRows: false, tamperObjects: false, sourceChanged: false, snapshotReads: 0, fileless: false });
  const tables = Object.fromEntries(tenantResetTableNames.map((table) => [table, table === "Tenant" ? [{ id: "tenant-a", status: "SUSPENDED", lifecycleVersion: 1 }] : []])) as unknown as TenantResetSnapshot["tables"];
  const rawTables = Object.fromEntries(tenantResetTableNames.map((table) => [table, tables[table].map((row) => JSON.stringify(row))])) as TenantResetSnapshot["rawTables"];
  const migrationRows = ['{"migration_name":"fixture","finished_at":"2026-01-01"}']; const schemaDigest = resetDigest(migrationRows);
  state.snapshot = { tenantId: "tenant-a", lifecycleVersion: 1, capturedAt: "2026-09-06", objectOwners: { tenantIds: ["tenant-a"], students: [] }, schemaDigest, tables, rawTables, migrationRows, dataDigest: resetDigest({ schemaDigest, rawTables }) };
});
describe("backup production adapter wiring (injected fixtures only)", () => {
  it("guard failure makes no DB/S3 target writes", async () => {
    await expect(createAndVerifyTenantResetBackup({ ...config, restoreObjects: config.sourceObjects })).rejects.toThrow("RESET_DISPOSABLE_TARGET_REQUIRED");
    expect(state.writes).toEqual([]); expect(state.tools).toEqual([]);
  });
  it("detects source drift before off-host or restore writes", async () => {
    state.sourceChanged = true;
    await expect(createAndVerifyTenantResetBackup(config)).rejects.toThrow("RESET_SOURCE_CHANGED");
    expect(state.writes).toEqual([]);
  });
  it("post-data constraint installation failure produces no verified receipt", async () => {
    state.failPostData = true;
    await expect(createAndVerifyTenantResetBackup(config)).rejects.toThrow("RESET_POSTGRES_TOOL_FAILED");
    expect(state.tools).toEqual(["dump", "pre-data", "post-data"]);
    expect(state.writes).not.toContain(`s3:${config.restoreObjects.bucket}`);
  });
  it.each(["tamperRows", "tamperObjects"] as const)("actual %s corruption prevents VERIFIED", async (field) => {
    state[field] = true;
    await expect(createAndVerifyTenantResetBackup(config)).rejects.toThrow(/RESET_RESTORE_/);
  });
  it("roundtrips package, migration ledger and actual target rows/object bytes", async () => {
    const result = await createAndVerifyTenantResetBackup(config);
    expect(result).toMatchObject({ result: "VERIFIED", tableCount: 73, rowCount: 1, objectCount: 1 });
    expect(state.tools).toEqual(["dump", "pre-data", "post-data"]);
    expect(state.targetRows._prisma_migrations).toEqual(state.snapshot!.migrationRows);
    expect(JSON.stringify(result)).not.toMatch(/owned\/source|postgresql|fixture|tenant-a/);
    expect(state.writes).not.toContain("s3:source");
  });
});

it("recovers the same immutable package after lost DB receipt by checking real restored bytes, with no rewrite", async () => {
  const ownConfig = { ...config, excludeCurrentOperation: true };
  const original = await createAndVerifyTenantResetBackup(ownConfig);
  state.writes = []; state.tools = [];
  const recovered = await recoverTenantResetBackup(ownConfig);
  expect(recovered).toMatchObject({ result: "VERIFIED", packageSha256: original.packageSha256 });
  expect(state.writes).toEqual([]); expect(state.tools).toEqual([]);
  state.tamperRows = true;
  await expect(recoverTenantResetBackup(ownConfig)).rejects.toThrow("RESET_RESTORE_ROW_MISMATCH");
});

it("fileless crash before post-data never recovers VERIFIED from matching data and absent constraints", async () => {
  state.fileless = true; state.buckets.source!.clear(); state.failPostData = true;
  const ownConfig = { ...config, excludeCurrentOperation: true };
  await expect(createAndVerifyTenantResetBackup(ownConfig)).rejects.toThrow("RESET_POSTGRES_TOOL_FAILED");
  expect(state.targetRows.Tenant).toHaveLength(1);
  await expect(recoverTenantResetBackup(ownConfig)).rejects.toThrow("RESET_RESTORE_ATTESTATION_UNVERIFIED");
});
it("missing or forged post-data attestation requires manual recovery even when rows match", async () => {
  const ownConfig = { ...config, excludeCurrentOperation: true };
  await createAndVerifyTenantResetBackup(ownConfig);
  state.buckets.backup!.set(`tenant-reset-backups/${config.operationId}.restore-verified.json`, Buffer.from('{"body":{},"signature":"forged"}'));
  await expect(recoverTenantResetBackup(ownConfig)).rejects.toThrow("RESET_RESTORE_ATTESTATION_UNVERIFIED");
  state.buckets.backup!.delete(`tenant-reset-backups/${config.operationId}.restore-verified.json`);
  await expect(recoverTenantResetBackup(ownConfig)).rejects.toThrow("RESET_RESTORE_ATTESTATION_UNVERIFIED");
});
