import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encryptSecretDeliveryPayload } from "@o-okul/db";
import type { CampusRecord, LicenseTermRecord, TenantAccessStatus, TenantLifecycleReason, TenantStatusUpdateRequest, TenantOnboardingOwnerRecord } from "@o-okul/shared-types";
import pg from "pg";
import type { AuditLogService } from "../audit-log/audit-log.service.js";
import { hashPasswordAsync, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import type { SessionStore } from "../auth/session-store.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";
import { buildTenantMembershipDualWriteRows } from "../identity-provisioning/tenant-membership-dual-write.js";
import { encryptTcIdentity, hashTcIdentity } from "../student/tc-identity.js";
import { tenantWebUrl } from "../http/tenant-origin.js";

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
  status: TenantAccessStatus;
  lifecycleVersion: number;
  suspendedAt?: string;
  suspendedReason?: TenantLifecycleReason;
}

export interface TenantStore {
  list(): Promise<TenantRecord[]>;
  findById(id: string): Promise<TenantRecord | undefined>;
  findBySlug(slug: string): Promise<TenantRecord | undefined>;
  findForAdmin(id: string): Promise<TenantRecord | undefined>;
  createOnboarding(input: CreateTenantInput, onboarding: CreateTenantOnboardingInput): Promise<TenantOnboardingStoreResult>;
  update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined>;
  transitionStatus(id: string, input: TenantStatusTransitionInput): Promise<TenantStatusTransitionResult | undefined>;
}

export const tenantStoreToken = Symbol("TenantStore");

const demoTenants: TenantRecord[] = [
  { id: "tenant-a", name: "DNA EĞİTİM KURUMU", slug: "dna-egitim", plan: "PRO", activeSeatCount: 4, status: "ACTIVE", lifecycleVersion: 0 },
  { id: "tenant-b", name: "Demo Kurum B", slug: "demo-kurum-b", plan: "TRIAL", activeSeatCount: 1, status: "ACTIVE", lifecycleVersion: 0 },
  {
    id: "tenant-expired",
    name: "Demo Süresi Dolmuş Kurum",
    slug: "demo-suresi-dolmus-kurum",
    plan: "TRIAL",
    licenseEndsAt: "2020-01-01T00:00:00.000Z",
    activeSeatCount: 0,
    status: "ACTIVE",
    lifecycleVersion: 0,
  },
];

export class InMemoryTenantStore implements TenantStore {
  private readonly tenants: TenantRecord[];
  private readonly lifecycleRequests = new Map<string, { requestHash: string; response: TenantStatusTransitionResult }>();
  private lifecyclePending = false;
  private readonly onboardingRequests = new Map<string, { requestHash: string; response: TenantOnboardingResult }>();

  constructor(private readonly lifecycle?: TenantLifecycleDependencies, initialTenants: readonly TenantRecord[] = demoTenants) {
    this.tenants = initialTenants.map((record) => ({ ...record }));
  }

  async list(): Promise<TenantRecord[]> {
    return this.tenants.map((tenant) => ({ ...tenant }));
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
    const tenant = this.tenants.find((record) => record.id === id);
    return tenant ? { ...tenant } : undefined;
  }

  private async createRecord(input: CreateTenantInput): Promise<TenantRecord> {
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
      lifecycleVersion: 0,
    };
    this.tenants.push(tenant);
    return { ...tenant };
  }

  async createOnboarding(input: CreateTenantInput, onboarding: CreateTenantOnboardingInput): Promise<TenantOnboardingStoreResult> {
    const idempotencyId = `${onboarding.licenseTerm.createdByPlatformAccountId}:${onboarding.idempotencyKey}`;
    const previous = this.onboardingRequests.get(idempotencyId);
    if (previous) {
      if (previous.requestHash !== onboarding.requestHash) throw new Error("IDEMPOTENCY_KEY_BODY_MISMATCH");
      return { auditedAtomically: false, result: structuredClone(previous.response), replayed: true };
    }
    const activation = await createFirstAdminActivation(input.slug, onboarding.firstOwner.email);
    const tenant = await this.createRecord({
      ...input,
      plan: onboarding.licenseTerm.planCode,
      licenseStartsAt: onboarding.licenseTerm.startsAt,
      licenseEndsAt: onboarding.licenseTerm.endsAt,
      seatLimit: onboarding.licenseTerm.activeStudentLimit,
    });
    const storedTenant = this.tenants.find((record) => record.id === tenant.id);
    if (storedTenant) storedTenant.activeSeatCount = 1;
    tenant.activeSeatCount = 1;
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
    return { auditedAtomically: false, result: structuredClone(response), replayed: false };
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id && record.id !== "system");
    if (!tenant) return undefined;
    Object.assign(tenant, withoutUndefined(input));
    return { ...tenant };
  }

  async transitionStatus(id: string, input: TenantStatusTransitionInput): Promise<TenantStatusTransitionResult | undefined> {
    // ponytail: memory driver serializes lifecycle writes; PostgreSQL uses row locks in deployed environments.
    if (this.lifecyclePending) throw new Error("IDEMPOTENCY_KEY_IN_PROGRESS");
    this.lifecyclePending = true;
    try {
      const tenant = this.tenants.find((record) => record.id === id && record.id !== "system");
      if (!tenant) return undefined;
      assertTenantAccessStatus(tenant.status);
      assertTenantAccessStatus(input.status);
      if (!this.lifecycle) throw new Error("TENANT_LIFECYCLE_DEPENDENCIES_REQUIRED");
      const session = await this.lifecycle.sessions.findById(input.sessionId);
      if (!session || session.status !== "ACTIVE" || session.userId !== input.actorUserId || session.tenantId !== "system" ||
        session.membershipVersion !== input.membershipVersion || session.expiresAt.getTime() <= Date.now()) throw new Error("MFA_STEP_UP_CONTEXT_INVALID");
      const key = `${input.actorUserId}:${input.idempotencyKey}`;
      const previous = this.lifecycleRequests.get(key);
      if (previous) {
        if (previous.requestHash !== input.requestHash) throw new Error("IDEMPOTENCY_KEY_BODY_MISMATCH");
        return structuredClone(previous.response);
      }
      assertLifecycleRequest(tenant, input);
      let sessionsRevoked = 0;
      if (tenant.status !== input.status) {
        const next = lifecycleNext(tenant, input);
        await this.lifecycle.auditLogs.record({
          tenantId: id, actorUserId: input.actorUserId, entityType: "Tenant", entityId: id,
          action: input.status === "SUSPENDED" ? "tenant.suspended" : "tenant.activated",
          diff: lifecycleDiff(tenant, input),
        });
        sessionsRevoked = await this.lifecycle.sessions.revokeByTenant(id, input.expectedLifecycleVersion + 1);
        Object.assign(tenant, next);
      }
      const response = { tenant: { ...tenant }, sessionsRevoked };
      this.lifecycleRequests.set(key, { requestHash: input.requestHash, response: structuredClone(response) });
      return response;
    } finally {
      this.lifecyclePending = false;
    }
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
           t."status", t."lifecycleVersion", t."suspendedAt", t."suspendedReason"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" <> 'system'
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
           t."status", t."lifecycleVersion", t."suspendedAt", t."suspendedReason"
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
           t."status", t."lifecycleVersion", t."suspendedAt", t."suspendedReason"
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
           t."status", t."lifecycleVersion", t."suspendedAt", t."suspendedReason"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" = $1
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
         LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return row ? mapTenantRow(row) : undefined;
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
        return { auditedAtomically: true, result: record.responseBody, replayed: true };
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
                   "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status", "lifecycleVersion", "suspendedAt", "suspendedReason"`,
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
           "id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "availableAt", "expiresAt", "updatedAt", "sourceScope", "tenantLifecycleVersion"
         ) VALUES ($1, $2, 'PASSWORD_RESET', $3, $4, 'PENDING', now(), $5, now(), 'TENANT', 0)`,
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
        `INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff")
         VALUES
           ($1, $2, $3, 'Tenant', $2, 'tenant.created', $4::jsonb),
           ($5, $2, $3, 'Employee', $6, 'tenant.first_owner_invited', $7::jsonb)`,
        [
          randomUUID(),
          tenant.id,
          term.createdByPlatformAccountId,
          JSON.stringify({
            licenseStartsAt: tenant.licenseStartsAt,
            licenseEndsAt: tenant.licenseEndsAt,
            capacity: tenant.seatLimit,
            status: tenant.status,
          }),
          randomUUID(),
          employeeId,
          JSON.stringify({ accountId: ownerId, emailProvided: true, roles: ["TENANT_OWNER"] }),
        ],
      );
      await client.query(
        `UPDATE "PlatformIdempotencyKey"
         SET "status" = 'COMPLETED', "responseBody" = $4::jsonb, "completedAt" = now(), "updatedAt" = now()
         WHERE "platformAccountId" = $1 AND "key" = $2 AND "operation" = 'tenant.onboarding.create' AND "requestHash" = $3`,
        [onboarding.licenseTerm.createdByPlatformAccountId, onboarding.idempotencyKey, onboarding.requestHash, JSON.stringify(response)],
      );
      return { auditedAtomically: true, result: response, replayed: false };
    });
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const currentResult = await client.query<TenantRow>(
        `SELECT "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status", "lifecycleVersion", "suspendedAt", "suspendedReason" FROM "Tenant"
         WHERE "id" = $1 AND "id" <> 'system'
         LIMIT 1`,
        [id],
      );
      const current = currentResult.rows[0] ? mapTenantRow(currentResult.rows[0]) : undefined;
      if (!current) return undefined;
      const next = { ...current, ...withoutUndefined(input) };
      const result = await client.query<TenantRow>(
        `UPDATE "Tenant"
         SET "name" = $2,
             "institutionType" = $3,
             "contactEmail" = $4,
             "logoUrl" = $5,
             "updatedAt" = now()
         WHERE "id" = $1 AND "id" <> 'system'
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
           "status", "lifecycleVersion", "suspendedAt", "suspendedReason"`,
        [
          id,
          next.name,
          next.institutionType ?? null,
          next.contactEmail ?? null,
          next.logoUrl ?? null,
        ],
      );
      return mapTenantRow(result.rows[0]!);
    });
  }

  async transitionStatus(id: string, input: TenantStatusTransitionInput): Promise<TenantStatusTransitionResult | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const actor = await client.query<{ id: string }>(
        `SELECT "id" FROM "AuthSession" WHERE "id" = $1 AND "userId" = $2 AND "tenantId" = 'system'
         AND "membershipVersion" = $3 AND "status" = 'ACTIVE' AND "expiresAt" > now() FOR SHARE`,
        [input.sessionId, input.actorUserId, input.membershipVersion],
      );
      if (!actor.rows[0]) throw new Error("MFA_STEP_UP_CONTEXT_INVALID");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO "PlatformIdempotencyKey" ("platformAccountId", "key", "operation", "requestHash", "status", "updatedAt")
         VALUES ($1, $2, 'tenant.lifecycle.change', $3, 'IN_PROGRESS', now())
         ON CONFLICT ("platformAccountId", "key", "operation") DO NOTHING RETURNING "id"`,
        [input.actorUserId, input.idempotencyKey, input.requestHash],
      );
      if (!inserted.rows[0]) {
        const previous = await client.query<{ requestHash: string; status: string; responseBody: TenantStatusTransitionResult | null }>(
          `SELECT "requestHash", "status", "responseBody" FROM "PlatformIdempotencyKey"
           WHERE "platformAccountId" = $1 AND "key" = $2 AND "operation" = 'tenant.lifecycle.change' FOR UPDATE`,
          [input.actorUserId, input.idempotencyKey],
        );
        const record = previous.rows[0];
        if (!record || record.requestHash !== input.requestHash) throw new Error("IDEMPOTENCY_KEY_BODY_MISMATCH");
        if (record.status !== "COMPLETED" || !record.responseBody) throw new Error("IDEMPOTENCY_KEY_IN_PROGRESS");
        return record.responseBody;
      }
      const currentResult = await client.query<TenantRow>(
        `SELECT t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt",
           t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status",
           t."lifecycleVersion", t."suspendedAt", t."suspendedReason",
           (SELECT COUNT(DISTINCT m."userId")::int FROM "TenantMembership" m WHERE m."tenantId" = t."id") AS "activeSeatCount"
         FROM "Tenant" t WHERE t."id" = $1 AND t."id" <> 'system' FOR UPDATE OF t`,
        [id],
      );
      const current = currentResult.rows[0] ? mapTenantRow(currentResult.rows[0]) : undefined;
      if (!current) throw new Error("TENANT_NOT_FOUND");
      assertTenantAccessStatus(current.status);
      assertTenantAccessStatus(input.status);
      assertLifecycleRequest(current, input);
      if (input.status === "ACTIVE") {
        const reset = await client.query<{ status: string }>('SELECT "status" FROM "TenantFreshResetOperation" WHERE "tenantId" = $1 AND ("status" NOT IN (\'COMPLETED\', \'CANCELLED\') OR ("preset" = \'LICENSE_EXPIRY_PURGE_V1\' AND "status" = \'COMPLETED\'))', [id]);
        // A purged institution stays a suspended tombstone (DEC-20261005-03).
        if (reset.rows.some((row) => row.status === "COMPLETED")) throw new Error("TENANT_PURGED");
        if (reset.rows.length) throw new Error("RESET_OPERATION_IN_PROGRESS");
      }
      let response: TenantStatusTransitionResult = { tenant: current, sessionsRevoked: 0 };
      if (current.status !== input.status) {
        const next = lifecycleNext(current, input);
        const updated = await client.query<{ id: string }>(
          `UPDATE "Tenant" SET "status" = $2, "lifecycleVersion" = "lifecycleVersion" + 1,
             "suspendedAt" = $4, "suspendedReason" = $5, "updatedAt" = now()
           WHERE "id" = $1 AND "id" <> 'system' AND "lifecycleVersion" = $3 RETURNING "id"`,
          [id, input.status, input.expectedLifecycleVersion, next.suspendedAt ?? null, next.suspendedReason ?? null],
        );
        if (!updated.rows[0]) throw new Error("TENANT_LIFECYCLE_VERSION_CONFLICT");
        const revoked = await client.query<{ id: string }>(
          `UPDATE "AuthSession" SET "status" = 'REVOKED', "updatedAt" = now()
           WHERE "tenantId" = $1 AND "status" = 'ACTIVE' RETURNING "id"`, [id],
        );
        response = { tenant: next, sessionsRevoked: revoked.rowCount ?? revoked.rows.length };
        await client.query(
          `INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff")
           VALUES ($1, $2, $3, 'Tenant', $2, $4, $5::jsonb)`,
          [randomUUID(), id, input.actorUserId, input.status === "SUSPENDED" ? "tenant.suspended" : "tenant.activated", JSON.stringify(lifecycleDiff(current, input))],
        );
      }
      const completed = await client.query<{ id: string }>(
        `UPDATE "PlatformIdempotencyKey" SET "status" = 'COMPLETED', "responseBody" = $4::jsonb, "completedAt" = now(), "updatedAt" = now()
         WHERE "platformAccountId" = $1 AND "key" = $2 AND "operation" = 'tenant.lifecycle.change' AND "requestHash" = $3 AND "status" = 'IN_PROGRESS' RETURNING "id"`,
        [input.actorUserId, input.idempotencyKey, input.requestHash, JSON.stringify(response)],
      );
      if (!completed.rows[0]) throw new Error("IDEMPOTENCY_COMPLETION_FAILED");
      return response;
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
  status: TenantAccessStatus;
  lifecycleVersion: number;
  suspendedAt: Date | string | null;
  suspendedReason: TenantLifecycleReason | null;
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
  status?: TenantAccessStatus;
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
  auditedAtomically: boolean;
  result: TenantOnboardingResult;
  replayed: boolean;
}

export interface TenantStatusTransitionInput extends TenantStatusUpdateRequest {
  actorUserId: string;
  sessionId: string;
  membershipVersion: number;
  idempotencyKey: string;
  requestHash: string;
}

export interface TenantStatusTransitionResult {
  tenant: TenantRecord;
  sessionsRevoked: number;
}

interface TenantLifecycleDependencies {
  auditLogs: AuditLogService;
  sessions: SessionStore;
}

export type UpdateTenantInput = Partial<Pick<CreateTenantInput, "name" | "institutionType" | "contactEmail" | "logoUrl">>;

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
    lifecycleVersion: row.lifecycleVersion,
    suspendedAt: optionalDateString(row.suspendedAt),
    suspendedReason: row.suspendedReason ?? undefined,
  };
}

function optionalDateString(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
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

function assertTenantAccessStatus(status: string): void {
  if (status !== "ACTIVE" && status !== "SUSPENDED") throw new Error("TENANT_STATUS_UNSUPPORTED");
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

export function createTenantStore(lifecycle?: TenantLifecycleDependencies): TenantStore {
  return resolvePersistenceDriver(process.env.TENANT_STORE) === "postgres" ? new PostgresTenantStore() : new InMemoryTenantStore(lifecycle);
}

function assertLifecycleRequest(tenant: TenantRecord, input: TenantStatusTransitionInput): void {
  if (!Number.isInteger(tenant.lifecycleVersion) || tenant.lifecycleVersion !== input.expectedLifecycleVersion) throw new Error("TENANT_LIFECYCLE_VERSION_CONFLICT");
  if (tenant.slug !== input.confirmationText) throw new Error("TENANT_CONFIRMATION_MISMATCH");
}

function lifecycleNext(tenant: TenantRecord, input: TenantStatusTransitionInput): TenantRecord {
  return { ...tenant, status: input.status, lifecycleVersion: tenant.lifecycleVersion + 1,
    suspendedAt: input.status === "SUSPENDED" ? new Date().toISOString() : undefined,
    suspendedReason: input.status === "SUSPENDED" ? input.reason : undefined };
}

function lifecycleDiff(tenant: TenantRecord, input: TenantStatusTransitionInput) {
  return { previousStatus: tenant.status, status: input.status, reason: input.reason,
    previousLifecycleVersion: tenant.lifecycleVersion, lifecycleVersion: tenant.lifecycleVersion + 1 };
}
