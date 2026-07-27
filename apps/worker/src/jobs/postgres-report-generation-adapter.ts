import { randomUUID } from "node:crypto";
import { type Queryable, type TenantQueryable, withTenantDb } from "@o-okul/db";
import type { ScoringResult } from "./scoring-engine.js";
import {
  examResultSummaryReportType,
  type ExamResultForReport,
  type ReportGenerationJobAdapter,
  type ReportGenerationJobInput,
  type ReportGenerationJobResult,
  type ReportSnapshotCandidate,
} from "./report-generation-job.js";

export class PostgresReportGenerationAdapter implements ReportGenerationJobAdapter {
  constructor(private readonly pool: TenantQueryable) {}

  async loadResults(input: ReportGenerationJobInput): Promise<ExamResultForReport[]> {
    return withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      const result = await client.query<ExamResultReportRow>(
         `WITH report_exam AS (
           SELECT "id", "title", "startsAt", "linkedTytExamId"
           FROM "Exam"
           WHERE "tenantId" = $1
             AND "id" = $2
             AND "deletedAt" IS NULL
         ),
         latest_results AS (
           SELECT DISTINCT ON (er."studentId")
             er."examId",
             requested_exam."title" AS "examTitle",
             requested_exam."startsAt" AS "examStartsAt",
             er."studentId",
             s."firstName",
             s."lastName",
             s."studentNo",
             ep."participantNo",
             ep."bookletType",
             s."classId",
             c."name" AS "className",
             selected_course."name" AS "courseName",
             selected_course."code" AS "courseCode",
             er."resultKey",
             er."answerKeyVersion",
             er."parserConfigVersion",
             er."engineVersion",
             er."scoreData",
             er."computedAt",
             linked_tyt."examId" AS "linkedTytExamId",
             linked_tyt."resultKey" AS "linkedTytResultKey",
             linked_tyt."answerKeyVersion" AS "linkedTytAnswerKeyVersion",
             linked_tyt."parserConfigVersion" AS "linkedTytParserConfigVersion",
             linked_tyt."engineVersion" AS "linkedTytEngineVersion",
             linked_tyt."scoreData" AS "linkedTytScoreData",
             linked_tyt."computedAt" AS "linkedTytComputedAt"
           FROM "ExamResult" er
           INNER JOIN report_exam requested_exam
             ON er."examId" = requested_exam."id"
           INNER JOIN "Exam" e
             ON e."tenantId" = er."tenantId"
            AND e."id" = er."examId"
            AND e."deletedAt" IS NULL
           LEFT JOIN LATERAL (
             SELECT
               linked_result."examId",
               linked_result."resultKey",
               linked_result."answerKeyVersion",
               linked_result."parserConfigVersion",
               linked_result."engineVersion",
               linked_result."scoreData",
               linked_result."computedAt"
             FROM "ExamResult" linked_result
             WHERE linked_result."tenantId" = er."tenantId"
               AND linked_result."examId" = requested_exam."linkedTytExamId"
               AND linked_result."studentId" = er."studentId"
               AND linked_result."deletedAt" IS NULL
             ORDER BY linked_result."computedAt" DESC, linked_result."updatedAt" DESC, linked_result."resultKey" DESC
             LIMIT 1
           ) linked_tyt ON TRUE
           LEFT JOIN "Student" s
             ON s."tenantId" = er."tenantId"
            AND s."id" = er."studentId"
            AND s."deletedAt" IS NULL
           LEFT JOIN "ExamParticipant" ep
             ON ep."tenantId" = er."tenantId"
            AND ep."examId" = er."examId"
            AND ep."studentId" = er."studentId"
            AND ep."deletedAt" IS NULL
           LEFT JOIN "Class" c
             ON c."tenantId" = er."tenantId"
            AND c."id" = s."classId"
            AND c."deletedAt" IS NULL
           LEFT JOIN "Course" selected_course
             ON selected_course."tenantId" = er."tenantId"
            AND selected_course."id" = $6
            AND selected_course."deletedAt" IS NULL
           WHERE er."tenantId" = $1
             AND er."deletedAt" IS NULL
             AND ($3::text IS NULL OR c."campusId" = $3)
             AND ($4::text IS NULL OR c."gradeLevelId" = $4)
             AND ($5::text IS NULL OR s."classId" = $5)
             AND ($6::text IS NULL OR EXISTS (
               SELECT 1
               FROM jsonb_array_elements(
                 CASE
                   WHEN jsonb_typeof(er."scoreData"->'branches') = 'array' THEN er."scoreData"->'branches'
                   ELSE '[]'::jsonb
                 END
               ) AS branch(value)
               CROSS JOIN LATERAL (
                 SELECT
                   regexp_replace(regexp_replace(upper(trim(branch.value->>'branch') COLLATE "tr-x-icu"), '[[:space:]]+', ' ', 'g'), '^LGS[- ]+', '') AS branch_label,
                   regexp_replace(regexp_replace(upper(trim(selected_course."name") COLLATE "tr-x-icu"), '[[:space:]]+', ' ', 'g'), '^LGS[- ]+', '') AS course_name,
                   regexp_replace(regexp_replace(upper(trim(selected_course."code") COLLATE "tr-x-icu"), '[[:space:]]+', ' ', 'g'), '^LGS[- ]+', '') AS course_code
               ) AS normalized_course
               WHERE selected_course."id" IS NOT NULL
                 AND normalized_course.branch_label IN (normalized_course.course_name, normalized_course.course_code)
             ))
             AND ($7::text IS NULL OR EXISTS (
               SELECT 1
               FROM "AcademicTerm" term
               WHERE term."tenantId" = er."tenantId"
                 AND term."id" = $7
                 AND term."deletedAt" IS NULL
                 AND COALESCE(e."startsAt", er."computedAt")::date BETWEEN term."startsAt" AND term."endsAt"
             ))
           ORDER BY er."studentId" ASC, er."computedAt" DESC, er."updatedAt" DESC, er."resultKey" DESC
         )
         SELECT *
         FROM latest_results
         ORDER BY "studentId" ASC, "resultKey" ASC`,
        [
          input.tenantId,
          input.examId,
          optionalText(input.campusId) ?? null,
          optionalText(input.gradeLevelId) ?? null,
          optionalText(input.classId) ?? null,
          optionalText(input.courseId) ?? null,
          optionalText(input.termId) ?? null,
        ],
      );

      return result.rows.map((row) => {
        const displayName = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
        return {
          examId: row.examId,
          ...(row.examTitle ? { examTitle: row.examTitle } : {}),
          ...(row.examStartsAt ? { examStartsAt: toIsoString(row.examStartsAt) } : {}),
          studentId: row.studentId,
          ...(displayName ? { displayName } : {}),
          ...(row.studentNo ? { studentNo: row.studentNo } : {}),
          ...(row.participantNo ? { participantNo: row.participantNo } : {}),
          ...(row.bookletType ? { bookletType: row.bookletType } : {}),
          classId: row.classId ?? undefined,
          className: row.className ?? undefined,
          resultKey: row.resultKey,
          answerKeyVersion: row.answerKeyVersion,
          parserConfigVersion: row.parserConfigVersion,
          engineVersion: row.engineVersion,
          score: filterScoreForCourse(parseScoringResult(row.scoreData), row.courseName, row.courseCode),
          computedAt: toIsoString(row.computedAt),
          ...(row.linkedTytExamId ? {
            linkedTytResult: {
              examId: row.linkedTytExamId,
              resultKey: row.linkedTytResultKey!,
              answerKeyVersion: row.linkedTytAnswerKeyVersion!,
              parserConfigVersion: row.linkedTytParserConfigVersion!,
              engineVersion: row.linkedTytEngineVersion!,
              score: parseScoringResult(row.linkedTytScoreData),
              computedAt: toIsoString(row.linkedTytComputedAt!),
            },
          } : {}),
        };
      });
    });
  }

  async saveSnapshot(snapshot: ReportSnapshotCandidate): Promise<ReportGenerationJobResult> {
    return withTenantDb(this.pool, { tenantId: snapshot.tenantId }, async (client) => {
      const row = await insertSnapshot(client, snapshot);
      if (!row) {
        throw new Error("REPORT_SNAPSHOT_SAVE_FAILED");
      }
      return {
        id: row.id,
        tenantId: row.tenantId,
        examId: row.examId,
        contentHash: row.contentHash,
        campusId: row.campusId ?? undefined,
        gradeLevelId: row.gradeLevelId ?? undefined,
        classId: row.classId ?? undefined,
        courseId: row.courseId ?? undefined,
        termId: row.termId ?? undefined,
        reportType: parseReportType(row.reportType),
        status: parseReportSnapshotStatus(row.status),
        inputRefs: parseJsonObject(row.inputRefs) as ReportGenerationJobResult["inputRefs"],
        snapshotData: parseJsonObject(row.snapshotData) as ReportGenerationJobResult["snapshotData"],
        generatedAt: toIsoString(row.generatedAt),
      };
    });
  }
}

interface ExamResultReportRow {
  examId: string;
  examTitle: string | null;
  examStartsAt: Date | string | null;
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  studentNo: string | null;
  participantNo: string | null;
  bookletType: string | null;
  classId: string | null;
  className: string | null;
  courseName: string | null;
  courseCode: string | null;
  resultKey: string;
  answerKeyVersion: string;
  parserConfigVersion: string;
  engineVersion: string;
  scoreData: unknown;
  computedAt: Date | string;
  linkedTytExamId: string | null;
  linkedTytResultKey: string | null;
  linkedTytAnswerKeyVersion: string | null;
  linkedTytParserConfigVersion: string | null;
  linkedTytEngineVersion: string | null;
  linkedTytScoreData: unknown | null;
  linkedTytComputedAt: Date | string | null;
}

function filterScoreForCourse(score: ScoringResult, courseName: string | null, courseCode: string | null): ScoringResult {
  const courseLabels = new Set([courseName, courseCode].flatMap((value) => value ? [normalizeCourseLabel(value)] : []));
  if (courseLabels.size === 0) return score;

  const matchesCourse = (branch: string) => courseLabels.has(normalizeCourseLabel(branch));
  const branches = score.branches.filter((branch) => matchesCourse(branch.branch));
  const outcomes = score.outcomes?.filter((outcome) => matchesCourse(outcome.branch));
  const questions = score.questions.filter((question) => matchesCourse(question.branch));
  const totals = branches.reduce(
    (current, branch) => ({
      correct: current.correct + branch.correct,
      wrong: current.wrong + branch.wrong,
      blank: current.blank + branch.blank,
      net: current.net + branch.net,
    }),
    { correct: 0, wrong: 0, blank: 0, net: 0 },
  );

  return {
    ...score,
    total: {
      ...totals,
      rawScore: totals.net,
      ...(score.total.standardScore !== undefined ? { standardScore: totals.net } : {}),
    },
    branches,
    ...(outcomes ? { outcomes } : {}),
    questions,
  };
}

function normalizeCourseLabel(value: string): string {
  return value.trim().toLocaleUpperCase("tr-TR").replace(/\s+/gu, " ").replace(/^LGS[- ]+/u, "");
}

interface ReportSnapshotRow {
  id: string;
  tenantId: string;
  examId: string;
  campusId: string | null;
  gradeLevelId: string | null;
  classId: string | null;
  courseId: string | null;
  termId: string | null;
  reportType: string;
  contentHash: string;
  status: string;
  inputRefs: unknown;
  snapshotData: unknown;
  generatedAt: Date | string;
}

async function insertSnapshot(
  client: Queryable,
  snapshot: ReportSnapshotCandidate,
): Promise<ReportSnapshotRow | undefined> {
  const result = await client.query<ReportSnapshotRow>(
    `INSERT INTO "ReportSnapshot" (
       "id",
       "tenantId",
       "examId",
       "campusId",
       "gradeLevelId",
       "classId",
       "courseId",
       "termId",
       "reportType",
       "contentHash",
       "status",
       "inputRefs",
       "snapshotData",
       "generatedAt",
       "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, now())
     ON CONFLICT ("tenantId", "contentHash") DO NOTHING
     RETURNING "id", "tenantId", "examId", "campusId", "gradeLevelId", "classId", "courseId", "termId",
       "reportType", "contentHash", "status", "inputRefs", "snapshotData", "generatedAt"`,
    [
      randomUUID(),
      snapshot.tenantId,
      snapshot.examId,
      snapshot.campusId ?? null,
      snapshot.gradeLevelId ?? null,
      snapshot.classId ?? null,
      snapshot.courseId ?? null,
      snapshot.termId ?? null,
      snapshot.reportType,
      snapshot.contentHash,
      snapshot.status,
      JSON.stringify(snapshot.inputRefs),
      JSON.stringify(snapshot.snapshotData),
      snapshot.generatedAt,
    ],
  );
  if (result.rows[0]) return result.rows[0];

  const existing = await client.query<ReportSnapshotRow>(
    `SELECT "id", "tenantId", "examId", "campusId", "gradeLevelId", "classId", "courseId", "termId",
       "reportType", "contentHash", "status", "inputRefs", "snapshotData", "generatedAt"
     FROM "ReportSnapshot"
     WHERE "tenantId" = $1
       AND "contentHash" = $2
     LIMIT 1`,
    [snapshot.tenantId, snapshot.contentHash],
  );
  return existing.rows[0];
}

function parseScoringResult(value: unknown): ScoringResult {
  const score = typeof value === "string" ? JSON.parse(value) as unknown : value;
  const record = parseJsonObject(score);
  if (!record.total || !Array.isArray(record.branches) || !record._meta) {
    throw new Error("REPORT_RESULT_SCORE_INVALID");
  }
  return score as ScoringResult;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parseReportType(value: string): ReportGenerationJobResult["reportType"] {
  if (value !== examResultSummaryReportType) {
    throw new Error("REPORT_TYPE_INVALID");
  }
  return value;
}

function parseReportSnapshotStatus(value: string): ReportGenerationJobResult["status"] {
  if (value !== "READY" && value !== "STALE") {
    throw new Error("REPORT_STATUS_INVALID");
  }
  return value;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("REPORT_JSON_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
