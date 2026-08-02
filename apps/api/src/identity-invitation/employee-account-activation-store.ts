import { randomUUID } from "node:crypto";
import type { EmployeeInvitationRole } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";
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
        | "PROFILE_NOT_ACTIVE"
        | "ALREADY_LINKED"
        | "EMAIL_ACCOUNT_ALREADY_BOUND"
        | "EMAIL_ACCOUNT_INCOMPATIBLE"
        | "LICENSE_INACTIVE"
        | "ACCOUNT_LIMIT_EXCEEDED";
    };

export interface EmployeeAccountActivationStore {
  accept(input: {
    tokenHash: string;
    passwordHash: string;
    name?: string;
    acceptedAt: string;
  }): Promise<EmployeeAccountActivationOutcome>;
}

export const employeeAccountActivationStoreToken = Symbol("EmployeeAccountActivationStore");

export class InMemoryEmployeeAccountActivationStore implements EmployeeAccountActivationStore {
  constructor(
    private readonly users: UserManagementStore,
    private readonly tenants: TenantStore,
    private readonly invitations: IdentityInvitationStore,
    private readonly employeeAccountLimit = defaultEmployeeAccountLimit,
  ) {}

  async accept(input: {
    tokenHash: string;
    passwordHash: string;
    name?: string;
    acceptedAt: string;
  }): Promise<EmployeeAccountActivationOutcome> {
    const invitation = await this.invitations.findByTokenHash(input.tokenHash);
    if (!isEmployeeEmailInvitation(invitation)) return { status: "INVALID" };
    if (invitation.status !== "PENDING") return { status: "NOT_PENDING" };
    if (Date.parse(invitation.expiresAt) <= Date.parse(input.acceptedAt)) return { status: "EXPIRED" };
    const employee = await this.users.findEmployee(invitation.tenantId, invitation.subjectId);
    if (!employee || employee.status !== "ACTIVE") return { status: "PROFILE_NOT_ACTIVE" };
    if (employee.userId) return { status: "ALREADY_LINKED" };

    const tenantUsers = await this.users.listTenantUsers(invitation.tenantId);
    const existingUser = tenantUsers.find((user) => user.email?.toLowerCase() === invitation.email);
    if (existingUser) {
      const boundElsewhere = (await this.users.listEmployees(invitation.tenantId)).some((candidate) => (
        candidate.id !== employee.id && candidate.userId === existingUser.id
      ));
      if (boundElsewhere) return { status: "EMAIL_ACCOUNT_ALREADY_BOUND" };
      if (existingUser.roles.includes("STUDENT") || existingUser.roles.includes("GUARDIAN")) {
        return { status: "EMAIL_ACCOUNT_INCOMPATIBLE" };
      }
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
      if (invitation.status !== "PENDING") return { status: "NOT_PENDING" };
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
        `SELECT "id", "status", "userId"
         FROM "Employee"
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         LIMIT 1
         FOR UPDATE`,
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
      let userId = await findUserIdByEmail(client, invitation.tenantId, normalizedEmail);
      let memberships = userId
        ? await findMemberships(client, invitation.tenantId, userId)
        : [];
      if (userId) {
        if (await isUserBoundToOtherEmployee(client, invitation.tenantId, invitation.subjectId, userId)) {
          return { status: "EMAIL_ACCOUNT_ALREADY_BOUND" };
        }
        if (hasIncompatiblePersona(memberships)) return { status: "EMAIL_ACCOUNT_INCOMPATIBLE" };
      }

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
      const hasTeacherPersona = memberships.some((membership) => (
        membership.hasTeacherPersona || membership.role === "TEACHER"
      ));
      await client.query(
        `DELETE FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2`,
        [invitation.tenantId, userId],
      );
      await insertMembership(client, invitation.tenantId, userId, invitation.role, invitation.role, hasTeacherPersona, membershipVersion);
      if (hasTeacherPersona) {
        await insertMembership(client, invitation.tenantId, userId, "TEACHER", null, false, membershipVersion);
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
): EmployeeAccountActivationStore {
  return resolvePersistenceDriver(process.env.IDENTITY_INVITATION_STORE ?? process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresEmployeeAccountActivationStore()
    : new InMemoryEmployeeAccountActivationStore(users, tenants, invitations);
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
    `SELECT "role"::text, "hasTeacherPersona", "hasStudentPersona", "version"
     FROM "TenantMembership"
     WHERE "tenantId" = $1 AND "userId" = $2
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
  const result = await client.query<{ id: string }>(
    `SELECT "id"
     FROM "Employee"
     WHERE "tenantId" = $1 AND "userId" = $2 AND "id" <> $3 AND "deletedAt" IS NULL
     LIMIT 1
     FOR UPDATE`,
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
): Promise<void> {
  await client.query(
    `INSERT INTO "TenantMembership" (
       "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
       "status", "version", "scopeMode", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, false, 'ACTIVE', $7, 'TENANT', now())`,
    [randomUUID(), tenantId, userId, role, staffRole, hasTeacherPersona, version],
  );
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
  role: string;
  hasTeacherPersona: boolean;
  hasStudentPersona: boolean;
  version: number;
}

const defaultEmployeeAccountLimit = 2_000;
