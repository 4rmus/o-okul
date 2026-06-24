import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  createSupportTicketAttachmentStorageFromEnv,
  InlineSupportTicketAttachmentStorage,
  S3SupportTicketAttachmentStorage,
} from "./support-ticket-attachment-storage.js";

describe("SupportTicketAttachmentStorage", () => {
  it("inline depolama dosya içeriğini base64 olarak saklar", async () => {
    const storage = new InlineSupportTicketAttachmentStorage();

    await expect(storage.put({
      tenantId: "tenant-a",
      ticketId: "support-ticket-a",
      fileName: "ekran.txt",
      contentType: "text/plain",
      body: Buffer.from("hello world"),
      sha256: "sha-a",
    })).resolves.toEqual({ contentBase64: "aGVsbG8gd29ybGQ=" });
  });

  it("S3 depolama support attachment key'i ile put/get ve imzalı GET URL üretir", async () => {
    const commands: Array<PutObjectCommand | GetObjectCommand> = [];
    const signedCommands: GetObjectCommand[] = [];
    const client = {
      async send(command: PutObjectCommand | GetObjectCommand) {
        commands.push(command);
        if (command instanceof GetObjectCommand) {
          return { Body: { async transformToByteArray() { return new Uint8Array(Buffer.from("remote file")); } } };
        }
        return {};
      },
    };
    const storage = new S3SupportTicketAttachmentStorage({
      bucket: "o-okul-local",
      client,
      async presigner(presignClient, command, expiresInSeconds) {
        expect(presignClient).toBe(client);
        signedCommands.push(command);
        expect(expiresInSeconds).toBe(300);
        return "https://storage.example.test/support-ticket-attachment";
      },
    });

    const stored = await storage.put({
      tenantId: "tenant-a",
      ticketId: "support-ticket-a",
      fileName: "hata ekrani.txt",
      contentType: "text/plain",
      body: Buffer.from("remote file"),
      sha256: "sha-a",
    });
    const body = await storage.get(stored.storageKey ?? "");
    const signedDownload = await storage.createSignedDownloadUrl(stored.storageKey ?? "");

    expect(stored).toEqual({
      storageKey: "support-ticket-attachments/sha-a",
    });
    expect(stored.storageKey?.split("/")).not.toContain("tenant-a");
    expect(stored.storageKey?.split("/")).not.toContain("support-ticket-a");
    expect(stored.storageKey).not.toContain("hata");
    expect(body.toString("utf8")).toBe("remote file");
    expect(signedDownload).toMatchObject({
      url: "https://storage.example.test/support-ticket-attachment",
      expiresInSeconds: 300,
    });
    expect(new Date(signedDownload.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(commands[0]?.input).toMatchObject({
      Bucket: "o-okul-local",
      Key: stored.storageKey,
      ContentType: "text/plain",
    });
    expect(commands[1]?.input).toMatchObject({
      Bucket: "o-okul-local",
      Key: stored.storageKey,
    });
    expect(signedCommands[0]?.input).toMatchObject({
      Bucket: "o-okul-local",
      Key: stored.storageKey,
    });
  });

  it("env seçimine göre inline veya S3 storage üretir", () => {
    expect(createSupportTicketAttachmentStorageFromEnv({ SUPPORT_ATTACHMENT_STORAGE: "inline" }))
      .toBeInstanceOf(InlineSupportTicketAttachmentStorage);

    expect(createSupportTicketAttachmentStorageFromEnv({
      SUPPORT_ATTACHMENT_STORAGE: "s3",
      S3_BUCKET: "o-okul-local",
      S3_REGION: "us-east-1",
    })).toBeInstanceOf(S3SupportTicketAttachmentStorage);

    expect(() => createSupportTicketAttachmentStorageFromEnv({ SUPPORT_ATTACHMENT_STORAGE: "disk" }))
      .toThrow("SUPPORT_ATTACHMENT_STORAGE_INVALID");
  });

  it("production ortamında inline storage ile başlamaz", () => {
    expect(() =>
      createSupportTicketAttachmentStorageFromEnv({
        NODE_ENV: "production",
        SUPPORT_ATTACHMENT_STORAGE: "inline",
      }),
    ).toThrow('SUPPORT_ATTACHMENT_STORAGE must be "s3" in production.');

    expect(createSupportTicketAttachmentStorageFromEnv({
      NODE_ENV: "production",
      S3_BUCKET: "o-okul-prod",
      S3_REGION: "us-east-1",
    })).toBeInstanceOf(S3SupportTicketAttachmentStorage);
  });
});
