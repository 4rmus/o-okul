import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { PostgresAuditLogStore } from "../audit-log/audit-log-store.js";
import { type RequestContext, runWithRequestContext } from "../context/request-context.js";
import { IdempotencyService, PostgresIdempotencyStore } from "../http/idempotency.js";
import { PostgresLicenseTermStore } from "../license/license-term-store.js";
import { PostgresAcademicCalendarStore } from "../school/academic-calendar-store.js";
import { PostgresCampusStore } from "../school/campus-store.js";
import { PostgresClassStore } from "../school/class-store.js";
import { PostgresGradeLevelStore } from "../school/grade-level-store.js";
import { PostgresGuardianStudentStore } from "../school/guardian-student-store.js";
import type { SchoolService } from "../school/school.service.js";
import { decryptStudentContactValue, hashStudentContactValue } from "./student-contact-pii.js";
import { PostgresStudentContactStore } from "./student-contact-store.js";
import { PostgresStudentEnrollmentStore } from "./student-enrollment-store.js";
import { StudentImportService } from "./student-import.service.js";
import { PostgresStudentStore } from "./student-store.js";
import { StudentService } from "./student.service.js";
import { decryptTcIdentity, hashTcIdentity } from "./tc-identity.js";

// DEC-20261021-02: the student import writes students, enrollments, contacts, profile PII, audits and the
// idempotency completion in one tenant transaction under the `app` role and FORCE RLS.
const appDatabaseUrl = process.env.STUDENT_LICENSE_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.STUDENT_LICENSE_POSTGRES_ADMIN_URL;
if (process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1" && (!appDatabaseUrl || !adminDatabaseUrl)) {
  throw new Error("STUDENT_LICENSE_POSTGRES_URLS_REQUIRED");
}
const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

const tenantA = "student-import-batch-tenant-a";
const tenantB = "student-import-batch-tenant-b";
const tenantLimit = "student-import-batch-tenant-limit";
const tenantIds = [tenantA, tenantB, tenantLimit];
const header = "okul_no,ad,soyad,seviye,sinif,email,tc_kimlik_no,telefon,veli_ad,veli_soyad,veli_telefon,veli_tc_kimlik_no";

describePostgres("student import batch on PostgreSQL", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl, max: 4 });
  const fault: { sqlIncludes?: string; before?: { sqlIncludes: string; run: () => Promise<void> } } = {};
  const faultyPool = {
    query: (sql: string, values?: unknown[]) => app.query(sql, values),
    connect: async () => {
      const client = await app.connect();
      return {
        query: async (sql: string, values?: unknown[]) => {
          if (fault.sqlIncludes && sql.includes(fault.sqlIncludes)) throw new Error("INJECTED_IMPORT_FAILURE");
          if (fault.before && sql.includes(fault.before.sqlIncludes)) {
            const before = fault.before;
            fault.before = undefined;
            await before.run();
          }
          return client.query(sql, values);
        },
        release: (destroy?: boolean) => client.release(destroy),
      };
    },
  };
  const service = buildImportService(faultyPool as never);

  beforeAll(async () => {
    await cleanup(admin);
    await seedTenant(admin, tenantA, 100);
    await seedTenant(admin, tenantB, 100);
    await seedTenant(admin, tenantLimit, 3);
    await seedActiveStudent(admin, tenantB, "b-existing", "500");
    await seedActiveStudent(admin, tenantLimit, "limit-existing-1", "600");
    await seedActiveStudent(admin, tenantLimit, "limit-existing-2", "601");
  });

  beforeEach(() => {
    fault.sqlIncludes = undefined;
    fault.before = undefined;
  });

  afterAll(async () => {
    await cleanup(admin);
    await Promise.all([admin.end(), app.end()]);
  });

  it("enrollment insert hatasında hiçbir satır ve idempotency kaydı bırakmaz; aynı anahtarla yeniden deneme başarılı olur", async () => {
    const fileBase64 = csv([
      header,
      "1001,Ada,Ak,8. Sınıf,8-A,ada@example.test,10000000146,05321234567,Fatma,Ak,05550000001,10000001372",
      ",Bora,Bal,8. Sınıf,8-A,,,,Veli2,Bal,05550000002,",
    ]);
    fault.sqlIncludes = 'INSERT INTO "StudentEnrollment"';

    await expect(importAs(tenantA, fileBase64, "batch-retry-a")).rejects.toThrow("INJECTED_IMPORT_FAILURE");
    await expect(countTenantRows(admin, tenantA)).resolves.toEqual({ students: 0, enrollments: 0, contacts: 0, audits: 0, idempotency: 0 });

    fault.sqlIncludes = undefined;
    const result = await importAs(tenantA, fileBase64, "batch-retry-a");
    expect(result).toMatchObject({ importedRows: 2, importedContacts: 2 });
    expect(result.students.map((student) => student.studentNo)).toEqual(["1001", "100"]);
    await expect(countTenantRows(admin, tenantA)).resolves.toEqual({ students: 2, enrollments: 2, contacts: 2, audits: 3, idempotency: 1 });

    const stored = await admin.query<{
      studentNo: string;
      nationalIdEncrypted: string | null;
      nationalIdHash: string | null;
      phone: string | null;
      email: string | null;
    }>(`SELECT "studentNo", "nationalIdEncrypted", "nationalIdHash", "phone", "email" FROM "Student" WHERE "tenantId" = $1 ORDER BY "studentNo" DESC`, [tenantA]);
    const [ada, bora] = stored.rows;
    expect(decryptTcIdentity(ada!.nationalIdEncrypted!)).toBe("10000000146");
    expect(ada).toMatchObject({ studentNo: "1001", nationalIdHash: hashTcIdentity("10000000146"), phone: "5321234567", email: "ada@example.test" });
    expect(bora).toMatchObject({ studentNo: "100", nationalIdEncrypted: null, nationalIdHash: null, phone: null, email: null });

    const contacts = await admin.query<{ firstName: string; relationType: string; phoneEncrypted: string; phoneHash: string; canReceiveSms: boolean }>(
      `SELECT "firstName", "relationType", "phoneEncrypted", "phoneHash", "canReceiveSms" FROM "StudentContact" WHERE "tenantId" = $1 ORDER BY "firstName"`,
      [tenantA],
    );
    expect(contacts.rows.map((row) => [row.firstName, row.relationType, row.canReceiveSms])).toEqual([
      ["FATMA", "LEGAL_GUARDIAN", false],
      ["VELİ2", "LEGAL_GUARDIAN", false],
    ]);
    expect(decryptStudentContactValue(contacts.rows[0]!.phoneEncrypted)).toBe("5550000001");
    expect(contacts.rows[0]!.phoneHash).toBe(hashStudentContactValue("phone", "5550000001"));
    const allText = JSON.stringify({ stored: stored.rows, contacts: contacts.rows });
    expect(allText).not.toContain("10000001372");

    const audits = await admin.query<{ action: string; entityType: string; diff: Record<string, unknown> }>(
      `SELECT "action", "entityType", "diff" FROM "AuditLog" WHERE "tenantId" = $1 ORDER BY "action"`,
      [tenantA],
    );
    expect(audits.rows).toEqual([
      expect.objectContaining({ action: "student_contact.imported", entityType: "StudentContact", diff: expect.objectContaining({ permissionsDefaultOff: "[REDACTED]", relationType: "LEGAL_GUARDIAN" }) }),
      expect.objectContaining({ action: "student_contact.imported", entityType: "StudentContact" }),
      expect.objectContaining({ action: "student_import.completed", entityType: "StudentImport", diff: { totalRows: 2, importedRows: 2, errorCount: 0, quota: "[REDACTED]" } }),
    ]);
  });

  it("aynı anahtarla tekrar aynı gövdeyi döndürür, farklı dosyada IDEMPOTENCY_KEY_BODY_MISMATCH verir", async () => {
    const fileBase64 = csv([header, "2001,Cem,Can,8. Sınıf,8-A,,,,,,,"]);
    const first = await importAs(tenantA, fileBase64, "batch-replay-a");
    const replay = await importAs(tenantA, fileBase64, "batch-replay-a");
    expect(replay).toStrictEqual(JSON.parse(JSON.stringify(first)));
    await expect(importAs(tenantA, csv([header, "2002,Cem,Can,8. Sınıf,8-A,,,,,,,"]), "batch-replay-a"))
      .rejects.toMatchObject({ status: 409, message: "IDEMPOTENCY_KEY_BODY_MISMATCH" });

    const key = await admin.query<{ status: string }>(
      `SELECT "status" FROM "IdempotencyKey" WHERE "tenantId" = $1 AND "key" = 'batch-replay-a'`,
      [tenantA],
    );
    expect(key.rows).toEqual([{ status: "COMPLETED" }]);
  });

  it("silinmiş öğrencide kayıtlı TC'yi ön izlemede satır hatası yapar; commit hiçbir satırı yazmaz ve diğer tenant'a dokunmaz", async () => {
    await seedSoftDeletedStudentWithTc(admin, tenantA, "a-deleted", "900", "10000002277");
    const before = await countTenantRows(admin, tenantA);
    const tenantBBefore = await tenantSnapshot(admin, tenantB);
    const fileBase64 = csv([
      header,
      "3001,Deniz,Er,8. Sınıf,8-A,,10000003001,,Veli,Er,05550003001,",
      "3002,Ece,Ek,8. Sınıf,8-A,,10000002277,,Veli,Ek,05550003002,",
    ]);
    const rowError = { row: 3, field: "nationalId", code: "STUDENT_NATIONAL_ID_DUPLICATE", value: "*******2277" };

    const context = staffContext(tenantA);
    const preview = await runWithRequestContext(context, () => service.dryRun(context, { fileBase64 }));
    expect(preview).toMatchObject({ wouldImport: false, errors: [rowError] });
    expect(preview.validRows.map((row) => row.row)).toEqual([2]);

    await expect(importAs(tenantA, fileBase64, "batch-deleted-tc-a"))
      .rejects.toMatchObject({ status: 400, response: { code: "STUDENT_IMPORT_INVALID", errors: [rowError] } });
    await expect(countTenantRows(admin, tenantA)).resolves.toEqual(before);
    const students = await admin.query(`SELECT 1 FROM "Student" WHERE "tenantId" = $1 AND "studentNo" = '3001'`, [tenantA]);
    expect(students.rows).toHaveLength(0);
    const keys = await admin.query(`SELECT 1 FROM "IdempotencyKey" WHERE "tenantId" = $1 AND "key" = 'batch-deleted-tc-a'`, [tenantA]);
    expect(keys.rows).toHaveLength(0);
    await expect(tenantSnapshot(admin, tenantB)).resolves.toEqual(tenantBBefore);
  });

  it("doğrulamadan sonra aynı TC başka kayıtta belirirse transaction içi kontrol 409 ile tüm import'u geri alır", async () => {
    const before = await countTenantRows(admin, tenantA);
    const fileBase64 = csv([
      header,
      "3101,Fırat,Fil,8. Sınıf,8-A,,10000003101,,Veli,Fil,05550003101,",
      "3102,Gaye,Göl,8. Sınıf,8-A,,10000003102,,Veli,Göl,05550003102,",
    ]);
    // Runs on the import transaction's first locked query, after the file was validated.
    fault.before = {
      sqlIncludes: "FOR SHARE",
      run: () => seedSoftDeletedStudentWithTc(admin, tenantA, "a-race-deleted", "910", "10000003102"),
    };

    await expect(importAs(tenantA, fileBase64, "batch-race-tc-a"))
      .rejects.toMatchObject({ status: 409, message: "STUDENT_NATIONAL_ID_CONFLICT" });
    await expect(countTenantRows(admin, tenantA)).resolves.toEqual(before);
    const keys = await admin.query(`SELECT 1 FROM "IdempotencyKey" WHERE "tenantId" = $1 AND "key" = 'batch-race-tc-a'`, [tenantA]);
    expect(keys.rows).toHaveLength(0);
  });

  it("başarılı import diğer tenant'ın öğrencilerini ve LicenseUsage satırını değiştirmez", async () => {
    const tenantBBefore = await tenantSnapshot(admin, tenantB);
    await importAs(tenantA, csv([header, "4001,Filiz,Fer,8. Sınıf,8-A,,,,,,,"]), "batch-isolation-a");
    await expect(tenantSnapshot(admin, tenantB)).resolves.toEqual(tenantBBefore);
  });

  it("limit = mevcut + 1 iken iki paralel tek satırlık importtan yalnız birini kabul eder", async () => {
    const outcomes = await Promise.allSettled([
      importAs(tenantLimit, csv([header, "7001,Gül,Gök,8. Sınıf,8-A,,,,,,,"]), "batch-limit-1"),
      importAs(tenantLimit, csv([header, "7002,Hale,Han,8. Sınıf,8-A,,,,,,,"]), "batch-limit-2"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason?.message ?? rejected[0]?.reason)).toContain("ACTIVE_STUDENT_LIMIT_REACHED");

    const usage = await admin.query<{ activeStudentCount: number }>(
      `SELECT "activeStudentCount" FROM "LicenseUsage" WHERE "tenantId" = $1 AND "usageDate" = timezone('UTC', now())::date`,
      [tenantLimit],
    );
    expect(usage.rows).toEqual([{ activeStudentCount: 3 }]);
    const keys = await admin.query<{ key: string }>(`SELECT "key" FROM "IdempotencyKey" WHERE "tenantId" = $1`, [tenantLimit]);
    expect(keys.rows).toHaveLength(1);
  });

  function importAs(tenantId: string, fileBase64: string, key: string) {
    const context = staffContext(tenantId);
    return runWithRequestContext(context, () => service.import(context, { fileBase64 }, key));
  }
});

function buildImportService(pool: never): StudentImportService {
  const classStore = new PostgresClassStore(pool);
  const gradeLevelStore = new PostgresGradeLevelStore(pool);
  const auditLogs = new AuditLogService(new PostgresAuditLogStore(pool));
  const idempotency = new IdempotencyService(new PostgresIdempotencyStore(pool));
  const students = new StudentService(
    new PostgresStudentStore(pool),
    new PostgresGuardianStudentStore(pool),
    {} as never,
    new PostgresStudentEnrollmentStore(pool),
    new PostgresAcademicCalendarStore(pool),
    new PostgresCampusStore(pool),
    classStore,
    gradeLevelStore,
    {} as never,
    {} as never,
    auditLogs,
    idempotency,
    undefined,
    new PostgresLicenseTermStore(pool),
    undefined,
    new PostgresStudentContactStore(pool),
  );
  const school = {
    listClasses: async () => (await classStore.list()).filter((record) => !record.deletedAt),
    listGradeLevels: async () => (await gradeLevelStore.list()).filter((record) => !record.deletedAt),
  };
  return new StudentImportService(students, school as unknown as SchoolService, idempotency);
}

function staffContext(tenantId: string): RequestContext {
  return {
    userId: "student-import-batch-user",
    tenantId,
    roles: ["TENANT_ADMIN"],
    capabilities: ["student:*"],
    activePersona: "STAFF",
    bypassRls: false,
  };
}

function csv(lines: string[]): string {
  return Buffer.from(lines.join("\n"), "utf8").toString("base64");
}

async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM "AuditLog" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [tenantIds]);
}

async function seedTenant(pool: pg.Pool, tenantId: string, activeStudentLimit: number): Promise<void> {
  await pool.query(
    `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status", "updatedAt")
     VALUES ($1, $1, $1, 'TEST', now() - interval '1 day', now() + interval '1 day', $2, 'ACTIVE', now())`,
    [tenantId, activeStudentLimit],
  );
  await pool.query(
    `INSERT INTO "LicenseTerm" ("id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit", "updatedAt")
     VALUES ($1, $2, 'TEST', now() - interval '1 day', now() + interval '1 day', $3, now())`,
    [`license-${tenantId}`, tenantId, activeStudentLimit],
  );
  await pool.query(
    `INSERT INTO "GradeLevel" ("id", "tenantId", "code", "name", "updatedAt") VALUES ($1, $2, '8', '8. Sınıf', now())`,
    [`grade-${tenantId}`, tenantId],
  );
  await pool.query(
    `INSERT INTO "Class" ("id", "tenantId", "name", "gradeLevelId", "updatedAt") VALUES ($1, $2, '8-A', $3, now())`,
    [`class-${tenantId}`, tenantId, `grade-${tenantId}`],
  );
}

async function seedActiveStudent(pool: pg.Pool, tenantId: string, id: string, studentNo: string): Promise<void> {
  await pool.query(
    `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "gradeLevelId", "classId", "status", "updatedAt")
     VALUES ($1, $2, $3, 'VAR', 'OLAN', $4, $5, 'ACTIVE', now())`,
    [id, tenantId, studentNo, `grade-${tenantId}`, `class-${tenantId}`],
  );
  await pool.query(
    `INSERT INTO "StudentEnrollment" ("id", "tenantId", "studentId", "gradeLevelId", "classId", "status", "startsAt", "reason", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', current_date, 'CREATED', now())`,
    [`${id}-enrollment`, tenantId, id, `grade-${tenantId}`, `class-${tenantId}`],
  );
}

async function seedSoftDeletedStudentWithTc(pool: pg.Pool, tenantId: string, id: string, studentNo: string, nationalId: string): Promise<void> {
  await pool.query(
    `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "status", "nationalIdHash", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, 'SİLİNMİŞ', 'ÖĞRENCİ', 'ACTIVE', $4, now(), now())`,
    [id, tenantId, studentNo, hashTcIdentity(nationalId)],
  );
}

async function countTenantRows(pool: pg.Pool, tenantId: string) {
  const result = await pool.query<{ students: number; enrollments: number; contacts: number; audits: number; idempotency: number }>(
    `SELECT
       (SELECT count(*)::int FROM "Student" WHERE "tenantId" = $1 AND "deletedAt" IS NULL) AS students,
       (SELECT count(*)::int FROM "StudentEnrollment" WHERE "tenantId" = $1) AS enrollments,
       (SELECT count(*)::int FROM "StudentContact" WHERE "tenantId" = $1) AS contacts,
       (SELECT count(*)::int FROM "AuditLog" WHERE "tenantId" = $1) AS audits,
       (SELECT count(*)::int FROM "IdempotencyKey" WHERE "tenantId" = $1) AS idempotency`,
    [tenantId],
  );
  return result.rows[0];
}

async function tenantSnapshot(pool: pg.Pool, tenantId: string) {
  const [students, usage] = await Promise.all([
    pool.query(`SELECT "id", "studentNo", "status", "updatedAt" FROM "Student" WHERE "tenantId" = $1 ORDER BY "id"`, [tenantId]),
    pool.query(`SELECT "activeStudentCount", "peakActiveStudentCount", "reconciledAt" FROM "LicenseUsage" WHERE "tenantId" = $1 ORDER BY "usageDate"`, [tenantId]),
  ]);
  return { students: students.rows, usage: usage.rows };
}
