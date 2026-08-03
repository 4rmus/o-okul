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
      deviceLabel: "Chrome · Windows",
      clientIpPrefix: "203.0.113.0/24",
      lastSeenAt: now,
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
                membershipId: values?.[3],
                activePersona: values?.[4],
                roles: values?.[5],
                subjectType: values?.[6],
                subjectId: values?.[7],
                deviceLabel: values?.[8],
                clientIpPrefix: values?.[9],
                tokenFamilyId: values?.[10],
                refreshTokenHash: values?.[11],
                membershipVersion: values?.[12],
                expiresAt: values?.[13],
              },
            ] as T[],
          };
        }
        if (sql.includes('SELECT * FROM "AuthSession" WHERE "refreshTokenHash"')) {
          return { rows: [currentSession] as T[] };
        }
        if (sql.includes('WITH rotated AS')) {
          return {
            rows: [
              {
                ...currentSession,
                refreshTokenHash: values?.[2],
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
    await store.listActiveByUser("user-tenant-a", "tenant-a");
    await store.updateRefreshToken("session-a", "refresh-old", "refresh-next", new Date("2026-07-02T12:00:00.000Z"));
    await store.findConsumedTokenFamily("refresh-old");
    await store.revoke("session-a");
    await store.revokeOwned("session-a", "user-tenant-a", "tenant-a");
    await store.revokeAllOwned("user-tenant-a", "tenant-a");
    await store.revokeByMembership("user-tenant-a", "tenant-a", 2);
    await store.revokeByUser("user-tenant-a");

    expect(queries.some((query) => query.sql.includes("set_config('app.bypass_rls'"))).toBe(true);
    const insertSession = queries.find((query) => query.sql.includes('INSERT INTO "AuthSession"'));
    expect(insertSession?.values).toEqual([
      expect.any(String),
      "user-tenant-a",
      "tenant-a",
      null,
      null,
      ["TENANT_ADMIN"],
      null,
      null,
      null,
      null,
      expect.any(String),
      hashRefreshToken("refresh-new"),
      1,
      new Date("2026-07-01T12:00:00.000Z"),
    ]);
    const updateRefresh = queries.find((query) => query.sql.includes("WITH rotated AS"));
    expect(updateRefresh?.sql).toContain('AND "refreshTokenHash" = $2');
    expect(updateRefresh?.sql).toContain("AND \"status\" = 'ACTIVE'");
    expect(updateRefresh?.sql).toContain('INSERT INTO "ConsumedRefreshToken"');
    expect(updateRefresh?.values).toEqual([
      "session-a",
      hashRefreshToken("refresh-old"),
      hashRefreshToken("refresh-next"),
      new Date("2026-07-02T12:00:00.000Z"),
    ]);
    const revokeByMembership = queries.find((query) => query.sql.includes('"membershipVersion" < $3'));
    expect(revokeByMembership?.values).toEqual(["user-tenant-a", "tenant-a", 2]);
    const ownedQueries = queries.filter((query) => query.sql.includes('"userId" = $1') && query.sql.includes('"tenantId" = $2'));
    expect(ownedQueries.length).toBeGreaterThanOrEqual(2);
    expect(queries.some((query) => query.values?.join(":") === "session-a:user-tenant-a:tenant-a")).toBe(true);
  });
});
