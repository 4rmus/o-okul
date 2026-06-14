import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3ClientConfigFromEnv } from "../exam/s3-raw-import-archive-store.js";
import type { SupportTicketAttachmentContentType } from "./support-ticket.service.js";

export interface StoreSupportTicketAttachmentInput {
  tenantId: string;
  ticketId: string;
  fileName: string;
  contentType: SupportTicketAttachmentContentType;
  body: Buffer;
  sha256: string;
}

export interface StoredSupportTicketAttachment {
  contentBase64?: string;
  storageKey?: string;
}

export interface SignedSupportTicketAttachmentDownloadUrl {
  url: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface SupportTicketAttachmentStorage {
  put(input: StoreSupportTicketAttachmentInput): Promise<StoredSupportTicketAttachment>;
  get(storageKey: string): Promise<Buffer>;
  createSignedDownloadUrl?(storageKey: string): Promise<SignedSupportTicketAttachmentDownloadUrl>;
}

export const supportTicketAttachmentStorageToken = Symbol("SupportTicketAttachmentStorage");
export const supportTicketAttachmentDownloadUrlExpiresInSeconds = 300;

export class InlineSupportTicketAttachmentStorage implements SupportTicketAttachmentStorage {
  async put(input: StoreSupportTicketAttachmentInput): Promise<StoredSupportTicketAttachment> {
    return { contentBase64: input.body.toString("base64") };
  }

  async get(): Promise<Buffer> {
    throw new Error("SUPPORT_TICKET_ATTACHMENT_STORAGE_KEY_UNSUPPORTED");
  }
}

export interface S3SupportTicketAttachmentStorageOptions {
  bucket: string;
  client: {
    send(command: PutObjectCommand | GetObjectCommand): Promise<{ Body?: unknown } | unknown>;
  };
  downloadUrlExpiresInSeconds?: number;
  presigner?: (
    client: S3SupportTicketAttachmentStorageOptions["client"],
    command: GetObjectCommand,
    expiresInSeconds: number,
  ) => Promise<string>;
}

export class S3SupportTicketAttachmentStorage implements SupportTicketAttachmentStorage {
  private readonly bucket: string;
  private readonly client: S3SupportTicketAttachmentStorageOptions["client"];
  private readonly downloadUrlExpiresInSeconds: number;
  private readonly presigner: NonNullable<S3SupportTicketAttachmentStorageOptions["presigner"]>;

  constructor(options: S3SupportTicketAttachmentStorageOptions) {
    const bucket = options.bucket.trim();
    if (!bucket) {
      throw new Error("S3_BUCKET_MISSING");
    }

    this.bucket = bucket;
    this.client = options.client;
    this.downloadUrlExpiresInSeconds =
      options.downloadUrlExpiresInSeconds ?? supportTicketAttachmentDownloadUrlExpiresInSeconds;
    this.presigner =
      options.presigner ??
      ((client, command, expiresInSeconds) => presignS3GetObjectUrl(client, command, expiresInSeconds));
  }

  async put(input: StoreSupportTicketAttachmentInput): Promise<StoredSupportTicketAttachment> {
    if (input.body.length === 0) {
      throw new Error("SUPPORT_TICKET_ATTACHMENT_BODY_EMPTY");
    }

    const storageKey = createSupportAttachmentStorageKey(input);
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
      throw new Error("SUPPORT_TICKET_ATTACHMENT_STORAGE_KEY_MISSING");
    }

    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = (result as { Body?: unknown }).Body;
    if (!body) {
      throw new Error("SUPPORT_TICKET_ATTACHMENT_STORAGE_BODY_MISSING");
    }
    return readS3Body(body);
  }

  async createSignedDownloadUrl(storageKey: string): Promise<SignedSupportTicketAttachmentDownloadUrl> {
    const key = storageKey.trim();
    if (!key) {
      throw new Error("SUPPORT_TICKET_ATTACHMENT_STORAGE_KEY_MISSING");
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

export function createSupportTicketAttachmentStorageFromEnv(
  env: Record<string, string | undefined> = process.env,
): SupportTicketAttachmentStorage {
  const mode = env.SUPPORT_ATTACHMENT_STORAGE ?? (env.NODE_ENV === "production" ? "s3" : "inline");
  if (env.NODE_ENV === "production" && mode !== "s3") {
    throw new Error('SUPPORT_ATTACHMENT_STORAGE must be "s3" in production.');
  }
  if (mode === "inline") {
    return new InlineSupportTicketAttachmentStorage();
  }
  if (mode === "s3") {
    const bucket = env.S3_BUCKET?.trim();
    if (!bucket) {
      throw new Error("S3_BUCKET_MISSING");
    }
    return new S3SupportTicketAttachmentStorage({
      bucket,
      client: new S3Client(createS3ClientConfigFromEnv(env)),
    });
  }

  throw new Error("SUPPORT_ATTACHMENT_STORAGE_INVALID");
}

function createSupportAttachmentStorageKey(input: StoreSupportTicketAttachmentInput): string {
  return [
    "support-ticket-attachments",
    cleanKeySegment(input.tenantId),
    cleanKeySegment(input.ticketId),
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

  throw new Error("SUPPORT_TICKET_ATTACHMENT_STORAGE_BODY_UNSUPPORTED");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Buffer | Uint8Array | string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
