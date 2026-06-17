import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PortalSubjectRoleName } from "@uzman-hocam/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery } from "../db/tenant-query.js";

export type InvitationSubjectType = PortalSubjectRoleName;
export type InvitationStatus = "PENDING" | "ACCEPTED";

export interface IdentityInvitationRecord {
  id: string;
  tenantId: string;
  subjectType: InvitationSubjectType;
  subjectId: string;
  email: string;
  name: string;
  role: InvitationSubjectType;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt?: string;
  acceptedUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdentityInvitationInput {
  tenantId: string;
  subjectType: InvitationSubjectType;
  subjectId: string;
  email: string;
  name: string;
  role: InvitationSubjectType;
  tokenHash: string;
  expiresAt: string;
}

export interface IdentityInvitationStore {
  list(tenantId: string): Promise<IdentityInvitationRecord[]>;
  create(input: CreateIdentityInvitationInput): Promise<IdentityInvitationRecord>;
  findById(tenantId: string, id: string): Promise<IdentityInvitationRecord | undefined>;
  findByTokenHash(tokenHash: string): Promise<IdentityInvitationRecord | undefined>;
  resend(tenantId: string, id: string, input: { tokenHash: string; expiresAt: string }): Promise<IdentityInvitationRecord | undefined>;
  markAccepted(id: string, userId: string, acceptedAt: string): Promise<IdentityInvitationRecord | undefined>;
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
      id: `identity-invitation-${this.invitations.length + 1}`,
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      email: input.email,
      name: input.name,
      role: input.role,
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
    input: { tokenHash: string; expiresAt: string },
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
    if (!invitation) return undefined;

    invitation.status = "ACCEPTED";
    invitation.acceptedAt = acceptedAt;
    invitation.acceptedUserId = userId;
    invitation.updatedAt = acceptedAt;
    return stripTokenHash(invitation);
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
           "id", "tenantId", "subjectType", "subjectId", "email", "name", "role",
           "tokenHash", "status", "expiresAt", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.subjectType,
          input.subjectId,
          input.email,
          input.name,
          input.role,
          input.tokenHash,
          input.expiresAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("IDENTITY_INVITATION_CREATE_FAILED");
      }
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
    input: { tokenHash: string; expiresAt: string },
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
      return result.rows[0] ? toIdentityInvitationRecord(result.rows[0]) : undefined;
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
         RETURNING *`,
        [id, acceptedAt, userId],
      );
      return result.rows[0] ? toIdentityInvitationRecord(result.rows[0]) : undefined;
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
  email: string;
  name: string;
  role: InvitationSubjectType;
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
    email: row.email,
    name: row.name,
    role: row.role,
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
