import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@uzman-hocam/db";
import { PostgresOpticalParseAdapter } from "./postgres-optical-parse-adapter.js";
import type { OpticalAnswerParseResult } from "./optical-answer-parser.js";

describe("PostgresOpticalParseAdapter", () => {
  it("matched ve unmatched parser sonucunu tenant transaction içinde yazar", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('INSERT INTO "ParsedAnswer"')) return [{ id: "parsed-a" }];
      if (sql.includes('INSERT INTO "ImportQuarantine"')) return [{ id: "quarantine-a" }];
      return [];
    });
    const adapter = new PostgresOpticalParseAdapter(new FakePool(client));

    const result = await adapter.save({
      tenantId: "tenant-a",
      result: createParseResult(),
    });

    expect(result).toEqual({ matchedSaved: 1, unmatchedSaved: 1 });
    expect(client.queries[0]?.sql).toBe("BEGIN");
    expect(client.queries[1]).toEqual({
      sql: "SELECT set_config('app.bypass_rls', $1, true)",
      values: ["false"],
    });
    expect(client.queries[2]).toEqual({
      sql: "SELECT set_config('app.current_tenant_id', $1, true)",
      values: ["tenant-a"],
    });
    const parsedInsert = client.queries.find((query) => query.sql.includes('INSERT INTO "ParsedAnswer"'));
    expect(parsedInsert?.sql).toContain('ON CONFLICT ("tenantId", "rawImportId", "participantId", "parserConfigVersion")');
    expect(parsedInsert?.sql).toContain('"deletedAt" = NULL');
    expect(parsedInsert?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "exam-a",
      "raw-import-a",
      "participant-a",
      "parser-v1",
      2,
      JSON.stringify([{ questionNo: 1, answer: "A" }]),
    ]);
    const participantUpdate = client.queries.find((query) => query.sql.includes('UPDATE "ExamParticipant"'));
    expect(participantUpdate?.sql).toContain('"bookletType" IS NULL OR btrim("bookletType") = \'\'');
    expect(participantUpdate?.values).toEqual(["tenant-a", "participant-a", "B"]);
    const staleQuarantineCleanup = client.queries.find((query) => query.sql.includes('UPDATE "ImportQuarantine"'));
    expect(staleQuarantineCleanup?.sql).toContain('"status" = \'OPEN\'');
    expect(staleQuarantineCleanup?.sql).toContain('"deletedAt" IS NULL');
    expect(staleQuarantineCleanup?.values).toEqual(["tenant-a", "raw-import-a", 2]);
    const quarantineInsert = client.queries.find((query) => query.sql.includes('INSERT INTO "ImportQuarantine"'));
    expect(quarantineInsert?.sql).toContain('WHERE "ImportQuarantine"."status" = \'OPEN\'');
    expect(quarantineInsert?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "exam-a",
      "raw-import-a",
      3,
      JSON.stringify({
        line: "99999\tA\tABCDE",
        studentNo: "99999",
        bookletType: "A",
        warnings: [],
      }),
      "STUDENT_NOT_FOUND",
    ]);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("çözülmüş quarantine conflict'i ezilmezse saved count artmaz", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('INSERT INTO "ParsedAnswer"')) return [{ id: "parsed-a" }];
      if (sql.includes('INSERT INTO "ImportQuarantine"')) return [];
      return [];
    });
    const adapter = new PostgresOpticalParseAdapter(new FakePool(client));

    await expect(adapter.save({
      tenantId: "tenant-a",
      result: createParseResult(),
    })).resolves.toEqual({ matchedSaved: 1, unmatchedSaved: 0 });
  });

  it("farklı tenant sonucu aynı kayıt işleminde reddeder", async () => {
    const client = new FakeClient(() => []);
    const adapter = new PostgresOpticalParseAdapter(new FakePool(client));
    const result = createParseResult();
    result.matched[0]!.tenantId = "tenant-b";

    await expect(adapter.save({ tenantId: "tenant-a", result })).rejects.toThrow("OPTICAL_PARSE_SAVE_TENANT_MISMATCH");
    expect(client.queries).toHaveLength(0);
  });
});

function createParseResult(): OpticalAnswerParseResult {
  return {
    matched: [{
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      participantId: "participant-a",
      parserConfigVersion: "parser-v1",
      rowNumber: 2,
      bookletType: "B",
      answers: [{ questionNo: 1, answer: "A" }],
      status: "MATCHED",
    }],
    unmatched: [{
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      rowNumber: 3,
      rawRow: {
        line: "99999\tA\tABCDE",
        studentNo: "99999",
        bookletType: "A",
        warnings: [],
      },
      reason: "STUDENT_NOT_FOUND",
    }],
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
