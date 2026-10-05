import { randomUUID } from "node:crypto";
import pg from "pg";
import type { StudentContactRelationType } from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { InMemoryAuthUserStore, addInMemoryAuthUserRole } from "../auth/auth-user-store.js";
import { canAttachGuardianRole } from "../auth/tenant-membership-projection.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery } from "../db/tenant-query.js";
import type { GuardianStore } from "../school/guardian-store.js";
import type { GuardianStudentStore } from "../school/guardian-student-store.js";

export interface StudentContactStorageRecord {
  id: string;
  tenantId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  relationType: StudentContactRelationType;
  phoneEncrypted?: string;
  phoneHash?: string;
  emailEncrypted?: string;
  emailHash?: string;
  canReceiveSms: boolean;
  canReceiveAnnouncements: boolean;
  canReceiveFinance: boolean;
  consentSource?: string;
  consentRecordedAt?: string;
  guardianId?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** guardianId is written only through linkGuardian, never through create/update. */
export type StudentContactStoreInput = Omit<StudentContactStorageRecord, "id" | "createdAt" | "updatedAt" | "deletedAt" | "guardianId">;

export interface StudentContactStore {
  listByStudent(tenantId: string, studentId: string): Promise<StudentContactStorageRecord[]>;
  findById(tenantId: string, id: string): Promise<StudentContactStorageRecord | undefined>;
  create(input: StudentContactStoreInput): Promise<StudentContactStorageRecord>;
  update(id: string, input: StudentContactStoreInput): Promise<StudentContactStorageRecord | undefined>;
  /** Sets guardianId only while it is still empty; false when the contact is gone or already linked. */
  linkGuardian(tenantId: string, id: string, guardianId: string): Promise<boolean>;
  /**
   * KV-3b: in one transaction ensures GuardianStudent(tenantId, guardianId, contact.studentId) (permissions off when
   * created, an existing link is left untouched) and sets guardianId while it is still empty. Nothing is written
   * when the contact is gone or already linked (linked: false).
   */
  linkGuardianWithStudentLink(tenantId: string, id: string, guardianId: string): Promise<StudentContactGuardianLinkWrite>;
  /**
   * KV-3b user path (product owner decision 2026-10-05): in one transaction checks that userId is a staff/teacher (or
   * guardian) user of this tenant, reuses or creates the Guardian profile bound to that user (names from the contact),
   * adds the GUARDIAN membership next to the existing ones without touching them (user version bump, active sessions
   * closed), then links exactly like linkGuardianWithStudentLink. Nothing is written when the contact is gone or
   * already linked (linked: false) or the user is not eligible (userNotEligible).
   */
  linkUserAsGuardianWithStudentLink(tenantId: string, id: string, userId: string): Promise<StudentContactUserGuardianLinkWrite>;
  /**
   * Clears guardianId only while it still equals expectedGuardianId and, in the same transaction, removes the
   * GuardianStudent access link unless another live contact of the same student still points at that guardian.
   */
  unlinkGuardian(tenantId: string, id: string, expectedGuardianId: string): Promise<StudentContactGuardianUnlinkWrite>;
  softDelete(tenantId: string, id: string): Promise<boolean>;
  purgeByStudent(tenantId: string, studentId: string): Promise<number>;
}

export interface StudentContactGuardianLinkWrite {
  linked: boolean;
  guardianStudentId?: string;
  guardianStudentCreated: boolean;
}

export interface StudentContactUserGuardianLinkWrite extends StudentContactGuardianLinkWrite {
  guardianId?: string;
  userNotEligible?: boolean;
  guardianCreated: boolean;
  guardianRoleAdded: boolean;
  sessionsRevoked: number;
}

export interface StudentContactGuardianUnlinkWrite {
  unlinked: boolean;
  studentId?: string;
  guardianStudentRemoved: boolean;
}

export const studentContactStoreToken = Symbol("StudentContactStore");

export class InMemoryStudentContactStore implements StudentContactStore {
  private readonly records: StudentContactStorageRecord[] = [];

  /** The guardian stores are only needed by the KV-3b link methods (the module wires the shared stores). */
  constructor(
    private readonly guardianStudents?: GuardianStudentStore,
    private readonly guardians?: GuardianStore,
  ) {}

  async listByStudent(tenantId: string, studentId: string): Promise<StudentContactStorageRecord[]> {
    return this.records.filter((record) => record.tenantId === tenantId && record.studentId === studentId && !record.deletedAt);
  }

  async findById(tenantId: string, id: string): Promise<StudentContactStorageRecord | undefined> {
    return this.records.find((record) => record.tenantId === tenantId && record.id === id && !record.deletedAt);
  }

  async create(input: StudentContactStoreInput): Promise<StudentContactStorageRecord> {
    const now = new Date().toISOString();
    const record = { id: `student-contact-${this.records.length + 1}`, ...input, createdAt: now, updatedAt: now };
    this.records.push(record);
    return record;
  }

  async update(id: string, input: StudentContactStoreInput): Promise<StudentContactStorageRecord | undefined> {
    const record = this.records.find((candidate) => candidate.id === id && !candidate.deletedAt);
    if (!record) return undefined;
    Object.assign(record, input, { updatedAt: new Date().toISOString() });
    return record;
  }

  async linkGuardian(tenantId: string, id: string, guardianId: string): Promise<boolean> {
    const record = this.records.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!record || record.guardianId) return false;
    record.guardianId = guardianId;
    record.updatedAt = new Date().toISOString();
    return true;
  }

  async linkGuardianWithStudentLink(tenantId: string, id: string, guardianId: string): Promise<StudentContactGuardianLinkWrite> {
    if (!this.guardianStudents) throw new Error("GUARDIAN_STUDENT_STORE_REQUIRED");
    const record = this.records.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!record || record.guardianId) return { linked: false, guardianStudentCreated: false };
    // ponytail: in-memory driver has no rollback; nothing awaits between the check above and the write below
    // except the link create, which is itself idempotent.
    const existing = (await this.guardianStudents.listByStudent(record.studentId))
      .find((link) => link.tenantId === tenantId && link.guardianId === guardianId);
    const link = existing ?? await this.guardianStudents.create({ tenantId, guardianId, studentId: record.studentId });
    record.guardianId = guardianId;
    record.updatedAt = new Date().toISOString();
    return { linked: true, guardianStudentId: link.id, guardianStudentCreated: !existing };
  }

  async linkUserAsGuardianWithStudentLink(tenantId: string, id: string, userId: string): Promise<StudentContactUserGuardianLinkWrite> {
    if (!this.guardians) throw new Error("GUARDIAN_STORE_REQUIRED");
    const notLinked = { linked: false, guardianCreated: false, guardianRoleAdded: false, guardianStudentCreated: false, sessionsRevoked: 0 };
    const record = this.records.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!record || record.guardianId) return notLinked;
    const user = await new InMemoryAuthUserStore().findById(userId);
    if (!user || user.tenantId !== tenantId || !canAttachGuardianRole(user)) return { ...notLinked, userNotEligible: true };
    // ponytail: in-memory driver has no rollback; the Postgres store does all of this in one transaction.
    const existing = await this.guardians.findByUserId(tenantId, userId);
    const guardian = existing ?? await this.guardians.create({ tenantId, firstName: record.firstName, lastName: record.lastName, userId });
    const guardianRoleAdded = !user.roles.includes("GUARDIAN");
    // The in-memory user version bump makes every open session fail the membership check (same effect as revoking).
    if (guardianRoleAdded) addInMemoryAuthUserRole(tenantId, userId, "GUARDIAN");
    const write = await this.linkGuardianWithStudentLink(tenantId, id, guardian.id);
    return { ...write, guardianId: guardian.id, guardianCreated: !existing, guardianRoleAdded, sessionsRevoked: 0 };
  }

  async unlinkGuardian(tenantId: string, id: string, expectedGuardianId: string): Promise<StudentContactGuardianUnlinkWrite> {
    const record = this.records.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!record || record.guardianId !== expectedGuardianId) return { unlinked: false, guardianStudentRemoved: false };
    record.guardianId = undefined;
    record.updatedAt = new Date().toISOString();
    const stillLinked = this.records.some((candidate) => (
      candidate.tenantId === tenantId && candidate.studentId === record.studentId && candidate.guardianId === expectedGuardianId && !candidate.deletedAt
    ));
    const guardianStudentRemoved = !stillLinked && Boolean(await this.guardianStudents?.delete(expectedGuardianId, record.studentId));
    return { unlinked: true, studentId: record.studentId, guardianStudentRemoved };
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const index = this.records.findIndex((record) => record.tenantId === tenantId && record.id === id && !record.deletedAt);
    const record = this.records[index];
    if (!record) return false;
    const deletedAt = new Date().toISOString();
    this.records[index] = {
      ...record,
      firstName: "Anonim",
      lastName: "İletişim",
      relationType: "OTHER",
      phoneEncrypted: undefined,
      phoneHash: undefined,
      emailEncrypted: undefined,
      emailHash: undefined,
      canReceiveSms: false,
      canReceiveAnnouncements: false,
      canReceiveFinance: false,
      consentSource: undefined,
      consentRecordedAt: undefined,
      guardianId: undefined,
      deletedAt,
      updatedAt: deletedAt,
    };
    return true;
  }

  async purgeByStudent(tenantId: string, studentId: string): Promise<number> {
    const records = this.records.filter((record) => record.tenantId === tenantId && record.studentId === studentId);
    const purgedAt = new Date().toISOString();
    for (const record of records) {
      Object.assign(record, {
        firstName: "Anonim",
        lastName: "İletişim",
        relationType: "OTHER",
        phoneEncrypted: undefined,
        phoneHash: undefined,
        emailEncrypted: undefined,
        emailHash: undefined,
        canReceiveSms: false,
        canReceiveAnnouncements: false,
        canReceiveFinance: false,
        consentSource: undefined,
        consentRecordedAt: undefined,
        guardianId: undefined,
        deletedAt: purgedAt,
        updatedAt: purgedAt,
      });
    }
    return records.length;
  }
}

export class PostgresStudentContactStore implements StudentContactStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listByStudent(tenantId: string, studentId: string): Promise<StudentContactStorageRecord[]> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<StudentContactRow>(
        `SELECT * FROM "StudentContact"
         WHERE "tenantId" = $1 AND "studentId" = $2 AND "deletedAt" IS NULL
         ORDER BY "lastName", "firstName", "id"`,
        [tenantId, studentId],
      );
      return result.rows.map(toStudentContactStorageRecord);
    });
  }

  async findById(tenantId: string, id: string): Promise<StudentContactStorageRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<StudentContactRow>(
        `SELECT * FROM "StudentContact" WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        [tenantId, id],
      );
      return result.rows[0] ? toStudentContactStorageRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: StudentContactStoreInput): Promise<StudentContactStorageRecord> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      const result = await client.query<StudentContactRow>(
        `INSERT INTO "StudentContact" (
           "id", "tenantId", "studentId", "firstName", "lastName", "relationType",
           "phoneEncrypted", "phoneHash", "emailEncrypted", "emailHash",
           "canReceiveSms", "canReceiveAnnouncements", "canReceiveFinance", "consentSource", "consentRecordedAt", "updatedAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) RETURNING *`,
        contactParams(randomUUID(), input),
      );
      const record = result.rows[0];
      if (!record) throw new Error("STUDENT_CONTACT_CREATE_FAILED");
      return toStudentContactStorageRecord(record);
    });
  }

  async update(id: string, input: StudentContactStoreInput): Promise<StudentContactStorageRecord | undefined> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      const params = contactParams(id, input);
      const result = await client.query<StudentContactRow>(
        `UPDATE "StudentContact" SET
           "studentId"=$3, "firstName"=$4, "lastName"=$5, "relationType"=$6,
           "phoneEncrypted"=$7, "phoneHash"=$8, "emailEncrypted"=$9, "emailHash"=$10,
           "canReceiveSms"=$11, "canReceiveAnnouncements"=$12, "canReceiveFinance"=$13,
           "consentSource"=$14, "consentRecordedAt"=$15, "updatedAt"=now()
         WHERE "tenantId"=$2 AND "id"=$1 AND "deletedAt" IS NULL RETURNING *`,
        params,
      );
      return result.rows[0] ? toStudentContactStorageRecord(result.rows[0]) : undefined;
    });
  }

  async linkGuardian(tenantId: string, id: string, guardianId: string): Promise<boolean> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE "StudentContact" SET "guardianId"=$3, "updatedAt"=now()
         WHERE "tenantId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND "guardianId" IS NULL RETURNING "id"`,
        [tenantId, id, guardianId],
      );
      return Boolean(result.rows[0]);
    });
  }

  async linkGuardianWithStudentLink(tenantId: string, id: string, guardianId: string): Promise<StudentContactGuardianLinkWrite> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const contact = await lockUnlinkedContact(client, tenantId, id);
      if (!contact) return { linked: false, guardianStudentCreated: false };
      return linkLockedContact(client, tenantId, id, guardianId, contact.studentId);
    });
  }

  async linkUserAsGuardianWithStudentLink(tenantId: string, id: string, userId: string): Promise<StudentContactUserGuardianLinkWrite> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const notLinked = { linked: false, guardianCreated: false, guardianRoleAdded: false, guardianStudentCreated: false, sessionsRevoked: 0 };
      const contact = await lockUnlinkedContact(client, tenantId, id);
      if (!contact) return notLinked;
      // The user row lock serializes concurrent role/guardian writes for the same person.
      const user = await client.query<{ id: string }>(
        `SELECT "id" FROM "User" WHERE "tenantId"=$1 AND "id"=$2 FOR UPDATE`,
        [tenantId, userId],
      );
      const memberships = await client.query<{ role: string; staffRole: string | null; hasTeacherPersona: boolean; hasStudentPersona: boolean }>(
        `SELECT "role"::text AS role, "staffRole"::text AS "staffRole", "hasTeacherPersona", "hasStudentPersona"
         FROM "TenantMembership"
         WHERE "tenantId"=$1 AND "userId"=$2 AND "status"='ACTIVE'
         FOR UPDATE`,
        [tenantId, userId],
      );
      const rows = memberships.rows;
      const canonical = rows.filter((row) => row.staffRole !== null || row.hasTeacherPersona || row.hasStudentPersona);
      if (!user.rows[0] || !canAttachGuardianRole({
        roles: rows.map((row) => row.role),
        membership: canonical.length === 1 ? { hasStudentPersona: canonical[0]!.hasStudentPersona } : undefined,
      }) || canonical.length > 1) {
        return { ...notLinked, userNotEligible: true };
      }

      const existing = await client.query<{ id: string }>(
        `SELECT "id" FROM "Guardian" WHERE "tenantId"=$1 AND "userId"=$2 AND "deletedAt" IS NULL FOR UPDATE`,
        [tenantId, userId],
      );
      const guardianId = existing.rows[0]?.id ?? (await client.query<{ id: string }>(
        `INSERT INTO "Guardian" ("id", "tenantId", "firstName", "lastName", "userId", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING "id"`,
        [randomUUID(), tenantId, contact.firstName, contact.lastName, userId],
      )).rows[0]?.id;
      if (!guardianId) throw new Error("STUDENT_CONTACT_GUARDIAN_CREATE_FAILED");

      const guardianRoleAdded = !rows.some((row) => row.role === "GUARDIAN");
      let sessionsRevoked = 0;
      if (guardianRoleAdded) {
        // Existing memberships are never deleted or changed beyond the shared version (DEC-20260801-01 parity).
        const version = (await client.query<{ membershipVersion: number }>(
          `UPDATE "User" SET "membershipVersion"="membershipVersion" + 1, "updatedAt"=now()
           WHERE "tenantId"=$1 AND "id"=$2 RETURNING "membershipVersion"`,
          [tenantId, userId],
        )).rows[0]?.membershipVersion;
        if (version === undefined) throw new Error("STUDENT_CONTACT_GUARDIAN_ROLE_FAILED");
        await client.query(
          `INSERT INTO "TenantMembership" (
             "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
             "status", "version", "scopeMode", "updatedAt"
           ) VALUES ($1, $2, $3, 'GUARDIAN', NULL, false, false, 'ACTIVE', $4, 'TENANT', now())
           ON CONFLICT ("tenantId", "userId", "role") DO UPDATE
           SET "status"='ACTIVE', "endsAt"=NULL, "endedReason"=NULL, "version"=EXCLUDED."version", "updatedAt"=now()`,
          [randomUUID(), tenantId, userId, version],
        );
        await client.query(
          `UPDATE "TenantMembership" SET "version"=$3, "updatedAt"=now()
           WHERE "tenantId"=$1 AND "userId"=$2 AND "status"='ACTIVE'`,
          [tenantId, userId, version],
        );
        // Same pattern as an employee access change: open sessions close; the next login offers the GUARDIAN persona.
        sessionsRevoked = (await client.query(
          `UPDATE "AuthSession" SET "status"='REVOKED', "updatedAt"=now()
           WHERE "tenantId"=$1 AND "userId"=$2 AND "status"='ACTIVE' RETURNING "id"`,
          [tenantId, userId],
        )).rows.length;
      }

      const write = await linkLockedContact(client, tenantId, id, guardianId, contact.studentId);
      return { ...write, guardianId, guardianCreated: !existing.rows[0], guardianRoleAdded, sessionsRevoked };
    });
  }

  async unlinkGuardian(tenantId: string, id: string, expectedGuardianId: string): Promise<StudentContactGuardianUnlinkWrite> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const updated = await client.query<{ studentId: string }>(
        `UPDATE "StudentContact" SET "guardianId"=NULL, "updatedAt"=now()
         WHERE "tenantId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND "guardianId"=$3 RETURNING "studentId"`,
        [tenantId, id, expectedGuardianId],
      );
      const studentId = updated.rows[0]?.studentId;
      if (!studentId) return { unlinked: false, guardianStudentRemoved: false };
      // Lock the access link first so a concurrent link of a sibling contact commits (and becomes visible) before
      // the "still referenced" check; deleting it while referenced would SET NULL that contact through the FK.
      const link = await client.query<{ id: string }>(
        `SELECT "id" FROM "GuardianStudent" WHERE "tenantId"=$1 AND "guardianId"=$2 AND "studentId"=$3 FOR UPDATE`,
        [tenantId, expectedGuardianId, studentId],
      );
      if (!link.rows[0]) return { unlinked: true, studentId, guardianStudentRemoved: false };
      const stillReferenced = await client.query(
        `SELECT 1 FROM "StudentContact"
         WHERE "tenantId"=$1 AND "studentId"=$2 AND "guardianId"=$3 AND "deletedAt" IS NULL LIMIT 1`,
        [tenantId, studentId, expectedGuardianId],
      );
      if (stillReferenced.rows[0]) return { unlinked: true, studentId, guardianStudentRemoved: false };
      const removed = await client.query(
        `DELETE FROM "GuardianStudent" WHERE "tenantId"=$1 AND "guardianId"=$2 AND "studentId"=$3 RETURNING "id"`,
        [tenantId, expectedGuardianId, studentId],
      );
      return { unlinked: true, studentId, guardianStudentRemoved: Boolean(removed.rows[0]) };
    });
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE "StudentContact" SET
           "firstName"='Anonim', "lastName"='İletişim', "relationType"='OTHER',
           "phoneEncrypted"=NULL, "phoneHash"=NULL, "emailEncrypted"=NULL, "emailHash"=NULL,
           "canReceiveSms"=false, "canReceiveAnnouncements"=false, "canReceiveFinance"=false,
           "consentSource"=NULL, "consentRecordedAt"=NULL, "guardianId"=NULL, "deletedAt"=now(), "updatedAt"=now()
         WHERE "tenantId"=$1 AND "id"=$2 AND "deletedAt" IS NULL RETURNING "id"`,
        [tenantId, id],
      );
      return Boolean(result.rows[0]);
    });
  }

  async purgeByStudent(tenantId: string, studentId: string): Promise<number> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE "StudentContact" SET
           "firstName"='Anonim', "lastName"='İletişim', "relationType"='OTHER',
           "phoneEncrypted"=NULL, "phoneHash"=NULL, "emailEncrypted"=NULL, "emailHash"=NULL,
           "canReceiveSms"=false, "canReceiveAnnouncements"=false, "canReceiveFinance"=false,
           "consentSource"=NULL, "consentRecordedAt"=NULL, "guardianId"=NULL, "deletedAt"=now(), "updatedAt"=now()
         WHERE "tenantId"=$1 AND "studentId"=$2
         RETURNING "id"`,
        [tenantId, studentId],
      );
      return result.rowCount ?? result.rows.length;
    });
  }
}

export function createStudentContactStore(guardianStudents?: GuardianStudentStore, guardians?: GuardianStore): StudentContactStore {
  return resolvePersistenceDriver(process.env.STUDENT_CONTACT_STORE) === "postgres"
    ? new PostgresStudentContactStore()
    : new InMemoryStudentContactStore(guardianStudents, guardians);
}

async function lockUnlinkedContact(
  client: Queryable,
  tenantId: string,
  id: string,
): Promise<{ studentId: string; firstName: string; lastName: string } | undefined> {
  const contact = await client.query<{ studentId: string; firstName: string; lastName: string }>(
    `SELECT "studentId", "firstName", "lastName" FROM "StudentContact"
     WHERE "tenantId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND "guardianId" IS NULL
     FOR UPDATE`,
    [tenantId, id],
  );
  return contact.rows[0];
}

/** Ensures GuardianStudent (permissions off when created) and sets the locked contact's guardianId. */
async function linkLockedContact(
  client: Queryable,
  tenantId: string,
  id: string,
  guardianId: string,
  studentId: string,
): Promise<StudentContactGuardianLinkWrite> {
  // Same defaults as GuardianStudentStore.create: every permission stays off.
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO "GuardianStudent" (
       "id", "tenantId", "guardianId", "studentId",
       "canViewFinance", "canReceiveSms", "canReceiveAnnouncements", "canOpenSupportTickets", "updatedAt"
     ) VALUES ($1, $2, $3, $4, false, false, false, false, now())
     ON CONFLICT ("tenantId", "guardianId", "studentId") DO NOTHING
     RETURNING "id"`,
    [randomUUID(), tenantId, guardianId, studentId],
  );
  // KEY SHARE keeps a concurrent unlink from deleting the link this contact is about to reference.
  const link = inserted.rows[0] ?? (await client.query<{ id: string }>(
    `SELECT "id" FROM "GuardianStudent" WHERE "tenantId"=$1 AND "guardianId"=$2 AND "studentId"=$3 LIMIT 1 FOR KEY SHARE`,
    [tenantId, guardianId, studentId],
  )).rows[0];
  if (!link) throw new Error("STUDENT_CONTACT_GUARDIAN_LINK_FAILED");
  const updated = await client.query(
    `UPDATE "StudentContact" SET "guardianId"=$3, "updatedAt"=now()
     WHERE "tenantId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND "guardianId" IS NULL RETURNING "id"`,
    [tenantId, id, guardianId],
  );
  // The row is locked by the caller; a miss here rolls the GuardianStudent insert back with it.
  if (!updated.rows[0]) throw new Error("STUDENT_CONTACT_GUARDIAN_LINK_FAILED");
  return { linked: true, guardianStudentId: link.id, guardianStudentCreated: Boolean(inserted.rows[0]) };
}

function contactParams(id: string, input: StudentContactStoreInput): unknown[] {
  return [
    id, input.tenantId, input.studentId, input.firstName, input.lastName, input.relationType,
    input.phoneEncrypted ?? null, input.phoneHash ?? null, input.emailEncrypted ?? null, input.emailHash ?? null,
    input.canReceiveSms, input.canReceiveAnnouncements, input.canReceiveFinance,
    input.consentSource ?? null, input.consentRecordedAt ?? null,
  ];
}

interface StudentContactRow {
  id: string;
  tenantId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  relationType: StudentContactRelationType;
  phoneEncrypted: string | null;
  phoneHash: string | null;
  emailEncrypted: string | null;
  emailHash: string | null;
  canReceiveSms: boolean;
  canReceiveAnnouncements: boolean;
  canReceiveFinance: boolean;
  consentSource: string | null;
  consentRecordedAt: Date | null;
  guardianId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toStudentContactStorageRecord(row: StudentContactRow): StudentContactStorageRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    firstName: row.firstName,
    lastName: row.lastName,
    relationType: row.relationType,
    phoneEncrypted: row.phoneEncrypted ?? undefined,
    phoneHash: row.phoneHash ?? undefined,
    emailEncrypted: row.emailEncrypted ?? undefined,
    emailHash: row.emailHash ?? undefined,
    canReceiveSms: row.canReceiveSms,
    canReceiveAnnouncements: row.canReceiveAnnouncements,
    canReceiveFinance: row.canReceiveFinance,
    consentSource: row.consentSource ?? undefined,
    consentRecordedAt: row.consentRecordedAt?.toISOString(),
    guardianId: row.guardianId ?? undefined,
    deletedAt: row.deletedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
