import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@uzman-hocam/db";
import { PostgresOpticalParseInputAdapter } from "./postgres-optical-parse-input-adapter.js";

describe("PostgresOpticalParseInputAdapter", () => {
  it("RawImport, APPROVED ParserConfig ve katılımcıları tenant transaction içinde yükler", async () => {
    const fieldMapping = {
      studentNo: { kind: "delimited", column: 0 },
      bookletType: { kind: "delimited", column: 1 },
      answers: { kind: "delimited", column: 2, estimatedQuestionCount: 5 },
    };
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "RawImport"')) {
        return [{
          tenantId: "tenant-a",
          examId: "exam-a",
          rawImportId: "raw-import-a",
          parserConfigVersion: "parser-v1",
          s3Key: "raw/import/a.dat",
          fileName: "a.dat",
          delimiter: "TAB",
          skipHeaderLines: 1,
          fieldMapping,
        }];
      }
      if (sql.includes('FROM "ExamParticipant"')) {
        return [{
          participantId: "participant-a",
          studentNo: "12345",
          participantNo: "P-12345",
          bookletType: "A",
        }];
      }
      return [];
    });
    const adapter = new PostgresOpticalParseInputAdapter(new FakePool(client));

    const result = await adapter.load({ tenantId: "tenant-a", rawImportId: "raw-import-a" });

    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      parserConfigVersion: "parser-v1",
      s3Key: "raw/import/a.dat",
      fileName: "a.dat",
      parserConfig: {
        delimiter: "TAB",
        skipHeaderLines: 1,
        fieldMapping,
      },
      participants: [{
        participantId: "participant-a",
        studentNo: "12345",
        participantNo: "P-12345",
        bookletType: "A",
      }],
    });
    expect(client.queries[0]?.sql).toBe("BEGIN");
    const rawImportQuery = client.queries.find((query) => query.sql.includes('FROM "RawImport"'));
    expect(rawImportQuery?.sql).toContain('pc."status" = \'APPROVED\'');
    expect(rawImportQuery?.sql).toContain('pc."version" = ri."parserConfigVersion"');
    expect(rawImportQuery?.values).toEqual(["tenant-a", "raw-import-a"]);
    const participantQuery = client.queries.find((query) => query.sql.includes('FROM "ExamParticipant"'));
    expect(participantQuery?.sql).toContain('INNER JOIN "Student" s');
    expect(participantQuery?.sql).toContain('ep."status" IN (\'REGISTERED\', \'ATTENDED\')');
    expect(participantQuery?.values).toEqual(["tenant-a", "exam-a"]);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("RawImport veya onaylı ParserConfig bulunamazsa net hata verir", async () => {
    const adapter = new PostgresOpticalParseInputAdapter(new FakePool(new FakeClient(() => [])));

    await expect(adapter.load({ tenantId: "tenant-a", rawImportId: "raw-import-a" })).rejects.toThrow("OPTICAL_PARSE_INPUT_NOT_FOUND");
  });

  it("ParserConfig fieldMapping şekli hatalıysa reddeder", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "RawImport"')) {
        return [{
          tenantId: "tenant-a",
          examId: "exam-a",
          rawImportId: "raw-import-a",
          parserConfigVersion: "parser-v1",
          s3Key: "raw/import/a.dat",
          fileName: "a.dat",
          delimiter: "TAB",
          skipHeaderLines: 1,
          fieldMapping: { studentNo: { kind: "delimited", column: 0 } },
        }];
      }
      return [];
    });
    const adapter = new PostgresOpticalParseInputAdapter(new FakePool(client));

    await expect(adapter.load({ tenantId: "tenant-a", rawImportId: "raw-import-a" })).rejects.toThrow("OPTICAL_PARSE_INPUT_INVALID");
  });

  it("ParserConfig answer count pozitif değilse reddeder", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "RawImport"')) {
        return [{
          tenantId: "tenant-a",
          examId: "exam-a",
          rawImportId: "raw-import-a",
          parserConfigVersion: "parser-v1",
          s3Key: "raw/import/a.dat",
          fileName: "a.dat",
          delimiter: "TAB",
          skipHeaderLines: 1,
          fieldMapping: {
            studentNo: { kind: "delimited", column: 0 },
            bookletType: { kind: "delimited", column: 1 },
            answers: { kind: "delimited", column: 2, estimatedQuestionCount: 0 },
          },
        }];
      }
      return [];
    });
    const adapter = new PostgresOpticalParseInputAdapter(new FakePool(client));

    await expect(adapter.load({ tenantId: "tenant-a", rawImportId: "raw-import-a" })).rejects.toThrow("OPTICAL_PARSE_INPUT_INVALID");
  });
});

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
