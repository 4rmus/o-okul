import type pg from "pg";
import { describe, expect, it } from "vitest";
import { hashRefreshToken, PostgresSessionStore } from "./session-store.js";

describe("PostgresSessionStore", () => {
  it("refresh session ve tüketilmiş token kayıtları için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const now = new Date("2026-06-01T12:00:00.000Z");
    const currentSession = {
      id: "session-a",
      userId: "user-tenant-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      subjectType: null,
      subjectId: null,
      tokenFamilyId: "family-a",
      refreshTokenHash: hashRefreshToken("refresh-old"),
      status: "ACTIVE",
      membershipVersion: 1,
      expiresAt: new Date("2026-07-01T12:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
    };
    const client = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('INSERT INTO "AuthSession"')) {
          return {
            rows: [
              {
                ...currentSession,
                id: values?.[0],
                userId: values?.[1],
                tenantId: values?.[2],
                roles: values?.[3],
                subjectType: values?.[4],
                subjectId: values?.[5],
                tokenFamilyId: values?.[6],
                refreshTokenHash: values?.[7],
                membershipVersion: values?.[8],
                expiresAt: values?.[9],
              },
            ] as T[],
          };
        }
        if (sql.includes('SELECT * FROM "AuthSession" WHERE "refreshTokenHash"')) {
          return { rows: [currentSession] as T[] };
        }
        if (sql.includes('SELECT * FROM "AuthSession" WHERE "id"')) {
          return { rows: [currentSession] as T[] };
        }
        if (sql.includes('UPDATE "AuthSession"') && sql.includes('"refreshTokenHash" = $2')) {
          return {
            rows: [
              {
                ...currentSession,
                refreshTokenHash: values?.[1],
              },
            ] as T[],
          };
        }
        if (sql.includes('SELECT "tokenFamilyId" FROM "ConsumedRefreshToken"')) {
          return { rows: [{ tokenFamilyId: "family-a" }] as T[] };
        }
        if (sql.includes("RETURNING")) {
          return { rows: [{ id: "session-a" }] as T[] };
        }
        return { rows: [] as T[] };
      },
      release() {},
    };
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as pg.Pool;
    const store = new PostgresSessionStore(pool);

    await store.create({
      userId: "user-tenant-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      refreshToken: "refresh-new",
      membershipVersion: 1,
      expiresAt: new Date("2026-07-01T12:00:00.000Z"),
    });
    await store.findByRefreshToken("refresh-old");
    await store.updateRefreshToken("session-a", "refresh-next", new Date("2026-07-02T12:00:00.000Z"));
    await store.findConsumedTokenFamily("refresh-old");
    await store.revoke("session-a");
    await store.revokeByMembership("user-tenant-a", "tenant-a", 2);
    await store.revokeByUser("user-tenant-a");

    expect(queries.some((query) => query.sql.includes("set_config('app.bypass_rls'"))).toBe(true);
    const insertSession = queries.find((query) => query.sql.includes('INSERT INTO "AuthSession"'));
    expect(insertSession?.values).toEqual([
      expect.any(String),
      "user-tenant-a",
      "tenant-a",
      ["TENANT_ADMIN"],
      null,
      null,
      expect.any(String),
      hashRefreshToken("refresh-new"),
      1,
      new Date("2026-07-01T12:00:00.000Z"),
    ]);
    const insertConsumed = queries.find((query) => query.sql.includes('INSERT INTO "ConsumedRefreshToken"'));
    expect(insertConsumed?.values).toEqual([hashRefreshToken("refresh-old"), "family-a"]);
    const updateRefresh = queries.find((query) => query.sql.includes('"refreshTokenHash" = $2'));
    expect(updateRefresh?.values).toEqual([
      "session-a",
      hashRefreshToken("refresh-next"),
      new Date("2026-07-02T12:00:00.000Z"),
    ]);
    const revokeByMembership = queries.find((query) => query.sql.includes('"membershipVersion" < $3'));
    expect(revokeByMembership?.values).toEqual(["user-tenant-a", "tenant-a", 2]);
  });
});
