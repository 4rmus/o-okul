import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  createHomeworkMaterialFileStorageFromEnv,
  InlineHomeworkMaterialFileStorage,
  S3HomeworkMaterialFileStorage,
} from "./homework-material-file-storage.js";

describe("HomeworkMaterialFileStorage", () => {
  it("inline depolama dosya içeriğini base64 olarak saklar", async () => {
    const storage = new InlineHomeworkMaterialFileStorage();

    await expect(storage.put({
      tenantId: "tenant-a",
      materialId: "material-a",
      fileName: "kesirler.txt",
      contentType: "text/plain",
      body: Buffer.from("hello world"),
      sha256: "sha-a",
    })).resolves.toEqual({ contentBase64: "aGVsbG8gd29ybGQ=" });
  });

  it("S3 depolama homework material key'i ile put/get ve imzalı GET URL üretir", async () => {
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
    const storage = new S3HomeworkMaterialFileStorage({
      bucket: "uzman-hocam-local",
      client,
      async presigner(presignClient, command, expiresInSeconds) {
        expect(presignClient).toBe(client);
        signedCommands.push(command);
        expect(expiresInSeconds).toBe(300);
        return "https://storage.example.test/homework-material-file";
      },
    });

    const stored = await storage.put({
      tenantId: "tenant-a",
      materialId: "material-a",
      fileName: "kesirler ek.txt",
      contentType: "text/plain",
      body: Buffer.from("remote file"),
      sha256: "sha-a",
    });
    const body = await storage.get(stored.storageKey ?? "");
    const signedDownload = await storage.createSignedDownloadUrl(stored.storageKey ?? "");

    expect(stored).toEqual({
      storageKey: "homework-material-files/tenant-a/material-a/sha-a/kesirler_ek.txt",
    });
    expect(body.toString("utf8")).toBe("remote file");
    expect(signedDownload).toMatchObject({
      url: "https://storage.example.test/homework-material-file",
      expiresInSeconds: 300,
    });
    expect(new Date(signedDownload.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(commands[0]?.input).toMatchObject({
      Bucket: "uzman-hocam-local",
      Key: stored.storageKey,
      ContentType: "text/plain",
    });
    expect(commands[1]?.input).toMatchObject({
      Bucket: "uzman-hocam-local",
      Key: stored.storageKey,
    });
    expect(signedCommands[0]?.input).toMatchObject({
      Bucket: "uzman-hocam-local",
      Key: stored.storageKey,
    });
  });

  it("env seçimine göre inline veya S3 storage üretir", () => {
    expect(createHomeworkMaterialFileStorageFromEnv({ HOMEWORK_MATERIAL_FILE_STORAGE: "inline" }))
      .toBeInstanceOf(InlineHomeworkMaterialFileStorage);

    expect(createHomeworkMaterialFileStorageFromEnv({
      HOMEWORK_MATERIAL_FILE_STORAGE: "s3",
      S3_BUCKET: "uzman-hocam-local",
      S3_REGION: "us-east-1",
    })).toBeInstanceOf(S3HomeworkMaterialFileStorage);

    expect(() => createHomeworkMaterialFileStorageFromEnv({ HOMEWORK_MATERIAL_FILE_STORAGE: "disk" }))
      .toThrow("HOMEWORK_MATERIAL_FILE_STORAGE_INVALID");
  });

  it("production ortamında inline storage ile başlamaz", () => {
    expect(() =>
      createHomeworkMaterialFileStorageFromEnv({
        NODE_ENV: "production",
        HOMEWORK_MATERIAL_FILE_STORAGE: "inline",
      }),
    ).toThrow('HOMEWORK_MATERIAL_FILE_STORAGE must be "s3" in production.');

    expect(createHomeworkMaterialFileStorageFromEnv({
      NODE_ENV: "production",
      S3_BUCKET: "uzman-hocam-prod",
      S3_REGION: "us-east-1",
    })).toBeInstanceOf(S3HomeworkMaterialFileStorage);
  });
});
