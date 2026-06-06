import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresAnswerKeyRepository } from "./postgres-answer-key-repository.js";

describe("PostgresAnswerKeyRepository", () => {
  it("cevap anahtarını tenant transaction içinde insert eder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresAnswerKeyRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('INSERT INTO "AnswerKey"')) {
          return { rows: [] as T[] };
        }
        return {
          rows: [createRow({
            id: values?.[0] as string,
            tenantId: values?.[1] as string,
            examId: values?.[2] as string,
            version: values?.[3] as string,
            keyData: JSON.parse(values?.[4] as string) as unknown,
            scoringConfig: JSON.parse(values?.[5] as string) as unknown,
          })] as T[],
        };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create(createInput()),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries).toHaveLength(1);
    expect(businessQueries[0]?.sql).toContain('INSERT INTO "AnswerKey"');
    expect(businessQueries[0]?.sql).toContain('ON CONFLICT ("tenantId", "examId", "version") DO NOTHING');
    expect(businessQueries[0]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "exam-a",
      "v1",
      JSON.stringify({ questions: createInput().questions }),
      JSON.stringify({ wrongPenalty: 0.333333 }),
    ]);
    expect(result).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "v1",
      questionCount: 2,
      branches: [
        { branch: "Matematik", questionCount: 1 },
        { branch: "Türkçe", questionCount: 1 },
      ],
      scoringConfig: { wrongPenalty: 0.333333 },
      status: "DRAFT",
    });
  });

  it("unique conflict durumunda domain hatası verir", async () => {
    const repository = new PostgresAnswerKeyRepository({
      async query<T>() {
        return { rows: [] as T[] };
      },
    });

    await expect(runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create(createInput()),
    )).rejects.toThrow("ANSWER_KEY_VERSION_CONFLICT");
  });

  it("aynı cevap anahtarı zaten varsa mevcut kaydı döndürür", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresAnswerKeyRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('INSERT INTO "AnswerKey"')) {
          return { rows: [] as T[] };
        }
        if (sql.includes('FROM "AnswerKey"')) {
          return { rows: [createRow()] as T[] };
        }
        if (sql.includes('FROM "ExamBookletVariant"')) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create(createInput()),
    );

    expect(queries.some((query) => query.sql.includes('FROM "AnswerKey"'))).toBe(true);
    expect(result).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "v1",
      questionCount: 2,
      status: "DRAFT",
    });
  });

  it("aynı version farklı cevap anahtarıyla gelirse conflict döner", async () => {
    const repository = new PostgresAnswerKeyRepository({
      async query<T>(sql: string) {
        if (sql.includes('FROM "AnswerKey"')) {
          return {
            rows: [createRow({
              keyData: { questions: [{ ...createInput().questions[0], correctAnswer: "B" }] },
            })] as T[],
          };
        }
        return { rows: [] as T[] };
      },
    });

    await expect(runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create(createInput()),
    )).rejects.toThrow("ANSWER_KEY_VERSION_CONFLICT");
  });

  it("aynı version farklı kitapçık permütasyonuyla gelirse conflict döner", async () => {
    const repository = new PostgresAnswerKeyRepository({
      async query<T>(sql: string) {
        if (sql.includes('FROM "AnswerKey"')) {
          return { rows: [createRow()] as T[] };
        }
        if (sql.includes('FROM "ExamBookletVariant"')) {
          return { rows: [{ code: "B", permutation: [1, 2] }] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await expect(runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create({
        ...createInput(),
        bookletVariants: [{ code: "B", permutation: [2, 1] }],
      }),
    )).rejects.toThrow("ANSWER_KEY_VERSION_CONFLICT");
  });

  it("cevap anahtarıyla birlikte kitapçık variant permütasyonunu upsert eder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresAnswerKeyRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('INSERT INTO "AnswerKey"')) {
          return { rows: [createRow()] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.create({
        ...createInput(),
        bookletVariants: [{ code: "B", permutation: [2, 1] }],
      }),
    );

    const variantInsert = queries.find((query) => query.sql.includes('INSERT INTO "ExamBookletVariant"'));
    expect(variantInsert?.sql).toContain('ON CONFLICT ("tenantId", "examId", "code")');
    expect(variantInsert?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "exam-a",
      "B",
      JSON.stringify([2, 1]),
    ]);
  });

  it("cevap anahtarını yayınlar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new PostgresAnswerKeyRepository({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('UPDATE "AnswerKey"')) {
          return { rows: [] as T[] };
        }
        return {
          rows: [createRow({
            tenantId: values?.[0] as string,
            examId: values?.[1] as string,
            version: values?.[2] as string,
            publishedAt: "2026-06-02T10:00:00.000Z",
          })] as T[],
        };
      },
    });

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => repository.publish("tenant-a", "exam-a", "v1"),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries[0]?.sql).toContain('UPDATE "AnswerKey"');
    expect(businessQueries[0]?.values).toEqual(["tenant-a", "exam-a", "v1"]);
    expect(result).toMatchObject({ status: "PUBLISHED", publishedAt: "2026-06-02T10:00:00.000Z" });
  });
});

function createInput() {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    version: "v1",
    questions: [
      { questionNo: 1, correctAnswer: "A" as const, branch: "Matematik" },
      { questionNo: 2, correctAnswer: "B" as const, branch: "Türkçe", outcomeCode: "SÖZCÜKTE ANLAM" },
    ],
    scoringConfig: { wrongPenalty: 0.333333 },
  };
}

function createRow(overrides: Partial<AnswerKeyTestRow> = {}): AnswerKeyTestRow {
  return {
    id: "answer-key-a",
    tenantId: "tenant-a",
    examId: "exam-a",
    version: "v1",
    keyData: { questions: createInput().questions },
    scoringConfig: createInput().scoringConfig,
    publishedAt: null,
    createdAt: "2026-06-02T09:00:00.000Z",
    updatedAt: "2026-06-02T09:00:00.000Z",
    ...overrides,
  };
}

interface AnswerKeyTestRow {
  id: string;
  tenantId: string;
  examId: string;
  version: string;
  keyData: unknown;
  scoringConfig: unknown;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
