import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery, withExplicitTenantQuery } from "../db/tenant-query.js";
import { resolveLicenseState, type LicenseState } from "./license-state.js";

export interface LicenseTermRecord {
  id: string;
  tenantId: string;
  planCode: string;
  startsAt: string;
  endsAt: string;
  activeStudentLimit: number;
  cancelledAt?: string;
  createdByPlatformAccountId?: string;
  auditReference?: string;
}

export interface TenantLicenseResolution {
  mirrorParity: boolean;
  state: LicenseState;
  term: LicenseTermRecord;
}

export interface LicenseTermStore {
  listForTenant?(tenantId: string): Promise<LicenseTermRecord[]>;
  resolveForTenant(tenantId: string, at?: Date): Promise<TenantLicenseResolution | undefined>;
  create(input: CreateLicenseTermInput): Promise<LicenseTermRecord>;
}

export interface CreateLicenseTermInput {
  tenantId: string;
  planCode: string;
  startsAt: string;
  endsAt: string;
  activeStudentLimit: number;
  createdByPlatformAccountId: string;
  auditReference: string;
}

export const licenseTermStoreToken = Symbol("LicenseTermStore");

const demoTerms: LicenseTermRecord[] = [
  createDemoTerm("tenant-a", "PRO", "2099-01-01T00:00:00.000Z", 1_000),
  createDemoTerm("tenant-b", "TRIAL", "2099-01-01T00:00:00.000Z", 100),
  createDemoTerm("tenant-expired", "TRIAL", "2020-01-01T00:00:00.000Z", 100),
];

export class InMemoryLicenseTermStore implements LicenseTermStore {
  private readonly terms: LicenseTermRecord[];
  private readonly allowImplicitFixtureTerm: boolean;

  constructor(terms?: LicenseTermRecord[]) {
    this.terms = terms ?? demoTerms;
    this.allowImplicitFixtureTerm = terms === undefined;
  }

  async listForTenant(tenantId: string): Promise<LicenseTermRecord[]> {
    return this.terms
      .filter((term) => term.tenantId === tenantId)
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt))
      .map((term) => ({ ...term }));
  }

  async resolveForTenant(tenantId: string, at = new Date()): Promise<TenantLicenseResolution | undefined> {
    const tenantTerms = this.terms.filter((term) => term.tenantId === tenantId);
    if (tenantTerms.length === 0 && this.allowImplicitFixtureTerm) {
      return resolveTenantLicense([createDemoTerm(tenantId, "TRIAL", "2099-01-01T00:00:00.000Z", 100)], at, true);
    }
    return resolveTenantLicense(tenantTerms, at, true);
  }

  async create(input: CreateLicenseTermInput): Promise<LicenseTermRecord> {
    const term: LicenseTermRecord = { id: randomUUID(), ...input };
    const overlaps = this.terms.some((candidate) => candidate.tenantId === input.tenantId
      && candidate.cancelledAt === undefined
      && Date.parse(candidate.startsAt) < Date.parse(input.endsAt)
      && Date.parse(input.startsAt) < Date.parse(candidate.endsAt));
    if (overlaps) throw new Error("LICENSE_TERM_OVERLAP");
    this.terms.push(term);
    return { ...term };
  }
}

export class PostgresLicenseTermStore implements LicenseTermStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listForTenant(tenantId: string): Promise<LicenseTermRecord[]> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<LicenseTermRow>(
        `SELECT "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit",
                "cancelledAt", "createdByPlatformAccountId", "auditReference"
         FROM "LicenseTerm"
         WHERE "tenantId" = $1
         ORDER BY "startsAt" DESC, "id" ASC`,
        [tenantId],
      );
      return result.rows.map(mapLicenseTermRow);
    });
  }

  async resolveForTenant(tenantId: string, at = new Date()): Promise<TenantLicenseResolution | undefined> {
    const result = await withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<LicenseTermRow>(
        `SELECT "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit",
                "cancelledAt", "createdByPlatformAccountId", "auditReference"
         FROM "LicenseTerm"
         WHERE "tenantId" = $1
         ORDER BY "startsAt" ASC, "id" ASC`,
        [tenantId],
      );
      const parity = await client.query<{ matches: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM "Tenant" tenant
           JOIN "LicenseTerm" term ON term."tenantId" = tenant."id" AND term."cancelledAt" IS NULL
           WHERE tenant."id" = $1
             AND term."planCode" = tenant."plan"
             AND term."startsAt" = tenant."licenseStartsAt"
             AND term."endsAt" = tenant."licenseEndsAt"
             AND term."activeStudentLimit" = tenant."seatLimit"
         ) AS matches`,
        [tenantId],
      );
      return { terms: result.rows.map(mapLicenseTermRow), mirrorParity: parity.rows[0]?.matches === true };
    });
    return resolveTenantLicense(result.terms, at, result.mirrorParity);
  }

  async create(input: CreateLicenseTermInput): Promise<LicenseTermRecord> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const inserted = await client.query<LicenseTermRow>(
        `INSERT INTO "LicenseTerm" (
           "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit",
           "createdByPlatformAccountId", "auditReference", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         RETURNING "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit",
                   "cancelledAt", "createdByPlatformAccountId", "auditReference"`,
        [input.tenantId, input.planCode, input.startsAt, input.endsAt, input.activeStudentLimit, input.createdByPlatformAccountId, input.auditReference],
      );
      await client.query(
        `UPDATE "Tenant"
         SET "plan" = $2, "licenseStartsAt" = $3, "licenseEndsAt" = $4, "seatLimit" = $5, "updatedAt" = now()
         WHERE "id" = $1 AND "id" <> 'system'`,
        [input.tenantId, input.planCode, input.startsAt, input.endsAt, input.activeStudentLimit],
      );
      await client.query(`SELECT o_okul_refresh_license_usage($1)`, [input.tenantId]);
      const row = inserted.rows[0];
      if (!row) throw new Error("LICENSE_TERM_CREATE_FAILED");
      return mapLicenseTermRow(row);
    });
  }
}

export function resolveTenantLicense(
  terms: readonly LicenseTermRecord[],
  at = new Date(),
  mirrorParity = true,
): TenantLicenseResolution | undefined {
  if (terms.length === 0) return undefined;
  const candidates = terms.map((term) => ({ term, state: resolveLicenseState(term, at) }));
  const active = candidates.filter((candidate) => candidate.state === "ACTIVE");
  if (active.length > 1) throw new Error("LICENSE_TERM_OVERLAP");
  if (active[0]) return { ...active[0], mirrorParity };

  const current = at.getTime();
  const prior = candidates
    .filter((candidate) => candidate.state !== "CANCELLED" && Date.parse(candidate.term.startsAt) <= current)
    .sort(descendingStart)[0];
  if (prior) return { ...prior, mirrorParity };

  const scheduled = candidates
    .filter((candidate) => candidate.state === "SCHEDULED")
    .sort(ascendingStart)[0];
  if (scheduled) return { ...scheduled, mirrorParity };

  const cancelled = candidates.filter((candidate) => candidate.state === "CANCELLED").sort(descendingStart)[0];
  return cancelled ? { ...cancelled, mirrorParity } : undefined;
}

export function createLicenseTermStore(): LicenseTermStore {
  return resolvePersistenceDriver(process.env.TENANT_STORE) === "postgres"
    ? new PostgresLicenseTermStore()
    : new InMemoryLicenseTermStore();
}

function createDemoTerm(tenantId: string, planCode: string, endsAt: string, activeStudentLimit: number): LicenseTermRecord {
  return {
    id: `license-${tenantId}`,
    tenantId,
    planCode,
    startsAt: "2019-01-01T00:00:00.000Z",
    endsAt,
    activeStudentLimit,
  };
}

type LicenseCandidate = Pick<TenantLicenseResolution, "state" | "term">;

function ascendingStart(left: LicenseCandidate, right: LicenseCandidate): number {
  return Date.parse(left.term.startsAt) - Date.parse(right.term.startsAt);
}

function descendingStart(left: LicenseCandidate, right: LicenseCandidate): number {
  return ascendingStart(right, left);
}

interface LicenseTermRow {
  id: string;
  tenantId: string;
  planCode: string;
  startsAt: Date | string;
  endsAt: Date | string;
  activeStudentLimit: number;
  cancelledAt: Date | string | null;
  createdByPlatformAccountId: string | null;
  auditReference: string | null;
}

function mapLicenseTermRow(row: LicenseTermRow): LicenseTermRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planCode: row.planCode,
    startsAt: dateString(row.startsAt),
    endsAt: dateString(row.endsAt),
    activeStudentLimit: row.activeStudentLimit,
    cancelledAt: optionalDateString(row.cancelledAt),
    createdByPlatformAccountId: row.createdByPlatformAccountId ?? undefined,
    auditReference: row.auditReference ?? undefined,
  };
}

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function optionalDateString(value: Date | string | null): string | undefined {
  return value === null ? undefined : dateString(value);
}
