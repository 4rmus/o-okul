import { randomUUID } from "node:crypto";
import { type Queryable, type TenantQueryable, withTenantDb } from "@uzman-hocam/db";
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
        `SELECT
           er."studentId",
           s."classId",
           c."name" AS "className",
           er."resultKey",
           er."answerKeyVersion",
           er."parserConfigVersion",
           er."engineVersion",
           er."scoreData",
           er."computedAt"
         FROM "ExamResult" er
         LEFT JOIN "Student" s
           ON s."tenantId" = er."tenantId"
          AND s."id" = er."studentId"
          AND s."deletedAt" IS NULL
         LEFT JOIN "Class" c
           ON c."tenantId" = er."tenantId"
          AND c."id" = s."classId"
          AND c."deletedAt" IS NULL
         WHERE er."tenantId" = $1
           AND er."examId" = $2
           AND er."deletedAt" IS NULL
         ORDER BY er."studentId" ASC, er."resultKey" ASC`,
        [input.tenantId, input.examId],
      );

      return result.rows.map((row) => ({
        studentId: row.studentId,
        classId: row.classId ?? undefined,
        className: row.className ?? undefined,
        resultKey: row.resultKey,
        answerKeyVersion: row.answerKeyVersion,
        parserConfigVersion: row.parserConfigVersion,
        engineVersion: row.engineVersion,
        score: parseScoringResult(row.scoreData),
        computedAt: toIsoString(row.computedAt),
      }));
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
        reportType: parseReportType(row.reportType),
        status: "READY",
        inputRefs: parseJsonObject(row.inputRefs) as ReportGenerationJobResult["inputRefs"],
        snapshotData: parseJsonObject(row.snapshotData) as ReportGenerationJobResult["snapshotData"],
        generatedAt: toIsoString(row.generatedAt),
      };
    });
  }
}

interface ExamResultReportRow {
  studentId: string;
  classId: string | null;
  className: string | null;
  resultKey: string;
  answerKeyVersion: string;
  parserConfigVersion: string;
  engineVersion: string;
  scoreData: unknown;
  computedAt: Date | string;
}

interface ReportSnapshotRow {
  id: string;
  tenantId: string;
  examId: string;
  reportType: string;
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
       "reportType",
       "status",
       "inputRefs",
       "snapshotData",
       "generatedAt",
       "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, now())
     RETURNING "id", "tenantId", "examId", "reportType", "inputRefs", "snapshotData", "generatedAt"`,
    [
      randomUUID(),
      snapshot.tenantId,
      snapshot.examId,
      snapshot.reportType,
      snapshot.status,
      JSON.stringify(snapshot.inputRefs),
      JSON.stringify(snapshot.snapshotData),
      snapshot.generatedAt,
    ],
  );
  return result.rows[0];
}

function parseScoringResult(value: unknown): ScoringResult {
  const score = typeof value === "string" ? JSON.parse(value) as unknown : value;
  const record = parseJsonObject(score);
  if (!record.total || !Array.isArray(record.branches) || !record._meta) {
    throw new Error("REPORT_RESULT_SCORE_INVALID");
  }
  return score as ScoringResult;
}

function parseReportType(value: string): ReportGenerationJobResult["reportType"] {
  if (value !== examResultSummaryReportType) {
    throw new Error("REPORT_TYPE_INVALID");
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
