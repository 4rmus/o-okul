import { GetObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { RawImportContentReader } from "./optical-parse-workflow.js";

export interface S3ClientLike {
  send(command: GetObjectCommand): Promise<{ Body?: unknown }>;
}

export interface S3RawImportContentReaderOptions {
  bucket: string;
  client: S3ClientLike;
}

export class S3RawImportContentReader implements RawImportContentReader {
  private readonly bucket: string;
  private readonly client: S3ClientLike;

  constructor(options: S3RawImportContentReaderOptions) {
    const bucket = options.bucket.trim();
    if (bucket.length === 0) {
      throw new Error("S3_BUCKET_MISSING");
    }

    this.bucket = bucket;
    this.client = options.client;
  }

  async read(input: { s3Key: string; fileName: string }): Promise<Buffer> {
    const key = input.s3Key.trim();
    if (key.length === 0) {
      throw new Error("RAW_IMPORT_CONTENT_KEY_MISSING");
    }

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return readBodyAsBuffer(response.Body);
  }
}

export function createS3RawImportContentReaderFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3RawImportContentReader {
  const bucket = requireEnv(env, "S3_BUCKET");
  return new S3RawImportContentReader({
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

async function readBodyAsBuffer(body: unknown): Promise<Buffer> {
  if (body === undefined || body === null) {
    throw new Error("RAW_IMPORT_CONTENT_EMPTY");
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (hasTransformToByteArray(body)) {
    return Buffer.from(await body.transformToByteArray());
  }

  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("RAW_IMPORT_CONTENT_UNSUPPORTED");
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

function hasTransformToByteArray(
  body: unknown,
): body is { transformToByteArray(): Promise<Uint8Array> } {
  return (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  );
}

function isAsyncIterable(
  body: unknown,
): body is AsyncIterable<Uint8Array | string> {
  return (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body
  );
}
