import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@o-okul/db";
import { PostgresGuardianNotificationStore } from "./postgres-guardian-notification-store.js";

describe("PostgresGuardianNotificationStore (KV-8 claims)", () => {
  it("lisans dönemleri tenant bağlamında okunur ve ISO metne çevrilir", async () => {
    const client = new ScriptedClient({
      licenseTerms: [
        { startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: new Date("2027-01-01T00:00:00.000Z"), cancelledAt: null },
        { startsAt: new Date("2025-01-01T00:00:00.000Z"), endsAt: new Date("2026-01-01T00:00:00.000Z"), cancelledAt: new Date("2025-06-01T00:00:00.000Z") },
      ],
    });
    const store = new PostgresGuardianNotificationStore(new FakePool(client));

    await expect(store.listLicenseTerms("tenant-a")).resolves.toEqual([
      { startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z" },
      { startsAt: "2025-01-01T00:00:00.000Z", endsAt: "2026-01-01T00:00:00.000Z", cancelledAt: "2025-06-01T00:00:00.000Z" },
    ]);
    const query = client.queries.find((entry) => entry.sql.includes("FROM \"LicenseTerm\""));
    expect(query?.values).toEqual(["tenant-a"]);
    expect(client.queries.some((entry) => entry.values?.includes("tenant-a") && entry.sql.includes("set_config"))).toBe(true);
  });

  it("devamsızlık: notifiedAt boşsa claim eder; aynı gün düzeltme sonrası tekrar ABSENT ikinci bildirim üretmez", async () => {
    const client = new ScriptedClient({ attendance: { status: "ABSENT", notified: false }, term: { absentCount: 1, warned: false } });
    const store = new PostgresGuardianNotificationStore(new FakePool(client));

    await expect(store.claimAbsence("tenant-a", "attendance-a", 10)).resolves.toEqual({
      studentId: "student-a",
      notifiedDate: "2026-10-05",
      thresholdReached: false,
    });
    expect(client.updates("SET \"notifiedAt\" = now()")).toHaveLength(1);

    // ABSENT -> PRESENT -> ABSENT keeps the same row with notifiedAt set: nothing new to claim.
    client.state.attendance = { status: "ABSENT", notified: true };
    await expect(store.claimAbsence("tenant-a", "attendance-a", 10)).resolves.toEqual({
      studentId: "student-a",
      notifiedDate: undefined,
      thresholdReached: false,
    });
    expect(client.updates("SET \"notifiedAt\" = now()")).toHaveLength(1);

    client.state.attendance = { status: "PRESENT", notified: false };
    await expect(store.claimAbsence("tenant-a", "attendance-a", 10)).resolves.toBeUndefined();
  });

  it("dönem eşiği: eşik altında uyarı yok, eşikte bir kez, daha önce uyarıldıysa yok", async () => {
    const client = new ScriptedClient({ attendance: { status: "ABSENT", notified: true }, term: { absentCount: 9, warned: false } });
    const store = new PostgresGuardianNotificationStore(new FakePool(client));

    expect((await store.claimAbsence("tenant-a", "attendance-a", 10))?.thresholdReached).toBe(false);
    client.state.term = { absentCount: 10, warned: false };
    expect((await store.claimAbsence("tenant-a", "attendance-a", 10))?.thresholdReached).toBe(true);
    expect(client.updates("SET \"thresholdNotifiedAt\" = now()")).toHaveLength(1);
    client.state.term = { absentCount: 11, warned: true };
    expect((await store.claimAbsence("tenant-a", "attendance-a", 10))?.thresholdReached).toBe(false);
    expect(client.updates("SET \"thresholdNotifiedAt\" = now()")).toHaveLength(1);
    expect(client.sql("FROM \"Student\"")[0]).toContain("FOR NO KEY UPDATE");
  });

  it("vade: taksit+gün başına bir kez; ödenmiş veya vade dışı gün claim edilmez", async () => {
    const client = new ScriptedClient({ installment: { dueDate: "2026-10-08", status: "PENDING", notifiedOn: null } });
    const store = new PostgresGuardianNotificationStore(new FakePool(client));

    await expect(store.claimPaymentDue("tenant-a", "installment-a", "2026-10-05")).resolves.toEqual({ studentId: "student-a", dueDate: "2026-10-08" });
    expect(client.updates("SET \"notifiedOn\" = $3::date")).toHaveLength(1);
    expect(client.updates("SET \"notifiedOn\" = $3::date")[0]?.values).toEqual(["tenant-a", "installment-a", "2026-10-05"]);

    client.state.installment = { dueDate: "2026-10-08", status: "PENDING", notifiedOn: "2026-10-05" };
    await expect(store.claimPaymentDue("tenant-a", "installment-a", "2026-10-05")).resolves.toBeUndefined();
    // The due-day reminder is a new day: claimable once more.
    client.state.installment = { dueDate: "2026-10-08", status: "PENDING", notifiedOn: "2026-10-05" };
    await expect(store.claimPaymentDue("tenant-a", "installment-a", "2026-10-08")).resolves.toBeDefined();

    client.state.installment = { dueDate: "2026-10-08", status: "PAID", notifiedOn: null };
    await expect(store.claimPaymentDue("tenant-a", "installment-a", "2026-10-08")).resolves.toBeUndefined();
    client.state.installment = { dueDate: "2026-10-09", status: "PENDING", notifiedOn: null };
    await expect(store.claimPaymentDue("tenant-a", "installment-a", "2026-10-08")).resolves.toBeUndefined();
    expect(client.updates("SET \"notifiedOn\" = $3::date")).toHaveLength(2);
  });

  it("not yayını: watermark sonrası yayımlananları döner ve watermark'ı SQL'de ilerletir", async () => {
    const client = new ScriptedClient({ gradeEntries: [{ studentId: "student-a", version: 2 }] });
    const store = new PostgresGuardianNotificationStore(new FakePool(client));

    await expect(store.claimGradePublished("tenant-a", "assessment-a")).resolves.toEqual([{ studentId: "student-a", version: 2 }]);
    expect(client.sql("FROM \"GradeEntry\" e\n")[0]).toContain("e.\"publishedAt\" > a.\"notifiedAt\"");
    expect(client.updates("UPDATE \"GradeAssessment\" a")).toHaveLength(1);

    client.state.gradeEntries = [];
    await expect(store.claimGradePublished("tenant-a", "assessment-a")).resolves.toEqual([]);
    expect(client.updates("UPDATE \"GradeAssessment\" a")).toHaveLength(1);
  });

  it("alıcılar: velinin tercihi ve (vade için) finans görünürlüğü SQL'de uygulanır; cihazlar disabledAt ile süzülür", async () => {
    const client = new ScriptedClient({});
    const store = new PostgresGuardianNotificationStore(new FakePool(client));

    await store.listRecipients("tenant-a", ["student-a"], true);
    await store.listActiveDevices("tenant-a", ["user-a"]);

    const recipients = client.queries.find((query) => query.sql.includes("FROM \"GuardianStudent\" gs"));
    expect(recipients?.sql).toContain("gs.\"canReceiveAutoNotifications\" = true");
    expect(recipients?.sql).toContain("($3::boolean = false OR gs.\"canViewFinance\" = true)");
    expect(recipients?.sql).toContain("u.\"accountStatus\" = 'ACTIVE'");
    expect(recipients?.values).toEqual(["tenant-a", ["student-a"], true]);
    const devices = client.queries.find((query) => query.sql.includes("FROM \"NotificationDeviceToken\""));
    expect(devices?.sql).toContain("\"disabledAt\" IS NULL");
  });
});

interface ScriptState {
  attendance?: { status: string; notified: boolean };
  term?: { absentCount: number; warned: boolean };
  installment?: { dueDate: string; status: string; notifiedOn: string | null };
  gradeEntries?: Array<{ studentId: string; version: number }>;
  licenseTerms?: Array<{ startsAt: Date; endsAt: Date; cancelledAt: Date | null }>;
}

class FakePool implements TenantQueryable {
  constructor(private readonly client: ScriptedClient) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    return this.client.query<T>(sql, values);
  }

  async connect(): Promise<ScriptedClient> {
    return this.client;
  }
}

class ScriptedClient implements Queryable {
  readonly queries: Array<{ sql: string; values?: unknown[] }> = [];

  constructor(readonly state: ScriptState) {}

  sql(fragment: string): string[] {
    return this.queries.filter((query) => query.sql.includes(fragment)).map((query) => query.sql);
  }

  updates(fragment: string): Array<{ sql: string; values?: unknown[] }> {
    return this.queries.filter((query) => query.sql.startsWith("UPDATE") && query.sql.includes(fragment));
  }

  async query<T>(rawSql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    const sql = rawSql.trim();
    this.queries.push({ sql, values });
    const rows = (value: unknown[]): { rows: T[] } => ({ rows: value as T[] });
    if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
    if (sql.includes("FROM \"Attendance\"\n") && sql.includes("FOR UPDATE")) {
      return rows(this.state.attendance ? [{ studentId: "student-a", termId: "term-a", date: "2026-10-05", ...this.state.attendance }] : []);
    }
    if (sql.includes("count(*) FILTER")) return rows(this.state.term ? [this.state.term] : []);
    if (sql.includes("FROM \"PaymentInstallment\" i") && sql.includes("FOR UPDATE OF i")) {
      return rows(this.state.installment ? [{ studentId: "student-a", deletedAt: null, planDeleted: false, ...this.state.installment }] : []);
    }
    if (sql.includes("FROM \"LicenseTerm\"")) return rows(this.state.licenseTerms ?? []);
    if (sql.startsWith("SELECT 1 FROM \"GradeAssessment\"")) return rows([{ "?column?": 1 }]);
    if (sql.includes("FROM \"GradeEntry\" e\n")) return rows(this.state.gradeEntries ?? []);
    return rows([]);
  }

  release(): void {}
}
