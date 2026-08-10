import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  createS3ClientConfigFromEnv,
  createS3RawImportArchiveStoreFromEnv,
  S3RawImportArchiveStore,
} from "./s3-raw-import-archive-store.js";

describe("S3RawImportArchiveStore", () => {
  it("RawImport içeriğini S3 PutObject olarak yazar", async () => {
    const commands: PutObjectCommand[] = [];
    const body = Buffer.from("ogrenci_no\tcevaplar");
    const store = new S3RawImportArchiveStore({
      bucket: "raw-imports",
      client: {
        async send(command) {
          commands.push(command);
        },
      },
    });

    await store.put({
      s3Key: "raw-imports/tenant-a/exam-a/parser-v1/hash/source",
      body,
      contentType: "text/plain",
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.input).toMatchObject({
      Bucket: "raw-imports",
      Key: "raw-imports/tenant-a/exam-a/parser-v1/hash/source",
      Body: body,
      ContentType: "text/plain",
    });
  });

  it("boş key veya body değerini S3'e gitmeden reddeder", async () => {
    let calls = 0;
    const store = new S3RawImportArchiveStore({
      bucket: "raw-imports",
      client: { async send() { calls += 1; } },
    });

    await expect(store.put({ s3Key: " ", body: Buffer.from("x") }))
      .rejects.toThrow("RAW_IMPORT_ARCHIVE_KEY_MISSING");
    await expect(store.put({ s3Key: "raw/import/a.dat", body: Buffer.alloc(0) }))
      .rejects.toThrow("RAW_IMPORT_ARCHIVE_BODY_EMPTY");
    expect(calls).toBe(0);
  });

  it("yarım kalan RawImport yazımı için S3 nesnesini siler", async () => {
    const commands: Array<PutObjectCommand | DeleteObjectCommand> = [];
    const store = new S3RawImportArchiveStore({
      bucket: "raw-imports",
      client: { async send(command) { commands.push(command); } },
    });

    await store.delete("raw-imports/tenant-a/exam-a/parser-v1/hash/source");

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(commands[0]?.input).toEqual({
      Bucket: "raw-imports",
      Key: "raw-imports/tenant-a/exam-a/parser-v1/hash/source",
    });
  });

  it("env'den MinIO uyumlu S3 config üretir", () => {
    const config = createS3ClientConfigFromEnv({
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "minio",
      S3_SECRET_ACCESS_KEY: "minio-secret",
      S3_FORCE_PATH_STYLE: "true",
    });

    expect(config).toMatchObject({
      endpoint: "http://minio:9000",
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "minio",
        secretAccessKey: "minio-secret",
      },
    });
  });

  it("env store için S3_BUCKET zorunludur", () => {
    expect(() => createS3RawImportArchiveStoreFromEnv({}))
      .toThrow("S3_BUCKET_MISSING");
  });

  it("eksik credential çiftini reddeder", () => {
    expect(() => createS3ClientConfigFromEnv({ S3_ACCESS_KEY_ID: "minio" }))
      .toThrow("S3_CREDENTIALS_INVALID");
  });
});
