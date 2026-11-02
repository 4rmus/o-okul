import { describe, expect, it } from "vitest";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { MeInstitutionDashboardService } from "./me-institution-dashboard.service.js";
import { PostgresInstitutionDashboardStore } from "./me-institution-dashboard.store.js";

describe("MeInstitutionDashboardService", () => {
  it("tenant kimliğini istemciden almadan tarih kapsamlı özeti döndürür", async () => {
    const calls: Array<{ tenantId: string; attendanceDate: string }> = [];
    const service = new MeInstitutionDashboardService({
      async load(tenantId, attendanceDate) {
        calls.push({ tenantId, attendanceDate });
        return {
          institution: { name: "Örnek Akademi" },
          activeStudentCount: 12,
          attention: {
            attendanceAlertCount: 2,
            openImportQuarantineCount: 1,
            openSupportTicketCount: 3,
          },
        };
      },
    });

    const result = await service.get(tenantAdminContext);

    expect(calls).toEqual([{
      tenantId: "tenant-a",
      attendanceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }]);
    expect(result).toMatchObject({
      institution: { name: "Örnek Akademi" },
      activeStudentCount: 12,
    });
    expect(result.generatedAt).toMatch(/Z$/);
  });

  it("kampüs kapsamlı üyelikte kampüsleri store'a geçirir ve yanıtı işaretler", async () => {
    const scopes: unknown[] = [];
    const service = new MeInstitutionDashboardService({
      async load(_tenantId, _attendanceDate, scope) {
        scopes.push(scope);
        return {
          institution: { name: "Örnek Akademi" },
          activeStudentCount: 4,
          attention: { attendanceAlertCount: 1, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
        };
      },
    });

    const scoped = await service.get({
      ...tenantAdminContext,
      roles: ["ASSISTANT_ADMIN"],
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-a"] },
    });
    const tenantWide = await service.get({
      ...tenantAdminContext,
      campusScope: { scopeMode: "TENANT", campusIds: [] },
    });

    expect(scopes).toEqual([{ campusIds: ["campus-a"] }, undefined]);
    expect(scoped.campusScoped).toBe(true);
    expect(tenantWide).not.toHaveProperty("campusScoped");
  });

  it("kampüs kapsamı eksik operasyon çalışanını reddeder", async () => {
    const service = new MeInstitutionDashboardService({ load: async () => {
      throw new Error("store çağrılmamalı");
    } });

    await expect(service.get({ ...tenantAdminContext, roles: ["OPERATIONS_STAFF"] })).rejects.toMatchObject({
      message: "INSTITUTION_DASHBOARD_CAMPUS_SCOPE_MISSING",
    });
  });

  it("tenant bağlamı olmayan isteği reddeder", async () => {
    const service = new MeInstitutionDashboardService({ load: async () => {
      throw new Error("store çağrılmamalı");
    } });

    await expect(service.get({ ...tenantAdminContext, tenantId: null })).rejects.toMatchObject({
      message: "TENANT_CONTEXT_MISSING",
    });
  });
});

describe("PostgresInstitutionDashboardStore", () => {
  it("tenant kapsamlı sayımları ve yalnız anonim rapor özetini projekte eder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('WITH "latestExam"')) return { rows: [] as T[] };
        return {
          rows: [{
            name: "Örnek Akademi",
            institutionType: "study-center",
            contactEmail: "kurum@example.com",
            logoUrl: null,
            activeStudentCount: 18,
            attendanceAlertCount: 2,
            openImportQuarantineCount: 1,
            openSupportTicketCount: 3,
            examId: "exam-a",
            examTitle: "LGS Deneme 4",
            examStartsAt: new Date("2026-07-30T07:00:00.000Z"),
            registeredParticipantCount: 18,
            attendedParticipantCount: 16,
            absentParticipantCount: 2,
            report: {
              snapshotId: "snapshot-a",
              generatedAt: "2026-07-30T10:00:00.000Z",
              resultCount: 16,
              averages: { correct: 60, wrong: 15, blank: 5, net: 56.25 },
              classes: [{
                classId: "class-a",
                className: "8-A",
                resultCount: 8,
                averages: { correct: 64, wrong: 12, blank: 4, net: 61 },
              }],
            },
          }] as T[],
        };
      },
    };
    const store = new PostgresInstitutionDashboardStore(pool);

    const result = await runWithRequestContext(
      tenantAdminContext,
      () => store.load("tenant-a", "2026-07-31"),
    );

    const businessQuery = queries.find((query) => query.sql.includes('WITH "latestExam"'));
    expect(businessQuery?.values).toEqual(["tenant-a", "2026-07-31", null]);
    expect(businessQuery?.sql).toContain('student."tenantId" = $1');
    expect(businessQuery?.sql).toContain('snapshot."snapshotData"->\'classes\'');
    expect(businessQuery?.sql).not.toContain("snapshotData\"->'students'");
    expect(result).toEqual({
      institution: {
        name: "Örnek Akademi",
        institutionType: "study-center",
        contactEmail: "kurum@example.com",
      },
      activeStudentCount: 18,
      attention: {
        attendanceAlertCount: 2,
        openImportQuarantineCount: 1,
        openSupportTicketCount: 3,
      },
      latestExam: {
        examId: "exam-a",
        title: "LGS Deneme 4",
        startsAt: "2026-07-30T07:00:00.000Z",
        registeredParticipantCount: 18,
        attendedParticipantCount: 16,
        absentParticipantCount: 2,
        reportStatus: "READY",
        report: {
          snapshotId: "snapshot-a",
          generatedAt: "2026-07-30T10:00:00.000Z",
          resultCount: 16,
          successRate: 70.31,
          net: 56.25,
          questionCount: 80,
          classes: [{
            classId: "class-a",
            className: "8-A",
            resultCount: 8,
            successRate: 76.25,
            net: 61,
            questionCount: 80,
          }],
        },
      },
    });
  });
});

describe("PostgresInstitutionDashboardStore kampüs kapsamı", () => {
  it("sayımları kampüs sınıflarıyla sınırlar, kapsam dışı sınıfı ve kurum geneli ortalamayı düşürür", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (!sql.includes('WITH "latestExam"')) return { rows: [] as T[] };
        return {
          rows: [{
            name: "Örnek Akademi",
            institutionType: null,
            contactEmail: null,
            logoUrl: null,
            activeStudentCount: 6,
            attendanceAlertCount: 1,
            openImportQuarantineCount: 0,
            openSupportTicketCount: 1,
            examId: "exam-a",
            examTitle: "LGS Deneme 4",
            examStartsAt: null,
            registeredParticipantCount: 6,
            attendedParticipantCount: 5,
            absentParticipantCount: 1,
            report: {
              snapshotId: "snapshot-a",
              resultCount: 16,
              averages: { correct: 60, wrong: 15, blank: 5, net: 56.25 },
              classes: [
                { classId: "class-a", className: "8-A", resultCount: 5, averages: { correct: 64, wrong: 12, blank: 4, net: 61 } },
                { classId: "class-b", className: "8-B", resultCount: 11, averages: { correct: 58, wrong: 16, blank: 6, net: 54 } },
                { className: "Sınıfsız", resultCount: 2, averages: { net: 10 } },
              ],
            },
            scopedClassIds: ["class-a"],
          }] as T[],
        };
      },
    };
    const store = new PostgresInstitutionDashboardStore(pool);

    const result = await runWithRequestContext(
      tenantAdminContext,
      () => store.load("tenant-a", "2026-07-31", { campusIds: ["campus-a", "campus-a"] }),
    );

    const businessQuery = queries.find((query) => query.sql.includes('WITH "latestExam"'));
    expect(businessQuery?.values).toEqual(["tenant-a", "2026-07-31", ["campus-a"]]);
    expect(businessQuery?.sql).toContain('"campusId" = ANY($3::text[])');
    expect(businessQuery?.sql).toContain('student."id" IN (SELECT "id" FROM "scopedStudent")');
    expect(businessQuery?.sql).toContain('attendance."studentId" IN (SELECT "id" FROM "scopedStudent")');
    expect(businessQuery?.sql).toContain('participant."studentId" IN (SELECT "id" FROM "scopedStudent")');
    expect(businessQuery?.sql).toMatch(/quarantine\."deletedAt" IS NULL\s+AND \$3::text\[\] IS NULL/);
    expect(result.latestExam?.report).toEqual({
      snapshotId: "snapshot-a",
      resultCount: 5,
      classes: [{ classId: "class-a", className: "8-A", resultCount: 5, successRate: 76.25, net: 61, questionCount: 80 }],
    });
    expect(JSON.stringify(result)).not.toContain("class-b");
  });
});

const tenantAdminContext: RequestContext = {
  userId: "admin-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};
