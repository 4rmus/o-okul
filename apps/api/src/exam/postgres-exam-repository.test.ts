import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresExamRepository } from "./postgres-exam-repository.js";

describe("PostgresExamRepository", () => {
  it("sınavı ve sınava bağlı DB girdilerini transaction içinde fiziksel siler", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresExamRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('SELECT * FROM "Exam"')) {
          return { rows: [createExamRow()] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.delete("tenant-a", "exam-a"),
    );

    const businessQueries = queries.filter((query) =>
      !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql)
    );
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Exam"');
    expect(businessQueries.slice(1).map((query) => query.sql.match(/DELETE FROM "([^"]+)"/)?.[1])).toEqual([
      "ReportSnapshot",
      "ExamResult",
      "ParsedAnswer",
      "ImportQuarantine",
      "ExamBookletVariant",
      "AnswerKey",
      "RawImport",
      "ParserConfig",
      "ExamParticipant",
      "Exam",
    ]);
    expect(businessQueries.slice(1).every((query) => JSON.stringify(query.values) === JSON.stringify(["tenant-a", "exam-a"]))).toBe(true);
    expect(result).toMatchObject({ id: "exam-a", tenantId: "tenant-a", title: "Silinecek Deneme" });
  });

  it("sınav bulunamazsa child tablo silme çalıştırmaz", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresExamRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.delete("tenant-a", "missing-exam"),
    );

    const businessQueries = queries.filter((query) =>
      !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql)
    );
    expect(result).toBeUndefined();
    expect(businessQueries).toHaveLength(1);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Exam"');
  });
});

function createExamRow() {
  return {
    id: "exam-a",
    tenantId: "tenant-a",
    title: "Silinecek Deneme",
    status: "PUBLISHED",
    startsAt: "2026-06-06T09:00:00.000Z",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
  };
}
