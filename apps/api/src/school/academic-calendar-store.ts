import { randomUUID } from "node:crypto";
import type { AcademicTermRecord as SharedAcademicTermRecord, AcademicYearRecord as SharedAcademicYearRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery, withTenantQuery } from "../db/tenant-query.js";

export interface AcademicYearRecord extends SharedAcademicYearRecord {
  deletedAt?: string;
}

export interface AcademicTermRecord extends SharedAcademicTermRecord {
  deletedAt?: string;
}

/** Sentinel error messages thrown by `activate`; the service maps them to HTTP exceptions. */
export const academicCalendarActivationErrors = {
  yearNotFound: "ACADEMIC_YEAR_NOT_FOUND",
  termNotFound: "ACADEMIC_TERM_NOT_FOUND",
  termYearMismatch: "ACADEMIC_TERM_YEAR_MISMATCH",
  notStarted: "ACADEMIC_CALENDAR_NOT_STARTED",
} as const;

export interface AcademicCalendarActivationInput {
  tenantId: string;
  academicYearId: string;
  termId: string;
  /** Calendar date (YYYY-MM-DD); a year or term starting after it is refused. */
  today: string;
  /** Runs on the open transaction after the writes, e.g. to complete the idempotency key atomically. */
  finalize?: (client: Queryable, result: AcademicCalendarActivation) => Promise<void>;
}

export interface AcademicCalendarActivation {
  academicYear: AcademicYearRecord;
  term: AcademicTermRecord;
  deactivatedAcademicYearIds: string[];
  deactivatedTermIds: string[];
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
  /**
   * DEC-20261102-08: makes exactly one year and one of its terms active for the tenant in one transaction; every
   * other year and term of that tenant is deactivated. Throws `academicCalendarActivationErrors` sentinels.
   */
  activate(input: AcademicCalendarActivationInput): Promise<AcademicCalendarActivation>;
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

  async activate(input: AcademicCalendarActivationInput): Promise<AcademicCalendarActivation> {
    const { year, term } = requireActivationTargets(
      input,
      this.years.find((record) => record.tenantId === input.tenantId && record.id === input.academicYearId && !record.deletedAt),
      this.terms.find((record) => record.tenantId === input.tenantId && record.id === input.termId && !record.deletedAt),
    );
    const deactivatedAcademicYearIds = this.years
      .filter((record) => record.tenantId === input.tenantId && record.isActive && record.id !== year.id)
      .map((record) => record.id);
    const deactivatedTermIds = this.terms
      .filter((record) => record.tenantId === input.tenantId && record.isActive && record.id !== term.id)
      .map((record) => record.id);
    for (const record of this.years) {
      if (record.tenantId === input.tenantId) record.isActive = record.id === year.id;
    }
    for (const record of this.terms) {
      if (record.tenantId === input.tenantId) record.isActive = record.id === term.id;
    }
    return { academicYear: { ...year }, term: { ...term }, deactivatedAcademicYearIds, deactivatedTermIds };
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

  async activate(input: AcademicCalendarActivationInput): Promise<AcademicCalendarActivation> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      // One activation per tenant at a time: without it two concurrent activations could each leave their own
      // year active, because an UPDATE skips rows whose snapshot version did not match its predicate.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`academic-calendar-activation:${input.tenantId}`]);
      const yearResult = await client.query<AcademicYearRow>(
        `SELECT * FROM "AcademicYear" WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL FOR UPDATE`,
        [input.tenantId, input.academicYearId],
      );
      const termResult = await client.query<AcademicTermRow>(
        `SELECT * FROM "AcademicTerm" WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL FOR UPDATE`,
        [input.tenantId, input.termId],
      );
      const { year, term } = requireActivationTargets(
        input,
        yearResult.rows[0] ? toAcademicYearRecord(yearResult.rows[0]) : undefined,
        termResult.rows[0] ? toAcademicTermRecord(termResult.rows[0]) : undefined,
      );

      const years = await client.query<{ id: string; isActive: boolean }>(
        `UPDATE "AcademicYear"
         SET "isActive" = ("id" = $2), "updatedAt" = now()
         WHERE "tenantId" = $1 AND "isActive" IS DISTINCT FROM ("id" = $2)
         RETURNING "id", "isActive"`,
        [input.tenantId, year.id],
      );
      const terms = await client.query<{ id: string; isActive: boolean }>(
        `UPDATE "AcademicTerm"
         SET "isActive" = ("id" = $2), "updatedAt" = now()
         WHERE "tenantId" = $1 AND "isActive" IS DISTINCT FROM ("id" = $2)
         RETURNING "id", "isActive"`,
        [input.tenantId, term.id],
      );
      const result: AcademicCalendarActivation = {
        academicYear: { ...year, isActive: true },
        term: { ...term, isActive: true },
        deactivatedAcademicYearIds: years.rows.filter((row) => !row.isActive).map((row) => row.id).sort(),
        deactivatedTermIds: terms.rows.filter((row) => !row.isActive).map((row) => row.id).sort(),
      };
      await input.finalize?.(client, result);
      return result;
    });
  }
}

/** The current calendar date in Türkiye; term starts are school-local dates. */
export function istanbulDateString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function requireActivationTargets(
  input: AcademicCalendarActivationInput,
  year: AcademicYearRecord | undefined,
  term: AcademicTermRecord | undefined,
): { year: AcademicYearRecord; term: AcademicTermRecord } {
  if (!year) throw new Error(academicCalendarActivationErrors.yearNotFound);
  if (!term) throw new Error(academicCalendarActivationErrors.termNotFound);
  if (term.academicYearId !== year.id) throw new Error(academicCalendarActivationErrors.termYearMismatch);
  if (year.startsAt > input.today || term.startsAt > input.today) throw new Error(academicCalendarActivationErrors.notStarted);
  return { year, term };
}

export function createAcademicCalendarStore(): AcademicCalendarStore {
  return resolvePersistenceDriver(process.env.ACADEMIC_CALENDAR_STORE) === "postgres"
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
