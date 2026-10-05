import type { GuardianAutoNotificationSettingsRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

/** KV-8 (DEC-20261005-04) defaults: every trigger on, 10 absent days per term. */
export const defaultGuardianAutoNotificationSettings: GuardianAutoNotificationSettingsRecord = {
  absenceEnabled: true,
  paymentDueEnabled: true,
  gradePublishEnabled: true,
  absenceThreshold: 10,
};

export interface GuardianNotificationSettingsStore {
  find(tenantId: string): Promise<GuardianAutoNotificationSettingsRecord | undefined>;
  update(tenantId: string, input: Partial<GuardianAutoNotificationSettingsRecord>): Promise<GuardianAutoNotificationSettingsRecord | undefined>;
}

export const guardianNotificationSettingsStoreToken = Symbol("GuardianNotificationSettingsStore");

export class InMemoryGuardianNotificationSettingsStore implements GuardianNotificationSettingsStore {
  private readonly settings = new Map<string, GuardianAutoNotificationSettingsRecord>();

  async find(tenantId: string): Promise<GuardianAutoNotificationSettingsRecord | undefined> {
    return { ...(this.settings.get(tenantId) ?? defaultGuardianAutoNotificationSettings) };
  }

  async update(tenantId: string, input: Partial<GuardianAutoNotificationSettingsRecord>): Promise<GuardianAutoNotificationSettingsRecord> {
    const next = { ...(this.settings.get(tenantId) ?? defaultGuardianAutoNotificationSettings), ...input };
    this.settings.set(tenantId, next);
    return { ...next };
  }
}

interface SettingsRow {
  guardianNotifyAbsence: boolean;
  guardianNotifyPaymentDue: boolean;
  guardianNotifyGradePublish: boolean;
  guardianAbsenceThreshold: number;
}

const settingsColumns = `"guardianNotifyAbsence", "guardianNotifyPaymentDue", "guardianNotifyGradePublish", "guardianAbsenceThreshold"`;

export class PostgresGuardianNotificationSettingsStore implements GuardianNotificationSettingsStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async find(tenantId: string): Promise<GuardianAutoNotificationSettingsRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SettingsRow>(`SELECT ${settingsColumns} FROM "Tenant" WHERE "id" = $1`, [tenantId]);
      return result.rows[0] ? toRecord(result.rows[0]) : undefined;
    });
  }

  async update(tenantId: string, input: Partial<GuardianAutoNotificationSettingsRecord>): Promise<GuardianAutoNotificationSettingsRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SettingsRow>(
        `UPDATE "Tenant"
         SET "guardianNotifyAbsence" = COALESCE($2, "guardianNotifyAbsence"),
             "guardianNotifyPaymentDue" = COALESCE($3, "guardianNotifyPaymentDue"),
             "guardianNotifyGradePublish" = COALESCE($4, "guardianNotifyGradePublish"),
             "guardianAbsenceThreshold" = COALESCE($5, "guardianAbsenceThreshold"),
             "updatedAt" = now()
         WHERE "id" = $1 AND "id" <> 'system'
         RETURNING ${settingsColumns}`,
        [tenantId, input.absenceEnabled ?? null, input.paymentDueEnabled ?? null, input.gradePublishEnabled ?? null, input.absenceThreshold ?? null],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : undefined;
    });
  }
}

function toRecord(row: SettingsRow): GuardianAutoNotificationSettingsRecord {
  return {
    absenceEnabled: row.guardianNotifyAbsence,
    paymentDueEnabled: row.guardianNotifyPaymentDue,
    gradePublishEnabled: row.guardianNotifyGradePublish,
    absenceThreshold: row.guardianAbsenceThreshold,
  };
}

export function createGuardianNotificationSettingsStore(): GuardianNotificationSettingsStore {
  return resolvePersistenceDriver() === "postgres"
    ? new PostgresGuardianNotificationSettingsStore()
    : new InMemoryGuardianNotificationSettingsStore();
}
