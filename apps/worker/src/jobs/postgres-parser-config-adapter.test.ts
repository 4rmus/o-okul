import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@uzman-hocam/db";
import { PostgresParserConfigAdapter } from "./postgres-parser-config-adapter.js";
import type { ParserConfigSuggestion } from "./format-analyzer-service.js";

describe("PostgresParserConfigAdapter", () => {
  it("onaylanmış format önerisini ParserConfig kaydı olarak yazar", async () => {
    const client = new FakeClient((sql, values) => {
      if (sql.includes('INSERT INTO "ParserConfig"')) {
        return [{
          tenantId: values?.[1],
          examId: values?.[2],
          version: values?.[3],
          encoding: values?.[4],
          delimiter: values?.[5],
          skipHeaderLines: values?.[6],
          fieldMapping: JSON.parse(values?.[7] as string),
          status: "APPROVED",
        }];
      }
      return [];
    });
    const adapter = new PostgresParserConfigAdapter(new FakePool(client));

    const result = await adapter.saveApproved({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      suggestion: createSuggestion(),
    });

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
    const insert = client.queries.find((query) => query.sql.includes('INSERT INTO "ParserConfig"'));
    expect(insert?.values?.[0]).toEqual(expect.any(String));
    expect(insert?.values?.slice(1)).toEqual([
      "tenant-a",
      "exam-a",
      "parser-v1",
      "UTF-8",
      "TAB",
      1,
      JSON.stringify(createSuggestion().fieldMapping),
    ]);
    expect(client.queries.filter((query) => query.sql === "BEGIN")).toHaveLength(1);
    expect(client.queries.some((query) => query.sql.includes('ON CONFLICT ("tenantId", "examId", "version") DO NOTHING'))).toBe(true);
  });

  it("aynı tenant/exam/version tekrar yazılırsa conflict döner", async () => {
    const adapter = new PostgresParserConfigAdapter(new FakePool(new FakeClient(() => [])));

    await expect(adapter.saveApproved({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      suggestion: createSuggestion(),
    })).rejects.toThrow("PARSER_CONFIG_VERSION_CONFLICT");
  });

  it("tenant veya version eksikse DB'ye gitmeden reddeder", async () => {
    const client = new FakeClient(() => []);
    const adapter = new PostgresParserConfigAdapter(new FakePool(client));

    await expect(adapter.saveApproved({
      tenantId: "",
      examId: "exam-a",
      version: "parser-v1",
      suggestion: createSuggestion(),
    })).rejects.toThrow("PARSER_CONFIG_APPROVAL_INPUT_INVALID");
    expect(client.queries).toHaveLength(0);
  });

  it("öneri eksikse net domain hatasıyla reddeder", async () => {
    const client = new FakeClient(() => []);
    const adapter = new PostgresParserConfigAdapter(new FakePool(client));

    await expect(adapter.saveApproved({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      suggestion: undefined as unknown as ParserConfigSuggestion,
    })).rejects.toThrow("PARSER_CONFIG_APPROVAL_INPUT_INVALID");
    expect(client.queries).toHaveLength(0);
  });
});

function createSuggestion(): ParserConfigSuggestion {
  return {
    encoding: "UTF-8",
    delimiter: "TAB",
    skipHeaderLines: 1,
    fieldMapping: {
      studentNo: { kind: "delimited", column: 0 },
      bookletType: { kind: "delimited", column: 1 },
      answers: { kind: "delimited", column: 2, estimatedQuestionCount: 5 },
    },
    version: 1,
    confidence: "high",
    warnings: [],
  };
}

class FakePool implements TenantQueryable {
  constructor(private readonly client: FakeClient) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    return this.client.query<T>(sql, values);
  }

  async connect(): Promise<FakeClient> {
    return this.client;
  }
}

class FakeClient implements Queryable {
  readonly queries: Array<{ sql: string; values?: unknown[] }> = [];

  constructor(private readonly handler: (sql: string, values?: unknown[]) => unknown[]) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql: sql.trim(), values });
    return { rows: this.handler(sql, values) as T[] };
  }

  release(): void {}
}
