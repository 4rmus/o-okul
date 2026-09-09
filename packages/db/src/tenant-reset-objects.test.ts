import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { tenantResetTableNames, type TenantResetSnapshot } from "@o-okul/db";
import { resetObjectInventory, resetPreflightDigest } from "./tenant-reset-objects.js";

describe("reset object inventory", () => {
  it.each(["valid", "orphan", "unknown", "hash"])("paginates, deduplicates and verifies %s inventory", async (variant) => {
    const bytes = Buffer.from("attachment bytes"); const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = `homework-material-files/tenant-a/material-a/${sha256}/source`;
    const tables = Object.fromEntries(tenantResetTableNames.map((name) => [name, []])) as unknown as TenantResetSnapshot["tables"];
    tables.HomeworkMaterialFile = [{ materialId: "material-a", sha256, storageKey: key }, { materialId: "material-a", sha256, storageKey: key }];
    tables.Student = [{ id: "student-a", photoKey: "students/student-a/photo.jpg" }];
    const calls: string[] = [];
    const s3 = { async send(command: { constructor: { name: string }; input: { ContinuationToken?: string; Key?: string } }) {
      calls.push(command.constructor.name);
      if (command.constructor.name === "ListObjectsV2Command") {
        if (!command.input.ContinuationToken) return { Contents: [{ Key: key, Size: bytes.length, ETag: "etag" }], IsTruncated: true, NextContinuationToken: "page-2" };
        return { Contents: [{ Key: "students/student-a/photo.jpg", Size: bytes.length, ETag: "etag" }, ...(variant === "orphan" ? [{ Key: "students/student-a/orphan.jpg", Size: 1, ETag: "etag" }] : variant === "unknown" ? [{ Key: "uncataloged/private-object", Size: 1, ETag: "etag" }] : [])] };
      }
      if (command.constructor.name === "HeadObjectCommand") return { ContentLength: bytes.length, ETag: "etag", VersionId: "version-1" };
      return { Body: { transformToByteArray: async () => variant === "hash" ? Buffer.from("corruption bytes") : bytes } };
    } };
    const snapshot = { tenantId: "tenant-a", tables, objectOwners: { tenantIds: ["tenant-a", "tenant-b"], students: [{ id: "student-a", tenantId: "tenant-a" }] } } as TenantResetSnapshot;
    if (variant === "valid") {
      const result = await resetObjectInventory(snapshot, s3 as never, "source");
      expect(result).toHaveLength(2); expect(result[0]?.sha256).toBe(sha256);
      expect(calls.filter((name) => name === "ListObjectsV2Command")).toHaveLength(2);
    } else await expect(resetObjectInventory(snapshot, s3 as never, "source")).rejects.toThrow(variant === "hash" ? "RESET_OBJECT_HASH_MISMATCH" : "RESET_OBJECT_KEY_UNKNOWN");
    expect(calls).not.toContain("PutObjectCommand"); expect(calls).not.toContain("DeleteObjectCommand");
  });
});

it("preflight binds bucket and endpoint path without binding secrets", () => {
  const snapshot = { tenantId: "tenant-a", lifecycleVersion: 3, dataDigest: "data" } as TenantResetSnapshot;
  const hash = resetPreflightDigest(snapshot, [], [], { endpoint: "https://objects.test/source", bucket: "source" });
  expect(resetPreflightDigest(snapshot, [], [], { endpoint: "https://objects.test/other", bucket: "source" })).not.toBe(hash);
  expect(resetPreflightDigest(snapshot, [], [], { endpoint: "https://objects.test/source", bucket: "copy" })).not.toBe(hash);
});
