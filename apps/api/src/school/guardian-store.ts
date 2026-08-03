import { randomUUID } from "node:crypto";
import type { GuardianRecord as SharedGuardianRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withExplicitTenantQuery, withTenantQuery } from "../db/tenant-query.js";

export interface GuardianRecord extends SharedGuardianRecord {
  deletedAt?: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
}

export interface GuardianStore {
  list(): Promise<GuardianRecord[]>;
  findById(id: string): Promise<GuardianRecord | undefined>;
  findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<GuardianRecord | undefined>;
  findByPhone(tenantId: string, phone: string): Promise<GuardianRecord | undefined>;
  findByUserId(tenantId: string, userId: string): Promise<GuardianRecord | undefined>;
  create(input: Omit<GuardianRecord, "id">): Promise<GuardianRecord>;
  update(
    id: string,
    input: Partial<Pick<GuardianRecord, "firstName" | "lastName" | "phone" | "nationalIdEncrypted" | "nationalIdHash">>,
  ): Promise<GuardianRecord | undefined>;
  bindUser(tenantId: string, id: string, userId: string): Promise<GuardianRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<GuardianRecord | undefined>;
  purgePii(id: string): Promise<GuardianRecord | undefined>;
}

export const guardianStoreToken = Symbol("GuardianStore");

const demoGuardians: GuardianRecord[] = [
  {
    id: "guardian-a",
    tenantId: "tenant-a",
    firstName: "Ali",
    lastName: "Veli",
    phone: "5000000001",
    userId: "guardian-tenant-a",
  },
  { id: "guardian-b", tenantId: "tenant-b", firstName: "Banu", lastName: "Veli", phone: "5000000002" },
];

export class InMemoryGuardianStore implements GuardianStore {
  private readonly guardians = demoGuardians.map((record) => ({ ...record }));

  async list(): Promise<GuardianRecord[]> {
    return this.guardians;
  }

  async findById(id: string): Promise<GuardianRecord | undefined> {
    return this.guardians.find((candidate) => candidate.id === id && !candidate.deletedAt);
  }

  async findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<GuardianRecord | undefined> {
    return this.guardians.find((candidate) => candidate.tenantId === tenantId && candidate.nationalIdHash === nationalIdHash && !candidate.deletedAt);
  }

  async findByPhone(tenantId: string, phone: string): Promise<GuardianRecord | undefined> {
    return this.guardians.find((candidate) => candidate.tenantId === tenantId && candidate.phone === phone && !candidate.deletedAt);
  }

  async findByUserId(tenantId: string, userId: string): Promise<GuardianRecord | undefined> {
    return this.guardians.find((candidate) => candidate.tenantId === tenantId && candidate.userId === userId && !candidate.deletedAt);
  }

  async create(input: Omit<GuardianRecord, "id">): Promise<GuardianRecord> {
    const record = {
      id: `guardian-${this.guardians.length + 1}`,
      ...input,
    };
    this.guardians.push(record);
    return record;
  }

  async update(
    id: string,
    input: Partial<Pick<GuardianRecord, "firstName" | "lastName" | "phone" | "nationalIdEncrypted" | "nationalIdHash">>,
  ): Promise<GuardianRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.firstName !== undefined) record.firstName = input.firstName;
    if (input.lastName !== undefined) record.lastName = input.lastName;
    if (input.phone !== undefined) record.phone = input.phone;
    if (input.nationalIdEncrypted !== undefined) record.nationalIdEncrypted = input.nationalIdEncrypted;
    if (input.nationalIdHash !== undefined) record.nationalIdHash = input.nationalIdHash;
    return record;
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<GuardianRecord | undefined> {
    const record = this.guardians.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!record) return undefined;

    record.userId = userId;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<GuardianRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    record.userId = undefined;
    return record;
  }

  async purgePii(id: string): Promise<GuardianRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.firstName = "Anonim";
    record.lastName = "Veli";
    record.phone = undefined;
    record.nationalIdEncrypted = undefined;
    record.nationalIdHash = undefined;
    return record;
  }
}

export class PostgresGuardianStore implements GuardianStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<GuardianRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianRow>(`SELECT * FROM "Guardian" WHERE "deletedAt" IS NULL`);
      return result.rows.map(toGuardianRecord);
    });
  }

  async findById(id: string): Promise<GuardianRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianRow>(
        `SELECT * FROM "Guardian" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toGuardianRecord(result.rows[0]) : undefined;
    });
  }

  async findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<GuardianRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<GuardianRow>(
        `SELECT * FROM "Guardian"
         WHERE "tenantId" = $1
           AND "nationalIdHash" = $2
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, nationalIdHash],
      );
      return result.rows[0] ? toGuardianRecord(result.rows[0]) : undefined;
    });
  }

  async findByPhone(tenantId: string, phone: string): Promise<GuardianRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<GuardianRow>(
        `SELECT * FROM "Guardian"
         WHERE "tenantId" = $1
           AND "phone" = $2
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, phone],
      );
      return result.rows[0] ? toGuardianRecord(result.rows[0]) : undefined;
    });
  }

  async findByUserId(tenantId: string, userId: string): Promise<GuardianRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<GuardianRow>(
        `SELECT * FROM "Guardian" WHERE "tenantId" = $1 AND "userId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        [tenantId, userId],
      );
      return result.rows[0] ? toGuardianRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<GuardianRecord, "id">): Promise<GuardianRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianRow>(
        `INSERT INTO "Guardian" ("id", "tenantId", "firstName", "lastName", "phone", "nationalIdEncrypted", "nationalIdHash", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.firstName,
          input.lastName,
          input.phone ?? null,
          input.nationalIdEncrypted ?? null,
          input.nationalIdHash ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("GUARDIAN_CREATE_FAILED");
      }
      return toGuardianRecord(record);
    });
  }

  async update(
    id: string,
    input: Partial<Pick<GuardianRecord, "firstName" | "lastName" | "phone" | "nationalIdEncrypted" | "nationalIdHash">>,
  ): Promise<GuardianRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianRow>(
        `UPDATE "Guardian"
         SET "firstName" = COALESCE($2, "firstName"),
             "lastName" = COALESCE($3, "lastName"),
             "phone" = CASE WHEN $4 THEN $5 ELSE "phone" END,
             "nationalIdEncrypted" = COALESCE($6, "nationalIdEncrypted"),
             "nationalIdHash" = COALESCE($7, "nationalIdHash"),
             "updatedAt" = now()
         WHERE "id" = $1
           AND "deletedAt" IS NULL
         RETURNING *`,
        [
          id,
          input.firstName ?? null,
          input.lastName ?? null,
          input.phone !== undefined,
          input.phone ?? null,
          input.nationalIdEncrypted ?? null,
          input.nationalIdHash ?? null,
        ],
      );
      return result.rows[0] ? toGuardianRecord(result.rows[0]) : undefined;
    });
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<GuardianRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<GuardianRow>(
        `UPDATE "Guardian"
         SET "userId" = $3,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "deletedAt" IS NULL
         RETURNING *`,
        [tenantId, id, userId],
      );
      return result.rows[0] ? toGuardianRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<GuardianRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianRow>(
        `UPDATE "Guardian"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toGuardianRecord(result.rows[0]) : undefined;
    });
  }

  async purgePii(id: string): Promise<GuardianRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GuardianRow>(
        `UPDATE "Guardian"
         SET "firstName" = 'Anonim',
             "lastName" = 'Veli',
             "phone" = NULL,
             "nationalIdEncrypted" = NULL,
             "nationalIdHash" = NULL,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id],
      );
      return result.rows[0] ? toGuardianRecord(result.rows[0]) : undefined;
    });
  }
}

export function createGuardianStore(): GuardianStore {
  return resolvePersistenceDriver(process.env.GUARDIAN_STORE) === "postgres" ? new PostgresGuardianStore() : new InMemoryGuardianStore();
}

interface GuardianRow {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  nationalIdEncrypted: string | null;
  nationalIdHash: string | null;
  userId: string | null;
  deletedAt: Date | null;
}

function toGuardianRecord(row: GuardianRow): GuardianRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone ?? undefined,
    nationalIdEncrypted: row.nationalIdEncrypted ?? undefined,
    nationalIdHash: row.nationalIdHash ?? undefined,
    userId: row.userId ?? undefined,
    deletedAt: row.deletedAt?.toISOString(),
  };
}
