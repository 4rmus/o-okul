import { randomUUID } from "node:crypto";
import type { GradeAssessmentRecord, GradeEntryDraftInput, GradeEntryRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type GradeAssessmentCreateInput = Omit<GradeAssessmentRecord, "id" | "createdAt" | "publishedVersion">;

export interface GradebookStore {
  createAssessment(input: GradeAssessmentCreateInput): Promise<GradeAssessmentRecord>;
  listAssessments(filter: { classIds?: readonly string[]; termId?: string; courseId?: string }): Promise<GradeAssessmentRecord[]>;
  findAssessment(id: string): Promise<GradeAssessmentRecord | undefined>;
  listEntries(assessmentId: string): Promise<GradeEntryRecord[]>;
  /** Upserts drafts on each student's highest version; a published highest version gets a new draft version. */
  saveDrafts(assessment: GradeAssessmentRecord, entries: readonly GradeEntryDraftInput[], enteredById: string): Promise<GradeEntryRecord[]>;
  /** Publishes every draft and moves publishedVersion to max(version) in the same transaction. */
  publish(assessment: GradeAssessmentRecord): Promise<{ assessment: GradeAssessmentRecord; publishedCount: number }>;
  /** Per assessment, the student's highest published version only; drafts and superseded versions are excluded. */
  listPublishedByStudent(studentId: string): Promise<PublishedStudentGrade[]>;
}

export interface PublishedStudentGrade {
  assessment: GradeAssessmentRecord;
  entry: GradeEntryRecord;
}

export const gradebookStoreToken = Symbol("GradebookStore");

export class InMemoryGradebookStore implements GradebookStore {
  private readonly assessments: GradeAssessmentRecord[] = [];
  private readonly entries: Array<GradeEntryRecord & { tenantId: string }> = [];

  async createAssessment(input: GradeAssessmentCreateInput): Promise<GradeAssessmentRecord> {
    const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.assessments.push(record);
    return { ...record };
  }

  async listAssessments(filter: { classIds?: readonly string[]; termId?: string; courseId?: string }): Promise<GradeAssessmentRecord[]> {
    return this.assessments
      .filter((record) => (!filter.classIds || filter.classIds.includes(record.classId))
        && (!filter.termId || record.termId === filter.termId)
        && (!filter.courseId || record.courseId === filter.courseId))
      .map((record) => ({ ...record }));
  }

  async findAssessment(id: string): Promise<GradeAssessmentRecord | undefined> {
    const record = this.assessments.find((item) => item.id === id);
    return record ? { ...record } : undefined;
  }

  async listEntries(assessmentId: string): Promise<GradeEntryRecord[]> {
    return this.entries.filter((entry) => entry.assessmentId === assessmentId).map(({ tenantId: _tenantId, ...entry }) => ({ ...entry }));
  }

  async saveDrafts(assessment: GradeAssessmentRecord, drafts: readonly GradeEntryDraftInput[], enteredById: string): Promise<GradeEntryRecord[]> {
    for (const draft of drafts) {
      const latest = this.entries
        .filter((entry) => entry.assessmentId === assessment.id && entry.studentId === draft.studentId)
        .sort((left, right) => right.version - left.version)[0];
      if (latest && !latest.publishedAt) {
        Object.assign(latest, { score: draft.score, absent: draft.absent, enteredById });
        continue;
      }
      this.entries.push({
        id: randomUUID(),
        tenantId: assessment.tenantId,
        assessmentId: assessment.id,
        studentId: draft.studentId,
        version: (latest?.version ?? 0) + 1,
        score: draft.score,
        absent: draft.absent,
        enteredById,
        createdAt: new Date().toISOString(),
      });
    }
    return this.listEntries(assessment.id);
  }

  async publish(assessment: GradeAssessmentRecord): Promise<{ assessment: GradeAssessmentRecord; publishedCount: number }> {
    const publishedAt = new Date().toISOString();
    const drafts = this.entries.filter((entry) => entry.assessmentId === assessment.id && !entry.publishedAt);
    for (const draft of drafts) draft.publishedAt = publishedAt;
    const stored = this.assessments.find((item) => item.id === assessment.id)!;
    const versions = this.entries.filter((entry) => entry.assessmentId === assessment.id && entry.publishedAt).map((entry) => entry.version);
    if (versions.length > 0) stored.publishedVersion = Math.max(...versions);
    return { assessment: { ...stored }, publishedCount: drafts.length };
  }

  async listPublishedByStudent(studentId: string): Promise<PublishedStudentGrade[]> {
    const latest = new Map<string, GradeEntryRecord & { tenantId: string }>();
    for (const entry of this.entries) {
      if (entry.studentId !== studentId || !entry.publishedAt) continue;
      const current = latest.get(entry.assessmentId);
      if (!current || entry.version > current.version) latest.set(entry.assessmentId, entry);
    }
    return [...latest.values()].flatMap(({ tenantId: _tenantId, ...entry }) => {
      const assessment = this.assessments.find((item) => item.id === entry.assessmentId);
      return assessment ? [{ assessment: { ...assessment }, entry: { ...entry } }] : [];
    });
  }
}

export class PostgresGradebookStore implements GradebookStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async createAssessment(input: GradeAssessmentCreateInput): Promise<GradeAssessmentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeAssessmentRow>(
        `INSERT INTO "GradeAssessment" ("id", "tenantId", "classId", "courseId", "termId", "kind", "title", "heldOn", "maxScore", "createdById", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.classId, input.courseId, input.termId, input.kind, input.title, input.heldOn, input.maxScore, input.createdById],
      );
      return toAssessmentRecord(result.rows[0]!);
    });
  }

  async listAssessments(filter: { classIds?: readonly string[]; termId?: string; courseId?: string }): Promise<GradeAssessmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeAssessmentRow>(
        `SELECT * FROM "GradeAssessment"
         WHERE ($1::text[] IS NULL OR "classId" = ANY($1))
           AND ($2::text IS NULL OR "termId" = $2)
           AND ($3::text IS NULL OR "courseId" = $3)
         ORDER BY "heldOn" DESC, "createdAt" DESC`,
        [filter.classIds ? [...filter.classIds] : null, filter.termId ?? null, filter.courseId ?? null],
      );
      return result.rows.map(toAssessmentRecord);
    });
  }

  async findAssessment(id: string): Promise<GradeAssessmentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeAssessmentRow>(`SELECT * FROM "GradeAssessment" WHERE "id" = $1`, [id]);
      return result.rows[0] ? toAssessmentRecord(result.rows[0]) : undefined;
    });
  }

  async listEntries(assessmentId: string): Promise<GradeEntryRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      return selectEntries(client, assessmentId);
    });
  }

  async saveDrafts(assessment: GradeAssessmentRecord, drafts: readonly GradeEntryDraftInput[], enteredById: string): Promise<GradeEntryRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      // Serializes with publish so a draft cannot be written into a version that is being published.
      await client.query(`SELECT 1 FROM "GradeAssessment" WHERE "id" = $1 FOR UPDATE`, [assessment.id]);
      for (const draft of drafts) {
        const updated = await client.query(
          `UPDATE "GradeEntry" SET "score" = $3, "absent" = $4, "enteredById" = $5
           WHERE "assessmentId" = $1 AND "studentId" = $2 AND "publishedAt" IS NULL
             AND "version" = (SELECT max("version") FROM "GradeEntry" WHERE "assessmentId" = $1 AND "studentId" = $2)`,
          [assessment.id, draft.studentId, draft.score, draft.absent, enteredById],
        );
        if (updated.rowCount) continue;
        await client.query(
          `INSERT INTO "GradeEntry" ("id", "tenantId", "assessmentId", "studentId", "version", "score", "absent", "enteredById")
           SELECT $1, $2, $3, $4, COALESCE(max("version"), 0) + 1, $5, $6, $7
           FROM "GradeEntry" WHERE "assessmentId" = $3 AND "studentId" = $4`,
          [randomUUID(), assessment.tenantId, assessment.id, draft.studentId, draft.score, draft.absent, enteredById],
        );
      }
      return selectEntries(client, assessment.id);
    });
  }

  async publish(assessment: GradeAssessmentRecord): Promise<{ assessment: GradeAssessmentRecord; publishedCount: number }> {
    return withTenantQuery(this.pool, async (client) => {
      await client.query(`SELECT 1 FROM "GradeAssessment" WHERE "id" = $1 FOR UPDATE`, [assessment.id]);
      const published = await client.query(
        `UPDATE "GradeEntry" SET "publishedAt" = now() WHERE "assessmentId" = $1 AND "publishedAt" IS NULL`,
        [assessment.id],
      );
      const result = await client.query<GradeAssessmentRow>(
        `UPDATE "GradeAssessment" SET "updatedAt" = now(),
           "publishedVersion" = (SELECT max("version") FROM "GradeEntry" WHERE "assessmentId" = $1 AND "publishedAt" IS NOT NULL)
         WHERE "id" = $1
         RETURNING *`,
        [assessment.id],
      );
      return { assessment: toAssessmentRecord(result.rows[0]!), publishedCount: published.rowCount ?? 0 };
    });
  }

  async listPublishedByStudent(studentId: string): Promise<PublishedStudentGrade[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<{ assessment: GradeAssessmentRow; entry: GradeEntryRow }>(
        `SELECT DISTINCT ON (e."assessmentId") row_to_json(a) AS "assessment", row_to_json(e) AS "entry"
         FROM "GradeEntry" e
         JOIN "GradeAssessment" a ON a."id" = e."assessmentId" AND a."tenantId" = e."tenantId"
         WHERE e."studentId" = $1 AND e."publishedAt" IS NOT NULL
         ORDER BY e."assessmentId", e."version" DESC`,
        [studentId],
      );
      return result.rows.map((row) => ({ assessment: toAssessmentRecord(row.assessment), entry: toEntryRecord(row.entry) }));
    });
  }
}

export function createGradebookStore(): GradebookStore {
  return resolvePersistenceDriver() === "postgres" ? new PostgresGradebookStore() : new InMemoryGradebookStore();
}

async function selectEntries(client: Queryable, assessmentId: string): Promise<GradeEntryRecord[]> {
  const result = await client.query<GradeEntryRow>(
    `SELECT * FROM "GradeEntry" WHERE "assessmentId" = $1 ORDER BY "studentId", "version"`,
    [assessmentId],
  );
  return result.rows.map(toEntryRecord);
}

interface GradeAssessmentRow {
  id: string;
  tenantId: string;
  classId: string;
  courseId: string;
  termId: string;
  kind: GradeAssessmentRecord["kind"];
  title: string;
  heldOn: Date | string;
  maxScore: string | number;
  publishedVersion: number | null;
  createdById: string;
  createdAt: Date | string;
}

interface GradeEntryRow {
  id: string;
  assessmentId: string;
  studentId: string;
  version: number;
  score: string | number | null;
  absent: boolean;
  publishedAt: Date | string | null;
  enteredById: string;
  createdAt: Date | string;
}

function toAssessmentRecord(row: GradeAssessmentRow): GradeAssessmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    classId: row.classId,
    courseId: row.courseId,
    termId: row.termId,
    kind: row.kind,
    title: row.title,
    heldOn: formatDate(row.heldOn),
    maxScore: Number(row.maxScore),
    ...(row.publishedVersion === null ? {} : { publishedVersion: row.publishedVersion }),
    createdById: row.createdById,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function toEntryRecord(row: GradeEntryRow): GradeEntryRecord {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    studentId: row.studentId,
    version: row.version,
    score: row.score === null ? null : Number(row.score),
    absent: row.absent,
    ...(row.publishedAt ? { publishedAt: new Date(row.publishedAt).toISOString() } : {}),
    enteredById: row.enteredById,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

// pg parses DATE as local midnight; toISOString() would shift it a day in UTC+ zones.
function formatDate(value: Date | string): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
