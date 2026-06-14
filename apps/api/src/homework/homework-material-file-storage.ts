import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3ClientConfigFromEnv } from "../exam/s3-raw-import-archive-store.js";
import type { HomeworkMaterialFileContentType } from "./homework.service.js";

export interface StoreHomeworkMaterialFileInput {
  tenantId: string;
  materialId: string;
  fileName: string;
  contentType: HomeworkMaterialFileContentType;
  body: Buffer;
  sha256: string;
}

export interface StoredHomeworkMaterialFile {
  contentBase64?: string;
  storageKey?: string;
}

export interface SignedHomeworkMaterialFileDownloadUrl {
  url: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface HomeworkMaterialFileStorage {
  put(input: StoreHomeworkMaterialFileInput): Promise<StoredHomeworkMaterialFile>;
  get(storageKey: string): Promise<Buffer>;
  createSignedDownloadUrl?(storageKey: string): Promise<SignedHomeworkMaterialFileDownloadUrl>;
}

export const homeworkMaterialFileStorageToken = Symbol("HomeworkMaterialFileStorage");
export const homeworkMaterialFileDownloadUrlExpiresInSeconds = 300;

export class InlineHomeworkMaterialFileStorage implements HomeworkMaterialFileStorage {
  async put(input: StoreHomeworkMaterialFileInput): Promise<StoredHomeworkMaterialFile> {
    return { contentBase64: input.body.toString("base64") };
  }

  async get(): Promise<Buffer> {
    throw new Error("HOMEWORK_MATERIAL_FILE_STORAGE_KEY_UNSUPPORTED");
  }
}

export interface S3HomeworkMaterialFileStorageOptions {
  bucket: string;
  client: {
    send(command: PutObjectCommand | GetObjectCommand): Promise<{ Body?: unknown } | unknown>;
  };
  downloadUrlExpiresInSeconds?: number;
  presigner?: (
    client: S3HomeworkMaterialFileStorageOptions["client"],
    command: GetObjectCommand,
    expiresInSeconds: number,
  ) => Promise<string>;
}

export class S3HomeworkMaterialFileStorage implements HomeworkMaterialFileStorage {
  private readonly bucket: string;
  private readonly client: S3HomeworkMaterialFileStorageOptions["client"];
  private readonly downloadUrlExpiresInSeconds: number;
  private readonly presigner: NonNullable<S3HomeworkMaterialFileStorageOptions["presigner"]>;

  constructor(options: S3HomeworkMaterialFileStorageOptions) {
    const bucket = options.bucket.trim();
    if (!bucket) {
      throw new Error("S3_BUCKET_MISSING");
    }

    this.bucket = bucket;
    this.client = options.client;
    this.downloadUrlExpiresInSeconds =
      options.downloadUrlExpiresInSeconds ?? homeworkMaterialFileDownloadUrlExpiresInSeconds;
    this.presigner =
      options.presigner ??
      ((client, command, expiresInSeconds) => presignS3GetObjectUrl(client, command, expiresInSeconds));
  }

  async put(input: StoreHomeworkMaterialFileInput): Promise<StoredHomeworkMaterialFile> {
    if (input.body.length === 0) {
      throw new Error("HOMEWORK_MATERIAL_FILE_BODY_EMPTY");
    }

    const storageKey = createHomeworkMaterialFileStorageKey(input);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { storageKey };
  }

  async get(storageKey: string): Promise<Buffer> {
    const key = storageKey.trim();
    if (!key) {
      throw new Error("HOMEWORK_MATERIAL_FILE_STORAGE_KEY_MISSING");
    }

    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = (result as { Body?: unknown }).Body;
    if (!body) {
      throw new Error("HOMEWORK_MATERIAL_FILE_STORAGE_BODY_MISSING");
    }
    return readS3Body(body);
  }

  async createSignedDownloadUrl(storageKey: string): Promise<SignedHomeworkMaterialFileDownloadUrl> {
    const key = storageKey.trim();
    if (!key) {
      throw new Error("HOMEWORK_MATERIAL_FILE_STORAGE_KEY_MISSING");
    }

    const expiresInSeconds = this.downloadUrlExpiresInSeconds;
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return {
      url: await this.presigner(this.client, command, expiresInSeconds),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      expiresInSeconds,
    };
  }
}

export function createHomeworkMaterialFileStorageFromEnv(
  env: Record<string, string | undefined> = process.env,
): HomeworkMaterialFileStorage {
  const mode = env.HOMEWORK_MATERIAL_FILE_STORAGE ?? (env.NODE_ENV === "production" ? "s3" : "inline");
  if (env.NODE_ENV === "production" && mode !== "s3") {
    throw new Error('HOMEWORK_MATERIAL_FILE_STORAGE must be "s3" in production.');
  }
  if (mode === "inline") {
    return new InlineHomeworkMaterialFileStorage();
  }
  if (mode === "s3") {
    const bucket = env.S3_BUCKET?.trim();
    if (!bucket) {
      throw new Error("S3_BUCKET_MISSING");
    }
    return new S3HomeworkMaterialFileStorage({
      bucket,
      client: new S3Client(createS3ClientConfigFromEnv(env)),
    });
  }

  throw new Error("HOMEWORK_MATERIAL_FILE_STORAGE_INVALID");
}

function createHomeworkMaterialFileStorageKey(input: StoreHomeworkMaterialFileInput): string {
  return [
    "homework-material-files",
    cleanKeySegment(input.tenantId),
    cleanKeySegment(input.materialId),
    input.sha256,
    cleanKeySegment(input.fileName),
  ].join("/");
}

function cleanKeySegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
}

function presignS3GetObjectUrl(
  client: unknown,
  command: GetObjectCommand,
  expiresInSeconds: number,
): Promise<string> {
  return getSignedUrl(
    client as Parameters<typeof getSignedUrl>[0],
    command as Parameters<typeof getSignedUrl>[1],
    { expiresIn: expiresInSeconds },
  );
}

async function readS3Body(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === "object" && body !== null && "transformToByteArray" in body) {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("HOMEWORK_MATERIAL_FILE_STORAGE_BODY_UNSUPPORTED");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Buffer | Uint8Array | string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
