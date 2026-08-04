import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encryptSecretDeliveryPayload } from "@o-okul/db";
import type { CampusRecord, LicenseTermRecord, TenantOnboardingOwnerRecord } from "@o-okul/shared-types";
import pg from "pg";
import { hashPasswordAsync, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";
import { buildTenantMembershipDualWriteRows } from "../identity-provisioning/tenant-membership-dual-write.js";
import { encryptTcIdentity, hashTcIdentity } from "../student/tc-identity.js";
import { tenantWebUrl } from "../http/tenant-origin.js";
import type { TenantUserRecord } from "../user-management/user-management-store.js";

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  institutionType?: string;
  contactEmail?: string;
  logoUrl?: string;
  seatLimit?: number;
  activeSeatCount?: number;
  status: string;
}

export interface TenantStore {
  list(): Promise<TenantRecord[]>;
  findById(id: string): Promise<TenantRecord | undefined>;
  findBySlug(slug: string): Promise<TenantRecord | undefined>;
  findForAdmin(id: string): Promise<TenantRecord | undefined>;
  create(input: CreateTenantInput): Promise<TenantRecord>;
  createWithFirstAdmin?(input: CreateTenantInput, firstAdmin: CreateTenantFirstAdminInput): Promise<TenantCreateWithAdminResult>;
  createOnboarding?(input: CreateTenantInput, onboarding: CreateTenantOnboardingInput): Promise<TenantOnboardingStoreResult>;
  update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined>;
  delete(id: string): Promise<TenantRecord | undefined>;
}

export const tenantStoreToken = Symbol("TenantStore");

const demoTenants: TenantRecord[] = [
  { id: "tenant-a", name: "DNA EĞİTİM KURUMU", slug: "dna-egitim", plan: "PRO", activeSeatCount: 4, status: "ACTIVE" },
  { id: "tenant-b", name: "Demo Kurum B", slug: "demo-kurum-b", plan: "TRIAL", activeSeatCount: 1, status: "ACTIVE" },
  {
    id: "tenant-expired",
    name: "Demo Süresi Dolmuş Kurum",
    slug: "demo-suresi-dolmus-kurum",
    plan: "TRIAL",
    licenseEndsAt: "2020-01-01T00:00:00.000Z",
    activeSeatCount: 0,
    status: "ACTIVE",
  },
];

export class InMemoryTenantStore implements TenantStore {
  private readonly tenants = demoTenants.map((record) => ({ ...record }));
  private readonly firstAdmins: TenantUserRecord[] = [];
  private readonly onboardingRequests = new Map<string, { requestHash: string; response: TenantOnboardingResult }>();

  async list(): Promise<TenantRecord[]> {
    return this.tenants.filter((tenant) => tenant.status !== "DELETED").map((tenant) => ({ ...tenant }));
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id && isUsableTenant(record));
    return tenant ? { ...tenant } : undefined;
  }

  async findBySlug(slug: string): Promise<TenantRecord | undefined> {
    const normalizedSlug = slug.trim().toLowerCase();
    const tenant = this.tenants.find((record) => record.slug.toLowerCase() === normalizedSlug && isUsableTenant(record));
    return tenant ? { ...tenant } : undefined;
  }

  async findForAdmin(id: string): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id && record.status !== "DELETED");
    return tenant ? { ...tenant } : undefined;
  }

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    const tenant: TenantRecord = {
      id: input.id ?? randomUUID(),
      name: input.name,
      slug: input.slug,
      plan: input.plan ?? "TRIAL",
      licenseStartsAt: input.licenseStartsAt,
      licenseEndsAt: input.licenseEndsAt,
      institutionType: input.institutionType,
      contactEmail: input.contactEmail,
      logoUrl: input.logoUrl,
      seatLimit: input.seatLimit,
      activeSeatCount: 0,
      status: input.status ?? "ACTIVE",
    };
    this.tenants.push(tenant);
    return { ...tenant };
  }

  async createWithFirstAdmin(input: CreateTenantInput, firstAdmin: CreateTenantFirstAdminInput): Promise<TenantCreateWithAdminResult> {
    const activation = await createFirstAdminActivation(input.slug, firstAdmin.email);
    const tenant = await this.create(input);
    const storedTenant = this.tenants.find((record) => record.id === tenant.id);
    if (storedTenant) {
      storedTenant.activeSeatCount = 1;
    }
    tenant.activeSeatCount = 1;
    const now = new Date().toISOString();
    const admin: TenantUserRecord = {
      id: activation.userId,
      email: firstAdmin.email.toLowerCase(),
      name: firstAdmin.name,
      tenantId: tenant.id,
      roles: ["TENANT_ADMIN"],
      createdAt: now,
      updatedAt: now,
    };
    this.firstAdmins.push(admin);
    upsertInMemoryAuthUser({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      nationalIdHash: hashTcIdentity(firstAdmin.nationalId),
      mustChangePassword: true,
      passwordHash: activation.passwordHash,
      tenantId: admin.tenantId,
      roles: admin.roles,
    });
    return { tenant: { ...tenant, activeSeatCount: 1 }, admin: { ...admin } };
  }

  async createOnboarding(input: CreateTenantInput, onboarding: CreateTenantOnboardingInput): Promise<TenantOnboardingStoreResult> {
    const idempotencyId = `${onboarding.licenseTerm.createdByPlatformAccountId}:${onboarding.idempotencyKey}`;
    const previous = this.onboardingRequests.get(idempotencyId);
    if (previous) {
      if (previous.requestHash !== onboarding.requestHash) throw new Error("IDEMPOTENCY_KEY_BODY_MISMATCH");
      return { result: structuredClone(previous.response), replayed: true };
    }
    const activation = await createFirstAdminActivation(input.slug, onboarding.firstOwner.email);
    const tenant = await this.create({
      ...input,
      plan: onboarding.licenseTerm.planCode,
      licenseStartsAt: onboarding.licenseTerm.startsAt,
      licenseEndsAt: onboarding.licenseTerm.endsAt,
      seatLimit: onboarding.licenseTerm.activeStudentLimit,
    });
    const owner = createInMemoryOwner(tenant, onboarding.firstOwner, activation);
    const campuses = onboarding.campuses.map((campus, index) => ({
      id: `campus-onboarding-${index + 1}-${tenant.id}`,
      tenantId: tenant.id,
      ...campus,
    }));
    const licenseTerm: LicenseTermRecord = {
      id: `license-onboarding-${tenant.id}`,
      tenantId: tenant.id,
      ...onboarding.licenseTerm,
    };
    const response = { tenant: { ...tenant, activeSeatCount: 1 }, owner, campuses, licenseTerm };
    this.onboardingRequests.set(idempotencyId, { requestHash: onboarding.requestHash, response });
    return { result: structuredClone(response), replayed: false };
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id);
    if (!tenant) return undefined;
    Object.assign(tenant, withoutUndefined(input));
    return { ...tenant };
  }

  async delete(id: string): Promise<TenantRecord | undefined> {
    const index = this.tenants.findIndex((record) => record.id === id && record.id !== "system");
    if (index === -1) return undefined;
    const tenant = this.tenants[index];
    if (!tenant) return undefined;
    this.tenants.splice(index, 1);
    for (let i = this.firstAdmins.length - 1; i >= 0; i -= 1) {
      if (this.firstAdmins[i]?.tenantId === id) {
        this.firstAdmins.splice(i, 1);
      }
    }
    return { ...tenant, status: "DELETED" };
  }
}

export class PostgresTenantStore implements TenantStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<TenantRecord[]> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" <> 'system' AND t."status" <> 'DELETED'
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status", t."createdAt"
         ORDER BY t."createdAt" DESC`,
      );
      return result.rows.map(mapTenantRow);
    });
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" = $1 AND t."status" = 'ACTIVE'
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
         LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return row ? mapTenantRow(row) : undefined;
    });
  }

  async findBySlug(slug: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE lower(t."slug") = lower($1) AND t."status" = 'ACTIVE'
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
         LIMIT 1`,
        [slug],
      );
      const row = result.rows[0];
      return row ? mapTenantRow(row) : undefined;
    });
  }

  async findForAdmin(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" = $1 AND t."status" <> 'DELETED'
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
         LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return row ? mapTenantRow(row) : undefined;
    });
  }

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", "status", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status"`,
        [
          input.id ?? randomUUID(),
          input.name,
          input.slug,
          input.plan ?? "TRIAL",
          input.licenseStartsAt ?? null,
          input.licenseEndsAt ?? null,
          input.institutionType ?? null,
          input.contactEmail ?? null,
          input.logoUrl ?? null,
          input.seatLimit ?? null,
          input.status ?? "ACTIVE",
        ],
      );
      return mapTenantRow(result.rows[0]!);
    });
  }

  async createWithFirstAdmin(input: CreateTenantInput, firstAdmin: CreateTenantFirstAdminInput): Promise<TenantCreateWithAdminResult> {
    const activation = await createFirstAdminActivation(input.slug, firstAdmin.email);
    return withBypassRlsQuery(this.pool, async (client) => {
      const normalizedEmail = firstAdmin.email.toLowerCase();
      const tenantResult = await client.query<TenantRow>(
        `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", "status", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status"`,
        [
          input.id ?? randomUUID(),
          input.name,
          input.slug,
          input.plan ?? "TRIAL",
          input.licenseStartsAt ?? null,
          input.licenseEndsAt ?? null,
          input.institutionType ?? null,
          input.contactEmail ?? null,
          input.logoUrl ?? null,
          input.seatLimit ?? null,
          input.status ?? "ACTIVE",
        ],
      );
      const tenant = mapTenantRow(tenantResult.rows[0]!);
      const nationalIdEncrypted = encryptTcIdentity(firstAdmin.nationalId);
      const nationalIdHash = hashTcIdentity(firstAdmin.nationalId);
      const createdUser = await client.query<{ id: string }>(
        `INSERT INTO "User" (
           "id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized",
           "nationalIdEncrypted", "nationalIdHash", "name", "passwordHash", "passwordHashVersion",
           "accountStatus", "mustChangePassword", "updatedAt"
         )
         VALUES ($1, $2, $3, $3, $3, $3, $4, $5, $6, $7, 2, 'PENDING_ACTIVATION', true, now())
         RETURNING "id"`,
        [activation.userId, tenant.id, normalizedEmail, nationalIdEncrypted, nationalIdHash, firstAdmin.name, activation.passwordHash],
      );
      const userId = createdUser.rows[0]?.id;
      if (!userId) {
        throw new Error("USER_CREATE_FAILED");
      }

      await client.query(`DELETE FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2`, [tenant.id, userId]);
      const [membership] = buildTenantMembershipDualWriteRows(["TENANT_ADMIN"]);
      await client.query(
        `INSERT INTO "TenantMembership" (
           "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
           "status", "version", "scopeMode", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 1, 'TENANT', now())`,
        [
          randomUUID(),
          tenant.id,
          userId,
          membership!.role,
          membership!.staffRole,
          membership!.hasTeacherPersona,
          membership!.hasStudentPersona,
        ],
      );
      await client.query(
        `INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "status", "expiresAt", "updatedAt")
         VALUES ($1, $2, $3, 'PENDING', $4, now())`,
        [activation.resetId, userId, activation.tokenHash, activation.expiresAt],
      );
      await client.query(
        `INSERT INTO "SecretDeliveryOutbox" (
           "id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "availableAt", "expiresAt", "updatedAt"
         ) VALUES ($1, $2, 'PASSWORD_RESET', $3, $4, 'PENDING', now(), $5, now())`,
        [randomUUID(), tenant.id, activation.resetId, activation.payloadEncrypted, activation.expiresAt],
      );
      const adminResult = await client.query<TenantAdminRow>(
        `SELECT
           u."id",
           u."email",
           u."name",
           m."tenantId",
           array_agg(m."role"::text ORDER BY m."role"::text) AS roles,
           min(u."createdAt") AS "createdAt",
           max(u."updatedAt") AS "updatedAt"
         FROM "TenantMembership" m
         JOIN "User" u ON u."id" = m."userId"
         WHERE m."tenantId" = $1 AND u."id" = $2
         GROUP BY u."id", u."email", u."name", m."tenantId"
         LIMIT 1`,
        [tenant.id, userId],
      );
      const admin = adminResult.rows[0] ? mapTenantAdminRow(adminResult.rows[0]) : undefined;
      if (!admin) {
        throw new Error("USER_MEMBERSHIP_CREATE_FAILED");
      }
      return { tenant: { ...tenant, activeSeatCount: 1 }, admin };
    });
  }

  async createOnboarding(input: CreateTenantInput, onboarding: CreateTenantOnboardingInput): Promise<TenantOnboardingStoreResult> {
    const activation = await createFirstAdminActivation(input.slug, onboarding.firstOwner.email);
    return withBypassRlsQuery(this.pool, async (client) => {
      const idempotencyInsert = await client.query<{ id: string }>(
        `INSERT INTO "PlatformIdempotencyKey" (
           "platformAccountId", "key", "operation", "requestHash", "status", "updatedAt"
         ) VALUES ($1, $2, 'tenant.onboarding.create', $3, 'IN_PROGRESS', now())
         ON CONFLICT ("platformAccountId", "key", "operation") DO NOTHING
         RETURNING "id"`,
        [onboarding.licenseTerm.createdByPlatformAccountId, onboarding.idempotencyKey, onboarding.requestHash],
      );
      if (!idempotencyInsert.rows[0]) {
        const previous = await client.query<{ requestHash: string; status: string; responseBody: TenantOnboardingResult | null }>(
          `SELECT "requestHash", "status", "responseBody"
           FROM "PlatformIdempotencyKey"
           WHERE "platformAccountId" = $1 AND "key" = $2 AND "operation" = 'tenant.onboarding.create'
           FOR UPDATE`,
          [onboarding.licenseTerm.createdByPlatformAccountId, onboarding.idempotencyKey],
        );
        const record = previous.rows[0];
        if (!record || record.requestHash !== onboarding.requestHash) throw new Error("IDEMPOTENCY_KEY_BODY_MISMATCH");
        if (record.status !== "COMPLETED" || !record.responseBody) throw new Error("IDEMPOTENCY_KEY_IN_PROGRESS");
        return { result: record.responseBody, replayed: true };
      }
      const tenantId = input.id ?? randomUUID();
      const ownerId = activation.userId;
      const employeeId = randomUUID();
      const normalizedEmail = onboarding.firstOwner.email.toLowerCase();
      const term = onboarding.licenseTerm;
      const tenantResult = await client.query<TenantRow>(
        `INSERT INTO "Tenant" (
           "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType",
           "contactEmail", "logoUrl", "seatLimit", "status", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType",
                   "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status"`,
        [
          tenantId,
          input.name,
          input.slug,
          term.planCode,
          term.startsAt,
          term.endsAt,
          input.institutionType ?? null,
          input.contactEmail ?? null,
          input.logoUrl ?? null,
          term.activeStudentLimit,
          input.status ?? "ACTIVE",
        ],
      );
      const tenant = mapTenantRow(tenantResult.rows[0]!);
      const licenseResult = await client.query<LicenseTermRow>(
        `INSERT INTO "LicenseTerm" (
           "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit",
           "createdByPlatformAccountId", "auditReference", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         RETURNING "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit",
                   "cancelledAt", "createdByPlatformAccountId", "auditReference"`,
        [randomUUID(), tenant.id, term.planCode, term.startsAt, term.endsAt, term.activeStudentLimit, term.createdByPlatformAccountId, term.auditReference],
      );
      const campuses: CampusRecord[] = [];
      for (const campus of onboarding.campuses) {
        const campusResult = await client.query<CampusRow>(
          `INSERT INTO "Campus" ("id", "tenantId", "name", "code", "unitType", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, now())
           RETURNING "id", "tenantId", "name", "code", "unitType"`,
          [randomUUID(), tenant.id, campus.name, campus.code ?? null, campus.unitType ?? null],
        );
        const row = campusResult.rows[0];
        if (!row) throw new Error("CAMPUS_CREATE_FAILED");
        campuses.push(mapCampusRow(row));
      }
      const nationalId = onboarding.firstOwner.nationalId;
      await client.query(
        `INSERT INTO "User" (
           "id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized",
           "nationalIdEncrypted", "nationalIdHash", "name", "passwordHash", "passwordHashVersion",
           "accountStatus", "mustChangePassword", "updatedAt"
         ) VALUES ($1, $2, $3, $3, $3, $3, $4, $5, $6, $7, 2, 'PENDING_ACTIVATION', true, now())`,
        [
          ownerId,
          tenant.id,
          normalizedEmail,
          nationalId ? encryptTcIdentity(nationalId) : null,
          nationalId ? hashTcIdentity(nationalId) : null,
          onboarding.firstOwner.name,
          activation.passwordHash,
        ],
      );
      const ownerName = splitPersonName(onboarding.firstOwner.name);
      await client.query(
        `INSERT INTO "Employee" (
           "id", "tenantId", "firstName", "lastName", "nationalIdEncrypted", "nationalIdHash",
           "workEmail", "userId", "status", "employmentStartsAt", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9::date, now())`,
        [
          employeeId,
          tenant.id,
          ownerName.firstName,
          ownerName.lastName,
          nationalId ? encryptTcIdentity(nationalId) : null,
          nationalId ? hashTcIdentity(nationalId) : null,
          normalizedEmail,
          ownerId,
          term.startsAt.slice(0, 10),
        ],
      );
      const [membership] = buildTenantMembershipDualWriteRows(["TENANT_OWNER"]);
      await client.query(
        `INSERT INTO "TenantMembership" (
           "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
           "status", "version", "scopeMode", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 1, 'TENANT', now())`,
        [randomUUID(), tenant.id, ownerId, membership!.role, membership!.staffRole, false, false],
      );
      await client.query(
        `INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "status", "expiresAt", "updatedAt")
         VALUES ($1, $2, $3, 'PENDING', $4, now())`,
        [activation.resetId, ownerId, activation.tokenHash, activation.expiresAt],
      );
      await client.query(
        `INSERT INTO "SecretDeliveryOutbox" (
           "id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "availableAt", "expiresAt", "updatedAt"
         ) VALUES ($1, $2, 'PASSWORD_RESET', $3, $4, 'PENDING', now(), $5, now())`,
        [randomUUID(), tenant.id, activation.resetId, activation.payloadEncrypted, activation.expiresAt],
      );
      await client.query(`SELECT o_okul_refresh_license_usage($1)`, [tenant.id]);
      const licenseRow = licenseResult.rows[0];
      if (!licenseRow) throw new Error("LICENSE_TERM_CREATE_FAILED");
      const response: TenantOnboardingResult = {
        tenant: { ...tenant, activeSeatCount: 1 },
        campuses,
        licenseTerm: mapLicenseTermRow(licenseRow),
        owner: {
          id: ownerId,
          employeeId,
          tenantId: tenant.id,
          roles: ["TENANT_OWNER"],
        },
      };
      await client.query(
        `UPDATE "PlatformIdempotencyKey"
         SET "status" = 'COMPLETED', "responseBody" = $4::jsonb, "completedAt" = now(), "updatedAt" = now()
         WHERE "platformAccountId" = $1 AND "key" = $2 AND "operation" = 'tenant.onboarding.create' AND "requestHash" = $3`,
        [onboarding.licenseTerm.createdByPlatformAccountId, onboarding.idempotencyKey, onboarding.requestHash, JSON.stringify(response)],
      );
      return { result: response, replayed: false };
    });
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const currentResult = await client.query<TenantRow>(
        `SELECT "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status" FROM "Tenant"
         WHERE "id" = $1
         LIMIT 1`,
        [id],
      );
      const current = currentResult.rows[0] ? mapTenantRow(currentResult.rows[0]) : undefined;
      if (!current) return undefined;
      const next = { ...current, ...withoutUndefined(input) };
      const result = await client.query<TenantRow>(
        `UPDATE "Tenant"
         SET "name" = $2,
             "plan" = $3,
             "licenseStartsAt" = $4,
             "licenseEndsAt" = $5,
             "institutionType" = $6,
             "contactEmail" = $7,
             "logoUrl" = $8,
             "seatLimit" = $9,
             "status" = $10,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING
           "id",
           "name",
           "slug",
           "plan",
           "licenseStartsAt",
           "licenseEndsAt",
           "institutionType",
           "contactEmail",
           "logoUrl",
           "seatLimit",
           (
             SELECT COUNT(DISTINCT "userId")::int
             FROM "TenantMembership"
             WHERE "tenantId" = "Tenant"."id"
           ) AS "activeSeatCount",
           "status"`,
        [
          id,
          next.name,
          next.plan,
          next.licenseStartsAt ?? null,
          next.licenseEndsAt ?? null,
          next.institutionType ?? null,
          next.contactEmail ?? null,
          next.logoUrl ?? null,
          next.seatLimit ?? null,
          next.status,
        ],
      );
      return mapTenantRow(result.rows[0]!);
    });
  }

  async delete(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const currentResult = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" = $1 AND t."id" <> 'system' AND t."status" <> 'DELETED'
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
         LIMIT 1`,
        [id],
      );
      const current = currentResult.rows[0] ? mapTenantRow(currentResult.rows[0]) : undefined;
      if (!current) return undefined;
      await client.query(`DELETE FROM "Tenant" WHERE "id" = $1 AND "id" <> 'system'`, [id]);
      return { ...current, status: "DELETED" };
    });
  }
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt: Date | string | null;
  licenseEndsAt: Date | string | null;
  institutionType: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
  seatLimit: number | null;
  activeSeatCount?: number | string | null;
  status: string;
}

interface TenantAdminRow {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  roles: TenantUserRecord["roles"];
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CreateTenantInput {
  id?: string;
  name: string;
  slug: string;
  plan?: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  institutionType?: string;
  contactEmail?: string;
  logoUrl?: string;
  seatLimit?: number;
  status?: string;
}

export interface CreateTenantFirstAdminInput {
  email: string;
  name: string;
  nationalId: string;
}

export interface TenantCreateWithAdminResult {
  tenant: TenantRecord;
  admin: TenantUserRecord;
}

export interface CreateTenantOnboardingInput {
  campuses: Array<Pick<CampusRecord, "name" | "code" | "unitType">>;
  firstOwner: { email: string; name: string; nationalId?: string };
  idempotencyKey: string;
  requestHash: string;
  licenseTerm: Omit<LicenseTermRecord, "id" | "tenantId" | "cancelledAt">;
}

export interface TenantOnboardingResult {
  tenant: TenantRecord;
  campuses: CampusRecord[];
  licenseTerm: LicenseTermRecord;
  owner: TenantOnboardingOwnerRecord;
}

export interface TenantOnboardingStoreResult {
  result: TenantOnboardingResult;
  replayed: boolean;
}

export type UpdateTenantInput = Partial<Omit<CreateTenantInput, "id" | "slug">>;

function mapTenantRow(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    licenseStartsAt: optionalDateString(row.licenseStartsAt),
    licenseEndsAt: optionalDateString(row.licenseEndsAt),
    institutionType: row.institutionType ?? undefined,
    contactEmail: row.contactEmail ?? undefined,
    logoUrl: row.logoUrl ?? undefined,
    seatLimit: row.seatLimit ?? undefined,
    activeSeatCount: optionalNumber(row.activeSeatCount),
    status: row.status,
  };
}

function optionalDateString(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function mapTenantAdminRow(row: TenantAdminRow): TenantUserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    tenantId: row.tenantId,
    roles: row.roles,
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
  };
}

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isUsableTenant(tenant: TenantRecord): boolean {
  return tenant.status === "ACTIVE";
}

function withoutUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

interface FirstAdminActivation {
  expiresAt: string;
  passwordHash: string;
  payloadEncrypted: string;
  resetId: string;
  tokenHash: string;
  userId: string;
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

interface CampusRow {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  unitType: CampusRecord["unitType"] | null;
}

function mapLicenseTermRow(row: LicenseTermRow): LicenseTermRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planCode: row.planCode,
    startsAt: dateString(row.startsAt),
    endsAt: dateString(row.endsAt),
    activeStudentLimit: row.activeStudentLimit,
    cancelledAt: row.cancelledAt ? dateString(row.cancelledAt) : undefined,
    createdByPlatformAccountId: row.createdByPlatformAccountId ?? undefined,
    auditReference: row.auditReference ?? undefined,
  };
}

function mapCampusRow(row: CampusRow): CampusRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code ?? undefined,
    unitType: row.unitType ?? undefined,
  };
}

function splitPersonName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts.slice(0, -1).join(" ") || parts[0] || "-",
    lastName: parts.length > 1 ? parts.at(-1)! : "-",
  };
}

function createInMemoryOwner(
  tenant: TenantRecord,
  input: CreateTenantOnboardingInput["firstOwner"],
  activation: FirstAdminActivation,
): TenantOnboardingOwnerRecord {
  const normalizedEmail = input.email.toLowerCase();
  upsertInMemoryAuthUser({
    id: activation.userId,
    email: normalizedEmail,
    name: input.name,
    nationalIdHash: input.nationalId ? hashTcIdentity(input.nationalId) : undefined,
    mustChangePassword: true,
    passwordHash: activation.passwordHash,
    tenantId: tenant.id,
    roles: ["TENANT_OWNER"],
  });
  return {
    id: activation.userId,
    employeeId: `employee-owner-${tenant.id}`,
    tenantId: tenant.id,
    roles: ["TENANT_OWNER"],
  };
}

async function createFirstAdminActivation(tenantSlug: string, email: string): Promise<FirstAdminActivation> {
  const resetToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  const url = createFirstAdminActivationUrl(tenantSlug, resetToken);
  return {
    expiresAt,
    passwordHash: await hashPasswordAsync(randomBytes(32).toString("base64url")),
    payloadEncrypted: encryptSecretDeliveryPayload({
      channel: "EMAIL",
      to: email.toLowerCase(),
      subject: "O-Okul hesap aktivasyonu",
      body: `Hesabınızı 24 saat içinde etkinleştirmek için bağlantıyı açın: ${url.toString()}`,
    }),
    resetId: randomUUID(),
    tokenHash: createHash("sha256").update(resetToken).digest("hex"),
    userId: randomUUID(),
  };
}

export function createFirstAdminActivationUrl(tenantSlug: string, token: string): URL {
  const url = tenantWebUrl("/parola-sifirla", tenantSlug);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") url.searchParams.set("tenant", tenantSlug);
  url.hash = new URLSearchParams({ token }).toString();
  return url;
}

export function createTenantStore(): TenantStore {
  return resolvePersistenceDriver(process.env.TENANT_STORE) === "postgres" ? new PostgresTenantStore() : new InMemoryTenantStore();
}
