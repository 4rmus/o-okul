import { randomUUID } from "node:crypto";
import pg from "pg";
import type { StudentContactRelationType } from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withExplicitTenantQuery } from "../db/tenant-query.js";

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
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type StudentContactStoreInput = Omit<StudentContactStorageRecord, "id" | "createdAt" | "updatedAt" | "deletedAt">;

export interface StudentContactStore {
  listByStudent(tenantId: string, studentId: string): Promise<StudentContactStorageRecord[]>;
  findById(tenantId: string, id: string): Promise<StudentContactStorageRecord | undefined>;
  create(input: StudentContactStoreInput): Promise<StudentContactStorageRecord>;
  update(id: string, input: StudentContactStoreInput): Promise<StudentContactStorageRecord | undefined>;
  softDelete(tenantId: string, id: string): Promise<boolean>;
  purgeByStudent(tenantId: string, studentId: string): Promise<number>;
}

export const studentContactStoreToken = Symbol("StudentContactStore");

export class InMemoryStudentContactStore implements StudentContactStore {
  private readonly records: StudentContactStorageRecord[] = [];

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

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const record = await this.findById(tenantId, id);
    if (!record) return false;
    record.deletedAt = new Date().toISOString();
    record.updatedAt = record.deletedAt;
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

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `UPDATE "StudentContact" SET "deletedAt"=now(), "updatedAt"=now()
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
           "consentSource"=NULL, "consentRecordedAt"=NULL, "deletedAt"=now(), "updatedAt"=now()
         WHERE "tenantId"=$1 AND "studentId"=$2
         RETURNING "id"`,
        [tenantId, studentId],
      );
      return result.rowCount ?? result.rows.length;
    });
  }
}

export function createStudentContactStore(): StudentContactStore {
  return resolvePersistenceDriver(process.env.STUDENT_CONTACT_STORE) === "postgres"
    ? new PostgresStudentContactStore()
    : new InMemoryStudentContactStore();
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
    deletedAt: row.deletedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
