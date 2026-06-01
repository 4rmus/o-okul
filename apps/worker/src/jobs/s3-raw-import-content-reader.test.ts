import { GetObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  createS3ClientConfigFromEnv,
  createS3RawImportContentReaderFromEnv,
  S3RawImportContentReader,
  type S3ClientLike,
} from "./s3-raw-import-content-reader.js";

describe("S3RawImportContentReader", () => {
  it("raw import içeriğini bucket ve s3Key ile okur", async () => {
    const sentCommands: GetObjectCommand[] = [];
    const reader = new S3RawImportContentReader({
      bucket: "raw-imports",
      client: {
        async send(command) {
          sentCommands.push(command);
          return {
            Body: {
              async transformToByteArray() {
                return new TextEncoder().encode("ogrenci_no\tcevaplar");
              },
            },
          };
        },
      },
    });

    const content = await reader.read({
      s3Key: "raw/import/a.dat",
      fileName: "a.dat",
    });

    expect(content.toString()).toBe("ogrenci_no\tcevaplar");
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0]?.input).toMatchObject({
      Bucket: "raw-imports",
      Key: "raw/import/a.dat",
    });
  });

  it("stream body parçalarını Buffer olarak birleştirir", async () => {
    const reader = new S3RawImportContentReader({
      bucket: "raw-imports",
      client: {
        async send() {
          return { Body: createBodyStream(["ogrenci_no\t", Buffer.from("cevaplar")]) };
        },
      },
    });

    await expect(reader.read({ s3Key: "raw/import/a.dat", fileName: "a.dat" }))
      .resolves.toEqual(Buffer.from("ogrenci_no\tcevaplar"));
  });

  it("string body değerini Buffer olarak döndürür", async () => {
    const reader = new S3RawImportContentReader({
      bucket: "raw-imports",
      client: { async send() { return { Body: "ogrenci_no\tcevaplar" }; } },
    });

    await expect(reader.read({ s3Key: "raw/import/a.dat", fileName: "a.dat" }))
      .resolves.toEqual(Buffer.from("ogrenci_no\tcevaplar"));
  });

  it("boş s3Key değerini reddeder", async () => {
    const reader = new S3RawImportContentReader({
      bucket: "raw-imports",
      client: { async send() { throw new Error("SHOULD_NOT_RUN"); } },
    });

    await expect(reader.read({ s3Key: " ", fileName: "a.dat" }))
      .rejects.toThrow("RAW_IMPORT_CONTENT_KEY_MISSING");
  });

  it("S3 response body yoksa domain hatası verir", async () => {
    const reader = new S3RawImportContentReader({
      bucket: "raw-imports",
      client: { async send() { return {}; } },
    });

    await expect(reader.read({ s3Key: "raw/import/a.dat", fileName: "a.dat" }))
      .rejects.toThrow("RAW_IMPORT_CONTENT_EMPTY");
  });

  it("S3 client hatasını saklamaz", async () => {
    const client: S3ClientLike = {
      async send() {
        throw new Error("RAW_IMPORT_CONTENT_NOT_FOUND");
      },
    };
    const reader = new S3RawImportContentReader({ bucket: "raw-imports", client });

    await expect(reader.read({ s3Key: "raw/import/missing.dat", fileName: "missing.dat" }))
      .rejects.toThrow("RAW_IMPORT_CONTENT_NOT_FOUND");
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

  it("env reader için S3_BUCKET zorunludur", () => {
    expect(() => createS3RawImportContentReaderFromEnv({}))
      .toThrow("S3_BUCKET_MISSING");
  });

  it("eksik S3 credential çiftini reddeder", () => {
    expect(() => createS3ClientConfigFromEnv({ S3_ACCESS_KEY_ID: "minio" }))
      .toThrow("S3_CREDENTIALS_INVALID");
  });

  it("S3_FORCE_PATH_STYLE sadece true veya false olabilir", () => {
    expect(() => createS3ClientConfigFromEnv({ S3_FORCE_PATH_STYLE: "yes" }))
      .toThrow("S3_FORCE_PATH_STYLE_INVALID");
  });
});

async function* createBodyStream(chunks: Array<string | Buffer>): AsyncIterable<string | Buffer> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
