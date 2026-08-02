import { randomUUID } from "node:crypto";
import type { SecretDeliveryOutboxInput } from "@o-okul/db";
import pg from "pg";
import type { PortalSubjectRoleName, TenantAssignableRoleName } from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery } from "../db/tenant-query.js";

export type InvitationSubjectType = PortalSubjectRoleName | "EMPLOYEE";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";
export type IdentityInvitationKind = "EMAIL_LINK" | "STUDENT_CODE";

export interface IdentityInvitationRecord {
  id: string;
  tenantId: string;
  subjectType: InvitationSubjectType;
  subjectId: string;
  email?: string;
  name: string;
  role: TenantAssignableRoleName;
  kind: IdentityInvitationKind;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt?: string;
  acceptedUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdentityInvitationInput {
  id?: string;
  tenantId: string;
  subjectType: InvitationSubjectType;
  subjectId: string;
  email?: string;
  name: string;
  role: TenantAssignableRoleName;
  kind?: IdentityInvitationKind;
  tokenHash: string;
  expiresAt: string;
  delivery?: SecretDeliveryOutboxInput;
}

export interface IdentityInvitationStore {
  list(tenantId: string): Promise<IdentityInvitationRecord[]>;
  create(input: CreateIdentityInvitationInput): Promise<IdentityInvitationRecord>;
  findById(tenantId: string, id: string): Promise<IdentityInvitationRecord | undefined>;
  findByTokenHash(tokenHash: string): Promise<IdentityInvitationRecord | undefined>;
  resend(tenantId: string, id: string, input: { tokenHash: string; expiresAt: string; delivery: SecretDeliveryOutboxInput }): Promise<IdentityInvitationRecord | undefined>;
  markAccepted(id: string, userId: string, acceptedAt: string): Promise<IdentityInvitationRecord | undefined>;
  revokePendingForSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string): Promise<number>;
}

export const identityInvitationStoreToken = Symbol("IdentityInvitationStore");

export class InMemoryIdentityInvitationStore implements IdentityInvitationStore {
  private readonly invitations: Array<IdentityInvitationRecord & { tokenHash: string }> = [];

  async list(tenantId: string): Promise<IdentityInvitationRecord[]> {
    return this.invitations.filter((invitation) => invitation.tenantId === tenantId).map(stripRequiredTokenHash);
  }

  async create(input: CreateIdentityInvitationInput): Promise<IdentityInvitationRecord> {
    const now = new Date().toISOString();
    const invitation = {
      id: input.id ?? `identity-invitation-${this.invitations.length + 1}`,
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      email: input.email,
      name: input.name,
      role: input.role,
      kind: input.kind ?? "EMAIL_LINK",
      tokenHash: input.tokenHash,
      status: "PENDING" as const,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.invitations.push(invitation);
    return stripRequiredTokenHash(invitation);
  }

  async findById(tenantId: string, id: string): Promise<IdentityInvitationRecord | undefined> {
    return stripTokenHash(this.invitations.find((invitation) => invitation.tenantId === tenantId && invitation.id === id));
  }

  async findByTokenHash(tokenHash: string): Promise<IdentityInvitationRecord | undefined> {
    return stripTokenHash(this.invitations.find((invitation) => invitation.tokenHash === tokenHash));
  }

  async resend(
    tenantId: string,
    id: string,
    input: { tokenHash: string; expiresAt: string; delivery: SecretDeliveryOutboxInput },
  ): Promise<IdentityInvitationRecord | undefined> {
    const invitation = this.invitations.find((candidate) => candidate.tenantId === tenantId && candidate.id === id);
    if (!invitation) return undefined;

    invitation.tokenHash = input.tokenHash;
    invitation.expiresAt = input.expiresAt;
    invitation.status = "PENDING";
    invitation.acceptedAt = undefined;
    invitation.acceptedUserId = undefined;
    invitation.updatedAt = new Date().toISOString();
    return stripTokenHash(invitation);
  }

  async markAccepted(id: string, userId: string, acceptedAt: string): Promise<IdentityInvitationRecord | undefined> {
    const invitation = this.invitations.find((candidate) => candidate.id === id);
    if (!invitation || invitation.status !== "PENDING" || Date.parse(invitation.expiresAt) <= Date.parse(acceptedAt)) return undefined;

    invitation.status = "ACCEPTED";
    invitation.acceptedAt = acceptedAt;
    invitation.acceptedUserId = userId;
    invitation.updatedAt = acceptedAt;
    return stripTokenHash(invitation);
  }

  async revokePendingForSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string): Promise<number> {
    let revoked = 0;
    const now = new Date().toISOString();
    for (const invitation of this.invitations) {
      if (
        invitation.tenantId === tenantId &&
        invitation.subjectType === subjectType &&
        invitation.subjectId === subjectId &&
        invitation.status === "PENDING"
      ) {
        invitation.status = "REVOKED";
        invitation.updatedAt = now;
        revoked += 1;
      }
    }
    return revoked;
  }
}

export class PostgresIdentityInvitationStore implements IdentityInvitationStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(tenantId: string): Promise<IdentityInvitationRecord[]> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<IdentityInvitationRow>(
        `SELECT * FROM "IdentityInvitation" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC`,
        [tenantId],
      );
      return result.rows.map(toIdentityInvitationRecord);
    });
  }

  async create(input: CreateIdentityInvitationInput): Promise<IdentityInvitationRecord> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      const result = await client.query<IdentityInvitationRow>(
        `INSERT INTO "IdentityInvitation" (
           "id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "kind",
           "tokenHash", "status", "expiresAt", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10, now())
         RETURNING *`,
        [
          input.id ?? randomUUID(),
          input.tenantId,
          input.subjectType,
          input.subjectId,
          input.email,
          input.name,
          input.role,
          input.kind ?? "EMAIL_LINK",
          input.tokenHash,
          input.expiresAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("IDENTITY_INVITATION_CREATE_FAILED");
      }
      if (input.delivery) await insertSecretDeliveryOutbox(client, record.id, input.delivery);
      return toIdentityInvitationRecord(record);
    });
  }

  async findById(tenantId: string, id: string): Promise<IdentityInvitationRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<IdentityInvitationRow>(
        `SELECT * FROM "IdentityInvitation" WHERE "tenantId" = $1 AND "id" = $2 LIMIT 1`,
        [tenantId, id],
      );
      return result.rows[0] ? toIdentityInvitationRecord(result.rows[0]) : undefined;
    });
  }

  async findByTokenHash(tokenHash: string): Promise<IdentityInvitationRecord | undefined> {
    return this.withBypassQuery(async (client) => {
      const result = await client.query<IdentityInvitationRow>(
        `SELECT * FROM "IdentityInvitation" WHERE "tokenHash" = $1 LIMIT 1`,
        [tokenHash],
      );
      return result.rows[0] ? toIdentityInvitationRecord(result.rows[0]) : undefined;
    });
  }

  async resend(
    tenantId: string,
    id: string,
    input: { tokenHash: string; expiresAt: string; delivery: SecretDeliveryOutboxInput },
  ): Promise<IdentityInvitationRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<IdentityInvitationRow>(
        `UPDATE "IdentityInvitation"
         SET "tokenHash" = $3,
             "expiresAt" = $4,
             "status" = 'PENDING',
             "acceptedAt" = NULL,
             "acceptedUserId" = NULL,
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2
         RETURNING *`,
        [tenantId, id, input.tokenHash, input.expiresAt],
      );
      if (!result.rows[0]) return undefined;
      await clearInvitationDeliveries(client, id);
      await insertSecretDeliveryOutbox(client, id, input.delivery);
      return toIdentityInvitationRecord(result.rows[0]);
    });
  }

  async markAccepted(id: string, userId: string, acceptedAt: string): Promise<IdentityInvitationRecord | undefined> {
    return this.withBypassQuery(async (client) => {
      const result = await client.query<IdentityInvitationRow>(
        `UPDATE "IdentityInvitation"
         SET "status" = 'ACCEPTED',
             "acceptedAt" = $2,
             "acceptedUserId" = $3,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "status" = 'PENDING'
           AND "expiresAt" > $2
         RETURNING *`,
        [id, acceptedAt, userId],
      );
      if (!result.rows[0]) return undefined;
      await clearInvitationDeliveries(client, id);
      return toIdentityInvitationRecord(result.rows[0]);
    });
  }

  async revokePendingForSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string): Promise<number> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const revoked = await client.query<{ id: string }>(
        `UPDATE "IdentityInvitation"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "subjectType" = $2
           AND "subjectId" = $3
           AND "status" = 'PENDING'
         RETURNING "id"`,
        [tenantId, subjectType, subjectId],
      );
      for (const invitation of revoked.rows) {
        await clearInvitationDeliveries(client, invitation.id);
      }
      return revoked.rows.length;
    });
  }

  private async withBypassQuery<T>(callback: (client: Queryable) => Promise<T>): Promise<T> {
    if (!this.pool.connect) {
      await this.pool.query("SELECT set_config('app.bypass_rls', 'true', true)");
      return callback(this.pool);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertSecretDeliveryOutbox(client: Queryable, sourceId: string, input: SecretDeliveryOutboxInput): Promise<void> {
  await client.query(
    `INSERT INTO "SecretDeliveryOutbox" (
       "id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "availableAt", "expiresAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, 'PENDING', now(), $6, now())`,
    [randomUUID(), input.tenantId ?? null, input.purpose, sourceId, input.payloadEncrypted, input.expiresAt],
  );
}

async function clearInvitationDeliveries(client: Queryable, sourceId: string): Promise<void> {
  await client.query(
    `UPDATE "SecretDeliveryOutbox"
     SET "status" = 'EXPIRED',
         "payloadEncrypted" = NULL,
         "claimedAt" = NULL,
         "lastErrorCode" = NULL,
         "updatedAt" = now()
     WHERE "purpose" = 'IDENTITY_INVITATION'
       AND "sourceId" = $1
       AND "payloadEncrypted" IS NOT NULL`,
    [sourceId],
  );
}

export function createIdentityInvitationStore(): IdentityInvitationStore {
  return resolvePersistenceDriver(process.env.IDENTITY_INVITATION_STORE ?? process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresIdentityInvitationStore()
    : new InMemoryIdentityInvitationStore();
}

interface IdentityInvitationRow {
  id: string;
  tenantId: string;
  subjectType: InvitationSubjectType;
  subjectId: string;
  email: string | null;
  name: string;
  role: TenantAssignableRoleName;
  kind: IdentityInvitationKind;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toIdentityInvitationRecord(row: IdentityInvitationRow): IdentityInvitationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    email: row.email ?? undefined,
    name: row.name,
    role: row.role,
    kind: row.kind,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString(),
    acceptedUserId: row.acceptedUserId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function stripTokenHash(
  invitation: (IdentityInvitationRecord & { tokenHash: string }) | undefined,
): IdentityInvitationRecord | undefined {
  if (!invitation) return undefined;
  const { tokenHash: _tokenHash, ...record } = invitation;
  return { ...record };
}

function stripRequiredTokenHash(invitation: IdentityInvitationRecord & { tokenHash: string }): IdentityInvitationRecord {
  const { tokenHash: _tokenHash, ...record } = invitation;
  return { ...record };
}
