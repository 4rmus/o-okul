import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { ReportSnapshotRecord } from "./report-generation.service.js";

export interface ReportSnapshotStore {
  listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]>;
  findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined>;
  markStaleByExam(tenantId: string, examId: string, reason: string): Promise<number>;
}

export const reportSnapshotStoreToken = Symbol("ReportSnapshotStore");

const demoSnapshots: ReportSnapshotRecord[] = [
  {
    id: "snapshot-demo",
    tenantId: "tenant-a",
    examId: "exam-demo",
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    courseId: "course-math",
    termId: "term-2026-spring",
    reportType: "EXAM_RESULT_SUMMARY",
    status: "READY",
    inputRefs: {
      resultKeys: ["participant-a_v1_parser-v1_engine-v1"],
      answerKeyVersions: ["v1"],
      parserConfigVersions: ["parser-v1"],
      engineVersions: ["engine-v1"],
    },
    snapshotData: {
      reportType: "EXAM_RESULT_SUMMARY",
      generatedAt: "2026-06-06T09:00:00.000Z",
      resultCount: 1,
      averages: {
        correct: 18,
        wrong: 2,
        blank: 0,
        net: 17.5,
        rawScore: 87.5,
        standardScore: 87.5,
      },
      branches: [
        {
          branch: "Matematik",
          resultCount: 1,
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
        },
      ],
      classes: [
        {
          classId: "class-a",
          className: "8-A",
          resultCount: 1,
          averages: {
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 17.5,
            rawScore: 87.5,
            standardScore: 87.5,
          },
        },
      ],
      students: [
        {
          studentId: "student-a",
          classId: "class-a",
          className: "8-A",
          resultKey: "participant-a_v1_parser-v1_engine-v1",
          total: {
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 17.5,
            rawScore: 87.5,
            standardScore: 87.5,
          },
          branches: [
            {
              branch: "Matematik",
              correct: 18,
              wrong: 2,
              blank: 0,
              net: 17.5,
            },
          ],
        },
      ],
    },
    generatedAt: "2026-06-06T09:00:00.000Z",
    createdAt: "2026-06-06T09:00:00.000Z",
    updatedAt: "2026-06-06T09:00:00.000Z",
  },
];

export class InMemoryReportSnapshotStore implements ReportSnapshotStore {
  private readonly snapshots = demoSnapshots.map((record) => ({ ...record }));

  async listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]> {
    return this.snapshots.filter(
      (snapshot) => snapshot.tenantId === tenantId && snapshot.examId === examId && !snapshot.deletedAt,
    );
  }

  async findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined> {
    return this.snapshots.find(
      (snapshot) =>
        snapshot.tenantId === tenantId &&
        snapshot.examId === examId &&
        snapshot.id === snapshotId &&
        !snapshot.deletedAt,
    );
  }

  async markStaleByExam(tenantId: string, examId: string, reason: string): Promise<number> {
    const staleAt = new Date().toISOString();
    let changed = 0;
    for (const snapshot of this.snapshots) {
      if (
        snapshot.tenantId !== tenantId ||
        snapshot.examId !== examId ||
        snapshot.deletedAt ||
        snapshot.status === "STALE"
      ) {
        continue;
      }
      snapshot.status = "STALE";
      snapshot.staleAt = staleAt;
      snapshot.updatedAt = staleAt;
      snapshot.inputRefs = {
        ...snapshot.inputRefs,
        staleReason: reason,
      };
      changed += 1;
    }
    return changed;
  }
}

export class PostgresReportSnapshotStore implements ReportSnapshotStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/uzman_hocam",
    }),
  ) {}

  async listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ReportSnapshotRow>(
        `SELECT
           "id",
           "tenantId",
           "examId",
           "campusId",
           "gradeLevelId",
           "classId",
           "courseId",
           "termId",
           "reportType",
           "status",
           "inputRefs",
           "snapshotData",
           "generatedAt",
           "staleAt",
           "deletedAt",
           "createdAt",
           "updatedAt"
         FROM "ReportSnapshot"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "deletedAt" IS NULL
         ORDER BY "generatedAt" DESC NULLS LAST, "createdAt" DESC`,
        [tenantId, examId],
      );
      return result.rows.map(toReportSnapshotRecord);
    });
  }

  async findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ReportSnapshotRow>(
        `SELECT
           "id",
           "tenantId",
           "examId",
           "campusId",
           "gradeLevelId",
           "classId",
           "courseId",
           "termId",
           "reportType",
           "status",
           "inputRefs",
           "snapshotData",
           "generatedAt",
           "staleAt",
           "deletedAt",
           "createdAt",
           "updatedAt"
         FROM "ReportSnapshot"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "id" = $3
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, examId, snapshotId],
      );
      return result.rows[0] ? toReportSnapshotRecord(result.rows[0]) : undefined;
    });
  }

  async markStaleByExam(tenantId: string, examId: string, reason: string): Promise<number> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE "ReportSnapshot"
         SET "status" = 'STALE',
             "staleAt" = COALESCE("staleAt", now()),
             "inputRefs" = COALESCE("inputRefs", '{}'::jsonb) || $3::jsonb,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "deletedAt" IS NULL
           AND "status" <> 'STALE'`,
        [tenantId, examId, JSON.stringify({ staleReason: reason })],
      );
      return result.rowCount ?? 0;
    });
  }
}

export function createReportSnapshotStore(): ReportSnapshotStore {
  return resolvePersistenceDriver(process.env.REPORT_SNAPSHOT_STORE) === "postgres"
    ? new PostgresReportSnapshotStore()
    : new InMemoryReportSnapshotStore();
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
  status: string;
  inputRefs: unknown;
  snapshotData: unknown;
  generatedAt: Date | string | null;
  staleAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toReportSnapshotRecord(row: ReportSnapshotRow): ReportSnapshotRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    examId: row.examId,
    campusId: row.campusId ?? undefined,
    gradeLevelId: row.gradeLevelId ?? undefined,
    classId: row.classId ?? undefined,
    courseId: row.courseId ?? undefined,
    termId: row.termId ?? undefined,
    reportType: row.reportType,
    status: row.status,
    inputRefs: parseJsonObject(row.inputRefs),
    snapshotData: row.snapshotData === null ? undefined : parseJsonObject(row.snapshotData),
    generatedAt: toOptionalIsoString(row.generatedAt),
    staleAt: toOptionalIsoString(row.staleAt),
    deletedAt: toOptionalIsoString(row.deletedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("REPORT_SNAPSHOT_JSON_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function toOptionalIsoString(value: Date | string | null): string | undefined {
  return value ? toIsoString(value) : undefined;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
