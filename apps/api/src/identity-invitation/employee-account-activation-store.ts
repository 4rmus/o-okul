import { randomUUID } from "node:crypto";
import type { EmployeeInvitationRole } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withBypassRlsQuery, withExplicitTenantQuery } from "../db/tenant-query.js";
import type { TeacherStore } from "../school/teacher-store.js";
import type { TenantStore } from "../tenant/tenant-store.js";
import type { UserManagementStore } from "../user-management/user-management-store.js";
import type { IdentityInvitationRecord, IdentityInvitationStore } from "./identity-invitation-store.js";

export type EmployeeAccountActivationOutcome =
  | { status: "ACCEPTED"; invitation: IdentityInvitationRecord }
  | {
      status:
        | "INVALID"
        | "EXPIRED"
        | "NOT_PENDING"
        | "REVOKED"
        | "PROFILE_NOT_ACTIVE"
        | "ALREADY_LINKED"
        | "EMAIL_ACCOUNT_ALREADY_BOUND"
        | "EMAIL_ACCOUNT_INCOMPATIBLE"
        | "LICENSE_INACTIVE"
        | "ACCOUNT_LIMIT_EXCEEDED";
    };

/** Why an e-mail address cannot become the account of a given Employee (same rules at invitation and activation). */
export type EmployeeInvitationEmailConflict = "EMAIL_ACCOUNT_ALREADY_BOUND" | "EMAIL_ACCOUNT_INCOMPATIBLE";

export interface EmployeeAccountActivationStore {
  accept(input: {
    tokenHash: string;
    passwordHash: string;
    name?: string;
    acceptedAt: string;
  }): Promise<EmployeeAccountActivationOutcome>;
  /**
   * UAT F-20: the activation-time e-mail checks, run before an invitation is created or resent so the admin hears
   * about a conflict instead of the invitee. Activation repeats them under row locks (race safety).
   */
  findInvitationEmailConflict(input: {
    tenantId: string;
    employeeId: string;
    email: string;
  }): Promise<EmployeeInvitationEmailConflict | undefined>;
}

export const employeeAccountActivationStoreToken = Symbol("EmployeeAccountActivationStore");

export class InMemoryEmployeeAccountActivationStore implements EmployeeAccountActivationStore {
  constructor(
    private readonly users: UserManagementStore,
    private readonly tenants: TenantStore,
    private readonly invitations: IdentityInvitationStore,
    private readonly teachers?: TeacherStore,
    private readonly employeeAccountLimit = defaultEmployeeAccountLimit,
  ) {}

  async findInvitationEmailConflict(input: {
    tenantId: string;
    employeeId: string;
    email: string;
  }): Promise<EmployeeInvitationEmailConflict | undefined> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingUser = (await this.users.listTenantUsers(input.tenantId))
      .find((user) => user.email?.toLowerCase() === normalizedEmail);
    return existingUser ? this.emailConflictFor(input.tenantId, input.employeeId, existingUser) : undefined;
  }

  private async emailConflictFor(
    tenantId: string,
    employeeId: string,
    user: { id: string; roles: readonly string[] },
  ): Promise<EmployeeInvitationEmailConflict | undefined> {
    for (const candidate of await this.users.listEmployees(tenantId)) {
      if (candidate.id === employeeId) continue;
      // UAT F-20: an Employee whose linked teacher holds the account counts as bound too (as in PostgreSQL).
      const linkedUserId = candidate.userId ?? (await this.teachers?.findByEmployeeId(tenantId, candidate.id))?.userId;
      if (linkedUserId === user.id) return "EMAIL_ACCOUNT_ALREADY_BOUND";
    }
    if (user.roles.includes("STUDENT") || user.roles.includes("GUARDIAN")) return "EMAIL_ACCOUNT_INCOMPATIBLE";
    return undefined;
  }

  async accept(input: {
    tokenHash: string;
    passwordHash: string;
    name?: string;
    acceptedAt: string;
  }): Promise<EmployeeAccountActivationOutcome> {
    const invitation = await this.invitations.findByTokenHash(input.tokenHash);
    if (!isEmployeeEmailInvitation(invitation)) return { status: "INVALID" };
    if (invitation.status !== "PENDING") return { status: invitation.status === "REVOKED" ? "REVOKED" : "NOT_PENDING" };
    if (Date.parse(invitation.expiresAt) <= Date.parse(input.acceptedAt)) return { status: "EXPIRED" };
    const employee = await this.users.findEmployee(invitation.tenantId, invitation.subjectId);
    if (!employee || employee.status !== "ACTIVE") return { status: "PROFILE_NOT_ACTIVE" };
    if (employee.userId) return { status: "ALREADY_LINKED" };

    const tenantUsers = await this.users.listTenantUsers(invitation.tenantId);
    const existingUser = tenantUsers.find((user) => user.email?.toLowerCase() === invitation.email);
    if (existingUser) {
      const conflict = await this.emailConflictFor(invitation.tenantId, employee.id, existingUser);
      if (conflict) return { status: conflict };
    } else {
      const tenant = await this.tenants.findById(invitation.tenantId);
      if (!tenant) return { status: "LICENSE_INACTIVE" };
      const activeEmployeeAccounts = (await this.users.listEmployees(invitation.tenantId)).filter((candidate) => (
        candidate.status === "ACTIVE" && Boolean(candidate.userId)
      )).length;
      if (activeEmployeeAccounts >= this.employeeAccountLimit) return { status: "ACCOUNT_LIMIT_EXCEEDED" };
    }

    const roles = existingUser?.roles.includes("TEACHER")
      ? [invitation.role, "TEACHER" as const]
      : [invitation.role];
    const user = await this.users.createOrAttachTenantUser({
      tenantId: invitation.tenantId,
      email: invitation.email,
      name: input.name ?? invitation.name,
      passwordHash: input.passwordHash,
      roles,
    });
    const bound = await this.users.bindEmployeeUser(invitation.tenantId, invitation.subjectId, user.id);
    if (!bound) {
      await this.users.removeTenantRole(invitation.tenantId, user.id, invitation.role);
      return { status: "PROFILE_NOT_ACTIVE" };
    }
    const accepted = await this.invitations.markAccepted(invitation.id, user.id, input.acceptedAt);
    if (!accepted) {
      await this.users.removeTenantRole(invitation.tenantId, user.id, invitation.role);
      return { status: "NOT_PENDING" };
    }
    return { status: "ACCEPTED", invitation: accepted };
  }
}

export class PostgresEmployeeAccountActivationStore implements EmployeeAccountActivationStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL }),
    private readonly employeeAccountLimit = defaultEmployeeAccountLimit,
  ) {}

  // Read in the caller's tenant (RLS on), not with the activation's RLS bypass: the admin's request carries its tenant.
  async findInvitationEmailConflict(input: {
    tenantId: string;
    employeeId: string;
    email: string;
  }): Promise<EmployeeInvitationEmailConflict | undefined> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => (
      (await resolveEmployeeEmailAccount(client, input.tenantId, input.employeeId, input.email.trim().toLowerCase())).conflict
    ));
  }

  async accept(input: {
    tokenHash: string;
    passwordHash: string;
    name?: string;
    acceptedAt: string;
  }): Promise<EmployeeAccountActivationOutcome> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const invitationResult = await client.query<EmployeeInvitationRow>(
        `SELECT *
         FROM "IdentityInvitation"
         WHERE "tokenHash" = $1
         LIMIT 1
         FOR UPDATE`,
        [input.tokenHash],
      );
      const invitation = invitationResult.rows[0];
      if (!isEmployeeEmailInvitationRow(invitation)) return { status: "INVALID" };
      if (invitation.status !== "PENDING") return { status: invitation.status === "REVOKED" ? "REVOKED" : "NOT_PENDING" };
      if (invitation.expiresAt.getTime() <= Date.parse(input.acceptedAt)) {
        await revokeInvitation(client, invitation.id);
        await clearInvitationDelivery(client, invitation.id);
        return { status: "EXPIRED" };
      }

      const currentTenant = await client.query<{ id: string }>(
        `SELECT tenant."id"
         FROM "Tenant" tenant
         JOIN "LicenseTerm" license ON license."tenantId" = tenant."id"
           AND license."cancelledAt" IS NULL
           AND license."planCode" = tenant."plan"
           AND license."startsAt" = tenant."licenseStartsAt"
           AND license."endsAt" = tenant."licenseEndsAt"
           AND license."activeStudentLimit" = tenant."seatLimit"
         WHERE tenant."id" = $1
           AND tenant."status" = 'ACTIVE'
           AND license."startsAt" <= $2
           AND $2 < license."endsAt"
         FOR NO KEY UPDATE OF tenant, license`,
        [invitation.tenantId, input.acceptedAt],
      );
      if (!currentTenant.rows[0]) return { status: "LICENSE_INACTIVE" };

      const employeeResult = await client.query<EmployeeActivationProfileRow>(
        // UAT F-13: an Employee whose linked teacher already has an account counts as linked, so a pending
        // invitation cannot create a second account for the same person.
        `SELECT e."id", e."status", coalesce(e."userId", t."userId") AS "userId"
         FROM "Employee" e
         LEFT JOIN "Teacher" t
           ON t."tenantId" = e."tenantId" AND t."employeeId" = e."id" AND t."deletedAt" IS NULL
         WHERE e."tenantId" = $1 AND e."id" = $2 AND e."deletedAt" IS NULL
         LIMIT 1
         FOR UPDATE OF e`,
        [invitation.tenantId, invitation.subjectId],
      );
      const employee = employeeResult.rows[0];
      if (!employee || employee.status !== "ACTIVE") {
        await revokeInvitation(client, invitation.id);
        await clearInvitationDelivery(client, invitation.id);
        return { status: "PROFILE_NOT_ACTIVE" };
      }
      if (employee.userId) {
        await revokeInvitation(client, invitation.id);
        await clearInvitationDelivery(client, invitation.id);
        return { status: "ALREADY_LINKED" };
      }

      const normalizedEmail = invitation.email.trim().toLowerCase();
      const emailAccount = await resolveEmployeeEmailAccount(client, invitation.tenantId, invitation.subjectId, normalizedEmail);
      if (emailAccount.conflict) return { status: emailAccount.conflict };
      let userId = emailAccount.userId;
      let memberships = emailAccount.memberships;

      if (memberships.length === 0
        && !(await hasEmployeeAccountCapacity(client, invitation.tenantId, this.employeeAccountLimit))) {
        return { status: "ACCOUNT_LIMIT_EXCEEDED" };
      }

      if (!userId) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO "User" (
             "id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized",
             "name", "passwordHash", "passwordHashVersion", "accountStatus", "membershipVersion",
             "mustChangePassword", "passwordChangedAt", "updatedAt"
           ) VALUES ($1, $2, $3, $3, $3, $3, $4, $5, 2, 'ACTIVE', 1, false, $6, now())
           ON CONFLICT ("tenantId", "emailNormalized") DO NOTHING
           RETURNING "id"`,
          [randomUUID(), invitation.tenantId, normalizedEmail, input.name ?? invitation.name, input.passwordHash, input.acceptedAt],
        );
        userId = created.rows[0]?.id ?? await findUserIdByEmail(client, invitation.tenantId, normalizedEmail);
        if (!userId) throw new Error("EMPLOYEE_ACTIVATION_USER_CREATE_FAILED");
        memberships = await findMemberships(client, invitation.tenantId, userId);
        if (await isUserBoundToOtherEmployee(client, invitation.tenantId, invitation.subjectId, userId)) {
          if (created.rows[0]) throw new Error("EMPLOYEE_ACTIVATION_CONCURRENT_EMAIL_ACCOUNT_BOUND");
          return { status: "EMAIL_ACCOUNT_ALREADY_BOUND" };
        }
        if (hasIncompatiblePersona(memberships)) {
          if (created.rows[0]) throw new Error("EMPLOYEE_ACTIVATION_CONCURRENT_EMAIL_ACCOUNT_INCOMPATIBLE");
          return { status: "EMAIL_ACCOUNT_INCOMPATIBLE" };
        }
      }

      const membershipVersion = memberships.length > 0
        ? Math.max(...memberships.map((membership) => membership.version)) + 1
        : 1;
      const membershipScope = resolveMembershipScope(memberships);
      const hasTeacherPersona = memberships.some((membership) => (
        membership.hasTeacherPersona || membership.role === "TEACHER"
      ));
      await client.query(
        `DELETE FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2`,
        [invitation.tenantId, userId],
      );
      const canonicalMembershipId = await insertMembership(
        client,
        invitation.tenantId,
        userId,
        invitation.role,
        invitation.role,
        hasTeacherPersona,
        membershipVersion,
        membershipScope.scopeMode,
      );
      await insertMembershipCampusScopes(client, invitation.tenantId, canonicalMembershipId, membershipScope.campusIds);
      if (hasTeacherPersona) {
        const teacherMembershipId = await insertMembership(
          client,
          invitation.tenantId,
          userId,
          "TEACHER",
          null,
          false,
          membershipVersion,
          membershipScope.scopeMode,
        );
        await insertMembershipCampusScopes(client, invitation.tenantId, teacherMembershipId, membershipScope.campusIds);
      }
      if (memberships.length > 0) {
        await client.query(
          `UPDATE "User"
           SET "membershipVersion" = "membershipVersion" + 1,
               "emailNormalized" = $3,
               "loginName" = coalesce("loginName", $3),
               "loginNameNormalized" = coalesce("loginNameNormalized", $3),
               "updatedAt" = now()
           WHERE "tenantId" = $1 AND "id" = $2`,
          [invitation.tenantId, userId, normalizedEmail],
        );
      }

      const bound = await client.query<{ id: string }>(
        `UPDATE "Employee"
         SET "userId" = $3, "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2 AND "userId" IS NULL
           AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
         RETURNING "id"`,
        [invitation.tenantId, invitation.subjectId, userId],
      );
      if (!bound.rows[0]) throw new Error("EMPLOYEE_ACTIVATION_BIND_FAILED");

      const accepted = await client.query<EmployeeInvitationRow>(
        `UPDATE "IdentityInvitation"
         SET "status" = 'ACCEPTED', "acceptedAt" = $2, "acceptedUserId" = $3, "updatedAt" = now()
         WHERE "id" = $1 AND "status" = 'PENDING' AND "expiresAt" > $2
         RETURNING *`,
        [invitation.id, input.acceptedAt, userId],
      );
      const acceptedInvitation = accepted.rows[0];
      if (!acceptedInvitation) throw new Error("EMPLOYEE_ACTIVATION_INVITATION_ACCEPT_FAILED");
      if (!isEmployeeEmailInvitationRow(acceptedInvitation)) {
        throw new Error("EMPLOYEE_ACTIVATION_INVITATION_INVALID_AFTER_ACCEPT");
      }
      await clearInvitationDelivery(client, invitation.id);
      return { status: "ACCEPTED", invitation: toInvitationRecord(acceptedInvitation) };
    });
  }
}

export function createEmployeeAccountActivationStore(
  users: UserManagementStore,
  tenants: TenantStore,
  invitations: IdentityInvitationStore,
  teachers?: TeacherStore,
): EmployeeAccountActivationStore {
  return resolvePersistenceDriver(process.env.IDENTITY_INVITATION_STORE ?? process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresEmployeeAccountActivationStore()
    : new InMemoryEmployeeAccountActivationStore(users, tenants, invitations, teachers);
}

/**
 * The account an employee e-mail resolves to and whether it may become that Employee's account. Shared by invitation
 * creation (UAT F-20) and activation, so both refuse the same addresses.
 */
async function resolveEmployeeEmailAccount(
  client: Queryable,
  tenantId: string,
  employeeId: string,
  email: string,
): Promise<{ userId?: string; memberships: EmployeeMembershipRow[]; conflict?: EmployeeInvitationEmailConflict }> {
  const userId = await findUserIdByEmail(client, tenantId, email);
  if (!userId) return { memberships: [] };
  const memberships = await findMemberships(client, tenantId, userId);
  if (await isUserBoundToOtherEmployee(client, tenantId, employeeId, userId)) {
    return { userId, memberships, conflict: "EMAIL_ACCOUNT_ALREADY_BOUND" };
  }
  if (hasIncompatiblePersona(memberships)) return { userId, memberships, conflict: "EMAIL_ACCOUNT_INCOMPATIBLE" };
  return { userId, memberships };
}

async function findUserIdByEmail(client: Queryable, tenantId: string, email: string): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    `SELECT "id"
     FROM "User"
     WHERE "tenantId" = $1 AND coalesce("emailNormalized", lower(btrim("email"))) = $2
     LIMIT 1
     FOR UPDATE`,
    [tenantId, email],
  );
  return result.rows[0]?.id;
}

async function findMemberships(client: Queryable, tenantId: string, userId: string): Promise<EmployeeMembershipRow[]> {
  const result = await client.query<EmployeeMembershipRow>(
    `SELECT m."id", m."role"::text, m."staffRole"::text, m."hasTeacherPersona", m."hasStudentPersona",
            m."version", m."scopeMode",
            ARRAY(
              SELECT scope."campusId"
              FROM "MembershipCampusScope" scope
              WHERE scope."tenantId" = m."tenantId" AND scope."membershipId" = m."id"
              ORDER BY scope."campusId"
            ) AS "campusIds"
     FROM "TenantMembership" m
     WHERE m."tenantId" = $1 AND m."userId" = $2
     ORDER BY (m."staffRole" IS NOT NULL OR m."hasTeacherPersona" OR m."hasStudentPersona") DESC, m."startsAt" ASC
     FOR UPDATE`,
    [tenantId, userId],
  );
  return result.rows;
}

async function isUserBoundToOtherEmployee(
  client: Queryable,
  tenantId: string,
  employeeId: string,
  userId: string,
): Promise<boolean> {
  // UAT F-20: an Employee linked to a teacher that holds the account (Teacher.employeeId, UAT F-13) counts as bound
  // even before its own userId is filled in.
  const result = await client.query<{ id: string }>(
    `SELECT e."id"
     FROM "Employee" e
     LEFT JOIN "Teacher" t
       ON t."tenantId" = e."tenantId" AND t."employeeId" = e."id" AND t."deletedAt" IS NULL
     WHERE e."tenantId" = $1 AND e."id" <> $3 AND e."deletedAt" IS NULL
       AND (e."userId" = $2 OR t."userId" = $2)
     LIMIT 1
     FOR UPDATE OF e`,
    [tenantId, userId, employeeId],
  );
  return Boolean(result.rows[0]);
}

async function hasEmployeeAccountCapacity(client: Queryable, tenantId: string, limit: number): Promise<boolean> {
  const usage = await client.query<{ activeEmployeeAccountCount: number | string | null }>(
    `SELECT COUNT(DISTINCT "userId")::int AS "activeEmployeeAccountCount"
     FROM "Employee"
     WHERE "tenantId" = $1 AND "status" = 'ACTIVE' AND "deletedAt" IS NULL AND "userId" IS NOT NULL`,
    [tenantId],
  );
  return Number(usage.rows[0]?.activeEmployeeAccountCount ?? 0) < limit;
}

async function insertMembership(
  client: Queryable,
  tenantId: string,
  userId: string,
  role: EmployeeInvitationRole | "TEACHER",
  staffRole: EmployeeInvitationRole | null,
  hasTeacherPersona: boolean,
  version: number,
  scopeMode: "TENANT" | "CAMPUSES",
): Promise<string> {
  const membershipId = randomUUID();
  await client.query(
    `INSERT INTO "TenantMembership" (
       "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
       "status", "version", "scopeMode", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, false, 'ACTIVE', $7, $8, now())`,
    [membershipId, tenantId, userId, role, staffRole, hasTeacherPersona, version, scopeMode],
  );
  return membershipId;
}

async function insertMembershipCampusScopes(
  client: Queryable,
  tenantId: string,
  membershipId: string,
  campusIds: readonly string[],
): Promise<void> {
  for (const campusId of campusIds) {
    await client.query(
      `INSERT INTO "MembershipCampusScope" ("id", "tenantId", "membershipId", "campusId")
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), tenantId, membershipId, campusId],
    );
  }
}

function resolveMembershipScope(memberships: readonly EmployeeMembershipRow[]): {
  scopeMode: "TENANT" | "CAMPUSES";
  campusIds: string[];
} {
  const canonical = memberships.find((membership) => (
    Boolean(membership.staffRole) || membership.hasTeacherPersona || membership.hasStudentPersona
  )) ?? memberships[0];
  if (canonical?.scopeMode !== "CAMPUSES") return { scopeMode: "TENANT", campusIds: [] };
  return { scopeMode: "CAMPUSES", campusIds: [...new Set(canonical.campusIds ?? [])].sort() };
}

async function revokeInvitation(client: Queryable, invitationId: string): Promise<void> {
  await client.query(
    `UPDATE "IdentityInvitation" SET "status" = 'REVOKED', "updatedAt" = now() WHERE "id" = $1 AND "status" = 'PENDING'`,
    [invitationId],
  );
}

async function clearInvitationDelivery(client: Queryable, invitationId: string): Promise<void> {
  await client.query(
    `UPDATE "SecretDeliveryOutbox"
     SET "status" = 'EXPIRED', "payloadEncrypted" = NULL, "claimedAt" = NULL, "lastErrorCode" = NULL, "updatedAt" = now()
     WHERE "purpose" = 'IDENTITY_INVITATION' AND "sourceId" = $1 AND "payloadEncrypted" IS NOT NULL`,
    [invitationId],
  );
}

function hasIncompatiblePersona(memberships: readonly EmployeeMembershipRow[]): boolean {
  return memberships.some((membership) => (
    membership.hasStudentPersona || membership.role === "STUDENT" || membership.role === "GUARDIAN"
  ));
}

function isEmployeeEmailInvitation(invitation: IdentityInvitationRecord | undefined): invitation is IdentityInvitationRecord & {
  email: string;
  role: EmployeeInvitationRole;
} {
  return Boolean(invitation
    && invitation.subjectType === "EMPLOYEE"
    && invitation.kind === "EMAIL_LINK"
    && invitation.email
    && isEmployeeInvitationRole(invitation.role));
}

function isEmployeeEmailInvitationRow(invitation: EmployeeInvitationRow | undefined): invitation is EmployeeInvitationRow & {
  email: string;
  role: EmployeeInvitationRole;
} {
  return Boolean(invitation
    && invitation.subjectType === "EMPLOYEE"
    && invitation.kind === "EMAIL_LINK"
    && invitation.email
    && isEmployeeInvitationRole(invitation.role));
}

function isEmployeeInvitationRole(role: string): role is EmployeeInvitationRole {
  return role === "TENANT_OWNER"
    || role === "TENANT_ADMIN"
    || role === "OPERATIONS_STAFF"
    || role === "FINANCE_STAFF";
}

function toInvitationRecord(row: EmployeeInvitationRow & { email: string; role: EmployeeInvitationRole }): IdentityInvitationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    subjectType: "EMPLOYEE",
    subjectId: row.subjectId,
    email: row.email,
    name: row.name,
    role: row.role,
    kind: "EMAIL_LINK",
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString(),
    acceptedUserId: row.acceptedUserId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface EmployeeInvitationRow {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  email: string | null;
  name: string;
  role: string;
  kind: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EmployeeActivationProfileRow {
  id: string;
  status: string;
  userId: string | null;
}

interface EmployeeMembershipRow {
  id?: string;
  role: string;
  staffRole?: string | null;
  hasTeacherPersona: boolean;
  hasStudentPersona: boolean;
  version: number;
  scopeMode?: string;
  campusIds?: string[];
}

const defaultEmployeeAccountLimit = 2_000;
