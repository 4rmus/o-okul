import type { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { resetBytesHash, resetDigest, type Queryable } from "@o-okul/db";
import type { DeviceBackupPayload } from "./device-backup.service.js";

type File = DeviceBackupPayload["files"][number];
type Intent = { key: string; sha256: string; size: number; owned: boolean };
type ObjectJob = { archive_digest: string; target: string; state: string; intent: Intent[] };
const fields = [["Student", "photoKey"], ["RawImport", "s3Key"], ["HomeworkMaterialFile", "storageKey"], ["SupportTicketAttachment", "storageKey"]] as const;

/** Photos may reuse a mutable filename. Restore them to an immutable, tenant-bound key. */
export async function mapExistingRestorePhotos(payload: DeviceBackupPayload, db: Queryable) {
  const result = structuredClone(payload);
  const files = new Map(result.files.map(f => [f.key, f]));
  for (const entry of result.tables.Student ?? []) {
    const row = JSON.parse(entry.row);
    if (row.photoKey == null) continue;
    const file = files.get(row.photoKey);
    if (!file) throw new Error("DEVICE_EXISTING_FILE_MISSING");
    const key = `students/${row.id}/restore-${resetDigest(payload.tenantId).slice(0, 16)}-${file.sha256}`;
    // PostgreSQL updates just the key; JSON.parse/stringify would round large JSON numbers.
    entry.row = (await db.query<{ row: string }>("SELECT jsonb_set($1::jsonb,'{photoKey}',to_jsonb($2::text))::text AS row", [entry.row, key])).rows[0]!.row;
    file.key = key;
  }
  return result;
}

export async function readExistingRestoreFile(client: S3Client, bucket: string, key: string, limit: number) {
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = object.Body as Readable | undefined;
    if (!body || !Number.isSafeInteger(object.ContentLength) || object.ContentLength! > limit) {
      body?.destroy(); throw new Error("DEVICE_EXISTING_FILE_SIZE");
    }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > limit) { body.destroy(); throw new Error("DEVICE_EXISTING_FILE_SIZE"); }
      chunks.push(Buffer.from(chunk));
    }
    if (size !== object.ContentLength || !object.ETag) throw new Error("DEVICE_EXISTING_FILE_SIZE");
    return { bytes: Buffer.concat(chunks), etag: object.ETag, owner: object.Metadata?.["restore-operation"] };
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") return undefined;
    throw error;
  }
}

export async function collectExistingRestoreFiles(payload: DeviceBackupPayload, client: S3Client, bucket: string) {
  const keys = new Set<string>();
  for (const [table, field] of fields) for (const entry of payload.tables[table] ?? []) {
    const key = JSON.parse(entry.row)[field]; if (key != null) keys.add(key);
  }
  if (keys.size > 2000) throw new Error("DEVICE_EXISTING_FILE_SIZE");
  let remaining = 16 * 1024 * 1024;
  for (const key of [...keys].sort()) {
    const file = await readExistingRestoreFile(client, bucket, key, remaining);
    if (!file) throw new Error("DEVICE_EXISTING_FILE_MISSING");
    remaining -= file.bytes.length;
    payload.files.push({ key, sha256: resetBytesHash(file.bytes), contentBase64: file.bytes.toString("base64") });
  }
  return payload;
}

/** Caller holds the exclusive tenant session lock across intent commit, PUTs and DB commit. */
export async function prepareExistingRestoreObjects(db: Queryable, client: S3Client, bucket: string, endpoint: string, tenantId: string, operationId: string, archiveDigest: string, files: File[], recover = false) {
  const target = resetDigest({ endpoint, bucket });
  const existing = (await db.query<ObjectJob>("SELECT archive_digest,target,state,intent FROM device_existing_restore.object_jobs WHERE operation_id=$1 AND tenant_id=$2", [operationId, tenantId])).rows[0];
  if (existing) {
    if (existing.archive_digest !== archiveDigest || existing.target !== target || resetDigest(existing.intent.map(({key,sha256,size}) => ({key,sha256,size}))) !== resetDigest(files.map(f => ({key:f.key,sha256:f.sha256,size:Buffer.byteLength(f.contentBase64,"base64")})))) throw new Error("DEVICE_EXISTING_OBJECT_BINDING_MISMATCH");
    if (!(recover ? ["PREPARED", "COMPLETE", "CLEANING", "ABORTED"] : ["PREPARED", "COMPLETE"]).includes(existing.state)) throw new Error("DEVICE_EXISTING_OBJECT_JOB_ABORTED");
    return existing.intent;
  }
  if ((await db.query("SELECT operation_id FROM device_existing_restore.object_jobs WHERE tenant_id=$1 AND state IN ('PREPARED','CLEANING') LIMIT 1", [tenantId])).rows.length) throw new Error("DEVICE_EXISTING_OTHER_OPERATION_UNRESOLVED");
  const intent: Intent[] = [];
  for (const file of files) {
    const size = Buffer.byteLength(file.contentBase64, "base64");
    const old = await readExistingRestoreFile(client, bucket, file.key, size);
    if (old && resetBytesHash(old.bytes) !== file.sha256) throw new Error("DEVICE_EXISTING_FILE_CONFLICT");
    intent.push({ key: file.key, sha256: file.sha256, size, owned: !old });
  }
  await db.query("INSERT INTO device_existing_restore.object_jobs (operation_id,tenant_id,archive_digest,target,state,intent) VALUES ($1,$2,$3,$4,'PREPARED',$5::jsonb)", [operationId, tenantId, archiveDigest, target, JSON.stringify(intent)]);
  return intent;
}

export async function stageExistingRestoreObjects(client: S3Client, bucket: string, operationId: string, files: File[], intent: Intent[], verifyOnly = false, crash?: string) {
  for (const [index, file] of files.entries()) {
    const expected = intent[index]!;
    let actual = await readExistingRestoreFile(client, bucket, file.key, expected.size);
    if (!actual) {
      if (verifyOnly || !expected.owned) throw new Error("DEVICE_EXISTING_FILE_MISSING");
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: file.key, Body: Buffer.from(file.contentBase64, "base64"), IfNoneMatch: "*", Metadata: { "restore-operation": operationId } }));
      if (crash === "after-first-put" && index === 0) process.kill(process.pid, "SIGKILL");
      actual = await readExistingRestoreFile(client, bucket, file.key, expected.size);
    }
    if (!actual || resetBytesHash(actual.bytes) !== file.sha256 || (expected.owned && actual.owner !== operationId)) throw new Error("DEVICE_EXISTING_FILE_CONFLICT");
  }
}

export async function cleanExistingRestoreObjects(client: S3Client, bucket: string, operationId: string, intent: Intent[], crash?: string) {
  for (const [index, file] of intent.entries()) {
    if (!file.owned) continue;
    const actual = await readExistingRestoreFile(client, bucket, file.key, file.size);
    if (!actual) continue;
    if (actual.owner !== operationId || resetBytesHash(actual.bytes) !== file.sha256) throw new Error("DEVICE_EXISTING_CLEANUP_CONFLICT");
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.key, IfMatch: actual.etag }));
    if (crash === "after-first-delete" && index === 0) process.kill(process.pid, "SIGKILL");
    if (await readExistingRestoreFile(client, bucket, file.key, file.size)) throw new Error("DEVICE_EXISTING_CLEANUP_UNVERIFIED");
  }
}
