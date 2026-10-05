import { type TenantQueryable, withTenantDb } from "@o-okul/db";
import type { LicenseTermWindow } from "@o-okul/shared-types";
import type { PushDevice } from "./announcement-push-delivery.js";
import {
  type AbsenceClaim,
  type GuardianNotificationStore,
  type GuardianNotifySettings,
  type GuardianRecipient,
  isPaymentDueReminderDay,
} from "./guardian-auto-notification.js";
import type { PaymentDueScanStore } from "./guardian-payment-due-scanner.js";
import { PostgresAnnouncementPushStore } from "./postgres-announcement-push-store.js";

interface SettingsRow {
  guardianNotifyAbsence: boolean;
  guardianNotifyPaymentDue: boolean;
  guardianNotifyGradePublish: boolean;
  guardianAbsenceThreshold: number;
}

export class PostgresGuardianNotificationStore implements GuardianNotificationStore, PaymentDueScanStore {
  constructor(private readonly pool: TenantQueryable) {}

  async loadSettings(tenantId: string): Promise<GuardianNotifySettings | undefined> {
    return withTenantDb(this.pool, { tenantId, readOnly: true }, async (client) => {
      const row = (await client.query<SettingsRow>(
        `SELECT "guardianNotifyAbsence", "guardianNotifyPaymentDue", "guardianNotifyGradePublish", "guardianAbsenceThreshold"
         FROM "Tenant" WHERE "id" = $1 AND "status" = 'ACTIVE'`,
        [tenantId],
      )).rows[0];
      return row
        ? {
            absenceEnabled: row.guardianNotifyAbsence,
            paymentDueEnabled: row.guardianNotifyPaymentDue,
            gradePublishEnabled: row.guardianNotifyGradePublish,
            absenceThreshold: row.guardianAbsenceThreshold,
          }
        : undefined;
    });
  }

  async listLicenseTerms(tenantId: string): Promise<LicenseTermWindow[]> {
    return withTenantDb(this.pool, { tenantId, readOnly: true }, async (client) => {
      const result = await client.query<{ startsAt: Date; endsAt: Date; cancelledAt: Date | null }>(
        `SELECT "startsAt", "endsAt", "cancelledAt" FROM "LicenseTerm" WHERE "tenantId" = $1`,
        [tenantId],
      );
      return result.rows.map((row) => ({
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        ...(row.cancelledAt ? { cancelledAt: row.cancelledAt.toISOString() } : {}),
      }));
    });
  }

  async claimAbsence(tenantId: string, attendanceId: string, threshold: number): Promise<AbsenceClaim | undefined> {
    return withTenantDb(this.pool, { tenantId }, async (client) => {
      const row = (await client.query<{ studentId: string; termId: string | null; date: string; status: string; notified: boolean }>(
        `SELECT "studentId", "termId", to_char("date", 'YYYY-MM-DD') AS "date", "status", "notifiedAt" IS NOT NULL AS "notified"
         FROM "Attendance"
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         FOR UPDATE`,
        [tenantId, attendanceId],
      )).rows[0];
      // A correction back to PRESENT before the worker ran: nothing to send.
      if (!row || row.status !== "ABSENT") return undefined;

      let notifiedDate: string | undefined;
      if (!row.notified) {
        await client.query(`UPDATE "Attendance" SET "notifiedAt" = now() WHERE "tenantId" = $1 AND "id" = $2 AND "notifiedAt" IS NULL`, [tenantId, attendanceId]);
        notifiedDate = row.date;
      }

      let thresholdReached = false;
      if (row.termId) {
        // Serializes the once-per-term warning for this student across concurrent absence jobs.
        await client.query(`SELECT 1 FROM "Student" WHERE "tenantId" = $1 AND "id" = $2 FOR NO KEY UPDATE`, [tenantId, row.studentId]);
        const term = (await client.query<{ absentCount: number; warned: boolean }>(
          `SELECT count(*) FILTER (WHERE "status" = 'ABSENT')::int AS "absentCount",
                  COALESCE(bool_or("thresholdNotifiedAt" IS NOT NULL), false) AS "warned"
           FROM "Attendance"
           WHERE "tenantId" = $1 AND "studentId" = $2 AND "termId" = $3 AND "deletedAt" IS NULL`,
          [tenantId, row.studentId, row.termId],
        )).rows[0];
        if (term && !term.warned && term.absentCount >= threshold) {
          await client.query(`UPDATE "Attendance" SET "thresholdNotifiedAt" = now() WHERE "tenantId" = $1 AND "id" = $2`, [tenantId, attendanceId]);
          thresholdReached = true;
        }
      }
      return { studentId: row.studentId, notifiedDate, thresholdReached };
    });
  }

  async claimPaymentDue(tenantId: string, installmentId: string, day: string): Promise<{ studentId: string; dueDate: string } | undefined> {
    return withTenantDb(this.pool, { tenantId }, async (client) => {
      const row = (await client.query<{
        studentId: string;
        dueDate: string;
        status: "PENDING" | "PAID" | "CANCELED";
        deletedAt: string | null;
        planDeleted: boolean;
        notifiedOn: string | null;
      }>(
        `SELECT p."studentId", to_char(i."dueDate", 'YYYY-MM-DD') AS "dueDate", i."status", i."deletedAt"::text AS "deletedAt",
                p."deletedAt" IS NOT NULL AS "planDeleted", to_char(i."notifiedOn", 'YYYY-MM-DD') AS "notifiedOn"
         FROM "PaymentInstallment" i
         JOIN "PaymentPlan" p ON p."tenantId" = i."tenantId" AND p."id" = i."planId"
         WHERE i."tenantId" = $1 AND i."id" = $2
         FOR UPDATE OF i`,
        [tenantId, installmentId],
      )).rows[0];
      if (!row || row.planDeleted || (row.notifiedOn !== null && row.notifiedOn >= day)) return undefined;
      if (!isPaymentDueReminderDay({ dueDate: row.dueDate, status: row.status, deletedAt: row.deletedAt ?? undefined }, day)) return undefined;
      await client.query(`UPDATE "PaymentInstallment" SET "notifiedOn" = $3::date WHERE "tenantId" = $1 AND "id" = $2`, [tenantId, installmentId, day]);
      return { studentId: row.studentId, dueDate: row.dueDate };
    });
  }

  async claimGradePublished(tenantId: string, assessmentId: string): Promise<Array<{ studentId: string; version: number }>> {
    return withTenantDb(this.pool, { tenantId }, async (client) => {
      const locked = await client.query(
        `SELECT 1 FROM "GradeAssessment" WHERE "tenantId" = $1 AND "id" = $2 AND "publishedVersion" IS NOT NULL FOR UPDATE`,
        [tenantId, assessmentId],
      );
      if (locked.rows.length === 0) return [];
      // Watermark compared in SQL: publishedAt keeps microseconds a JS Date would drop.
      const entries = (await client.query<{ studentId: string; version: number }>(
        `SELECT e."studentId", e."version"
         FROM "GradeEntry" e
         JOIN "GradeAssessment" a ON a."tenantId" = e."tenantId" AND a."id" = e."assessmentId"
         WHERE e."tenantId" = $1 AND e."assessmentId" = $2 AND e."publishedAt" IS NOT NULL
           AND (a."notifiedAt" IS NULL OR e."publishedAt" > a."notifiedAt")
         ORDER BY e."studentId", e."version"`,
        [tenantId, assessmentId],
      )).rows;
      if (entries.length === 0) return [];
      await client.query(
        `UPDATE "GradeAssessment" a
         SET "notifiedAt" = (SELECT max(e."publishedAt") FROM "GradeEntry" e WHERE e."tenantId" = a."tenantId" AND e."assessmentId" = a."id" AND e."publishedAt" IS NOT NULL),
             "notifiedVersion" = a."publishedVersion"
         WHERE a."tenantId" = $1 AND a."id" = $2`,
        [tenantId, assessmentId],
      );
      return entries;
    });
  }

  async listRecipients(tenantId: string, studentIds: string[], requireFinance: boolean): Promise<GuardianRecipient[]> {
    return withTenantDb(this.pool, { tenantId, readOnly: true }, async (client) => {
      const result = await client.query<GuardianRecipient>(
        `SELECT DISTINCT u."id" AS "userId", u."email"
         FROM "GuardianStudent" gs
         JOIN "Guardian" g ON g."tenantId" = gs."tenantId" AND g."id" = gs."guardianId" AND g."deletedAt" IS NULL
         JOIN "User" u ON u."tenantId" = g."tenantId" AND u."id" = g."userId" AND u."accountStatus" = 'ACTIVE'
         WHERE gs."tenantId" = $1 AND gs."studentId" = ANY($2::text[])
           AND gs."canReceiveAutoNotifications" = true
           AND ($3::boolean = false OR gs."canViewFinance" = true)
         ORDER BY u."id"`,
        [tenantId, studentIds, requireFinance],
      );
      return result.rows;
    });
  }

  async listActiveDevices(tenantId: string, userIds: string[]): Promise<PushDevice[]> {
    return withTenantDb(this.pool, { tenantId, readOnly: true }, async (client) => {
      const result = await client.query<PushDevice>(
        `SELECT "id", "token", "subjectType"
         FROM "NotificationDeviceToken"
         WHERE "tenantId" = $1 AND "userId" = ANY($2::text[]) AND "provider" = 'web-push' AND "disabledAt" IS NULL
         ORDER BY "id"`,
        [tenantId, userIds],
      );
      return result.rows;
    });
  }

  async disableDevices(tenantId: string, deviceIds: string[]): Promise<void> {
    await new PostgresAnnouncementPushStore(this.pool).disableDevices(tenantId, deviceIds);
  }

  async listEnabledTenants(): Promise<Array<{ id: string; lifecycleVersion: number }>> {
    // Tenant carries no RLS (it is the tenant registry); only switch + status are read.
    return (await this.pool.query<{ id: string; lifecycleVersion: number }>(
      `SELECT "id", "lifecycleVersion" FROM "Tenant"
       WHERE "status" = 'ACTIVE' AND "id" <> 'system' AND "guardianNotifyPaymentDue" = true
       ORDER BY "id"`,
    )).rows;
  }

  async listDueInstallmentIds(tenantId: string, day: string): Promise<string[]> {
    return withTenantDb(this.pool, { tenantId, readOnly: true }, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT i."id"
         FROM "PaymentInstallment" i
         JOIN "PaymentPlan" p ON p."tenantId" = i."tenantId" AND p."id" = i."planId" AND p."deletedAt" IS NULL
         WHERE i."tenantId" = $1 AND i."status" = 'PENDING' AND i."deletedAt" IS NULL
           AND i."dueDate" IN ($2::date, $2::date + 3)
           AND (i."notifiedOn" IS NULL OR i."notifiedOn" < $2::date)
         ORDER BY i."id"`,
        [tenantId, day],
      );
      return result.rows.map((row) => row.id);
    });
  }
}
