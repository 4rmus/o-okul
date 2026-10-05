import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthUserStore, addInMemoryAuthUserRole, resetInMemoryAuthUsers } from "../auth/auth-user-store.js";
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
      expiresAt: new Date(Date.now() + 60_000),
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
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
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
    // KV-3b: memberships that stay (e.g. staff beside a removed guardian role) follow the new user version.
    const userBump = queries.findIndex(({ sql }) => sql.includes('"membershipVersion" = "membershipVersion" + 1'));
    const versionSync = queries.findIndex(({ sql }) => sql.includes('SET "version" = u."membershipVersion"'));
    expect(versionSync).toBeGreaterThan(userBump);
    expect(queries[versionSync]?.sql).toContain(`m."status" = 'ACTIVE'`);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "AuthSession"'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "NotificationDeviceToken"'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "IdentityInvitation"'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "SecretDeliveryOutbox"') && sql.includes('"payloadEncrypted" = NULL'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "SecretDeliveryOutbox"') && sql.includes('"claimToken" = NULL'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("KV-3c K4: personel+veli kullanıcının öğretmen profili kapanınca yalnız öğretmen erişimi kesilir; GUARDIAN ve hesap kalır", async () => {
    addInMemoryAuthUserRole("tenant-a", "teacher-tenant-a", "GUARDIAN");
    const sessions = new InMemorySessionStore();
    const session = await sessions.create({
      userId: "teacher-tenant-a", tenantId: "tenant-a", roles: ["TEACHER"], subjectType: "TEACHER", subjectId: "teacher-a",
      refreshToken: "refresh-k4", membershipVersion: 2, expiresAt: new Date(Date.now() + 60_000),
    });
    const store = new InMemoryProfileLifecycleStore(
      new InMemoryStudentStore(), new InMemoryTeacherStore(), new InMemoryGuardianStore(),
      new InMemoryUserManagementStore(), sessions, new InMemoryIdentityInvitationStore(),
    );
    expect(await store.deactivate({ tenantId: "tenant-a", subjectType: "TEACHER", subjectId: "teacher-a", deletedAt: "2026-10-05T12:00:00.000Z" }))
      .toMatchObject({ userId: "teacher-tenant-a", roleRemoved: true, sessionsClosed: true });
    // The guardian role stays and the account keeps logging in; open sessions close (version bump).
    expect(await new InMemoryAuthUserStore().findById("teacher-tenant-a")).toMatchObject({ roles: ["GUARDIAN"], membershipVersion: 3 });
    expect(await sessions.findById(session.id)).toMatchObject({ status: "REVOKED" });
  });

  it("KV-3c K4 PostgreSQL: öğretmen profili kapatma hesabı DISABLED yapmaz ve GUARDIAN üyeliğine yalnız ortak sürümü verir", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = transactionPool(async <T>(sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
      if (sql.includes('SELECT "userId"')) return { rows: [{ userId: "staff-parent" }] as T[] };
      return { rows: [] as T[], rowCount: 0 };
    });
    await new PostgresProfileLifecycleStore(pool).deactivate({
      tenantId: "tenant-a", subjectType: "TEACHER", subjectId: "teacher-a", deletedAt: "2026-10-05T12:00:00.000Z",
    });
    const sqls = queries.map(({ sql }) => sql);
    // Rule B (KV-3c): the staff/teacher side stops, the account status is never written here (staff-only users too).
    expect(sqls.some((sql) => sql.includes('"accountStatus"'))).toBe(false);
    expect(sqls.filter((sql) => sql.includes('DELETE FROM "TenantMembership"'))).toEqual([expect.stringContaining("\"role\" = 'TEACHER'")]);
    expect(sqls.some((sql) => sql.includes("GUARDIAN") || sql.includes("'ENDED'"))).toBe(false);
    expect(sqls.some((sql) => sql.includes('SET "version" = u."membershipVersion"') && sql.includes(`m."status" = 'ACTIVE'`))).toBe(true);
    expect(sqls.some((sql) => sql.includes('UPDATE "AuthSession"'))).toBe(true);
  });

  it("lifecycle adımlarından biri hata verirse PostgreSQL transaction'ını rollback eder", async () => {
    const queries: string[] = [];
    const pool = transactionPool(async <T>(sql: string) => {
      queries.push(sql);
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
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
