import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { RawImportArchiveStore } from "./raw-import-upload.service.js";

export interface S3ClientLike {
  send(command: PutObjectCommand): Promise<unknown>;
}

export interface S3RawImportArchiveStoreOptions {
  bucket: string;
  client: S3ClientLike;
}

export class S3RawImportArchiveStore implements RawImportArchiveStore {
  private readonly bucket: string;
  private readonly client: S3ClientLike;

  constructor(options: S3RawImportArchiveStoreOptions) {
    const bucket = options.bucket.trim();
    if (bucket.length === 0) {
      throw new Error("S3_BUCKET_MISSING");
    }

    this.bucket = bucket;
    this.client = options.client;
  }

  async put(input: {
    s3Key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<void> {
    const key = input.s3Key.trim();
    if (key.length === 0) {
      throw new Error("RAW_IMPORT_ARCHIVE_KEY_MISSING");
    }
    if (input.body.length === 0) {
      throw new Error("RAW_IMPORT_ARCHIVE_BODY_EMPTY");
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }
}

export function createS3RawImportArchiveStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3RawImportArchiveStore {
  const bucket = requireEnv(env, "S3_BUCKET");
  return new S3RawImportArchiveStore({
    bucket,
    client: new S3Client(createS3ClientConfigFromEnv(env)),
  });
}

export function createS3ClientConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3ClientConfig {
  const config: S3ClientConfig = {
    region: env.S3_REGION ?? "us-east-1",
  };

  if (env.S3_ENDPOINT) {
    config.endpoint = env.S3_ENDPOINT;
  }

  if (env.S3_FORCE_PATH_STYLE !== undefined) {
    config.forcePathStyle = parseBooleanEnv(env.S3_FORCE_PATH_STYLE, "S3_FORCE_PATH_STYLE");
  }

  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (accessKeyId !== undefined || secretAccessKey !== undefined) {
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("S3_CREDENTIALS_INVALID");
    }

    config.credentials = {
      accessKeyId,
      secretAccessKey,
    };
  }

  return config;
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key}_MISSING`);
  }
  return value;
}

function parseBooleanEnv(value: string, key: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${key}_INVALID`);
}
