import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@uzman-hocam/db";
import { PostgresBackupRestoreJobReporter } from "./postgres-backup-restore-job-reporter.js";

describe("PostgresBackupRestoreJobReporter", () => {
  it("backup restore job kaydını completed olarak günceller", async () => {
    const client = new FakeClient(() => [{ id: "job-a" }]);
    const reporter = new PostgresBackupRestoreJobReporter(new FakePool(client));

    await reporter.markCompleted({
      tenantId: "tenant-a",
      jobId: "backup-restore-a_hash-a",
      operationType: "RESTORE_DRILL",
      targetReference: "file:///mnt/restore-drills/staging-drill-2026-06.json",
      reason: "Aylık restore kanıtı",
      result: "PASS",
      status: "completed",
      checkedTables: ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"],
    });

    const update = client.queries.find((query) => query.sql.includes('UPDATE "BackupRestoreJob"'));
    expect(update?.values).toEqual([
      "tenant-a",
      "backup-restore-a_hash-a",
      "PASS",
      "file:///mnt/restore-drills/staging-drill-2026-06.json",
      "Aylık restore kanıtı",
      ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"],
    ]);
  });

  it("job kaydı yoksa hata verir", async () => {
    const client = new FakeClient(() => []);
    const reporter = new PostgresBackupRestoreJobReporter(new FakePool(client));

    await expect(reporter.markCompleted({
      tenantId: "tenant-a",
      jobId: "missing-job",
      operationType: "RESTORE_DRILL",
      targetReference: "staging",
      result: "PASS",
      status: "completed",
      checkedTables: ["Tenant"],
    })).rejects.toThrow("BACKUP_RESTORE_JOB_NOT_FOUND");
  });

  it("backup restore job kaydını failed olarak günceller", async () => {
    const client = new FakeClient(() => [{ id: "job-a" }]);
    const reporter = new PostgresBackupRestoreJobReporter(new FakePool(client));

    await reporter.markFailed({
      tenantId: "tenant-a",
      jobId: "backup-restore-a_hash-a",
      operationType: "RESTORE_DRILL",
      targetReference: "staging",
      errorCode: "BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED",
    });

    const update = client.queries.find((query) => query.sql.includes('UPDATE "BackupRestoreJob"'));
    expect(update?.values).toEqual([
      "tenant-a",
      "backup-restore-a_hash-a",
      "staging",
      null,
      "BACKUP_RESTORE_EVIDENCE_FILE_URL_REQUIRED",
    ]);
  });
});

class FakePool implements TenantQueryable {
  constructor(private readonly client: FakeClient) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    return this.client.query<T>(sql, values);
  }

  async connect(): Promise<FakeClient> {
    return this.client;
  }
}

class FakeClient implements Queryable {
  readonly queries: Array<{ sql: string; values?: unknown[] }> = [];

  constructor(private readonly handler: (sql: string, values?: unknown[]) => unknown[]) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql: sql.trim(), values });
    return { rows: this.handler(sql, values) as T[] };
  }

  release(): void {}
}
