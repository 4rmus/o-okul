import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthUserStore, resetInMemoryAuthUsers } from "../auth/auth-user-store.js";
import { InMemorySessionStore } from "../auth/session-store.js";
import { InMemoryIdentityInvitationStore } from "../identity-invitation/identity-invitation-store.js";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryTeacherStore } from "../school/teacher-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryUserManagementStore } from "../user-management/user-management-store.js";
import { InMemoryProfileLifecycleStore, PostgresProfileLifecycleStore } from "./profile-lifecycle-store.js";

describe("ProfileLifecycleStore", () => {
  beforeEach(() => resetInMemoryAuthUsers());

  it("in-memory profili, rolü, session'ı ve bekleyen daveti birlikte kapatır", async () => {
    const teachers = new InMemoryTeacherStore();
    const users = new InMemoryUserManagementStore();
    const sessions = new InMemorySessionStore();
    const invitations = new InMemoryIdentityInvitationStore();
    const session = await sessions.create({
      userId: "teacher-tenant-a",
      tenantId: "tenant-a",
      roles: ["TEACHER"],
      subjectType: "TEACHER",
      subjectId: "teacher-a",
      refreshToken: "refresh-token",
      membershipVersion: 1,
      expiresAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    await invitations.create({
      tenantId: "tenant-a",
      subjectType: "TEACHER",
      subjectId: "teacher-a",
      email: "teacher@example.test",
      name: "Teacher A",
      role: "TEACHER",
      tokenHash: "token-hash",
      expiresAt: "2026-08-02T00:00:00.000Z",
      delivery: {
        tenantId: "tenant-a",
        purpose: "IDENTITY_INVITATION",
        payloadEncrypted: "encrypted",
        expiresAt: "2026-08-02T00:00:00.000Z",
      },
    });
    const store = new InMemoryProfileLifecycleStore(
      new InMemoryStudentStore(),
      teachers,
      new InMemoryGuardianStore(),
      users,
      sessions,
      invitations,
    );

    const result = await store.deactivate({
      tenantId: "tenant-a",
      subjectType: "TEACHER",
      subjectId: "teacher-a",
      deletedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      userId: "teacher-tenant-a",
      roleRemoved: true,
      sessionsClosed: true,
      invitationsRevoked: 1,
    });
    expect(await teachers.findById("teacher-a")).toBeUndefined();
    expect(await users.findTenantUser("tenant-a", "teacher-tenant-a")).toBeUndefined();
    expect(await new InMemoryAuthUserStore().findById("teacher-tenant-a")).toMatchObject({ roles: [], membershipVersion: 2 });
    expect(await sessions.findById(session.id)).toMatchObject({ status: "REVOKED" });
    expect(await invitations.list("tenant-a")).toEqual([
      expect.objectContaining({ subjectId: "teacher-a", status: "REVOKED" }),
    ]);
  });

  it("PostgreSQL'de profil, rol, session, cihaz ve davet outbox kapanışını tek transaction'da yapar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = transactionPool(async <T>(sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes('SELECT "userId"')) return { rows: [{ userId: "teacher-user" }] as T[] };
      if (sql.includes('UPDATE "IdentityInvitation"')) return { rows: [{ id: "invite-a" }] as T[] };
      if (sql.includes('UPDATE "TenantMembership"')) return { rows: [{ id: "membership-staff" }] as T[], rowCount: 1 };
      if (sql.includes('DELETE FROM "TenantMembership"')) return { rows: [{ id: "membership-teacher" }] as T[], rowCount: 1 };
      if (sql.includes('UPDATE "AuthSession"')) return { rows: [] as T[], rowCount: 2 };
      return { rows: [] as T[], rowCount: 1 };
    });

    const result = await new PostgresProfileLifecycleStore(pool).deactivate({
      tenantId: "tenant-a",
      subjectType: "TEACHER",
      subjectId: "teacher-a",
      deletedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(result).toEqual({
      userId: "teacher-user",
      roleRemoved: true,
      sessionsClosed: true,
      invitationsRevoked: 1,
    });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some(({ sql }) => sql.includes('UPDATE "Teacher"') && sql.includes('"userId" = NULL'))).toBe(true);
    expect(queries.some(({ sql }) => (
      sql.includes('UPDATE "TenantMembership"') &&
      sql.includes('"hasTeacherPersona" = false') &&
      sql.includes('"version" = "version" + 1')
    ))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('DELETE FROM "TenantMembership"') && sql.includes("\"role\" = 'TEACHER'"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('"membershipVersion" = "membershipVersion" + 1'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "AuthSession"'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "NotificationDeviceToken"'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "IdentityInvitation"'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "SecretDeliveryOutbox"') && sql.includes('"payloadEncrypted" = NULL'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "SecretDeliveryOutbox"') && sql.includes('"claimToken" = NULL'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("lifecycle adımlarından biri hata verirse PostgreSQL transaction'ını rollback eder", async () => {
    const queries: string[] = [];
    const pool = transactionPool(async <T>(sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT "userId"')) return { rows: [{ userId: "student-user" }] as T[] };
      if (sql.includes('UPDATE "IdentityInvitation"')) return { rows: [] as T[] };
      if (sql.includes('UPDATE "AuthSession"')) throw new Error("SESSION_REVOKE_FAILED");
      return { rows: [] as T[], rowCount: 1 };
    });

    await expect(new PostgresProfileLifecycleStore(pool).deactivate({
      tenantId: "tenant-a",
      subjectType: "STUDENT",
      subjectId: "student-a",
      deletedAt: "2026-08-01T12:00:00.000Z",
    })).rejects.toThrow("SESSION_REVOKE_FAILED");

    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });
});

function transactionPool(
  query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>,
) {
  return {
    async connect() {
      return { query, release() {} };
    },
    query,
  };
}
