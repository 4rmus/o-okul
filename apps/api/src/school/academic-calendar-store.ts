import { randomUUID } from "node:crypto";
import type { AcademicTermRecord as SharedAcademicTermRecord, AcademicYearRecord as SharedAcademicYearRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface AcademicYearRecord extends SharedAcademicYearRecord {
  deletedAt?: string;
}

export interface AcademicTermRecord extends SharedAcademicTermRecord {
  deletedAt?: string;
}

export interface AcademicCalendarStore {
  listYears(): Promise<AcademicYearRecord[]>;
  findYearById(id: string): Promise<AcademicYearRecord | undefined>;
  createYear(input: Omit<AcademicYearRecord, "id">): Promise<AcademicYearRecord>;
  updateYear(id: string, input: Partial<Pick<AcademicYearRecord, "name" | "startsAt" | "endsAt" | "isActive">>): Promise<AcademicYearRecord | undefined>;
  softDeleteYear(id: string, deletedAt: string): Promise<AcademicYearRecord | undefined>;
  listTerms(): Promise<AcademicTermRecord[]>;
  findTermById(id: string): Promise<AcademicTermRecord | undefined>;
  createTerm(input: Omit<AcademicTermRecord, "id">): Promise<AcademicTermRecord>;
  updateTerm(id: string, input: Partial<Pick<AcademicTermRecord, "academicYearId" | "name" | "startsAt" | "endsAt" | "isActive">>): Promise<AcademicTermRecord | undefined>;
  softDeleteTerm(id: string, deletedAt: string): Promise<AcademicTermRecord | undefined>;
}

export const academicCalendarStoreToken = Symbol("AcademicCalendarStore");

const demoYears: AcademicYearRecord[] = [
  { id: "academic-year-2026", tenantId: "tenant-a", name: "2025-2026", startsAt: "2025-09-01", endsAt: "2026-06-30", isActive: true },
  { id: "academic-year-2026-b", tenantId: "tenant-b", name: "2025-2026", startsAt: "2025-09-01", endsAt: "2026-06-30", isActive: true },
];

const demoTerms: AcademicTermRecord[] = [
  { id: "term-2026-spring", tenantId: "tenant-a", academicYearId: "academic-year-2026", name: "2. Donem", startsAt: "2026-02-01", endsAt: "2026-06-30", isActive: true },
  { id: "term-2026-spring-b", tenantId: "tenant-b", academicYearId: "academic-year-2026-b", name: "2. Donem", startsAt: "2026-02-01", endsAt: "2026-06-30", isActive: true },
];

export class InMemoryAcademicCalendarStore implements AcademicCalendarStore {
  private readonly years = demoYears.map((record) => ({ ...record }));
  private readonly terms = demoTerms.map((record) => ({ ...record }));

  async listYears(): Promise<AcademicYearRecord[]> {
    return this.years;
  }

  async findYearById(id: string): Promise<AcademicYearRecord | undefined> {
    return this.years.find((candidate) => candidate.id === id);
  }

  async createYear(input: Omit<AcademicYearRecord, "id">): Promise<AcademicYearRecord> {
    const record = { id: `academic-year-${this.years.length + 1}`, ...input };
    this.years.push(record);
    return record;
  }

  async updateYear(id: string, input: Partial<Pick<AcademicYearRecord, "name" | "startsAt" | "endsAt" | "isActive">>): Promise<AcademicYearRecord | undefined> {
    const record = await this.findYearById(id);
    if (!record) return undefined;

    if (input.name !== undefined) record.name = input.name;
    if (input.startsAt !== undefined) record.startsAt = input.startsAt;
    if (input.endsAt !== undefined) record.endsAt = input.endsAt;
    if (input.isActive !== undefined) record.isActive = input.isActive;
    return record;
  }

  async softDeleteYear(id: string, deletedAt: string): Promise<AcademicYearRecord | undefined> {
    const record = await this.findYearById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }

  async listTerms(): Promise<AcademicTermRecord[]> {
    return this.terms;
  }

  async findTermById(id: string): Promise<AcademicTermRecord | undefined> {
    return this.terms.find((candidate) => candidate.id === id);
  }

  async createTerm(input: Omit<AcademicTermRecord, "id">): Promise<AcademicTermRecord> {
    const record = { id: `academic-term-${this.terms.length + 1}`, ...input };
    this.terms.push(record);
    return record;
  }

  async updateTerm(id: string, input: Partial<Pick<AcademicTermRecord, "academicYearId" | "name" | "startsAt" | "endsAt" | "isActive">>): Promise<AcademicTermRecord | undefined> {
    const record = await this.findTermById(id);
    if (!record) return undefined;

    if (input.academicYearId !== undefined) record.academicYearId = input.academicYearId;
    if (input.name !== undefined) record.name = input.name;
    if (input.startsAt !== undefined) record.startsAt = input.startsAt;
    if (input.endsAt !== undefined) record.endsAt = input.endsAt;
    if (input.isActive !== undefined) record.isActive = input.isActive;
    return record;
  }

  async softDeleteTerm(id: string, deletedAt: string): Promise<AcademicTermRecord | undefined> {
    const record = await this.findTermById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresAcademicCalendarStore implements AcademicCalendarStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listYears(): Promise<AcademicYearRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicYearRow>(`SELECT * FROM "AcademicYear"`);
      return result.rows.map(toAcademicYearRecord);
    });
  }

  async findYearById(id: string): Promise<AcademicYearRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicYearRow>(`SELECT * FROM "AcademicYear" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toAcademicYearRecord(result.rows[0]) : undefined;
    });
  }

  async createYear(input: Omit<AcademicYearRecord, "id">): Promise<AcademicYearRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicYearRow>(
        `INSERT INTO "AcademicYear" ("id", "tenantId", "name", "startsAt", "endsAt", "isActive", "updatedAt")
         VALUES ($1, $2, $3, $4::date, $5::date, $6, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.name, input.startsAt, input.endsAt, input.isActive],
      );
      const record = result.rows[0];
      if (!record) throw new Error("ACADEMIC_YEAR_CREATE_FAILED");
      return toAcademicYearRecord(record);
    });
  }

  async updateYear(id: string, input: Partial<Pick<AcademicYearRecord, "name" | "startsAt" | "endsAt" | "isActive">>): Promise<AcademicYearRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicYearRow>(
        `UPDATE "AcademicYear"
         SET "name" = COALESCE($2, "name"),
             "startsAt" = CASE WHEN $3 THEN $4::date ELSE "startsAt" END,
             "endsAt" = CASE WHEN $5 THEN $6::date ELSE "endsAt" END,
             "isActive" = COALESCE($7, "isActive"),
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.name ?? null, input.startsAt !== undefined, input.startsAt ?? null, input.endsAt !== undefined, input.endsAt ?? null, input.isActive ?? null],
      );
      return result.rows[0] ? toAcademicYearRecord(result.rows[0]) : undefined;
    });
  }

  async softDeleteYear(id: string, deletedAt: string): Promise<AcademicYearRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicYearRow>(
        `UPDATE "AcademicYear" SET "deletedAt" = $2, "updatedAt" = now() WHERE "id" = $1 RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toAcademicYearRecord(result.rows[0]) : undefined;
    });
  }

  async listTerms(): Promise<AcademicTermRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicTermRow>(`SELECT * FROM "AcademicTerm"`);
      return result.rows.map(toAcademicTermRecord);
    });
  }

  async findTermById(id: string): Promise<AcademicTermRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicTermRow>(`SELECT * FROM "AcademicTerm" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toAcademicTermRecord(result.rows[0]) : undefined;
    });
  }

  async createTerm(input: Omit<AcademicTermRecord, "id">): Promise<AcademicTermRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicTermRow>(
        `INSERT INTO "AcademicTerm" ("id", "tenantId", "academicYearId", "name", "startsAt", "endsAt", "isActive", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.academicYearId, input.name, input.startsAt, input.endsAt, input.isActive],
      );
      const record = result.rows[0];
      if (!record) throw new Error("ACADEMIC_TERM_CREATE_FAILED");
      return toAcademicTermRecord(record);
    });
  }

  async updateTerm(id: string, input: Partial<Pick<AcademicTermRecord, "academicYearId" | "name" | "startsAt" | "endsAt" | "isActive">>): Promise<AcademicTermRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicTermRow>(
        `UPDATE "AcademicTerm"
         SET "academicYearId" = COALESCE($2, "academicYearId"),
             "name" = COALESCE($3, "name"),
             "startsAt" = CASE WHEN $4 THEN $5::date ELSE "startsAt" END,
             "endsAt" = CASE WHEN $6 THEN $7::date ELSE "endsAt" END,
             "isActive" = COALESCE($8, "isActive"),
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.academicYearId ?? null, input.name ?? null, input.startsAt !== undefined, input.startsAt ?? null, input.endsAt !== undefined, input.endsAt ?? null, input.isActive ?? null],
      );
      return result.rows[0] ? toAcademicTermRecord(result.rows[0]) : undefined;
    });
  }

  async softDeleteTerm(id: string, deletedAt: string): Promise<AcademicTermRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicTermRow>(
        `UPDATE "AcademicTerm" SET "deletedAt" = $2, "updatedAt" = now() WHERE "id" = $1 RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toAcademicTermRecord(result.rows[0]) : undefined;
    });
  }
}

export function createAcademicCalendarStore(): AcademicCalendarStore {
  return process.env.ACADEMIC_CALENDAR_STORE === "postgres"
    ? new PostgresAcademicCalendarStore()
    : new InMemoryAcademicCalendarStore();
}

interface AcademicYearRow {
  id: string;
  tenantId: string;
  name: string;
  startsAt: Date | string;
  endsAt: Date | string;
  isActive: boolean;
  deletedAt: Date | string | null;
}

interface AcademicTermRow extends AcademicYearRow {
  academicYearId: string;
}

function toAcademicYearRecord(row: AcademicYearRow): AcademicYearRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    startsAt: toDateString(row.startsAt),
    endsAt: toDateString(row.endsAt),
    isActive: row.isActive,
    deletedAt: row.deletedAt ? toIsoString(row.deletedAt) : undefined,
  };
}

function toAcademicTermRecord(row: AcademicTermRow): AcademicTermRecord {
  return {
    ...toAcademicYearRecord(row),
    academicYearId: row.academicYearId,
  };
}

function toDateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
