import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { hashPasswordAsync, InMemoryAuthUserStore, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withBypassRlsQuery, withExplicitTenantQuery } from "../db/tenant-query.js";
import type { StudentStore } from "../student/student-store.js";
import type { TenantStore } from "../tenant/tenant-store.js";
import type { IdentityInvitationStore } from "./identity-invitation-store.js";

export interface IssueStudentPortalActivationInput {
  id: string;
  tenantId: string;
  studentId: string;
  tokenHash: string;
  expiresAt: string;
  maxAttempts: number;
}

export interface StudentPortalActivationInvitation {
  id: string;
  tenantId: string;
  tenantSlug: string;
  studentId: string;
  studentNo: string;
  expiresAt: string;
}

export type StudentPortalActivationOutcome =
  | { status: "ACCEPTED"; acceptedAt: string; invitationId: string; loginName: string; tenantId: string; studentId: string; userId: string }
  | { status: "INVALID" | "EXPIRED" | "LOCKED" | "PROFILE_NOT_ACTIVE" | "ALREADY_ACTIVATED" | "LOGIN_NAME_CONFLICT" };

export interface StudentPortalActivationStore {
  issue(input: IssueStudentPortalActivationInput): Promise<StudentPortalActivationInvitation | undefined>;
  accept(input: { tenantSlug: string; studentNo: string; code: string; password: string }): Promise<StudentPortalActivationOutcome>;
}

export const studentPortalActivationStoreToken = Symbol("StudentPortalActivationStore");

export class InMemoryStudentPortalActivationStore implements StudentPortalActivationStore {
  private readonly secrets = new Map<string, { tokenHash: string; failedAttempts: number; maxAttempts: number }>();

  constructor(
    private readonly students: StudentStore,
    private readonly tenants: TenantStore,
    private readonly invitations: IdentityInvitationStore,
  ) {}

  async issue(input: IssueStudentPortalActivationInput): Promise<StudentPortalActivationInvitation | undefined> {
    const student = await this.students.findById(input.studentId);
    if (!student || student.tenantId !== input.tenantId) return undefined;
    if (student.status !== "ACTIVE") throw new Error("STUDENT_PORTAL_PROFILE_NOT_ACTIVE");
    if (student.userId) throw new Error("STUDENT_PORTAL_ALREADY_ACTIVATED");
    if (!student.studentNo?.trim()) throw new Error("STUDENT_PORTAL_STUDENT_NO_REQUIRED");
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) return undefined;

    await this.invitations.revokePendingForSubject(input.tenantId, "STUDENT", input.studentId);
    await this.invitations.create({
      id: input.id,
      tenantId: input.tenantId,
      subjectType: "STUDENT",
      subjectId: input.studentId,
      name: `${student.firstName} ${student.lastName}`.trim(),
      role: "STUDENT",
      kind: "STUDENT_CODE",
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
    this.secrets.set(input.id, { tokenHash: input.tokenHash, failedAttempts: 0, maxAttempts: input.maxAttempts });
    return {
      id: input.id,
      tenantId: input.tenantId,
      tenantSlug: tenant.slug,
      studentId: student.id,
      studentNo: student.studentNo,
      expiresAt: input.expiresAt,
    };
  }

  async accept(input: { tenantSlug: string; studentNo: string; code: string; password: string }): Promise<StudentPortalActivationOutcome> {
    const tenant = await this.tenants.findBySlug(input.tenantSlug);
    if (!tenant) return { status: "INVALID" };
    const student = (await this.students.list()).find((candidate) => (
      candidate.tenantId === tenant.id && candidate.studentNo?.toLowerCase() === input.studentNo.toLowerCase()
    ));
    if (!student) return { status: "INVALID" };
    const loginName = student.studentNo;
    if (!loginName) return { status: "INVALID" };
    const invitation = (await this.invitations.list(tenant.id)).find((candidate) => (
      candidate.subjectType === "STUDENT" && candidate.subjectId === student.id && candidate.kind === "STUDENT_CODE" && candidate.status === "PENDING"
    ));
    if (!invitation) return { status: "INVALID" };
    const secret = this.secrets.get(invitation.id);
    if (!secret) return { status: "INVALID" };
    if (Date.parse(invitation.expiresAt) <= Date.now()) return { status: "EXPIRED" };
    if (secret.failedAttempts >= secret.maxAttempts) return { status: "LOCKED" };
    if (!safeHashEqual(secret.tokenHash, hashStudentPortalActivationCode(invitation.id, input.code))) {
      secret.failedAttempts += 1;
      if (secret.failedAttempts >= secret.maxAttempts) {
        await this.invitations.revokePendingForSubject(tenant.id, "STUDENT", student.id);
      }
      return { status: secret.failedAttempts >= secret.maxAttempts ? "LOCKED" : "INVALID" };
    }
    if (student.status !== "ACTIVE") return { status: "PROFILE_NOT_ACTIVE" };
    if (student.userId) return { status: "ALREADY_ACTIVATED" };
    if (await new InMemoryAuthUserStore().findByTenantAndLoginName(tenant.id, loginName)) {
      return { status: "LOGIN_NAME_CONFLICT" };
    }

    const acceptedAt = new Date().toISOString();
    const userId = randomUUID();
    upsertInMemoryAuthUser({
      id: userId,
      loginName,
      name: `${student.firstName} ${student.lastName}`.trim(),
      passwordHash: await hashPasswordAsync(input.password),
      passwordChangedAt: acceptedAt,
      tenantId: tenant.id,
      roles: ["STUDENT"],
    });
    const bound = await this.students.bindUser(tenant.id, student.id, userId);
    if (!bound) return { status: "INVALID" };
    const accepted = await this.invitations.markAccepted(invitation.id, userId, acceptedAt);
    if (!accepted) return { status: "INVALID" };
    return {
      status: "ACCEPTED",
      acceptedAt,
      invitationId: invitation.id,
      loginName,
      tenantId: tenant.id,
      studentId: student.id,
      userId,
    };
  }
}

export class PostgresStudentPortalActivationStore implements StudentPortalActivationStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async issue(input: IssueStudentPortalActivationInput): Promise<StudentPortalActivationInvitation | undefined> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      const profile = await client.query<StudentActivationProfileRow>(
        `SELECT s."id" AS "studentId", s."studentNo", s."firstName", s."lastName", s."status", s."userId", t."slug" AS "tenantSlug"
         FROM "Student" s
         JOIN "Tenant" t ON t."id" = s."tenantId"
         JOIN "LicenseTerm" license ON license."tenantId" = t."id"
           AND license."cancelledAt" IS NULL
           AND license."planCode" = t."plan"
           AND license."startsAt" = t."licenseStartsAt"
           AND license."endsAt" = t."licenseEndsAt"
           AND license."activeStudentLimit" = t."seatLimit"
         WHERE s."tenantId" = $1 AND s."id" = $2 AND s."deletedAt" IS NULL
           AND t."status" = 'ACTIVE'
           AND license."startsAt" <= now() AND now() < license."endsAt"
         FOR UPDATE OF s, t, license`,
        [input.tenantId, input.studentId],
      );
      const student = profile.rows[0];
      if (!student) return undefined;
      if (student.status !== "ACTIVE") throw new Error("STUDENT_PORTAL_PROFILE_NOT_ACTIVE");
      if (student.userId) throw new Error("STUDENT_PORTAL_ALREADY_ACTIVATED");
      if (!student.studentNo?.trim()) throw new Error("STUDENT_PORTAL_STUDENT_NO_REQUIRED");

      const revoked = await client.query<{ id: string }>(
        `UPDATE "IdentityInvitation"
         SET "status" = 'REVOKED', "updatedAt" = now()
         WHERE "tenantId" = $1 AND "subjectType" = 'STUDENT' AND "subjectId" = $2 AND "status" = 'PENDING'
         RETURNING "id"`,
        [input.tenantId, input.studentId],
      );
      await expireInvitationDeliveries(client, revoked.rows.map((row) => row.id));
      const invitation = await client.query<{ id: string }>(
        `INSERT INTO "IdentityInvitation" (
           "id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "kind",
           "tokenHash", "status", "failedAttempts", "maxAttempts", "expiresAt", "updatedAt"
         ) VALUES ($1, $2, 'STUDENT', $3, NULL, $4, 'STUDENT', 'STUDENT_CODE', $5, 'PENDING', 0, $6, $7, now())
         RETURNING "id"`,
        [input.id, input.tenantId, input.studentId, `${student.firstName} ${student.lastName}`.trim(), input.tokenHash, input.maxAttempts, input.expiresAt],
      );
      if (!invitation.rows[0]) throw new Error("STUDENT_PORTAL_INVITATION_CREATE_FAILED");
      return {
        id: input.id,
        tenantId: input.tenantId,
        tenantSlug: student.tenantSlug,
        studentId: student.studentId,
        studentNo: student.studentNo,
        expiresAt: input.expiresAt,
      };
    });
  }

  async accept(input: { tenantSlug: string; studentNo: string; code: string; password: string }): Promise<StudentPortalActivationOutcome> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const tenant = await client.query<{ id: string }>(
        `SELECT tenant."id"
         FROM "Tenant" tenant
         JOIN "LicenseTerm" license ON license."tenantId" = tenant."id"
           AND license."cancelledAt" IS NULL
           AND license."planCode" = tenant."plan"
           AND license."startsAt" = tenant."licenseStartsAt"
           AND license."endsAt" = tenant."licenseEndsAt"
           AND license."activeStudentLimit" = tenant."seatLimit"
         WHERE lower(tenant."slug") = lower($1)
           AND tenant."status" = 'ACTIVE'
           AND license."startsAt" <= now() AND now() < license."endsAt"
         LIMIT 1
         FOR SHARE OF tenant, license`,
        [input.tenantSlug],
      );
      const tenantId = tenant.rows[0]?.id;
      if (!tenantId) return { status: "INVALID" };
      const profile = await client.query<StudentActivationProfileRow>(
        `SELECT "id" AS "studentId", "studentNo", "firstName", "lastName", "status", "userId", $1::text AS "tenantSlug"
         FROM "Student"
         WHERE "tenantId" = $2 AND lower("studentNo") = lower($3) AND "deletedAt" IS NULL
         LIMIT 1
         FOR UPDATE`,
        [input.tenantSlug, tenantId, input.studentNo],
      );
      const student = profile.rows[0];
      if (!student) return { status: "INVALID" };
      const loginName = student.studentNo;
      if (!loginName) return { status: "INVALID" };
      const invitation = await client.query<StudentActivationInvitationRow>(
        `SELECT "id", "tokenHash", "expiresAt", "failedAttempts", "maxAttempts"
         FROM "IdentityInvitation"
         WHERE "tenantId" = $1
           AND "subjectType" = 'STUDENT'
           AND "subjectId" = $2
           AND "kind" = 'STUDENT_CODE'
           AND "status" = 'PENDING'
         ORDER BY "createdAt" DESC
         LIMIT 1
         FOR UPDATE`,
        [tenantId, student.studentId],
      );
      const pending = invitation.rows[0];
      if (!pending) return { status: "INVALID" };
      if (pending.expiresAt.getTime() <= Date.now()) {
        await revokeStudentCode(client, pending.id);
        return { status: "EXPIRED" };
      }
      if (pending.failedAttempts >= pending.maxAttempts) {
        await revokeStudentCode(client, pending.id);
        return { status: "LOCKED" };
      }
      if (!safeHashEqual(pending.tokenHash, hashStudentPortalActivationCode(pending.id, input.code))) {
        const failedAttempts = pending.failedAttempts + 1;
        await client.query(
          `UPDATE "IdentityInvitation"
           SET "failedAttempts" = $2,
               "status" = CASE WHEN $2 >= "maxAttempts" THEN 'REVOKED' ELSE "status" END,
               "updatedAt" = now()
           WHERE "id" = $1`,
          [pending.id, failedAttempts],
        );
        return { status: failedAttempts >= pending.maxAttempts ? "LOCKED" : "INVALID" };
      }
      if (student.status !== "ACTIVE") {
        await revokeStudentCode(client, pending.id);
        return { status: "PROFILE_NOT_ACTIVE" };
      }
      if (student.userId) {
        await revokeStudentCode(client, pending.id);
        return { status: "ALREADY_ACTIVATED" };
      }

      const loginConflict = await client.query<{ id: string }>(
        `SELECT "id" FROM "User" WHERE "tenantId" = $1 AND "loginNameNormalized" = lower(btrim($2)) LIMIT 1 FOR UPDATE`,
        [tenantId, loginName],
      );
      if (loginConflict.rows[0]) return { status: "LOGIN_NAME_CONFLICT" };
      const userId = randomUUID();
      const membershipId = randomUUID();
      const acceptedAt = new Date().toISOString();
      const passwordHash = await hashPasswordAsync(input.password);
      await client.query(
        `INSERT INTO "User" (
           "id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized",
           "name", "passwordHash", "passwordHashVersion", "accountStatus", "membershipVersion",
           "mustChangePassword", "passwordChangedAt", "updatedAt"
         ) VALUES ($1, $2, NULL, NULL, $3, lower(btrim($3)), $4, $5, 2, 'ACTIVE', 1, false, $6, now())`,
        [userId, tenantId, loginName, `${student.firstName} ${student.lastName}`.trim(), passwordHash, acceptedAt],
      );
      await client.query(
        `INSERT INTO "TenantMembership" (
           "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
           "status", "version", "scopeMode", "updatedAt"
         ) VALUES ($1, $2, $3, 'STUDENT', NULL, false, true, 'ACTIVE', 1, 'TENANT', now())`,
        [membershipId, tenantId, userId],
      );
      await client.query(
        `UPDATE "Student" SET "userId" = $3, "updatedAt" = now() WHERE "tenantId" = $1 AND "id" = $2`,
        [tenantId, student.studentId, userId],
      );
      await client.query(
        `UPDATE "IdentityInvitation"
         SET "status" = 'ACCEPTED', "acceptedAt" = $2, "acceptedUserId" = $3, "updatedAt" = now()
         WHERE "id" = $1 AND "status" = 'PENDING'`,
        [pending.id, acceptedAt, userId],
      );
      return {
        status: "ACCEPTED",
        acceptedAt,
        invitationId: pending.id,
        loginName,
        tenantId,
        studentId: student.studentId,
        userId,
      };
    });
  }
}

export function createStudentPortalActivationStore(
  students: StudentStore,
  tenants: TenantStore,
  invitations: IdentityInvitationStore,
): StudentPortalActivationStore {
  return resolvePersistenceDriver(process.env.IDENTITY_INVITATION_STORE ?? process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresStudentPortalActivationStore()
    : new InMemoryStudentPortalActivationStore(students, tenants, invitations);
}

export function hashStudentPortalActivationCode(invitationId: string, code: string): string {
  return createHash("sha256").update(`${invitationId}:${normalizeStudentPortalActivationCode(code)}`).digest("hex");
}

export function normalizeStudentPortalActivationCode(code: string): string {
  return code.trim().toUpperCase();
}

function safeHashEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

async function revokeStudentCode(client: Queryable, id: string): Promise<void> {
  await client.query(
    `UPDATE "IdentityInvitation" SET "status" = 'REVOKED', "updatedAt" = now() WHERE "id" = $1 AND "status" = 'PENDING'`,
    [id],
  );
}

async function expireInvitationDeliveries(client: Queryable, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await client.query(
    `UPDATE "SecretDeliveryOutbox"
     SET "status" = 'EXPIRED', "payloadEncrypted" = NULL, "claimedAt" = NULL, "lastErrorCode" = NULL, "updatedAt" = now()
     WHERE "purpose" = 'IDENTITY_INVITATION' AND "sourceId" = ANY($1::text[]) AND "payloadEncrypted" IS NOT NULL`,
    [ids],
  );
}

interface StudentActivationProfileRow {
  studentId: string;
  studentNo: string | null;
  firstName: string;
  lastName: string;
  status: string;
  userId: string | null;
  tenantSlug: string;
}

interface StudentActivationInvitationRow {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  failedAttempts: number;
  maxAttempts: number;
}
