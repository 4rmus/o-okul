import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { PostgresDevelopmentStore } from "./development-store.js";

const appUrl = process.env.DEVELOPMENT_POSTGRES_TEST_URL, adminUrl = process.env.DEVELOPMENT_POSTGRES_ADMIN_URL;
if (process.env.DEVELOPMENT_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("DEVELOPMENT_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_development_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

const run = appUrl && adminUrl ? describe : describe.skip;

// DEC-20261102-05: development assessments are append-only; the assessment and its scores are written in one
// transaction, and the only in-place change is the KVKK purge of a purged student's mentor notes.
run("development assessments with restricted app role and RLS", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `development-${randomUUID()}-${suffix}`) as [string, string];
  const id = (tenant: string, name: string) => `${tenant}-${name}`;
  const staffContext = (tenantId: string): RequestContext => ({
    userId: "fixture", tenantId, activePersona: "STAFF", roles: ["TENANT_ADMIN"], bypassRls: false,
  });
  const inTenant = <T>(tenantId: string, work: () => Promise<T>) => runWithRequestContext(staffContext(tenantId), work);
  const assessmentInput = (tenant: string, student: string, mentorNote?: string) => ({
    tenantId: tenant,
    studentId: id(tenant, student),
    teacherId: id(tenant, "teacher"),
    periodLabel: "1. Dönem",
    visibility: "GUARDIAN" as const,
    ...(mentorNote ? { mentorNote } : {}),
  });

  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const tenant of [tenantA, tenantB]) {
        const t = (name: string) => id(tenant, name);
        await db.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Development fixture\',\'ACTIVE\',now())', [tenant]);
        await db.query('INSERT INTO "Teacher" (id,"tenantId","firstName","lastName","updatedAt") VALUES ($1,$2,\'AYŞE\',\'ÖĞRETMEN\',now())', [t("teacher"), tenant]);
        for (const [index, student] of ["s1", "s2"].entries()) {
          await db.query(
            'INSERT INTO "Student" (id,"tenantId","studentNo","firstName","lastName",status,"updatedAt") VALUES ($1,$2,$3,\'ADA\',\'YILMAZ\',\'ACTIVE\',now())',
            [t(student), tenant, String(200 + index)],
          );
        }
        for (const [index, criterion] of ["c1", "c2"].entries()) {
          await db.query(
            'INSERT INTO "DevelopmentCriterion" (id,"tenantId",name,"scaleMin","scaleMax","sortOrder","updatedAt") VALUES ($1,$2,$3,1,5,$4,now())',
            [t(criterion), tenant, `Ölçüt ${index + 1}`, index],
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

  afterAll(async () => {
    await Promise.all([app.end(), admin.end()]);
  });

  async function adminCount(sql: string, values: unknown[]): Promise<number> {
    const result = await admin.query<{ count: string }>(sql, values);
    return Number(result.rows[0]?.count ?? 0);
  }

  it("writes the assessment and every score together, and a failing second score leaves no row behind", async () => {
    const store = new PostgresDevelopmentStore(app);
    const written = await inTenant(tenantA, () => store.createAssessmentWithScores(
      assessmentInput(tenantA, "s1", "Okuma alışkanlığı gelişiyor."),
      [{ criterionId: id(tenantA, "c1"), score: 4 }, { criterionId: id(tenantA, "c2"), score: 3 }],
    ));
    expect(written.scores.map((score) => score.assessmentId)).toEqual([written.assessment.id, written.assessment.id]);

    // The first score is valid; the second names a criterion of another tenant, so the composite foreign key fails
    // after the assessment and the first score were inserted in the same transaction.
    await expect(inTenant(tenantA, () => store.createAssessmentWithScores(
      assessmentInput(tenantA, "s2"),
      [{ criterionId: id(tenantA, "c1"), score: 5 }, { criterionId: id(tenantB, "c1"), score: 2 }],
    ))).rejects.toMatchObject({ code: "23503", constraint: "DevelopmentScore_criterion_fkey" });
    // A duplicate criterion fails on the (tenantId, assessmentId, criterionId) unique key the same way.
    await expect(inTenant(tenantA, () => store.createAssessmentWithScores(
      assessmentInput(tenantA, "s2"),
      [{ criterionId: id(tenantA, "c2"), score: 5 }, { criterionId: id(tenantA, "c2"), score: 1 }],
    ))).rejects.toMatchObject({ code: "23505" });

    expect(await adminCount('SELECT count(*) FROM "DevelopmentAssessment" WHERE "tenantId" = $1 AND "studentId" = $2', [tenantA, id(tenantA, "s2")])).toBe(0);
    expect(await adminCount('SELECT count(*) FROM "DevelopmentScore" WHERE "tenantId" = $1', [tenantA])).toBe(2);
    expect(await adminCount('SELECT count(*) FROM "DevelopmentAssessment" WHERE "tenantId" = $1', [tenantA])).toBe(1);
  });

  it("the KVKK purge clears only the target student's mentor notes and keeps scores, other students and other tenants", async () => {
    const store = new PostgresDevelopmentStore(app);
    const note = "Mentor notu: KVKK imha testi.";
    for (const tenant of [tenantA, tenantB]) {
      for (const student of ["s1", "s2"]) {
        await inTenant(tenant, () => store.createAssessmentWithScores(
          assessmentInput(tenant, student, note),
          [{ criterionId: id(tenant, "c1"), score: 3 }],
        ));
      }
    }
    const notesBefore = await admin.query<{ tenantId: string; studentId: string; notes: string }>(
      'SELECT "tenantId", "studentId", count("mentorNote")::text AS notes FROM "DevelopmentAssessment" WHERE "tenantId" = ANY($1) GROUP BY 1, 2',
      [[tenantA, tenantB]],
    );
    const scoresBefore = await adminCount('SELECT count(*) FROM "DevelopmentScore" WHERE "tenantId" = ANY($1)', [[tenantA, tenantB]]);

    // tenantA/s1 has two noted assessments (one from the atomic-write test above).
    expect(await inTenant(tenantA, () => store.purgeMentorNotesByStudent(tenantA, id(tenantA, "s1")))).toBe(2);
    // A second run changes nothing, and a foreign tenant's student is invisible to tenant A's purge under RLS.
    expect(await inTenant(tenantA, () => store.purgeMentorNotesByStudent(tenantA, id(tenantA, "s1")))).toBe(0);
    expect(await inTenant(tenantA, () => store.purgeMentorNotesByStudent(tenantB, id(tenantB, "s1")))).toBe(0);

    const notesAfter = await admin.query<{ tenantId: string; studentId: string; notes: string }>(
      'SELECT "tenantId", "studentId", count("mentorNote")::text AS notes FROM "DevelopmentAssessment" WHERE "tenantId" = ANY($1) GROUP BY 1, 2',
      [[tenantA, tenantB]],
    );
    const byKey = (rows: Array<{ tenantId: string; studentId: string; notes: string }>) => Object.fromEntries(
      rows.map((row) => [row.studentId, Number(row.notes)]),
    );
    expect(byKey(notesBefore.rows)).toEqual({
      [id(tenantA, "s1")]: 2, [id(tenantA, "s2")]: 1, [id(tenantB, "s1")]: 1, [id(tenantB, "s2")]: 1,
    });
    expect(byKey(notesAfter.rows)).toEqual({
      [id(tenantA, "s1")]: 0, [id(tenantA, "s2")]: 1, [id(tenantB, "s1")]: 1, [id(tenantB, "s2")]: 1,
    });
    // The purge never deletes an assessment or a score (append-only, DEC-20261102-05).
    expect(await adminCount('SELECT count(*) FROM "DevelopmentScore" WHERE "tenantId" = ANY($1)', [[tenantA, tenantB]])).toBe(scoresBefore);
    expect(await adminCount('SELECT count(*) FROM "DevelopmentAssessment" WHERE "tenantId" = $1 AND "studentId" = $2', [tenantA, id(tenantA, "s1")])).toBe(2);
  });

  it("RLS hides another tenant's criteria, assessments and scores from the app role", async () => {
    const store = new PostgresDevelopmentStore(app);
    const [assessmentsA, assessmentsB] = await Promise.all([
      inTenant(tenantA, () => store.listAssessments()),
      inTenant(tenantB, () => store.listAssessments()),
    ]);
    expect(assessmentsA.length).toBeGreaterThan(0);
    expect(assessmentsB.length).toBeGreaterThan(0);
    expect(assessmentsA.every((assessment) => assessment.tenantId === tenantA)).toBe(true);
    expect(assessmentsB.every((assessment) => assessment.tenantId === tenantB)).toBe(true);

    const foreign = assessmentsB[0]!;
    expect(await inTenant(tenantA, () => store.findAssessmentById(foreign.id))).toBeUndefined();
    expect(await inTenant(tenantA, () => store.listAssessments(foreign.studentId))).toEqual([]);
    expect(await inTenant(tenantA, () => store.listScores(foreign.id))).toEqual([]);
    expect(await inTenant(tenantB, () => store.listScores(foreign.id))).not.toEqual([]);
    expect(await inTenant(tenantA, () => store.findCriterionById(id(tenantB, "c1")))).toBeUndefined();
    expect((await inTenant(tenantA, () => store.listCriteria())).every((criterion) => criterion.tenantId === tenantA)).toBe(true);

    // A write naming another tenant is rejected by the RLS WITH CHECK, not silently stored.
    await expect(inTenant(tenantA, () => store.createAssessmentWithScores(assessmentInput(tenantB, "s1"), [])))
      .rejects.toMatchObject({ code: "42501" });
    expect(await adminCount('SELECT count(*) FROM "DevelopmentAssessment" WHERE "tenantId" = $1', [tenantB])).toBe(assessmentsB.length);
  });
});
