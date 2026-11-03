import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { PostgresExamWorkspaceProgressStore } from "./exam-workspace-progress-store.js";
import { PostgresExamParticipantRepository } from "./postgres-exam-participant-repository.js";

const appUrl = process.env.EXAM_WORKSPACE_POSTGRES_TEST_URL, adminUrl = process.env.EXAM_WORKSPACE_POSTGRES_ADMIN_URL;
if (process.env.EXAM_WORKSPACE_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("EXAM_WORKSPACE_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_exam_workspace_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

const run = appUrl && adminUrl ? describe : describe.skip;
run("exam workspace progress with restricted app role and RLS", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `exam-workspace-${randomUUID()}-${suffix}`) as [string, string];
  const examA = `${tenantA}-exam`, examB = `${tenantB}-exam`;

  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const [tenantId, examId] of [[tenantA, examA], [tenantB, examB]] as const) {
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Exam workspace fixture\',\'ACTIVE\',now())', [tenantId]);
        await db.query('INSERT INTO "Exam" (id,"tenantId",title,"updatedAt") VALUES ($1,$2,\'Fixture exam\',now())', [examId, tenantId]);
      }
      // Tenant A: onaylı düzen, iki import (sonuncusu seçilir), bir açık + bir çözülmüş karantina, READY rapor.
      await db.query('INSERT INTO "ParserConfig" (id,"tenantId","examId",version,encoding,delimiter,"fieldMapping",status,"updatedAt") VALUES ($1,$2,$3,\'v1\',\'utf-8\',\';\',\'{}\'::jsonb,\'APPROVED\',now())', [`${tenantA}-pc`, tenantA, examA]);
      await db.query('INSERT INTO "RawImport" (id,"tenantId","examId","sourceType","fileName","s3Key",sha256,"parserConfigVersion","createdAt","updatedAt") VALUES ($1,$2,$3,\'TXT\',\'a.txt\',\'k1\',\'s1\',\'v1\',now()-interval \'1 hour\',now())', [`${tenantA}-ri-old`, tenantA, examA]);
      await db.query('INSERT INTO "RawImport" (id,"tenantId","examId","sourceType","fileName","s3Key",sha256,"parserConfigVersion","createdAt","updatedAt") VALUES ($1,$2,$3,\'TXT\',\'b.txt\',\'k2\',\'s2\',\'v1\',now(),now())', [`${tenantA}-ri-new`, tenantA, examA]);
      await db.query('INSERT INTO "ImportQuarantine" (id,"tenantId","examId","rawImportId","rowNumber","rawRow",reason,status,"updatedAt") VALUES ($1,$2,$3,$4,1,\'{}\'::jsonb,\'NO_MATCH\',\'OPEN\',now())', [`${tenantA}-q1`, tenantA, examA, `${tenantA}-ri-new`]);
      await db.query('INSERT INTO "ImportQuarantine" (id,"tenantId","examId","rawImportId","rowNumber","rawRow",reason,status,"updatedAt") VALUES ($1,$2,$3,$4,2,\'{}\'::jsonb,\'NO_MATCH\',\'RESOLVED\',now())', [`${tenantA}-q2`, tenantA, examA, `${tenantA}-ri-new`]);
      await db.query('INSERT INTO "ReportSnapshot" (id,"tenantId","examId","reportType","contentHash","inputRefs",status,"updatedAt") VALUES ($1,$2,$3,\'EXAM\',\'h\',\'{}\'::jsonb,\'READY\',now())', [`${tenantA}-rs`, tenantA, examA]);
      // Participants for the hasResult read model: a REGISTERED row matched by the import (live result), an ABSENT row
      // whose only result was deleted, and an ATTENDED row without any result.
      await db.query('INSERT INTO "AnswerKey" (id,"tenantId","examId",version,"keyData","updatedAt") VALUES ($1,$2,$3,\'v1\',\'{}\'::jsonb,now())', [`${tenantA}-ak`, tenantA, examA]);
      for (const [index, [student, status]] of ([["registered", "REGISTERED"], ["absent", "ABSENT"], ["attended", "ATTENDED"]] as const).entries()) {
        await db.query(
          'INSERT INTO "Student" (id,"tenantId","studentNo","firstName","lastName",status,"updatedAt") VALUES ($1,$2,$3,\'ADA\',\'YILMAZ\',\'ACTIVE\',now())',
          [`${tenantA}-student-${student}`, tenantA, String(200 + index)],
        );
        await db.query(
          'INSERT INTO "ExamParticipant" (id,"tenantId","examId","studentId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
          [`${tenantA}-participant-${student}`, tenantA, examA, `${tenantA}-student-${student}`, status],
        );
      }
      for (const [student, deletedAt] of [["registered", null], ["absent", "2026-11-01T00:00:00Z"]] as const) {
        await db.query(
          'INSERT INTO "ExamResult" (id,"tenantId","examId","studentId","participantId","rawImportId","answerKeyId","answerKeyVersion","parserConfigVersion","engineVersion","resultKey","scoreData","computedAt","deletedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,\'v1\',\'v1\',\'e1\',$1,\'{}\'::jsonb,now(),$8::timestamptz,now())',
          [`${tenantA}-result-${student}`, tenantA, examA, `${tenantA}-student-${student}`, `${tenantA}-participant-${student}`, `${tenantA}-ri-old`, `${tenantA}-ak`, deletedAt],
        );
      }
      // Tenant B: aynı sınav kimliği desenini kullanan açık karantina; A'nın sonucuna sızmamalı.
      await db.query('INSERT INTO "RawImport" (id,"tenantId","examId","sourceType","fileName","s3Key",sha256,"parserConfigVersion","updatedAt") VALUES ($1,$2,$3,\'TXT\',\'c.txt\',\'k3\',\'s3\',\'v1\',now())', [`${tenantB}-ri`, tenantB, examB]);
      for (const row of [1, 2, 3]) {
        await db.query('INSERT INTO "ImportQuarantine" (id,"tenantId","examId","rawImportId","rowNumber","rawRow",reason,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,\'{}\'::jsonb,\'NO_MATCH\',\'OPEN\',now())', [`${tenantB}-q${row}`, tenantB, examB, `${tenantB}-ri`, row]);
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
    try {
      for (const table of ["ImportQuarantine", "ExamResult", "AnswerKey", "ExamParticipant", "Student", "ReportSnapshot", "RawImport", "ParserConfig", "Exam"]) {
        await admin.query(`DELETE FROM "${table}" WHERE "tenantId"=ANY($1::text[])`, [[tenantA, tenantB]]);
      }
      await admin.query('DELETE FROM "Tenant" WHERE id=ANY($1::text[])', [[tenantA, tenantB]]);
    } finally {
      await Promise.all([app.end(), admin.end()]);
    }
  });

  it("returns only the requesting tenant's latest-import progress", async () => {
    const store = new PostgresExamWorkspaceProgressStore(app);
    const progressA = await runWithRequestContext({ userId: "fixture", roles: ["TENANT_ADMIN"], tenantId: tenantA, bypassRls: false }, () => store.load(tenantA, examA));
    expect(progressA).toEqual({
      approvedLayout: true,
      latestRawImportId: `${tenantA}-ri-new`,
      openQuarantineCount: 1,
      matchedCount: 0,
      evaluatedCount: 0,
      readyReport: true,
    });

    const crossTenant = await runWithRequestContext({ userId: "fixture", roles: ["TENANT_ADMIN"], tenantId: tenantA, bypassRls: false }, () => store.load(tenantA, examB));
    expect(crossTenant).toEqual({ approvedLayout: false, openQuarantineCount: 0, matchedCount: 0, evaluatedCount: 0, readyReport: false });

    const rlsProbe = await runWithRequestContext({ userId: "fixture", roles: ["TENANT_ADMIN"], tenantId: tenantA, bypassRls: false }, () => store.load(tenantB, examB));
    expect(rlsProbe.openQuarantineCount).toBe(0);
    expect(rlsProbe.latestRawImportId).toBeUndefined();
  });

  it("participant list carries hasResult from live ExamResult rows only", async () => {
    const repository = new PostgresExamParticipantRepository(app);
    const context: RequestContext = { userId: "fixture", roles: ["TENANT_ADMIN"], tenantId: tenantA, bypassRls: false };
    const listed = await runWithRequestContext(context, () => repository.list(tenantA, examA));
    const byStudent = new Map(listed.map((participant) => [participant.studentId, participant]));

    expect(byStudent.get(`${tenantA}-student-registered`)).toMatchObject({ status: "REGISTERED", hasResult: true });
    expect(byStudent.get(`${tenantA}-student-absent`)).toMatchObject({ status: "ABSENT", hasResult: false });
    expect(byStudent.get(`${tenantA}-student-attended`)).toMatchObject({ status: "ATTENDED", hasResult: false });
    expect(listed).toHaveLength(3);

    const rlsProbe = await runWithRequestContext(context, () => repository.list(tenantB, examB));
    expect(rlsProbe).toEqual([]);
  });
});
