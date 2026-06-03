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

export interface DevelopmentStore {
  listCriteria(): Promise<DevelopmentCriterionRecord[]>;
  findCriterionById(id: string): Promise<DevelopmentCriterionRecord | undefined>;
  createCriterion(input: Omit<DevelopmentCriterionRecord, "id">): Promise<DevelopmentCriterionRecord>;
  listAssessments(studentId?: string): Promise<DevelopmentAssessmentRecord[]>;
  createAssessment(input: Omit<DevelopmentAssessmentRecord, "id">): Promise<DevelopmentAssessmentRecord>;
  createScore(input: Omit<DevelopmentScoreRecord, "id">): Promise<DevelopmentScoreRecord>;
  listScores(assessmentId: string): Promise<DevelopmentScoreRecord[]>;
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

  async createAssessment(input: Omit<DevelopmentAssessmentRecord, "id">): Promise<DevelopmentAssessmentRecord> {
    const record = { id: `development-assessment-${this.assessments.length + 1}`, ...input };
    this.assessments.push(record);
    return record;
  }

  async createScore(input: Omit<DevelopmentScoreRecord, "id">): Promise<DevelopmentScoreRecord> {
    const record = { id: `development-score-${this.scores.length + 1}`, ...input };
    this.scores.push(record);
    return record;
  }

  async listScores(assessmentId: string): Promise<DevelopmentScoreRecord[]> {
    return this.scores.filter((score) => score.assessmentId === assessmentId);
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

  async createAssessment(input: Omit<DevelopmentAssessmentRecord, "id">): Promise<DevelopmentAssessmentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<DevelopmentAssessmentRow>(
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
      return toAssessmentRecord(result.rows[0]!);
    });
  }

  async createScore(input: Omit<DevelopmentScoreRecord, "id">): Promise<DevelopmentScoreRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<DevelopmentScoreRow>(
        `INSERT INTO "DevelopmentScore" ("id", "tenantId", "assessmentId", "criterionId", "score", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.assessmentId, input.criterionId, input.score],
      );
      return toScoreRecord(result.rows[0]!);
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
