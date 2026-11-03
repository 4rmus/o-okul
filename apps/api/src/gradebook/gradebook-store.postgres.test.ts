import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { PostgresGradebookStore } from "./gradebook-store.js";

const appUrl = process.env.GRADEBOOK_POSTGRES_TEST_URL, adminUrl = process.env.GRADEBOOK_POSTGRES_ADMIN_URL;
if (process.env.GRADEBOOK_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("GRADEBOOK_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_gradebook_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

const run = appUrl && adminUrl ? describe : describe.skip;

// UAT 2026-11-03 U7: the assessment list carries unpublishedDraftCount, read under the restricted app role and RLS.
run("PostgresGradebookStore.listAssessments unpublishedDraftCount with restricted app role and RLS", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `gradebook-${randomUUID()}-${suffix}`) as [string, string];
  const id = (tenant: string, name: string) => `${tenant}-${name}`;
  const context = (tenantId: string): RequestContext => ({ userId: "fixture", tenantId, roles: ["TENANT_ADMIN"], bypassRls: false });
  const store = new PostgresGradebookStore(app);
  const inTenant = <T>(tenantId: string, work: () => Promise<T>) => runWithRequestContext(context(tenantId), work);

  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const tenant of [tenantA, tenantB]) {
        const t = (name: string) => id(tenant, name);
        await db.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Gradebook fixture\',\'ACTIVE\',now())', [tenant]);
        await db.query('INSERT INTO "Class" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'8-A\',now())', [t("c1"), tenant]);
        await db.query('INSERT INTO "Course" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'Matematik\',now())', [t("math"), tenant]);
        await db.query(
          'INSERT INTO "AcademicYear" (id,"tenantId",name,"startsAt","endsAt","updatedAt") VALUES ($1,$2,\'2026-2027\',\'2026-09-01\',\'2027-06-30\',now())',
          [t("year"), tenant],
        );
        await db.query(
          'INSERT INTO "AcademicTerm" (id,"tenantId","academicYearId",name,"startsAt","endsAt","updatedAt") VALUES ($1,$2,$3,\'1. Dönem\',\'2026-09-01\',\'2027-01-31\',now())',
          [t("term"), tenant, t("year")],
        );
        for (const [index, student] of ["s1", "s2"].entries()) {
          await db.query(
            'INSERT INTO "Student" (id,"tenantId","classId","studentNo","firstName","lastName",status,"updatedAt") VALUES ($1,$2,$3,$4,\'ADA\',\'KAYA\',\'ACTIVE\',now())',
            [t(student), tenant, t("c1"), String(100 + index)],
          );
        }
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  });

  // Published GradeEntry rows cannot be deleted (ADR-0011 trigger); fixtures use random tenant ids in a disposable database.
  afterAll(async () => {
    await Promise.all([app.end(), admin.end()]);
  });

  it("counts draft students: 1 after a draft, 0 after publish, 1 after a correction; another tenant sees none", async () => {
    const t = (name: string) => id(tenantA, name);
    const assessment = await inTenant(tenantA, () => store.createAssessment({
      tenantId: tenantA,
      classId: t("c1"),
      courseId: t("math"),
      termId: t("term"),
      kind: "WRITTEN",
      title: "1. Yazılı",
      heldOn: "2026-10-10",
      maxScore: 100,
      createdById: "fixture",
    }));
    const draftCount = async () => (await inTenant(tenantA, () => store.listAssessments({}))).find((record) => record.id === assessment.id)?.unpublishedDraftCount;

    expect(await draftCount()).toBe(0);

    await inTenant(tenantA, () => store.saveDrafts(assessment, [{ studentId: t("s1"), score: 70, absent: false }], "fixture"));
    // Saving the same student's draft twice keeps one draft row (newest version), so the count stays 1.
    await inTenant(tenantA, () => store.saveDrafts(assessment, [{ studentId: t("s1"), score: 72, absent: false }], "fixture"));
    expect(await draftCount()).toBe(1);

    const published = await inTenant(tenantA, () => store.publish(assessment));
    expect(published.publishedCount).toBe(1);
    expect(published.assessment.publishedVersion).toBe(1);
    expect(await draftCount()).toBe(0);

    // The correction is a new version (ADR-0011); the published v1 row is untouched.
    await inTenant(tenantA, () => store.saveDrafts(published.assessment, [{ studentId: t("s1"), score: 75, absent: false }], "fixture"));
    expect(await draftCount()).toBe(1);
    const entries = await inTenant(tenantA, () => store.listEntries(assessment.id));
    expect(entries.map((entry) => [entry.version, entry.score, Boolean(entry.publishedAt)])).toEqual([[1, 72, true], [2, 75, false]]);

    // RLS: tenant B lists none of tenant A's assessments.
    const tenantBList = await inTenant(tenantB, () => store.listAssessments({}));
    expect(tenantBList.some((record) => record.id === assessment.id)).toBe(false);
  });
});
