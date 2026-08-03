import pg from "pg";
import type { PortalSubjectRoleName } from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery } from "../db/tenant-query.js";
import type { IdentityInvitationStore } from "../identity-invitation/identity-invitation-store.js";
import type { GuardianStore } from "../school/guardian-store.js";
import type { TeacherStore } from "../school/teacher-store.js";
import type { StudentStore } from "../student/student-store.js";
import type { SessionStore } from "../auth/session-store.js";
import type { UserManagementStore } from "../user-management/user-management-store.js";

export interface DeactivateProfileInput {
  tenantId: string;
  subjectType: PortalSubjectRoleName;
  subjectId: string;
  deletedAt: string;
}

export interface DeactivateProfileResult {
  userId?: string;
  roleRemoved: boolean;
  sessionsClosed: boolean;
  invitationsRevoked: number;
}

export interface ProfileLifecycleStore {
  deactivate(input: DeactivateProfileInput): Promise<DeactivateProfileResult | undefined>;
}

export const profileLifecycleStoreToken = Symbol("ProfileLifecycleStore");

export class InMemoryProfileLifecycleStore implements ProfileLifecycleStore {
  constructor(
    private readonly students: StudentStore,
    private readonly teachers: TeacherStore,
    private readonly guardians: GuardianStore,
    private readonly users: UserManagementStore,
    private readonly sessions: SessionStore,
    private readonly invitations: IdentityInvitationStore,
  ) {}

  async deactivate(input: DeactivateProfileInput): Promise<DeactivateProfileResult | undefined> {
    const profile = await this.findProfile(input);
    if (!profile) return undefined;
    const userId = profile.userId;

    const deleted = await this.softDeleteProfile(input);
    if (!deleted) return undefined;

    const invitationsRevoked = await this.invitations.revokePendingForSubject(
      input.tenantId,
      input.subjectType,
      input.subjectId,
    );
    if (!userId) {
      return { roleRemoved: false, sessionsClosed: true, invitationsRevoked };
    }

    const tenantUser = await this.users.findTenantUser(input.tenantId, userId);
    const roleRemoved = tenantUser?.roles.includes(input.subjectType) ?? false;
    await this.users.removeTenantRole(input.tenantId, userId, input.subjectType);
    await this.sessions.revokeByUser(userId);
    return {
      userId,
      roleRemoved,
      sessionsClosed: true,
      invitationsRevoked,
    };
  }

  private findProfile(input: DeactivateProfileInput) {
    if (input.subjectType === "STUDENT") return this.students.findById(input.subjectId);
    if (input.subjectType === "TEACHER") return this.teachers.findById(input.subjectId);
    return this.guardians.findById(input.subjectId);
  }

  private softDeleteProfile(input: DeactivateProfileInput) {
    if (input.subjectType === "STUDENT") return this.students.softDelete(input.subjectId, input.deletedAt);
    if (input.subjectType === "TEACHER") return this.teachers.softDelete(input.subjectId, input.deletedAt);
    return this.guardians.softDelete(input.subjectId, input.deletedAt);
  }
}

export class PostgresProfileLifecycleStore implements ProfileLifecycleStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async deactivate(input: DeactivateProfileInput): Promise<DeactivateProfileResult | undefined> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      const table = profileTable(input.subjectType);
      const profile = await client.query<{ userId: string | null }>(
        `SELECT "userId"
         FROM "${table}"
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         FOR UPDATE`,
        [input.tenantId, input.subjectId],
      );
      const row = profile.rows[0];
      if (!row) return undefined;

      await client.query(
        `UPDATE "${table}"
         SET "deletedAt" = $3,
             "userId" = NULL,
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL`,
        [input.tenantId, input.subjectId, input.deletedAt],
      );

      const invitationsRevoked = await revokeInvitations(client, input);
      if (!row.userId) {
        return { roleRemoved: false, sessionsClosed: true, invitationsRevoked };
      }

      let rolesRemoved = 0;
      if (input.subjectType === "TEACHER") {
        const canonical = await client.query<{ id: string }>(
          `UPDATE "TenantMembership"
           SET "hasTeacherPersona" = false,
               "version" = "version" + 1,
               "updatedAt" = now()
           WHERE "tenantId" = $1
             AND "userId" = $2
             AND "hasTeacherPersona" = true
           RETURNING "id"`,
          [input.tenantId, row.userId],
        );
        const legacy = await client.query<{ id: string }>(
          `DELETE FROM "TenantMembership"
           WHERE "tenantId" = $1 AND "userId" = $2 AND "role" = 'TEACHER'
           RETURNING "id"`,
          [input.tenantId, row.userId],
        );
        rolesRemoved = canonical.rows.length + legacy.rows.length;
      } else {
        const membership = await client.query<{ id: string }>(
          `DELETE FROM "TenantMembership"
           WHERE "tenantId" = $1 AND "userId" = $2 AND "role" = $3
           RETURNING "id"`,
          [input.tenantId, row.userId, input.subjectType],
        );
        rolesRemoved = membership.rows.length;
      }
      await client.query(
        `UPDATE "User"
         SET "membershipVersion" = "membershipVersion" + 1,
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2`,
        [input.tenantId, row.userId],
      );
      await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "userId" = $2 AND "status" = 'ACTIVE'`,
        [input.tenantId, row.userId],
      );
      await client.query(
        `UPDATE "NotificationDeviceToken"
         SET "disabledAt" = COALESCE("disabledAt", now()),
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "userId" = $2
           AND "subjectType" = $3
           AND "subjectId" = $4
           AND "disabledAt" IS NULL`,
        [input.tenantId, row.userId, input.subjectType, input.subjectId],
      );

      return {
        userId: row.userId,
        roleRemoved: rolesRemoved > 0,
        sessionsClosed: true,
        invitationsRevoked,
      };
    });
  }
}

async function revokeInvitations(client: Queryable, input: DeactivateProfileInput): Promise<number> {
  const revoked = await client.query<{ id: string }>(
    `UPDATE "IdentityInvitation"
     SET "status" = 'REVOKED',
         "updatedAt" = now()
     WHERE "tenantId" = $1
       AND "subjectType" = $2
       AND "subjectId" = $3
       AND "status" = 'PENDING'
     RETURNING "id"`,
    [input.tenantId, input.subjectType, input.subjectId],
  );
  if (revoked.rows.length > 0) {
    await client.query(
      `UPDATE "SecretDeliveryOutbox"
       SET "status" = 'EXPIRED',
           "payloadEncrypted" = NULL,
           "claimedAt" = NULL,
           "claimToken" = NULL,
           "lastErrorCode" = NULL,
           "updatedAt" = now()
       WHERE "purpose" = 'IDENTITY_INVITATION'
         AND "sourceId" = ANY($1::text[])
         AND "payloadEncrypted" IS NOT NULL`,
      [revoked.rows.map((invitation) => invitation.id)],
    );
  }
  return revoked.rows.length;
}

function profileTable(subjectType: PortalSubjectRoleName): "Student" | "Teacher" | "Guardian" {
  if (subjectType === "STUDENT") return "Student";
  if (subjectType === "TEACHER") return "Teacher";
  return "Guardian";
}

export function createProfileLifecycleStore(
  students: StudentStore,
  teachers: TeacherStore,
  guardians: GuardianStore,
  users: UserManagementStore,
  sessions: SessionStore,
  invitations: IdentityInvitationStore,
): ProfileLifecycleStore {
  return resolvePersistenceDriver(process.env.PROFILE_LIFECYCLE_STORE ?? process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresProfileLifecycleStore()
    : new InMemoryProfileLifecycleStore(students, teachers, guardians, users, sessions, invitations);
}
