import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresRawImportRepository } from "./postgres-raw-import-repository.js";

describe("PostgresRawImportRepository", () => {
  it("RawImport kaydını tenant transaction içinde insert eder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresRawImportRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [createRow({ metadata: { contentType: "text/plain" } })] as T[],
        };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create(createInput()),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries).toHaveLength(1);
    expect(businessQueries[0]?.sql).toContain('INSERT INTO "RawImport"');
    expect(businessQueries[0]?.sql).toContain('"id"');
    expect(businessQueries[0]?.sql).toContain('ON CONFLICT ("tenantId", "examId", "sha256", "parserConfigVersion")');
    expect(businessQueries[0]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "exam-a",
      "OPTICAL_TXT",
      "answers.dat",
      "raw-imports/tenant-a/exam-a/parser-v1/hash/source",
      "hash-a",
      "parser-v1",
      JSON.stringify({ contentType: "text/plain" }),
    ]);
    expect(result).toEqual({
      id: "raw-import-a",
      ...createInput(),
    });
  });

  it("unique conflict durumunda mevcut RawImport kaydını döndürür", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresRawImportRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("INSERT INTO")) {
          return { rows: [] as T[] };
        }
        return { rows: [createRow({ id: "raw-import-existing", metadata: null })] as T[] };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create(createInput()),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries).toHaveLength(2);
    expect(businessQueries[1]?.sql).toContain('FROM "RawImport"');
    expect(businessQueries[1]?.values).toEqual(["tenant-a", "exam-a", "hash-a", "parser-v1"]);
    expect(result).toEqual({
      id: "raw-import-existing",
      ...createInput(),
      metadata: undefined,
    });
  });

  it("insert ve existing select boşsa domain hatası verir", async () => {
    const repository = new PostgresRawImportRepository({
      async query<T>() {
        return { rows: [] as T[] };
      },
    });

    await expect(runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create(createInput()),
    )).rejects.toThrow("RAW_IMPORT_CREATE_FAILED");
  });
});

function createInput() {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    sourceType: "OPTICAL_TXT",
    fileName: "answers.dat",
    s3Key: "raw-imports/tenant-a/exam-a/parser-v1/hash/source",
    sha256: "hash-a",
    parserConfigVersion: "parser-v1",
    metadata: { contentType: "text/plain" },
  };
}

type RawImportTestRow = Omit<ReturnType<typeof createInput>, "metadata"> & {
  id: string;
  metadata: unknown;
};

function createRow(overrides: Partial<RawImportTestRow> = {}) {
  return {
    id: "raw-import-a",
    ...createInput(),
    ...overrides,
  };
}
