import { randomUUID } from "node:crypto";
import type { GuardianStudentRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import { InMemoryAuthUserStore, addInMemoryAuthUserRole, removeInMemoryAuthUserRole } from "../auth/auth-user-store.js";
import type { GuardianStore } from "./guardian-store.js";

export type GuardianStudentInput = Pick<GuardianStudentRecord, "tenantId" | "guardianId" | "studentId"> &
  Partial<Pick<
    GuardianStudentRecord,
    "canViewFinance" | "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets"
  >>;

export interface GuardianStudentStore {
  listByGuardian(guardianId: string): Promise<GuardianStudentRecord[]>;
  listByStudent(studentId: string): Promise<GuardianStudentRecord[]>;
  /**
   * Creates the link or returns the existing one. KV-3c security review: a link this call returns is no longer
   * "created by the StudentContact flow" (an admin/API link is kept by a contact unlink). The User behind the guardian
   * is locked before the link row; a GUARDIAN membership ended by LAST_GUARDIAN_STUDENT_LINK_REMOVED becomes ACTIVE
   * again (version bump, sessions closed), the same way as the KV-3b role add.
   */
  create(input: GuardianStudentInput): Promise<GuardianStudentCreateWrite>;
  /** clearStudentContactOrigin: an admin permission change adopts the link (KV-3c); guardian self-service does not. */
  update(
    guardianId: string,
    studentId: string,
    input: Partial<GuardianStudentInput>,
    options?: { clearStudentContactOrigin?: boolean },
  ): Promise<GuardianStudentRecord | undefined>;
  /**
   * Removes the link; undefined when there was none. Product owner decision (2026-10-05, KV-3c): when this was the
   * guardian's last link and the user behind the guardian also holds another ACTIVE (staff/teacher) membership, the
   * GUARDIAN membership ends in the same transaction (version bump, sessions closed). A guardian-only user keeps it.
   */
  delete(guardianId: string, studentId: string): Promise<GuardianRoleEndWrite | undefined>;
}

export interface GuardianRoleEndWrite {
  /** Set only when the GUARDIAN membership of this user ended because its last GuardianStudent link went. */
  guardianRoleRemovedUserId?: string;
  sessionsRevoked: number;
}

export interface GuardianStudentCreateWrite {
  link: GuardianStudentRecord;
  /** Set only when the GUARDIAN membership ended by LAST_GUARDIAN_STUDENT_LINK_REMOVED became ACTIVE again. */
  guardianRoleRestoredUserId?: string;
  sessionsRevoked: number;
}

export const guardianRoleEndedReason = "LAST_GUARDIAN_STUDENT_LINK_REMOVED";

export const guardianStudentStoreToken = Symbol("GuardianStudentStore");

const demoLinks: GuardianStudentRecord[] = [
  {
    id: "guardian-student-a",
    tenantId: "tenant-a",
    guardianId: "guardian-a",
    studentId: "student-a",
    canViewFinance: true,
    canReceiveSms: true,
    canReceiveAnnouncements: true,
    canOpenSupportTickets: true,
  },
  {
    id: "guardian-student-b",
    tenantId: "tenant-b",
    guardianId: "guardian-b",
    studentId: "student-b",
    canViewFinance: true,
    canReceiveSms: true,
    canReceiveAnnouncements: true,
    canOpenSupportTickets: true,
  },
];

export class InMemoryGuardianStudentStore implements GuardianStudentStore {
  private readonly links = demoLinks.map((record) => ({ ...record }));
  /** KV-3c: ids of links the StudentContact flow created (the Postgres column "createdByStudentContact"). */
  private readonly contactCreatedIds = new Set<string>();
  /** Users whose GUARDIAN role this store ended after their last link (the Postgres endedReason). */
  private readonly endedGuardianRoleUserIds = new Set<string>();

  /** guardians is only needed to end the GUARDIAN role after the last link (the module wires the shared store). */
  constructor(private readonly guardians?: GuardianStore) {}

  async listByGuardian(guardianId: string): Promise<GuardianStudentRecord[]> {
    return this.links.filter((link) => link.guardianId === guardianId);
  }

  async listByStudent(studentId: string): Promise<GuardianStudentRecord[]> {
    return this.links.filter((link) => link.studentId === studentId);
  }

  async create(input: GuardianStudentInput): Promise<GuardianStudentCreateWrite> {
    const existing = this.links.find(
      (link) =>
        link.tenantId === input.tenantId &&
        link.guardianId === input.guardianId &&
        link.studentId === input.studentId,
    );
    const link = existing ?? {
      id: `guardian-student-${this.links.length + 1}`,
      ...withGuardianStudentDefaults(input),
    };
    if (existing) this.contactCreatedIds.delete(existing.id);
    else this.links.push(link);
    return { link, ...await this.restoreGuardianRole(input.guardianId) };
  }

  /** In-memory side of the StudentContact flow marker (the Postgres flow writes the column itself). */
  markCreatedByStudentContact(linkId: string): void {
    this.contactCreatedIds.add(linkId);
  }

  isCreatedByStudentContact(linkId: string): boolean {
    return this.contactCreatedIds.has(linkId);
  }

  async update(
    guardianId: string,
    studentId: string,
    input: Partial<GuardianStudentInput>,
    options: { clearStudentContactOrigin?: boolean } = {},
  ): Promise<GuardianStudentRecord | undefined> {
    const index = this.links.findIndex((link) => link.guardianId === guardianId && link.studentId === studentId);
    if (index === -1) {
      return undefined;
    }
    if (options.clearStudentContactOrigin) this.contactCreatedIds.delete(this.links[index]!.id);

    const updated = {
      ...this.links[index]!,
      ...input,
      guardianId,
      studentId,
      updatedAt: new Date().toISOString(),
    };
    this.links[index] = updated;
    return updated;
  }

  async delete(guardianId: string, studentId: string): Promise<GuardianRoleEndWrite | undefined> {
    const index = this.links.findIndex((link) => link.guardianId === guardianId && link.studentId === studentId);
    if (index === -1) {
      return undefined;
    }

    const [removed] = this.links.splice(index, 1);
    if (removed) this.contactCreatedIds.delete(removed.id);
    const none = { sessionsRevoked: 0 };
    if (this.links.some((link) => link.guardianId === guardianId)) return none;
    const guardian = await this.guardians?.findById(guardianId);
    const user = guardian?.userId ? await new InMemoryAuthUserStore().findById(guardian.userId) : undefined;
    if (!user || user.tenantId !== guardian?.tenantId || !keepsOtherRole(user.roles)) return none;
    // The in-memory version bump makes every open session fail the membership check (same effect as revoking).
    removeInMemoryAuthUserRole(user.tenantId, user.id, "GUARDIAN");
    this.endedGuardianRoleUserIds.add(user.id);
    return { guardianRoleRemovedUserId: user.id, sessionsRevoked: 0 };
  }

  private async restoreGuardianRole(guardianId: string): Promise<Omit<GuardianStudentCreateWrite, "link">> {
    const guardian = await this.guardians?.findById(guardianId);
    if (!guardian?.userId || !this.endedGuardianRoleUserIds.delete(guardian.userId)) return { sessionsRevoked: 0 };
    // The KV-3b user path may have added the role back already.
    if ((await new InMemoryAuthUserStore().findById(guardian.userId))?.roles.includes("GUARDIAN")) return { sessionsRevoked: 0 };
    // Same effect as the KV-3b role add: the version bump makes every open session fail the membership check.
    addInMemoryAuthUserRole(guardian.tenantId, guardian.userId, "GUARDIAN");
    return { guardianRoleRestoredUserId: guardian.userId, sessionsRevoked: 0 };
  }
}

export class PostgresGuardianStudentStore implements GuardianStudentStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listByGuardian(guardianId: string): Promise<GuardianStudentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianStudentRow>(
        `SELECT *
         FROM "GuardianStudent"
         WHERE "guardianId" = $1`,
        [guardianId],
      );
      return result.rows.map(toGuardianStudentRecord);
    });
  }

  async listByStudent(studentId: string): Promise<GuardianStudentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianStudentRow>(
        `SELECT *
         FROM "GuardianStudent"
         WHERE "studentId" = $1`,
        [studentId],
      );
      return result.rows.map(toGuardianStudentRecord);
    });
  }

  async create(input: GuardianStudentInput): Promise<GuardianStudentCreateWrite> {
    const recordInput = withGuardianStudentDefaults(input);
    return withTenantQuery(this.pool, async (client) => {
      // User before link row: the same order as delete and the StudentContact flow, so they serialize.
      const guardianUser = await lockGuardianUser(client, recordInput.guardianId);
      // KV-3c: an existing link returned here is adopted by this (API) flow; its permissions stay as they are.
      const upserted = await client.query<GuardianStudentRow>(
        `INSERT INTO "GuardianStudent" (
           "id",
           "tenantId",
           "guardianId",
           "studentId",
           "canViewFinance",
           "canReceiveSms",
           "canReceiveAnnouncements",
           "canOpenSupportTickets",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT ("tenantId", "guardianId", "studentId") DO UPDATE
         SET "createdByStudentContact" = false
         RETURNING *`,
        [
          randomUUID(),
          recordInput.tenantId,
          recordInput.guardianId,
          recordInput.studentId,
          recordInput.canViewFinance,
          recordInput.canReceiveSms,
          recordInput.canReceiveAnnouncements,
          recordInput.canOpenSupportTickets,
        ],
      );
      const row = upserted.rows[0];
      if (!row) {
        throw new Error("GUARDIAN_STUDENT_LINK_CREATE_FAILED");
      }
      return { link: toGuardianStudentRecord(row), ...await restoreGuardianRoleWhenRelinked(client, guardianUser) };
    });
  }

  async update(
    guardianId: string,
    studentId: string,
    input: Partial<GuardianStudentInput>,
    options: { clearStudentContactOrigin?: boolean } = {},
  ): Promise<GuardianStudentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianStudentRow>(
        `UPDATE "GuardianStudent"
         SET "canViewFinance" = COALESCE($3, "canViewFinance"),
             "canReceiveSms" = COALESCE($4, "canReceiveSms"),
             "canReceiveAnnouncements" = COALESCE($5, "canReceiveAnnouncements"),
             "canOpenSupportTickets" = COALESCE($6, "canOpenSupportTickets"),
             "createdByStudentContact" = CASE WHEN $7 THEN false ELSE "createdByStudentContact" END,
             "updatedAt" = now()
         WHERE "guardianId" = $1
           AND "studentId" = $2
         RETURNING *`,
        [
          guardianId,
          studentId,
          input.canViewFinance,
          input.canReceiveSms,
          input.canReceiveAnnouncements,
          input.canOpenSupportTickets,
          options.clearStudentContactOrigin === true,
        ],
      );
      return result.rows[0] ? toGuardianStudentRecord(result.rows[0]) : undefined;
    });
  }

  async delete(guardianId: string, studentId: string): Promise<GuardianRoleEndWrite | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const guardianUser = await lockGuardianUser(client, guardianId);
      const result = await client.query<GuardianStudentRow>(
        `DELETE FROM "GuardianStudent"
         WHERE "guardianId" = $1
           AND "studentId" = $2
         RETURNING *`,
        [guardianId, studentId],
      );
      if (result.rows.length === 0) return undefined;
      return endGuardianRoleWhenUnlinked(client, guardianId, guardianUser);
    });
  }
}

export function createGuardianStudentStore(guardians?: GuardianStore): GuardianStudentStore {
  return resolvePersistenceDriver(process.env.GUARDIAN_STUDENT_STORE) === "postgres"
    ? new PostgresGuardianStudentStore()
    : new InMemoryGuardianStudentStore(guardians);
}

/** Only a user that keeps another ACTIVE membership loses GUARDIAN; a guardian-only account keeps its role. */
function keepsOtherRole(activeRoles: readonly string[]): boolean {
  return activeRoles.includes("GUARDIAN") && activeRoles.some((role) => role !== "GUARDIAN");
}

/**
 * Locks the User row behind a guardian profile before any GuardianStudent row, the same order as the KV-3b user link
 * (contact -> user -> GuardianStudent), so a concurrent link and unlink of the same person serialize instead of
 * deadlocking. undefined for a guardian without a user.
 */
export async function lockGuardianUser(client: Queryable, guardianId: string): Promise<{ tenantId: string; userId: string } | undefined> {
  const result = await client.query<{ tenantId: string; userId: string }>(
    `SELECT u."tenantId", u."id" AS "userId"
     FROM "Guardian" g
     JOIN "User" u ON u."tenantId" = g."tenantId" AND u."id" = g."userId"
     WHERE g."id" = $1
     FOR UPDATE OF u`,
    [guardianId],
  );
  return result.rows[0];
}

/**
 * Product owner decision (2026-10-05, KV-3c): after a GuardianStudent delete in the same transaction, ends the
 * GUARDIAN membership when the guardian has no link left and the (locked) user keeps another ACTIVE membership. Other
 * memberships are not changed beyond the shared version (same pattern as the KV-3b role add); open sessions close.
 */
export async function endGuardianRoleWhenUnlinked(
  client: Queryable,
  guardianId: string,
  user: { tenantId: string; userId: string } | undefined,
): Promise<GuardianRoleEndWrite> {
  const none = { sessionsRevoked: 0 };
  if (!user) return none;
  const remaining = await client.query(
    `SELECT 1 FROM "GuardianStudent" WHERE "tenantId" = $1 AND "guardianId" = $2 LIMIT 1`,
    [user.tenantId, guardianId],
  );
  if (remaining.rows[0]) return none;
  const memberships = await client.query<{ role: string }>(
    `SELECT "role"::text AS role FROM "TenantMembership"
     WHERE "tenantId" = $1 AND "userId" = $2 AND "status" = 'ACTIVE'
     FOR UPDATE`,
    [user.tenantId, user.userId],
  );
  if (!keepsOtherRole(memberships.rows.map((row) => row.role))) return none;

  const sessionsRevoked = await changeGuardianMembership(client, user, (version) => client.query(
    `UPDATE "TenantMembership"
     SET "status" = 'ENDED', "endsAt" = now(), "endedReason" = $4, "version" = $3, "updatedAt" = now()
     WHERE "tenantId" = $1 AND "userId" = $2 AND "role" = 'GUARDIAN' AND "status" = 'ACTIVE'`,
    [user.tenantId, user.userId, version, guardianRoleEndedReason],
  ));
  return { guardianRoleRemovedUserId: user.userId, sessionsRevoked };
}

/**
 * KV-3c security review (R2): relinking a guardian whose GUARDIAN membership ended only because its last link went
 * (LAST_GUARDIAN_STUDENT_LINK_REMOVED) makes it ACTIVE again in the same transaction, like the KV-3b role add. Any
 * other ended/suspended GUARDIAN membership stays as it is. The caller holds the User row lock.
 */
export async function restoreGuardianRoleWhenRelinked(
  client: Queryable,
  user: { tenantId: string; userId: string } | undefined,
): Promise<Omit<GuardianStudentCreateWrite, "link">> {
  if (!user) return { sessionsRevoked: 0 };
  const ended = await client.query<{ id: string }>(
    `SELECT "id" FROM "TenantMembership"
     WHERE "tenantId" = $1 AND "userId" = $2 AND "role" = 'GUARDIAN' AND "status" = 'ENDED' AND "endedReason" = $3
     FOR UPDATE`,
    [user.tenantId, user.userId, guardianRoleEndedReason],
  );
  const membershipId = ended.rows[0]?.id;
  if (!membershipId) return { sessionsRevoked: 0 };
  const sessionsRevoked = await changeGuardianMembership(client, user, (version) => client.query(
    `UPDATE "TenantMembership"
     SET "status" = 'ACTIVE', "endsAt" = NULL, "endedReason" = NULL, "version" = $3, "updatedAt" = now()
     WHERE "tenantId" = $1 AND "id" = $2`,
    [user.tenantId, membershipId, version],
  ));
  return { guardianRoleRestoredUserId: user.userId, sessionsRevoked };
}

/**
 * Shared GUARDIAN membership change: bumps User.membershipVersion, applies the change with the new version, gives every
 * ACTIVE membership that version (other memberships change nothing else) and closes open sessions.
 */
async function changeGuardianMembership(
  client: Queryable,
  user: { tenantId: string; userId: string },
  change: (version: number) => Promise<unknown>,
): Promise<number> {
  const version = (await client.query<{ membershipVersion: number }>(
    `UPDATE "User" SET "membershipVersion" = "membershipVersion" + 1, "updatedAt" = now()
     WHERE "tenantId" = $1 AND "id" = $2 RETURNING "membershipVersion"`,
    [user.tenantId, user.userId],
  )).rows[0]?.membershipVersion;
  if (version === undefined) throw new Error("GUARDIAN_ROLE_CHANGE_FAILED");
  await change(version);
  await client.query(
    `UPDATE "TenantMembership" SET "version" = $3, "updatedAt" = now()
     WHERE "tenantId" = $1 AND "userId" = $2 AND "status" = 'ACTIVE'`,
    [user.tenantId, user.userId, version],
  );
  const sessions = await client.query(
    `UPDATE "AuthSession" SET "status" = 'REVOKED', "updatedAt" = now()
     WHERE "tenantId" = $1 AND "userId" = $2 AND "status" = 'ACTIVE' RETURNING "id"`,
    [user.tenantId, user.userId],
  );
  return sessions.rows.length;
}

interface GuardianStudentRow {
  id: string;
  tenantId: string;
  guardianId: string;
  studentId: string;
  canViewFinance?: boolean;
  canReceiveSms?: boolean;
  canReceiveAnnouncements?: boolean;
  canOpenSupportTickets?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}


function toGuardianStudentRecord(row: GuardianStudentRow): GuardianStudentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guardianId: row.guardianId,
    studentId: row.studentId,
    canViewFinance: row.canViewFinance ?? false,
    canReceiveSms: row.canReceiveSms ?? false,
    canReceiveAnnouncements: row.canReceiveAnnouncements ?? false,
    canOpenSupportTickets: row.canOpenSupportTickets ?? false,
    createdAt: row.createdAt ? toIsoString(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? toIsoString(row.updatedAt) : undefined,
  };
}

function withGuardianStudentDefaults(input: GuardianStudentInput): Omit<GuardianStudentRecord, "id"> {
  return {
    tenantId: input.tenantId,
    guardianId: input.guardianId,
    studentId: input.studentId,
    canViewFinance: input.canViewFinance ?? false,
    canReceiveSms: input.canReceiveSms ?? false,
    canReceiveAnnouncements: input.canReceiveAnnouncements ?? false,
    canOpenSupportTickets: input.canOpenSupportTickets ?? false,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
