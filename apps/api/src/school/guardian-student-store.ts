import { randomUUID } from "node:crypto";
import type { GuardianStudentRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type GuardianStudentInput = Pick<GuardianStudentRecord, "tenantId" | "guardianId" | "studentId"> &
  Partial<Pick<
    GuardianStudentRecord,
    "canViewFinance" | "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets"
  >>;

export interface GuardianStudentStore {
  listByGuardian(guardianId: string): Promise<GuardianStudentRecord[]>;
  listByStudent(studentId: string): Promise<GuardianStudentRecord[]>;
  create(input: GuardianStudentInput): Promise<GuardianStudentRecord>;
  update(guardianId: string, studentId: string, input: Partial<GuardianStudentInput>): Promise<GuardianStudentRecord | undefined>;
  delete(guardianId: string, studentId: string): Promise<boolean>;
}

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

  async listByGuardian(guardianId: string): Promise<GuardianStudentRecord[]> {
    return this.links.filter((link) => link.guardianId === guardianId);
  }

  async listByStudent(studentId: string): Promise<GuardianStudentRecord[]> {
    return this.links.filter((link) => link.studentId === studentId);
  }

  async create(input: GuardianStudentInput): Promise<GuardianStudentRecord> {
    const existing = this.links.find(
      (link) =>
        link.tenantId === input.tenantId &&
        link.guardianId === input.guardianId &&
        link.studentId === input.studentId,
    );
    if (existing) {
      return existing;
    }

    const record = {
      id: `guardian-student-${this.links.length + 1}`,
      ...withGuardianStudentDefaults(input),
    };
    this.links.push(record);
    return record;
  }

  async update(guardianId: string, studentId: string, input: Partial<GuardianStudentInput>): Promise<GuardianStudentRecord | undefined> {
    const index = this.links.findIndex((link) => link.guardianId === guardianId && link.studentId === studentId);
    if (index === -1) {
      return undefined;
    }

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

  async delete(guardianId: string, studentId: string): Promise<boolean> {
    const index = this.links.findIndex((link) => link.guardianId === guardianId && link.studentId === studentId);
    if (index === -1) {
      return false;
    }

    this.links.splice(index, 1);
    return true;
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

  async create(input: GuardianStudentInput): Promise<GuardianStudentRecord> {
    const recordInput = withGuardianStudentDefaults(input);
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<GuardianStudentRow>(
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
         ON CONFLICT ("tenantId", "guardianId", "studentId") DO NOTHING
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
      const row = inserted.rows[0] ?? await findExisting(client, recordInput);
      if (!row) {
        throw new Error("GUARDIAN_STUDENT_LINK_CREATE_FAILED");
      }
      return toGuardianStudentRecord(row);
    });
  }

  async update(guardianId: string, studentId: string, input: Partial<GuardianStudentInput>): Promise<GuardianStudentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianStudentRow>(
        `UPDATE "GuardianStudent"
         SET "canViewFinance" = COALESCE($3, "canViewFinance"),
             "canReceiveSms" = COALESCE($4, "canReceiveSms"),
             "canReceiveAnnouncements" = COALESCE($5, "canReceiveAnnouncements"),
             "canOpenSupportTickets" = COALESCE($6, "canOpenSupportTickets"),
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
        ],
      );
      return result.rows[0] ? toGuardianStudentRecord(result.rows[0]) : undefined;
    });
  }

  async delete(guardianId: string, studentId: string): Promise<boolean> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianStudentRow>(
        `DELETE FROM "GuardianStudent"
         WHERE "guardianId" = $1
           AND "studentId" = $2
         RETURNING *`,
        [guardianId, studentId],
      );
      return result.rows.length > 0;
    });
  }
}

export function createGuardianStudentStore(): GuardianStudentStore {
  return resolvePersistenceDriver(process.env.GUARDIAN_STUDENT_STORE) === "postgres"
    ? new PostgresGuardianStudentStore()
    : new InMemoryGuardianStudentStore();
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

async function findExisting(
  client: Queryable,
  input: GuardianStudentInput,
): Promise<GuardianStudentRow | undefined> {
  const existing = await client.query<GuardianStudentRow>(
    `SELECT *
     FROM "GuardianStudent"
     WHERE "tenantId" = $1
       AND "guardianId" = $2
       AND "studentId" = $3
     LIMIT 1`,
    [input.tenantId, input.guardianId, input.studentId],
  );
  return existing.rows[0];
}

function toGuardianStudentRecord(row: GuardianStudentRow): GuardianStudentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guardianId: row.guardianId,
    studentId: row.studentId,
    canViewFinance: row.canViewFinance ?? true,
    canReceiveSms: row.canReceiveSms ?? true,
    canReceiveAnnouncements: row.canReceiveAnnouncements ?? true,
    canOpenSupportTickets: row.canOpenSupportTickets ?? true,
    createdAt: row.createdAt ? toIsoString(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? toIsoString(row.updatedAt) : undefined,
  };
}

function withGuardianStudentDefaults(input: GuardianStudentInput): Omit<GuardianStudentRecord, "id"> {
  return {
    tenantId: input.tenantId,
    guardianId: input.guardianId,
    studentId: input.studentId,
    canViewFinance: input.canViewFinance ?? true,
    canReceiveSms: input.canReceiveSms ?? true,
    canReceiveAnnouncements: input.canReceiveAnnouncements ?? true,
    canOpenSupportTickets: input.canOpenSupportTickets ?? true,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
