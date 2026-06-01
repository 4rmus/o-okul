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

  it("S3 depolama support attachment key'i ile put/get yapar", async () => {
    const commands: Array<PutObjectCommand | GetObjectCommand> = [];
    const storage = new S3SupportTicketAttachmentStorage({
      bucket: "uzman-hocam-local",
      client: {
        async send(command) {
          commands.push(command);
          if (command instanceof GetObjectCommand) {
            return { Body: { async transformToByteArray() { return new Uint8Array(Buffer.from("remote file")); } } };
          }
          return {};
        },
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

    expect(stored).toEqual({
      storageKey: "support-ticket-attachments/tenant-a/support-ticket-a/sha-a/hata_ekrani.txt",
    });
    expect(body.toString("utf8")).toBe("remote file");
    expect(commands[0]?.input).toMatchObject({
      Bucket: "uzman-hocam-local",
      Key: stored.storageKey,
      ContentType: "text/plain",
    });
    expect(commands[1]?.input).toMatchObject({
      Bucket: "uzman-hocam-local",
      Key: stored.storageKey,
    });
  });

  it("env seçimine göre inline veya S3 storage üretir", () => {
    expect(createSupportTicketAttachmentStorageFromEnv({ SUPPORT_ATTACHMENT_STORAGE: "inline" }))
      .toBeInstanceOf(InlineSupportTicketAttachmentStorage);

    expect(createSupportTicketAttachmentStorageFromEnv({
      SUPPORT_ATTACHMENT_STORAGE: "s3",
      S3_BUCKET: "uzman-hocam-local",
      S3_REGION: "us-east-1",
    })).toBeInstanceOf(S3SupportTicketAttachmentStorage);

    expect(() => createSupportTicketAttachmentStorageFromEnv({ SUPPORT_ATTACHMENT_STORAGE: "disk" }))
      .toThrow("SUPPORT_ATTACHMENT_STORAGE_INVALID");
  });
});
