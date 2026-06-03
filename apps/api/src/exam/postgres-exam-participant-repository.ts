import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ExamParticipantRecord } from "@uzman-hocam/shared-types";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { CreateExamParticipantRepositoryInput, ExamParticipantRepository } from "./exam.service.js";

export class PostgresExamParticipantRepository implements ExamParticipantRepository {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(tenantId: string, examId: string): Promise<ExamParticipantRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ExamParticipantRow>(
        `SELECT * FROM "ExamParticipant"
         WHERE "tenantId" = $1 AND "examId" = $2 AND "deletedAt" IS NULL
         ORDER BY "createdAt" DESC`,
        [tenantId, examId],
      );
      return result.rows.map(toExamParticipantRecord);
    });
  }

  async create(input: CreateExamParticipantRepositoryInput): Promise<ExamParticipantRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<ExamParticipantRow>(
        `INSERT INTO "ExamParticipant"
           ("id", "tenantId", "examId", "studentId", "participantNo", "bookletType", "status", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 'REGISTERED', now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.examId,
          input.studentId,
          input.participantNo ?? null,
          input.bookletType ?? null,
        ],
      );
      return toExamParticipantRecord(inserted.rows[0]!);
    });
  }
}

interface ExamParticipantRow {
  id: string;
  tenantId: string;
  examId: string;
  studentId: string;
  participantNo: string | null;
  bookletType: string | null;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toExamParticipantRecord(row: ExamParticipantRow): ExamParticipantRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    examId: row.examId,
    studentId: row.studentId,
    ...(row.participantNo ? { participantNo: row.participantNo } : {}),
    ...(row.bookletType ? { bookletType: row.bookletType } : {}),
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}
