import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface DevelopmentCriterionRecord {
  id: string;
  tenantId: string;
  name: string;
  scaleMin: number;
  scaleMax: number;
  sortOrder: number;
  deletedAt?: string;
}

export interface DevelopmentAssessmentRecord {
  id: string;
  tenantId: string;
  studentId: string;
  teacherId: string;
  termId?: string;
  periodLabel: string;
  mentorNote?: string;
  visibility: "INTERNAL" | "GUARDIAN";
  createdAt?: string;
}

export interface DevelopmentScoreRecord {
  id: string;
  tenantId: string;
  assessmentId: string;
  criterionId: string;
  score: number;
}

export type DevelopmentAssessmentCreateInput = Omit<DevelopmentAssessmentRecord, "id" | "createdAt">;
export type DevelopmentScoreCreateInput = Pick<DevelopmentScoreRecord, "criterionId" | "score">;

/**
 * Assessments are append-only (DEC-20261102-05): the store has no update or delete for an assessment or its scores.
 * The only in-place change is the KVKK purge that clears a purged student's mentor notes.
 */
export interface DevelopmentStore {
  listCriteria(): Promise<DevelopmentCriterionRecord[]>;
  findCriterionById(id: string): Promise<DevelopmentCriterionRecord | undefined>;
  createCriterion(input: Omit<DevelopmentCriterionRecord, "id">): Promise<DevelopmentCriterionRecord>;
  listAssessments(studentId?: string): Promise<DevelopmentAssessmentRecord[]>;
  findAssessmentById(id: string): Promise<DevelopmentAssessmentRecord | undefined>;
  /** Writes the assessment and all of its scores in one transaction: either every row exists or none does. */
  createAssessmentWithScores(
    input: DevelopmentAssessmentCreateInput,
    scores: DevelopmentScoreCreateInput[],
  ): Promise<{ assessment: DevelopmentAssessmentRecord; scores: DevelopmentScoreRecord[] }>;
  listScores(assessmentId: string): Promise<DevelopmentScoreRecord[]>;
  /** KVKK purge: clears mentorNote on every assessment of the student and returns how many rows changed. */
  purgeMentorNotesByStudent(tenantId: string, studentId: string): Promise<number>;
}

export const developmentStoreToken = Symbol("DevelopmentStore");

export class InMemoryDevelopmentStore implements DevelopmentStore {
  private readonly criteria: DevelopmentCriterionRecord[] = [];
  private readonly assessments: DevelopmentAssessmentRecord[] = [];
  private readonly scores: DevelopmentScoreRecord[] = [];

  async listCriteria(): Promise<DevelopmentCriterionRecord[]> {
    return this.criteria.filter((criterion) => !criterion.deletedAt);
  }

  async findCriterionById(id: string): Promise<DevelopmentCriterionRecord | undefined> {
    return this.criteria.find((criterion) => criterion.id === id && !criterion.deletedAt);
  }

  async createCriterion(input: Omit<DevelopmentCriterionRecord, "id">): Promise<DevelopmentCriterionRecord> {
    const record = { id: `development-criterion-${this.criteria.length + 1}`, ...input };
    this.criteria.push(record);
    return record;
  }

  async listAssessments(studentId?: string): Promise<DevelopmentAssessmentRecord[]> {
    return this.assessments.filter((assessment) => !studentId || assessment.studentId === studentId);
  }

  async findAssessmentById(id: string): Promise<DevelopmentAssessmentRecord | undefined> {
    return this.assessments.find((assessment) => assessment.id === id);
  }

  async createAssessmentWithScores(
    input: DevelopmentAssessmentCreateInput,
    scores: DevelopmentScoreCreateInput[],
  ): Promise<{ assessment: DevelopmentAssessmentRecord; scores: DevelopmentScoreRecord[] }> {
    // Mirrors the DevelopmentScore (tenantId, assessmentId, criterionId) unique key before anything is stored.
    if (new Set(scores.map((score) => score.criterionId)).size !== scores.length) {
      throw new Error("DEVELOPMENT_SCORE_CRITERION_DUPLICATE");
    }
    const assessment: DevelopmentAssessmentRecord = {
      id: `development-assessment-${this.assessments.length + 1}`,
      ...input,
      createdAt: new Date().toISOString(),
    };
    const scoreRecords = scores.map((score, index) => ({
      id: `development-score-${this.scores.length + index + 1}`,
      tenantId: input.tenantId,
      assessmentId: assessment.id,
      criterionId: score.criterionId,
      score: score.score,
    }));
    this.assessments.push(assessment);
    this.scores.push(...scoreRecords);
    return { assessment, scores: scoreRecords };
  }

  async listScores(assessmentId: string): Promise<DevelopmentScoreRecord[]> {
    return this.scores.filter((score) => score.assessmentId === assessmentId);
  }

  async purgeMentorNotesByStudent(tenantId: string, studentId: string): Promise<number> {
    let changed = 0;
    for (const assessment of this.assessments) {
      if (assessment.tenantId !== tenantId || assessment.studentId !== studentId || assessment.mentorNote === undefined) continue;
      delete assessment.mentorNote;
      changed += 1;
    }
    return changed;
  }
}

export class PostgresDevelopmentStore implements DevelopmentStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listCriteria(): Promise<DevelopmentCriterionRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<DevelopmentCriterionRow>(
        `SELECT * FROM "DevelopmentCriterion" WHERE "deletedAt" IS NULL ORDER BY "sortOrder" ASC, "name" ASC`,
      );
      return result.rows.map(toCriterionRecord);
    });
  }

  async findCriterionById(id: string): Promise<DevelopmentCriterionRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<DevelopmentCriterionRow>(
        `SELECT * FROM "DevelopmentCriterion" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toCriterionRecord(result.rows[0]) : undefined;
    });
  }

  async createCriterion(input: Omit<DevelopmentCriterionRecord, "id">): Promise<DevelopmentCriterionRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<DevelopmentCriterionRow>(
        `INSERT INTO "DevelopmentCriterion" ("id", "tenantId", "name", "scaleMin", "scaleMax", "sortOrder", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.name, input.scaleMin, input.scaleMax, input.sortOrder],
      );
      return toCriterionRecord(result.rows[0]!);
    });
  }

  async listAssessments(studentId?: string): Promise<DevelopmentAssessmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<DevelopmentAssessmentRow>(
        `SELECT * FROM "DevelopmentAssessment"
         WHERE ($1::text IS NULL OR "studentId" = $1)
         ORDER BY "createdAt" DESC`,
        [studentId ?? null],
      );
      return result.rows.map(toAssessmentRecord);
    });
  }

  async findAssessmentById(id: string): Promise<DevelopmentAssessmentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<DevelopmentAssessmentRow>(
        `SELECT * FROM "DevelopmentAssessment" WHERE "id" = $1 LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toAssessmentRecord(result.rows[0]) : undefined;
    });
  }

  async createAssessmentWithScores(
    input: DevelopmentAssessmentCreateInput,
    scores: DevelopmentScoreCreateInput[],
  ): Promise<{ assessment: DevelopmentAssessmentRecord; scores: DevelopmentScoreRecord[] }> {
    // One withTenantQuery call is one BEGIN/COMMIT: a failing score insert rolls the assessment back too.
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<DevelopmentAssessmentRow>(
        `INSERT INTO "DevelopmentAssessment" ("id", "tenantId", "studentId", "teacherId", "termId", "periodLabel", "mentorNote", "visibility", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.studentId,
          input.teacherId,
          input.termId ?? null,
          input.periodLabel,
          input.mentorNote ?? null,
          input.visibility,
        ],
      );
      const assessment = toAssessmentRecord(inserted.rows[0]!);
      const scoreRecords: DevelopmentScoreRecord[] = [];
      for (const score of scores) {
        const result = await client.query<DevelopmentScoreRow>(
          `INSERT INTO "DevelopmentScore" ("id", "tenantId", "assessmentId", "criterionId", "score", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, now())
           RETURNING *`,
          [randomUUID(), input.tenantId, assessment.id, score.criterionId, score.score],
        );
        scoreRecords.push(toScoreRecord(result.rows[0]!));
      }
      return { assessment, scores: scoreRecords };
    });
  }

  async purgeMentorNotesByStudent(tenantId: string, studentId: string): Promise<number> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE "DevelopmentAssessment"
         SET "mentorNote" = NULL, "updatedAt" = now()
         WHERE "tenantId" = $1 AND "studentId" = $2 AND "mentorNote" IS NOT NULL`,
        [tenantId, studentId],
      );
      return result.rowCount ?? 0;
    });
  }

  async listScores(assessmentId: string): Promise<DevelopmentScoreRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<DevelopmentScoreRow>(
        `SELECT * FROM "DevelopmentScore" WHERE "assessmentId" = $1 ORDER BY "criterionId" ASC`,
        [assessmentId],
      );
      return result.rows.map(toScoreRecord);
    });
  }
}

export function createDevelopmentStore(): DevelopmentStore {
  return resolvePersistenceDriver(process.env.DEVELOPMENT_STORE) === "postgres"
    ? new PostgresDevelopmentStore()
    : new InMemoryDevelopmentStore();
}

interface DevelopmentCriterionRow {
  id: string;
  tenantId: string;
  name: string;
  scaleMin: number;
  scaleMax: number;
  sortOrder: number;
  deletedAt: Date | string | null;
}

interface DevelopmentAssessmentRow {
  id: string;
  tenantId: string;
  studentId: string;
  teacherId: string;
  termId: string | null;
  periodLabel: string;
  mentorNote: string | null;
  visibility: "INTERNAL" | "GUARDIAN";
  createdAt: Date | string;
}

interface DevelopmentScoreRow {
  id: string;
  tenantId: string;
  assessmentId: string;
  criterionId: string;
  score: number;
}

function toCriterionRecord(row: DevelopmentCriterionRow): DevelopmentCriterionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    scaleMin: row.scaleMin,
    scaleMax: row.scaleMax,
    sortOrder: row.sortOrder,
    deletedAt: row.deletedAt ? toIsoString(row.deletedAt) : undefined,
  };
}

function toAssessmentRecord(row: DevelopmentAssessmentRow): DevelopmentAssessmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    teacherId: row.teacherId,
    termId: row.termId ?? undefined,
    periodLabel: row.periodLabel,
    mentorNote: row.mentorNote ?? undefined,
    visibility: row.visibility,
    createdAt: toIsoString(row.createdAt),
  };
}

function toScoreRecord(row: DevelopmentScoreRow): DevelopmentScoreRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    assessmentId: row.assessmentId,
    criterionId: row.criterionId,
    score: row.score,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
