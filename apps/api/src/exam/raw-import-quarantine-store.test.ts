import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresRawImportQuarantineStore } from "./raw-import-quarantine-store.js";

describe("PostgresRawImportQuarantineStore", () => {
  it("tenant içindeki açık karantina sayısını döndürür", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresRawImportQuarantineStore({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('FROM "ImportQuarantine"')) {
          return { rows: [] as T[] };
        }
        return { rows: [{ count: "3" }] as T[] };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.countOpenByTenant("tenant-a"),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries).toHaveLength(1);
    expect(businessQueries[0]?.sql).toContain('COUNT(*)::text AS count');
    expect(businessQueries[0]?.sql).toContain('FROM "ImportQuarantine"');
    expect(businessQueries[0]?.sql).toContain('"tenantId" = $1');
    expect(businessQueries[0]?.sql).toContain('"status" = \'OPEN\'');
    expect(businessQueries[0]?.sql).toContain('"deletedAt" IS NULL');
    expect(businessQueries[0]?.values).toEqual(["tenant-a"]);
    expect(result).toBe(3);
  });

  it("karantina listesini tenant, sınav ve raw import ile sınırlar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresRawImportQuarantineStore({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('FROM "ImportQuarantine"')) {
          return { rows: [] as T[] };
        }
        return {
          rows: [createRow({ rawRow: JSON.stringify({ studentNo: "1606" }) })] as T[],
        };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.listByRawImport("tenant-a", "exam-a", "raw-import-a"),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries).toHaveLength(1);
    expect(businessQueries[0]?.sql).toContain('FROM "ImportQuarantine"');
    expect(businessQueries[0]?.sql).toContain('"tenantId" = $1');
    expect(businessQueries[0]?.sql).toContain('"examId" = $2');
    expect(businessQueries[0]?.sql).toContain('"rawImportId" = $3');
    expect(businessQueries[0]?.sql).toContain('ORDER BY "rowNumber" ASC');
    expect(businessQueries[0]?.values).toEqual(["tenant-a", "exam-a", "raw-import-a"]);
    expect(result).toEqual([
      expect.objectContaining({
        id: "quarantine-a",
        rawRow: { studentNo: "1606" },
        status: "OPEN",
      }),
    ]);
  });

  it("açık karantina için reprocess girdisini hazırlar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresRawImportQuarantineStore({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('FROM "ImportQuarantine"')) {
          return { rows: [] as T[] };
        }
        return {
          rows: [createRow({
            resolvedParticipantId: "participant-a",
            answerKeyId: "answer-key-a",
            rawImportSha256: "raw-sha-a",
          })] as T[],
        };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.resolve({
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        quarantineId: "quarantine-a",
        resolvedStudentId: "student-a",
      }),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries).toHaveLength(1);
    expect(businessQueries[0]?.sql).toContain('FROM "ImportQuarantine"');
    expect(businessQueries[0]?.sql).toContain('"status" = \'OPEN\'');
    expect(businessQueries[0]?.sql).toContain('FROM "Student"');
    expect(businessQueries[0]?.sql).toContain('"Student"."tenantId" = $1');
    expect(businessQueries[0]?.sql).toContain('"Student"."id" = $5');
    expect(businessQueries[0]?.sql).toContain('FROM "StudentEnrollment" se');
    expect(businessQueries[0]?.sql).toContain('se."status" = \'ACTIVE\'');
    expect(businessQueries[0]?.sql).toContain('se."endsAt" IS NULL');
    expect(businessQueries[0]?.sql).toContain('INNER JOIN "ExamParticipant" ep');
    expect(businessQueries[0]?.sql).toContain('INNER JOIN "RawImport" ri');
    expect(businessQueries[0]?.sql).toContain('FROM "AnswerKey"');
    expect(businessQueries[0]?.sql).toContain('"publishedAt" DESC NULLS LAST');
    expect(businessQueries[0]?.values).toEqual([
      "tenant-a",
      "exam-a",
      "raw-import-a",
      "quarantine-a",
      "student-a",
    ]);
    expect(result).toEqual(expect.objectContaining({
      id: "quarantine-a",
      status: "OPEN",
      resolvedParticipantId: "participant-a",
      answerKeyId: "answer-key-a",
      rawImportSha256: "raw-sha-a",
    }));
  });

  it("enqueue sonrası açık karantinayı resolved yapar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresRawImportQuarantineStore({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('UPDATE "ImportQuarantine"')) {
          return { rows: [] as T[] };
        }
        return {
          rows: [createRow({
            status: "RESOLVED",
            resolvedStudentId: values?.[4] as string,
          })] as T[],
        };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.markResolved({
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        quarantineId: "quarantine-a",
        resolvedStudentId: "student-a",
      }),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries).toHaveLength(1);
    expect(businessQueries[0]?.sql).toContain('UPDATE "ImportQuarantine"');
    expect(businessQueries[0]?.sql).toContain('"status" = \'RESOLVED\'');
    expect(businessQueries[0]?.sql).toContain('"resolvedStudentId" = $5');
    expect(businessQueries[0]?.sql).toContain('"status" = \'OPEN\'');
    expect(businessQueries[0]?.values).toEqual([
      "tenant-a",
      "exam-a",
      "raw-import-a",
      "quarantine-a",
      "student-a",
    ]);
    expect(result).toEqual(expect.objectContaining({
      id: "quarantine-a",
      status: "RESOLVED",
      resolvedStudentId: "student-a",
    }));
  });
});

function createRow(overrides: Partial<ImportQuarantineTestRow> = {}): ImportQuarantineTestRow {
  return {
    id: "quarantine-a",
    tenantId: "tenant-a",
    examId: "exam-a",
    rawImportId: "raw-import-a",
    rowNumber: 12,
    rawRow: { studentNo: "1606", answers: "ABCDE" },
    reason: "STUDENT_NOT_MATCHED",
    status: "OPEN",
    resolvedStudentId: null,
    createdAt: new Date("2026-06-02T09:00:00.000Z"),
    updatedAt: new Date("2026-06-02T09:00:00.000Z"),
    ...overrides,
  };
}

interface ImportQuarantineTestRow {
  id: string;
  tenantId: string;
  examId: string;
  rawImportId: string;
  rowNumber: number;
  rawRow: unknown;
  reason: string;
  status: string;
  resolvedStudentId: string | null;
  resolvedParticipantId?: string | null;
  answerKeyId?: string | null;
  rawImportSha256?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
