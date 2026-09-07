import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { GetBucketAclCommand, GetBucketPolicyStatusCommand, GetPublicAccessBlockCommand, GetObjectCommand, PutObjectCommand, ListObjectVersionsCommand, ListMultipartUploadsCommand, type S3Client } from "@aws-sdk/client-s3";
import { resetDigest, tenantResetTableNames, type TenantResetTable } from "./tenant-reset-catalog.js";
import { resetDataDigest, withResetSnapshot, type TenantResetSnapshot } from "./tenant-reset-snapshot.js";
import { listResetBucket, readResetObject, resetObjectInventory, resetS3Client, type ResetObject, type ResetS3Config } from "./tenant-reset-objects.js";

export interface TenantResetBackupConfig {
  tenantId: string; operationId: string; approvalReference: string; encryptionKey: Buffer;
  sourceDatabaseUrl: string; restoreDatabaseUrl: string;
  excludeCurrentOperation?: boolean;
  sourceObjects: ResetS3Config; backupObjects: ResetS3Config; restoreObjects: ResetS3Config;
}
export interface ResetBackupManifest {
  format: "TENANT_RESET_BACKUP_V1"; digestOperationId?: string; tenantId: string; lifecycleVersion: number; schemaDigest: string;
  dataDigest: string; sourceIdentity: string; dependencyProjection: "DISABLED_PLATFORM_ACCOUNT_V1"; schemaArchiveSha256: string;
  tables: Array<{ table: TenantResetTable; count: number; sha256: string }>;
  objects: Array<{ key: string; size: number; sha256: string }>;
}
export interface TenantResetPackage { manifest: ResetBackupManifest; schemaArchive: string; migrationRows: string[]; rawTables: Record<TenantResetTable, string[]>; objects: Array<{ key: string; base64: string }>; }
export const resetBytesHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
// ponytail: packages are buffered and fail closed above 512 MiB; use streaming archives for larger tenants.
const maxPackageBytes = 512 * 1024 * 1024;

export function encryptResetPackage(bytes: Buffer, key: Buffer): Buffer {
  if (key.length !== 32 || bytes.length > maxPackageBytes) throw new Error("RESET_PACKAGE_SIZE_OR_KEY_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("TENANT_RESET_BACKUP_V1"));
  const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
export function decryptResetPackage(envelope: Buffer, key: Buffer): Buffer {
  if (key.length !== 32 || envelope.length < 28 || envelope.length > maxPackageBytes + 28) throw new Error("RESET_PACKAGE_INTEGRITY_FAILED");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.subarray(0, 12));
    decipher.setAAD(Buffer.from("TENANT_RESET_BACKUP_V1"));
    decipher.setAuthTag(envelope.subarray(12, 28));
    return Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]);
  } catch { throw new Error("RESET_PACKAGE_INTEGRITY_FAILED"); }
}

export function verifyResetPackage(pkg: TenantResetPackage, expected: Pick<ResetBackupManifest, "tenantId" | "lifecycleVersion" | "schemaDigest" | "dataDigest" | "sourceIdentity">): void {
  try {
    for (const field of ["tenantId", "lifecycleVersion", "schemaDigest", "dataDigest", "sourceIdentity"] as const) if (pkg.manifest[field] !== expected[field]) throw new Error();
    if (pkg.manifest.dependencyProjection !== "DISABLED_PLATFORM_ACCOUNT_V1" || resetDigest(pkg.migrationRows) !== pkg.manifest.schemaDigest) throw new Error();
    for (const raw of pkg.rawTables.PlatformAccount) {
      const account = JSON.parse(raw);
      if (account.name !== "Restore dependency" || !/^restore-dependency-[a-f0-9]{32}$/.test(account.loginName) || account.loginNameNormalized !== account.loginName || account.email !== null || account.emailNormalized !== null || account.passwordHash !== "!NON_AUTHENTICATING_RESTORE_DEPENDENCY!" || account.status !== "SUSPENDED" || account.totpSecretEncrypted !== null || account.totpEnabledAt !== null) throw new Error();
    }
    if (pkg.manifest.format !== "TENANT_RESET_BACKUP_V1" || pkg.manifest.tenantId === "system") throw new Error();
    if (resetBytesHash(Buffer.from(pkg.schemaArchive, "base64")) !== pkg.manifest.schemaArchiveSha256) throw new Error();
    if (resetDigest(Object.keys(pkg.rawTables).sort()) !== resetDigest(tenantResetTableNames)) throw new Error();
    const tables = tenantResetTableNames.map((table) => ({ table, count: pkg.rawTables[table].length, sha256: resetDigest(pkg.rawTables[table]) }));
    if (resetDigest(tables) !== resetDigest(pkg.manifest.tables) || resetDataDigest(pkg.manifest.schemaDigest, pkg.rawTables, pkg.manifest.digestOperationId) !== pkg.manifest.dataDigest) throw new Error();
    const objects = pkg.objects.map((object) => { const bytes = Buffer.from(object.base64, "base64"); return { key: object.key, size: bytes.length, sha256: resetBytesHash(bytes) }; });
    if (new Set(objects.map((object) => object.key)).size !== objects.length || resetDigest(objects) !== resetDigest(pkg.manifest.objects)) throw new Error();
  } catch { throw new Error("RESET_PACKAGE_INTEGRITY_FAILED"); }
}

export async function createAndVerifyTenantResetBackup(config: TenantResetBackupConfig) {
  const clients = [resetS3Client(config.sourceObjects), resetS3Client(config.backupObjects), resetS3Client(config.restoreObjects)];
  const [sourceS3, backupS3, restoreS3] = clients as [S3Client, S3Client, S3Client];
  const source = new pg.Pool({ connectionString: config.sourceDatabaseUrl });
  const target = new pg.Pool({ connectionString: config.restoreDatabaseUrl });
  try {
    await assertResetDestinations(config);
    await assertPrivateBucket(backupS3, config.backupObjects.bucket);
    await assertPrivateBucket(restoreS3, config.restoreObjects.bucket);
    await assertEmptyRestoreTarget(target, restoreS3, config);
    const sourceIdentity = resetDigest({ database: databaseIdentity(config.sourceDatabaseUrl), objects: { endpoint: config.sourceObjects.endpoint, bucket: config.sourceObjects.bucket } });
    const pkg = await withResetSnapshot(source, config.tenantId, async (snapshot, db) => {
      if (snapshot.tables.Tenant[0]?.status !== "SUSPENDED") throw new Error("RESET_BACKUP_REQUIRES_SUSPENDED_TENANT");
      const exported = await db.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot");
      const snapshotId = exported.rows[0]?.snapshot;
      if (!snapshotId) throw new Error("RESET_SNAPSHOT_UNVERIFIED");
      const schema = await runPostgresTool("pg_dump", config.sourceDatabaseUrl, ["--schema-only", "--format=custom", `--snapshot=${snapshotId}`, "--no-owner", "--no-privileges"]);
      const inventory = await resetObjectInventory(snapshot, sourceS3, config.sourceObjects.bucket);
      const objects: TenantResetPackage["objects"] = [];
      const manifestObjects: ResetBackupManifest["objects"] = [];
      let totalBytes = schema.length;
      for (const object of inventory) {
        const bytes = await readResetObject(sourceS3, config.sourceObjects.bucket, object);
        const sha256 = resetBytesHash(bytes);
        if (object.sha256 && sha256 !== object.sha256) throw new Error("RESET_OBJECT_HASH_MISMATCH");
        totalBytes += bytes.length;
        if (totalBytes > maxPackageBytes) throw new Error("RESET_PACKAGE_SIZE_OR_KEY_INVALID");
        objects.push({ key: object.key, base64: bytes.toString("base64") });
        manifestObjects.push({ key: object.key, size: bytes.length, sha256 });
      }
      return { manifest: { format: "TENANT_RESET_BACKUP_V1" as const, ...(config.excludeCurrentOperation ? { digestOperationId: config.operationId } : {}), tenantId: snapshot.tenantId, lifecycleVersion: snapshot.lifecycleVersion, schemaDigest: snapshot.schemaDigest,
        dataDigest: snapshot.dataDigest, sourceIdentity, dependencyProjection: "DISABLED_PLATFORM_ACCOUNT_V1" as const, schemaArchiveSha256: resetBytesHash(schema),
        tables: tenantResetTableNames.map((table) => ({ table, count: snapshot.rawTables[table].length, sha256: resetDigest(snapshot.rawTables[table]) })), objects: manifestObjects },
        schemaArchive: schema.toString("base64"), rawTables: snapshot.rawTables, migrationRows: snapshot.migrationRows, objects };
    }, config.excludeCurrentOperation ? config.operationId : undefined);
    verifyResetPackage(pkg, pkg.manifest);
    // A fresh snapshot and fresh object GETs detect committed source changes during collection.
    await assertSourceUnchanged(source, sourceS3, config, pkg);
    const envelope = encryptResetPackage(Buffer.from(JSON.stringify(pkg)), config.encryptionKey);
    const packageSha256 = resetBytesHash(envelope);
    const key = `tenant-reset-backups/${config.operationId}.bin`;
    await backupS3.send(new PutObjectCommand({ Bucket: config.backupObjects.bucket, Key: key, Body: envelope, ContentType: "application/octet-stream", ServerSideEncryption: "AES256", IfNoneMatch: "*" }));
    const uploaded = await backupS3.send(new GetObjectCommand({ Bucket: config.backupObjects.bucket, Key: key }));
    if (!uploaded.Body) throw new Error("RESET_PACKAGE_READBACK_FAILED");
    const savedBytes = Buffer.from(await uploaded.Body.transformToByteArray());
    if (resetBytesHash(savedBytes) !== packageSha256) throw new Error("RESET_PACKAGE_READBACK_FAILED");
    const saved: TenantResetPackage = JSON.parse(decryptResetPackage(savedBytes, config.encryptionKey).toString("utf8"));
    verifyResetPackage(saved, pkg.manifest);
    // No writes until every target/private/empty guard and package integrity check has passed.
    await assertEmptyRestoreTarget(target, restoreS3, config);
    await runPostgresTool("pg_restore", config.restoreDatabaseUrl, ["--exit-on-error", "--no-owner", "--no-privileges", "--section=pre-data"], Buffer.from(saved.schemaArchive, "base64"));
    const connection = await target.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SET LOCAL TIME ZONE 'UTC'");
      for (const table of tenantResetTableNames) for (const raw of saved.rawTables[table]) {
        await connection.query(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_record(NULL::"${table}", $1::jsonb)`, [raw]);
      }
      for (const raw of saved.migrationRows) await connection.query('INSERT INTO "_prisma_migrations" SELECT * FROM jsonb_populate_record(NULL::"_prisma_migrations", $1::jsonb)', [raw]);
      await connection.query("COMMIT");
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { connection.release(); }
    // Standard pg_restore order: data first, then actual constraints/indexes/triggers. No trigger disabling.
    await runPostgresTool("pg_restore", config.restoreDatabaseUrl, ["--exit-on-error", "--no-owner", "--no-privileges", "--section=post-data"], Buffer.from(saved.schemaArchive, "base64"));
    for (const object of saved.objects) {
      await restoreS3.send(new PutObjectCommand({ Bucket: config.restoreObjects.bucket, Key: object.key, Body: Buffer.from(object.base64, "base64"), IfNoneMatch: "*", ServerSideEncryption: "AES256" }));
    }
    await verifyRestoredRowsAndObjects(target, restoreS3, config.restoreObjects.bucket, saved);
    await assertSourceUnchanged(source, sourceS3, config, saved);
    // Durable evidence that post-data actually ran; counts alone cannot prove missing constraints.
    const attestation = resetRestoreAttestation(config, saved, packageSha256);
    const attestationBytes = Buffer.from(JSON.stringify(attestation));
    const attestationKey = `tenant-reset-backups/${config.operationId}.restore-verified.json`;
    await backupS3.send(new PutObjectCommand({ Bucket: config.backupObjects.bucket, Key: attestationKey, Body: attestationBytes, ContentType: "application/json", ServerSideEncryption: "AES256", IfNoneMatch: "*" }));
    const attested = await backupS3.send(new GetObjectCommand({ Bucket: config.backupObjects.bucket, Key: attestationKey }));
    if (!attested.Body || resetBytesHash(await attested.Body.transformToByteArray()) !== resetBytesHash(attestationBytes)) throw new Error("RESET_RESTORE_ATTESTATION_UNVERIFIED");
    return { format: "TENANT_RESET_BACKUP_RECEIPT_V1", result: "VERIFIED", operationId: config.operationId, lifecycleVersion: saved.manifest.lifecycleVersion,
      packageSha256, manifestSha256: resetDigest(saved.manifest), schemaDigest: saved.manifest.schemaDigest, dataDigest: saved.manifest.dataDigest,
      tableCount: saved.manifest.tables.length, rowCount: saved.manifest.tables.reduce((sum, table) => sum + table.count, 0), objectCount: saved.objects.length,
      objectBytes: saved.manifest.objects.reduce((sum, object) => sum + object.size, 0), verifiedAt: new Date().toISOString() };
  } catch (error) {
    // Never surface driver stderr, DSNs, raw rows, object keys or provider messages.
    const code = error instanceof Error && /^RESET_[A-Z_]+$/.test(error.message) ? error.message : "RESET_BACKUP_VERIFICATION_FAILED";
    throw new Error(code);
  } finally { await Promise.all([source.end(), target.end()]); clients.forEach((client) => client.destroy()); }
}

async function assertSourceUnchanged(source: pg.Pool, s3: S3Client, config: TenantResetBackupConfig, pkg: TenantResetPackage) {
  await withResetSnapshot(source, config.tenantId, async (snapshot, db) => {
    if (snapshot.dataDigest !== pkg.manifest.dataDigest) throw new Error("RESET_SOURCE_CHANGED");
    const inventory = await resetObjectInventory(snapshot, s3, config.sourceObjects.bucket);
    if (inventory.length !== pkg.manifest.objects.length) throw new Error("RESET_SOURCE_CHANGED");
    for (let index = 0; index < inventory.length; index++) {
      const object = inventory[index]!;
      const expected = pkg.manifest.objects[index]!;
      if (object.key !== expected.key || resetBytesHash(await readResetObject(s3, config.sourceObjects.bucket, object)) !== expected.sha256) throw new Error("RESET_SOURCE_CHANGED");
    }
  }, config.excludeCurrentOperation ? config.operationId : undefined);
}

export async function verifyRestoredRowsAndObjects(db: pg.Pool, s3: S3Client, bucket: string, pkg: TenantResetPackage): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const invalid = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_constraint WHERE NOT convalidated");
    if (invalid.rows[0]?.count !== "0") throw new Error("RESET_RESTORE_CONSTRAINT_UNVERIFIED");
    for (const entry of pkg.manifest.tables) {
      const rows = await client.query<{ row: string }>(`SELECT to_jsonb(t)::text AS row FROM "${entry.table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`);
      if (rows.rows.length !== entry.count || resetDigest(rows.rows.map((row) => row.row).sort()) !== entry.sha256) throw new Error("RESET_RESTORE_ROW_MISMATCH");
    }
    const ledger = await client.query<{ row: string }>('SELECT to_jsonb(t)::text AS row FROM "_prisma_migrations" t ORDER BY migration_name COLLATE "C", id COLLATE "C"');
    if (resetDigest(ledger.rows.map((row) => row.row).sort()) !== pkg.manifest.schemaDigest) throw new Error("RESET_RESTORE_SCHEMA_MISMATCH");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const actual = await listResetBucket(s3, bucket);
  if (actual.length !== pkg.manifest.objects.length) throw new Error("RESET_RESTORE_OBJECT_MISMATCH");
  for (let index = 0; index < actual.length; index++) {
    const object = actual[index]!;
    const expected = pkg.manifest.objects[index]!;
    if (object.key !== expected.key || resetBytesHash(await readResetObject(s3, bucket, object)) !== expected.sha256) throw new Error("RESET_RESTORE_OBJECT_MISMATCH");
  }
}

export async function assertPrivateBucket(s3: S3Client, bucket: string) {
  const acl = await s3.send(new GetBucketAclCommand({ Bucket: bucket }));
  if (!acl.Owner?.ID || !acl.Grants?.length || acl.Grants.some((grant) => grant.Grantee?.Type !== "CanonicalUser" || grant.Grantee.ID !== acl.Owner?.ID)) throw new Error("RESET_DESTINATION_NOT_PRIVATE");
  const policy = await s3.send(new GetBucketPolicyStatusCommand({ Bucket: bucket }));
  const block = await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
  const config = block.PublicAccessBlockConfiguration;
  if (policy.PolicyStatus?.IsPublic !== false || !config?.BlockPublicAcls || !config.IgnorePublicAcls || !config.BlockPublicPolicy || !config.RestrictPublicBuckets) throw new Error("RESET_DESTINATION_NOT_PRIVATE");
}

export async function assertResetDestinations(config: TenantResetBackupConfig): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(config.operationId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/.test(config.approvalReference) || config.encryptionKey.length !== 32 || config.tenantId === "system") throw new Error("RESET_APPROVAL_CONTEXT_INVALID");
  const sourceDb = new URL(config.sourceDatabaseUrl);
  const restoreDb = new URL(config.restoreDatabaseUrl);
  if (restoreDb.pathname !== `/o_okul_reset_drill_${config.operationId}` || config.restoreObjects.bucket !== `o-okul-reset-drill-${config.operationId}`) throw new Error("RESET_DISPOSABLE_TARGET_REQUIRED");
  if (!["require", "verify-full"].includes(restoreDb.searchParams.get("sslmode") ?? "")) throw new Error("RESET_RESTORE_TLS_REQUIRED");
  const backupUrl = new URL(config.backupObjects.endpoint);
  const sourceUrl = new URL(config.sourceObjects.endpoint);
  const restoreUrl = new URL(config.restoreObjects.endpoint);
  if ([sourceUrl, backupUrl, restoreUrl].some((url) => url.protocol !== "https:" || url.username || url.password || url.search || url.hash)) throw new Error("RESET_OFFHOST_DESTINATION_REQUIRED");
  const hosts = await Promise.all([sourceDb.hostname, restoreDb.hostname, sourceUrl.hostname, backupUrl.hostname, restoreUrl.hostname].map(async (host) => (await lookup(host, { all: true })).map((entry) => entry.address)));
  const overlap = (a: string[], b: string[]) => a.some((ip) => b.includes(ip));
  if (sourceDb.hostname === restoreDb.hostname || overlap(hosts[0]!, hosts[1]!) || sourceUrl.hostname === backupUrl.hostname || overlap(hosts[2]!, hosts[3]!) || overlap(hosts[0]!, hosts[3]!) ||
      config.sourceObjects.bucket === config.backupObjects.bucket || config.sourceObjects.bucket === config.restoreObjects.bucket || config.backupObjects.bucket === config.restoreObjects.bucket) throw new Error("RESET_SOURCE_DESTINATION_ALIAS");
  if (hosts[3]!.some((ip) => /^(::ffff:|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|f[cd]|fe80)/i.test(ip))) throw new Error("RESET_OFFHOST_DESTINATION_REQUIRED");
}
async function assertEmptyRestoreTarget(db: pg.Pool, s3: S3Client, config: TenantResetBackupConfig) {
  const identity = await db.query<{ name: string }>("SELECT current_database() AS name");
  const tables = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f','S')");
  if (identity.rows[0]?.name !== `o_okul_reset_drill_${config.operationId}` || tables.rows[0]?.count !== "0") throw new Error("RESET_RESTORE_TARGET_NOT_EMPTY");
  const bucket = config.restoreObjects.bucket;
  if ((await listResetBucket(s3, bucket)).length) throw new Error("RESET_RESTORE_TARGET_NOT_EMPTY");
  const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, MaxKeys: 1 }));
  const uploads = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 1 }));
  if (versions.Versions?.length || versions.DeleteMarkers?.length || uploads.Uploads?.length) throw new Error("RESET_RESTORE_TARGET_NOT_EMPTY");
}
function databaseIdentity(value: string) { const url = new URL(value); return { host: url.hostname, port: url.port || "5432", database: url.pathname }; }
export async function runPostgresTool(command: "pg_dump" | "pg_restore", databaseUrl: string, args: string[], input?: Buffer): Promise<Buffer> {
  const url = new URL(databaseUrl);
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args, ...(command === "pg_restore" ? ["--dbname", decodeURIComponent(url.pathname.slice(1))] : [])], {
      env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer" }, stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = []; let size = 0;
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxPackageBytes) { child.kill(); reject(new Error("RESET_PACKAGE_SIZE_OR_KEY_INVALID")); } else chunks.push(chunk); });
    child.stderr.resume();
    child.on("error", () => reject(new Error("RESET_POSTGRES_TOOL_FAILED")));
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("RESET_POSTGRES_TOOL_FAILED")));
    child.stdin.on("error", () => reject(new Error("RESET_POSTGRES_TOOL_FAILED")));
    child.stdin.end(input);
  });
}

// Retry recovery reads the immutable package AND re-verifies actual restored rows
// and objects. Package presence alone can never manufacture a VERIFIED receipt.
export async function recoverTenantResetBackup(config: TenantResetBackupConfig) {
  const source = new pg.Pool({ connectionString: config.sourceDatabaseUrl });
  const target = new pg.Pool({ connectionString: config.restoreDatabaseUrl });
  const sourceS3 = resetS3Client(config.sourceObjects), backupS3 = resetS3Client(config.backupObjects), restoreS3 = resetS3Client(config.restoreObjects);
  try {
    await assertResetDestinations(config);
    await assertPrivateBucket(backupS3, config.backupObjects.bucket);
    await assertPrivateBucket(restoreS3, config.restoreObjects.bucket);
    let saved;
    try { saved = await backupS3.send(new GetObjectCommand({ Bucket: config.backupObjects.bucket, Key: `tenant-reset-backups/${config.operationId}.bin` })); }
    catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined; throw new Error("RESET_BACKUP_RECOVERY_UNVERIFIED"); }
    if (!saved.Body) throw new Error("RESET_BACKUP_RECOVERY_UNVERIFIED");
    const bytes = Buffer.from(await saved.Body.transformToByteArray());
    const pkg: TenantResetPackage = JSON.parse(decryptResetPackage(bytes, config.encryptionKey).toString("utf8"));
    const sourceIdentity = resetDigest({ database: databaseIdentity(config.sourceDatabaseUrl), objects: { endpoint: config.sourceObjects.endpoint, bucket: config.sourceObjects.bucket } });
    verifyResetPackage(pkg, { ...pkg.manifest, tenantId: config.tenantId, sourceIdentity });
    if (pkg.manifest.digestOperationId !== config.operationId) throw new Error("RESET_PACKAGE_INTEGRITY_FAILED");
    try {
      const attested = await backupS3.send(new GetObjectCommand({ Bucket: config.backupObjects.bucket, Key: `tenant-reset-backups/${config.operationId}.restore-verified.json` }));
      if (!attested.Body) throw new Error();
      const attestation = JSON.parse(Buffer.from(await attested.Body.transformToByteArray()).toString("utf8"));
      if (resetDigest(attestation) !== resetDigest(resetRestoreAttestation(config, pkg, resetBytesHash(bytes)))) throw new Error();
    } catch { throw new Error("RESET_RESTORE_ATTESTATION_UNVERIFIED"); }
    await verifyRestoredRowsAndObjects(target, restoreS3, config.restoreObjects.bucket, pkg);
    await assertSourceUnchanged(source, sourceS3, config, pkg);
    return { format: "TENANT_RESET_BACKUP_RECEIPT_V1", result: "VERIFIED", operationId: config.operationId, lifecycleVersion: pkg.manifest.lifecycleVersion,
      packageSha256: resetBytesHash(bytes), manifestSha256: resetDigest(pkg.manifest), schemaDigest: pkg.manifest.schemaDigest, dataDigest: pkg.manifest.dataDigest,
      tableCount: pkg.manifest.tables.length, rowCount: pkg.manifest.tables.reduce((sum, table) => sum + table.count, 0), objectCount: pkg.objects.length,
      objectBytes: pkg.manifest.objects.reduce((sum, object) => sum + object.size, 0), verifiedAt: new Date().toISOString() };
  } catch (error) { throw new Error(error instanceof Error && /^RESET_[A-Z_]+$/.test(error.message) ? error.message : "RESET_BACKUP_RECOVERY_UNVERIFIED"); }
  finally { await Promise.all([source.end(), target.end()]); sourceS3.destroy(); backupS3.destroy(); restoreS3.destroy(); }
}

function resetRestoreAttestation(config: TenantResetBackupConfig, pkg: TenantResetPackage, packageSha256: string) {
  const body = { format: "PG_RESTORE_POST_DATA_VERIFIED_V1", operationId: config.operationId, tenantId: config.tenantId,
    packageSha256, manifestSha256: resetDigest(pkg.manifest),
    restoreIdentity: resetDigest({ database: databaseIdentity(config.restoreDatabaseUrl), objects: { endpoint: config.restoreObjects.endpoint, bucket: config.restoreObjects.bucket } }) };
  return { body, signature: createHmac("sha256", config.encryptionKey).update(`RESET_RESTORE_ATTESTATION:${resetDigest(body)}`).digest("hex") };
}
