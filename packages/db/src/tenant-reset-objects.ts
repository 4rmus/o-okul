import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { resetDigest, tenantResetObjectFields, type TenantResetSnapshot } from "./index.js";

export interface ResetS3Config { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; }
export interface ResetObject { key: string; size: number; etag: string; versionId?: string; sha256?: string; }
export function resetS3Config(prefix = "S3", env = process.env): ResetS3Config {
  const read = (key: string) => { const value = env[`${prefix}_${key}`]; if (!value) throw new Error("RESET_OBJECT_CONFIG_UNVERIFIED"); return value; };
  return { endpoint: read("ENDPOINT"), bucket: read("BUCKET"), region: env[`${prefix}_REGION`] ?? "us-east-1", accessKeyId: read("ACCESS_KEY_ID"), secretAccessKey: read("SECRET_ACCESS_KEY") };
}
export function resetS3Client(config: ResetS3Config, options?: Pick<S3ClientConfig, "requestHandler" | "maxAttempts">): S3Client {
  return new S3Client({ ...options, endpoint: config.endpoint, region: config.region, forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
}
export async function listResetBucket(client: S3Client, bucket: string): Promise<Array<{ key: string; size: number; etag: string }>> {
  const objects: Array<{ key: string; size: number; etag: string }> = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      if (!object.Key || object.Size === undefined || !object.ETag) throw new Error("RESET_OBJECT_INVENTORY_UNVERIFIED");
      objects.push({ key: object.Key, size: object.Size, etag: object.ETag });
    }
    if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === token)) throw new Error("RESET_OBJECT_INVENTORY_UNVERIFIED");
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}

function expectedObjects(snapshot: Pick<TenantResetSnapshot, "tenantId" | "tables">) {
  const expected = new Map<string, { sha256?: string; studentId?: string }>();
  for (const [table, field] of Object.entries(tenantResetObjectFields)) {
    for (const row of snapshot.tables[table as keyof typeof tenantResetObjectFields]) {
      if (row[field] == null) continue;
      const key = row[field];
      if (typeof key !== "string" || !key || /[\x00-\x1f]|(?:^|\/)\.\.(?:\/|$)/.test(key)) throw new Error("RESET_OBJECT_KEY_UNKNOWN");
      const tenantSegment = encodeURIComponent(snapshot.tenantId);
      const valid = table === "Student" ? key.startsWith(`students/${row.id}/`) :
        table === "RawImport" ? key === `raw-imports/${tenantSegment}/${encodeURIComponent(String(row.examId))}/${encodeURIComponent(String(row.parserConfigVersion))}/${row.sha256}/source` :
          key === `${table === "HomeworkMaterialFile" ? "homework-material-files" : "support-ticket-attachments"}/${tenantSegment}/${encodeURIComponent(String(row.materialId ?? row.ticketId))}/${row.sha256}/source`;
      if (!valid || (expected.has(key) && expected.get(key)?.sha256 !== row.sha256)) throw new Error("RESET_OBJECT_KEY_UNKNOWN");
      expected.set(key, { sha256: typeof row.sha256 === "string" ? row.sha256 : undefined, studentId: table === "Student" ? String(row.id) : undefined });
    }
  }
  return expected;
}

export async function resetObjectInventory(snapshot: TenantResetSnapshot, client: S3Client, bucket: string): Promise<ResetObject[]> {
  const expected = expectedObjects(snapshot);
  const tenantIds = new Set(snapshot.objectOwners.tenantIds.map((id) => encodeURIComponent(id)));
  const studentTenants = new Map(snapshot.objectOwners.students.map((row) => [row.id, row.tenantId]));
  const result: ResetObject[] = [];
  for (const object of await listResetBucket(client, bucket)) {
    const parts = object.key.split("/");
    const tenantPrefix = ["raw-imports", "homework-material-files", "support-ticket-attachments"].includes(parts[0] ?? "");
    const owner = tenantPrefix && tenantIds.has(parts[1] ?? "") ? decodeURIComponent(parts[1]!) :
      parts[0] === "students" ? studentTenants.get(parts[1] ?? "") : undefined;
    if (!owner || (owner === snapshot.tenantId && !expected.has(object.key))) throw new Error("RESET_OBJECT_KEY_UNKNOWN");
    if (owner !== snapshot.tenantId) continue;
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key, IfMatch: object.etag }));
    if (head.ContentLength !== object.size || head.ETag !== object.etag) throw new Error("RESET_SOURCE_CHANGED");
    const versioned = { ...object, versionId: head.VersionId };
    const sha256 = createHash("sha256").update(await readResetObject(client, bucket, versioned)).digest("hex");
    const recordedHash = expected.get(object.key)?.sha256;
    if (recordedHash && recordedHash !== sha256) throw new Error("RESET_OBJECT_HASH_MISMATCH");
    result.push({ ...versioned, sha256 });
  }
  if (result.length !== expected.size) throw new Error("RESET_OBJECT_MISSING");
  return result;
}
/** Device exports read only objects referenced by this tenant's snapshot; no global bucket scan. */
export async function referencedResetObjectInventory(snapshot: Pick<TenantResetSnapshot, "tenantId" | "tables">, client: S3Client, bucket: string, limits: { maxBytes: number; maxObjects: number }): Promise<ResetObject[]> {
  const expected = expectedObjects(snapshot), objects: ResetObject[] = [];
  if (expected.size > limits.maxObjects) throw new Error("RESET_OBJECT_SIZE_LIMIT");
  let bytes = 0;
  for (const [key, metadata] of [...expected].sort(([a],[b]) => a.localeCompare(b))) {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (!Number.isSafeInteger(head.ContentLength) || head.ContentLength! < 0 || !head.ETag) throw new Error("RESET_OBJECT_INVENTORY_UNVERIFIED");
    bytes += head.ContentLength!;
    if (bytes > limits.maxBytes) throw new Error("RESET_OBJECT_SIZE_LIMIT");
    const object = { key, size: head.ContentLength!, etag: head.ETag, versionId: head.VersionId };
    const sha256 = createHash("sha256").update(await readResetObject(client, bucket, object)).digest("hex");
    if (metadata.sha256 && metadata.sha256 !== sha256) throw new Error("RESET_OBJECT_HASH_MISMATCH");
    objects.push({ ...object, sha256 });
  }
  return objects;
}

export async function readResetObject(client: S3Client, bucket: string, object: ResetObject): Promise<Buffer> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key, VersionId: object.versionId, IfMatch: object.etag }));
  if (!result.Body) throw new Error("RESET_OBJECT_MISSING");
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  if (bytes.length !== object.size) throw new Error("RESET_OBJECT_HASH_MISMATCH");
  return bytes;
}
export function resetPreflightDigest(snapshot: TenantResetSnapshot, objects: ResetObject[], blockers: string[], source?: Pick<ResetS3Config, "endpoint" | "bucket">): string {
  return resetDigest({ preset: "CLEAN_SETUP_V1", tenantId: snapshot.tenantId, lifecycleVersion: snapshot.lifecycleVersion, dataDigest: snapshot.dataDigest, objects, blockers, ...(source ? { source: { endpoint: new URL(source.endpoint).origin + new URL(source.endpoint).pathname, bucket: source.bucket } } : {}) });
}
