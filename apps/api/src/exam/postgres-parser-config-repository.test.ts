import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresParserConfigRepository } from "./postgres-parser-config-repository.js";

describe("PostgresParserConfigRepository", () => {
  it("onaylanmış ParserConfig kaydını tenant transaction içinde insert eder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresParserConfigRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('INSERT INTO "ParserConfig"')) {
          return { rows: [] as T[] };
        }
        return {
          rows: [createRow({
            tenantId: values?.[1] as string,
            examId: values?.[2] as string,
            version: values?.[3] as string,
            encoding: values?.[4] as string,
            delimiter: values?.[5] as string,
            skipHeaderLines: values?.[6] as number,
            fieldMapping: JSON.parse(values?.[7] as string) as unknown,
          })] as T[],
        };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.saveApproved(createInput()),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config"));
    expect(businessQueries).toHaveLength(1);
    expect(businessQueries[0]?.sql).toContain('INSERT INTO "ParserConfig"');
    expect(businessQueries[0]?.sql).toContain('"id"');
    expect(businessQueries[0]?.sql).toContain('ON CONFLICT ("tenantId", "examId", "version") DO NOTHING');
    expect(businessQueries[0]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "exam-a",
      "parser-v1",
      "UTF-8",
      "TAB",
      1,
      JSON.stringify(createSuggestion().fieldMapping),
    ]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      encoding: "UTF-8",
      delimiter: "TAB",
      skipHeaderLines: 1,
      fieldMapping: createSuggestion().fieldMapping,
      status: "APPROVED",
    });
  });

  it("unique conflict durumunda domain hatası verir", async () => {
    const repository = new PostgresParserConfigRepository({
      async query<T>() {
        return { rows: [] as T[] };
      },
    });

    await expect(runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.saveApproved(createInput()),
    )).rejects.toThrow("PARSER_CONFIG_VERSION_CONFLICT");
  });
});

function createInput() {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    version: "parser-v1",
    suggestion: createSuggestion(),
  };
}

function createSuggestion() {
  return {
    encoding: "UTF-8" as const,
    delimiter: "TAB" as const,
    skipHeaderLines: 1,
    fieldMapping: {
      studentNo: { kind: "delimited" as const, column: 0 },
      bookletType: { kind: "delimited" as const, column: 1 },
      answers: { kind: "delimited" as const, column: 2, estimatedQuestionCount: 5 },
    },
    version: 1 as const,
    confidence: "high" as const,
    warnings: [],
  };
}

interface ParserConfigTestRow {
  tenantId: string;
  examId: string;
  version: string;
  encoding: string;
  delimiter: string;
  skipHeaderLines: number;
  status: string;
  fieldMapping: unknown;
}

function createRow(overrides: Partial<ParserConfigTestRow> = {}) {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    version: "parser-v1",
    encoding: "UTF-8",
    delimiter: "TAB",
    skipHeaderLines: 1,
    fieldMapping: createSuggestion().fieldMapping,
    status: "APPROVED",
    ...overrides,
  };
}
