import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Queue } from "bullmq";
import pg from "pg";
import { licenseExpiryPurgeBlockers, licenseExpiryPurgeEndsAt, licenseExpiryPurgeTables, parseInstitutionResetRequest, resetDigest, resetSnapshotBlockers, resetTableCounts, resetOwnerIds, resetOwnerMemberships, tenantResetQueues, withResetPreviewSnapshot } from "@o-okul/db";
import type { TenantResetPreset, TenantResetPreview } from "@o-okul/shared-types";
import { parseRedisUrl } from "../config/env.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { getRequestContext } from "../context/request-context.js";
import { TenantService } from "./tenant.service.js";
import { resetObjectInventory, resetPreflightDigest, resetS3Client, resetS3Config } from "./tenant-reset-objects.js";

@Injectable()
export class TenantResetPreviewService {
  constructor(private readonly tenants: TenantService) {}

  async preview(tenantId: string, preset: TenantResetPreset = "CLEAN_SETUP_V1"): Promise<TenantResetPreview> {
    const tenant = await this.tenants.findOne(getRequestContext(), tenantId);
    const purge = preset === "LICENSE_EXPIRY_PURGE_V1";
    if (resolvePersistenceDriver(process.env.TENANT_STORE) !== "postgres") {
      return { preset, lifecycleVersion: tenant.lifecycleVersion, preservedOwnerCount: 0, categories: [], objectCount: 0, objectBytes: 0, blockers: ["SOURCE_UNVERIFIED", "INSTITUTION_REQUEST_REQUIRED", "WRITE_QUIESCENCE_UNVERIFIED"], blockerCounts: [{ code: "SOURCE_UNVERIFIED", count: null }, { code: "INSTITUTION_REQUEST_REQUIRED", count: null }, { code: "WRITE_QUIESCENCE_UNVERIFIED", count: null }], allowed: false, preflightDigest: resetDigest({ tenantId, lifecycleVersion: tenant.lifecycleVersion, source: "UNVERIFIED" }) };
    }
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      return await withResetPreviewSnapshot(pool, tenantId, async (snapshot, db) => {
        const blockers = purge ? licenseExpiryPurgeBlockers(resetSnapshotBlockers(snapshot)) : resetSnapshotBlockers(snapshot);
        if (purge && !licenseExpiryPurgeEndsAt(snapshot.tables.LicenseTerm as never[], new Date(snapshot.capturedAt))) blockers.push("LICENSE_NOT_EXPIRED");
        let objects: Awaited<ReturnType<typeof resetObjectInventory>> = [];
        try {
          const config = resetS3Config();
          const client = resetS3Client(config);
          try { objects = await resetObjectInventory(snapshot, client, config.bucket); }
          finally { client.destroy(); }
        } catch { blockers.push("OBJECT_INVENTORY_UNVERIFIED"); }
        const queue = await resetQueueBlockers(tenantId);
        blockers.push(...queue.blockers);
        const uniqueBlockers = [...new Set(blockers)].sort();
        const purged = new Set(licenseExpiryPurgeTables());
        const categories = purge
          ? resetTableCounts(snapshot.tables, new Date(snapshot.capturedAt)).map(({ category }) => { const rows = snapshot.tables[category].length; return purged.has(category) ? { category, preserved: 0, deleted: rows, blocked: 0 } : { category, preserved: rows, deleted: 0, blocked: 0 }; })
          : resetTableCounts(snapshot.tables, new Date(snapshot.capturedAt));
        const preservedOwners = resetOwnerIds(snapshot.tables, new Date(snapshot.capturedAt));
        const counts: Record<string, number | null> = {
          MUTATION_ACTIVITY_PRESENT: snapshot.tables.TenantMutationActivity.length,
          FINANCE_RECORDS_PRESENT: categories.filter((row) => row.category.startsWith("Payment")).reduce((sum, row) => sum + row.blocked, 0),
          SUPPORT_RECORDS_PRESENT: categories.filter((row) => row.category.startsWith("Support")).reduce((sum, row) => sum + row.blocked, 0),
          CONSENT_RECORDS_PRESENT: snapshot.tables.WhatsAppConsent.length + snapshot.tables.WhatsAppConsentEvent.length + snapshot.tables.StudentContact.filter((row) => row.consentRecordedAt != null || row.consentSource != null || row.canReceiveSms || row.canReceiveAnnouncements || row.canReceiveFinance).length + snapshot.tables.GuardianStudent.filter((row) => row.canReceiveSms || row.canReceiveAnnouncements).length,
          CONSENT_HISTORY_UNVERIFIED: snapshot.tables.StudentContact.length,
          OWNER_PROJECTION_MISMATCH: new Set(resetOwnerMemberships(snapshot.tables, new Date(snapshot.capturedAt)).filter((row) => !preservedOwners.has(String(row.userId))).map((row) => row.userId)).size,
          NO_ACTIVE_OWNER: 0,
          QUEUE_WORK_PRESENT: queue.workCount,
          DELIVERY_WORK_PRESENT: snapshot.tables.SecretDeliveryOutbox.filter((row) => (["PENDING", "PROCESSING", "UNCERTAIN"].includes(String(row.status)) || (row.sourceScope == null && Number(row.attempts ?? 0) > 0 && row.status !== "DELIVERED"))).length,
          BACKUP_WORK_PRESENT: snapshot.tables.BackupRestoreJob.filter((row) => /queued|running/i.test(String(row.status))).length,
          IMPORT_WORK_PRESENT: snapshot.tables.RawImport.filter((row) => /queued|running|processing/i.test(String((row.metadata as Record<string, unknown> | null)?.status ?? ""))).length,
          LICENSE_NOT_EXPIRED: 0,

        };
        return { institutionRequest: purge ? null : parseInstitutionResetRequest(snapshot.tables.Tenant[0]?.resetRequest), preset, lifecycleVersion: snapshot.lifecycleVersion, preservedOwnerCount: purge ? 0 : resetOwnerIds(snapshot.tables, new Date(snapshot.capturedAt)).size,
          categories, blockerCounts: uniqueBlockers.map((code) => ({ code, count: counts[code] ?? null })), objectCount: objects.length, objectBytes: objects.reduce((sum, object) => sum + object.size, 0),
          blockers: uniqueBlockers, allowed: false, preflightDigest: resetPreflightDigest(snapshot, objects, uniqueBlockers, !blockers.includes("OBJECT_INVENTORY_UNVERIFIED") ? resetS3Config() : undefined) };
      });
    } catch { throw new ServiceUnavailableException("RESET_PREVIEW_UNVERIFIED"); }
    finally { await pool.end(); }
  }
}

export async function resetQueueBlockers(tenantId: string): Promise<{ blockers: string[]; workCount: number }> {
  if (!process.env.REDIS_URL) return { blockers: ["QUEUE_STATE_UNVERIFIED"], workCount: 0 };
  const workIds = new Set<string>();
  const blockers: string[] = [];
  for (const name of tenantResetQueues) {
    const queue = new Queue(name, { connection: parseRedisUrl(), prefix: process.env.QUEUE_PREFIX, skipMetasUpdate: true });
    try {
      // Failed jobs are retryable. Completed jobs are receipts, not executable work.
      for (let start = 0; ; start += 100) {
        const jobs = await queue.getJobs(["active", "wait", "delayed", "prioritized", "paused", "waiting-children", "failed"], start, start + 99);
        for (const job of jobs) {
          const owner = job?.data?.tenantId ?? job?.data?.snapshot?.tenantId;
          if (!owner) blockers.push("QUEUE_STATE_UNVERIFIED");
          else if (owner === tenantId) { blockers.push("QUEUE_WORK_PRESENT"); if (job.id) workIds.add(`${name}:${job.id}`); else blockers.push("QUEUE_STATE_UNVERIFIED"); }
        }
        if (jobs.length < 100) break;
      }
      if ((await queue.getJobSchedulers(0, -1)).length || (await queue.getRepeatableJobs(0, -1)).length) blockers.push("QUEUE_SCHEDULE_UNVERIFIED");
    } catch { blockers.push("QUEUE_STATE_UNVERIFIED"); }
    finally { await queue.close(); }
  }
  return { blockers: [...new Set(blockers)].sort(), workCount: workIds.size };
}
