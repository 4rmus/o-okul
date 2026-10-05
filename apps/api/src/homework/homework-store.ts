import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialFileRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  HomeworkSubmissionRow,
} from "./homework.service.js";

export interface HomeworkStore {
  listMaterials(): Promise<HomeworkMaterialRecord[]>;
  findMaterialById(id: string): Promise<HomeworkMaterialRecord | undefined>;
  createMaterial(input: Omit<HomeworkMaterialRecord, "id">): Promise<HomeworkMaterialRecord>;
  updateMaterial(
    id: string,
    input: Pick<HomeworkMaterialRecord, "title" | "description">,
  ): Promise<HomeworkMaterialRecord | undefined>;
  softDeleteMaterial(id: string, deletedAt: string): Promise<HomeworkMaterialRecord | undefined>;
  listMaterialFiles(materialId: string): Promise<HomeworkMaterialFileRecord[]>;
  findMaterialFileById(id: string): Promise<HomeworkMaterialFileRecord | undefined>;
  createMaterialFile(input: Omit<HomeworkMaterialFileRecord, "id">): Promise<HomeworkMaterialFileRecord>;
  listMaterialAssignments(materialId: string): Promise<HomeworkMaterialAssignmentRecord[]>;
  listAllMaterialAssignments(): Promise<HomeworkMaterialAssignmentRecord[]>;
  createMaterialAssignment(
    input: Omit<HomeworkMaterialAssignmentRecord, "id">,
  ): Promise<HomeworkMaterialAssignmentRecord>;
  list(): Promise<HomeworkRecord[]>;
  findById(id: string): Promise<HomeworkRecord | undefined>;
  create(input: Omit<HomeworkRecord, "id">): Promise<HomeworkRecord>;
  update(id: string, input: Partial<Pick<HomeworkRecord, "classId" | "title" | "description" | "dueAt">>): Promise<HomeworkRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<HomeworkRecord | undefined>;
  updateCheckStatus(id: string, checkedAt: string | undefined, checkedBy: string | undefined): Promise<HomeworkRecord | undefined>;
  listSubmissions(homeworkId: string): Promise<HomeworkSubmissionRow[]>;
  listSubmissionsByStudent(studentId: string): Promise<HomeworkSubmissionRow[]>;
  /** Lazily creates the row; returns undefined when the row is already checked (DEC-20261004-10). */
  markSubmitted(input: SubmissionKey & { submittedAt: string }): Promise<HomeworkSubmissionRow | undefined>;
  /** Checks existing submitted rows only (never creates rows); already checked rows keep their first check. */
  markChecked(input: Omit<SubmissionKey, "studentId"> & { studentIds: string[]; checkedAt: string; checkedById: string }): Promise<HomeworkSubmissionRow[]>;
}

interface SubmissionKey {
  tenantId: string;
  homeworkId: string;
  studentId: string;
}

export const homeworkStoreToken = Symbol("HomeworkStore");

const demoMaterials: HomeworkMaterialRecord[] = [
  {
    id: "material-a",
    tenantId: "tenant-a",
    title: "Kesirler Çalışma Kağıdı",
    description: "Kesirlerle dört işlem alıştırmaları",
  },
  {
    id: "material-b",
    tenantId: "tenant-b",
    title: "Paragraf Etkinliği",
    description: "Ana fikir ve yardımcı fikir çalışması",
  },
];

const demoHomework: HomeworkRecord[] = [
  {
    id: "homework-a",
    tenantId: "tenant-a",
    classId: "class-a",
    title: "Kesirler",
    description: "1-20 arası sorular",
    dueAt: "2026-06-05T12:00:00.000Z",
  },
  {
    id: "homework-b",
    tenantId: "tenant-b",
    classId: "class-b",
    title: "Paragraf",
    dueAt: "2026-06-05T12:00:00.000Z",
  },
];

const demoMaterialFiles: HomeworkMaterialFileRecord[] = [
  {
    id: "material-file-a",
    tenantId: "tenant-a",
    materialId: "material-a",
    uploadedById: "user-tenant-a",
    fileName: "kesirler.txt",
    contentType: "text/plain",
    byteSize: 11,
    sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
    contentBase64: "aGVsbG8gd29ybGQ=",
    createdAt: "2026-06-08T09:10:00.000Z",
  },
  {
    id: "material-file-b",
    tenantId: "tenant-b",
    materialId: "material-b",
    uploadedById: "user-tenant-b",
    fileName: "paragraf.txt",
    contentType: "text/plain",
    byteSize: 8,
    sha256: "f2f66cde996a5f060a22979f9c35a9d4a43aca5c7e94cbb08b5a89e58e6684c8",
    contentBase64: "dGVuYW50LWI=",
    createdAt: "2026-06-08T09:10:00.000Z",
  },
];

const demoMaterialAssignments: HomeworkMaterialAssignmentRecord[] = [
  {
    id: "material-assignment-a",
    tenantId: "tenant-a",
    materialId: "material-a",
    studentId: "student-a",
    courseId: "course-math",
    termId: "term-2026-spring",
    assignedById: "user-tenant-a",
    note: "Bireysel tekrar",
    dueAt: "2026-06-09T12:00:00.000Z",
    createdAt: "2026-06-08T09:20:00.000Z",
  },
  {
    id: "material-assignment-b",
    tenantId: "tenant-b",
    materialId: "material-b",
    studentId: "student-b",
    courseId: "course-turkish",
    termId: "term-2026-spring",
    assignedById: "user-tenant-b",
    createdAt: "2026-06-08T09:20:00.000Z",
  },
];

export class InMemoryHomeworkStore implements HomeworkStore {
  private readonly materials = demoMaterials.map((record) => ({ ...record }));
  private readonly materialFiles = demoMaterialFiles.map((record) => ({ ...record }));
  private readonly materialAssignments = demoMaterialAssignments.map((record) => ({ ...record }));
  private readonly homework = demoHomework.map((record) => ({ ...record }));
  private readonly submissions: HomeworkSubmissionRow[] = [];

  async listMaterials(): Promise<HomeworkMaterialRecord[]> {
    return this.materials;
  }

  async findMaterialById(id: string): Promise<HomeworkMaterialRecord | undefined> {
    return this.materials.find((candidate) => candidate.id === id);
  }

  async createMaterial(input: Omit<HomeworkMaterialRecord, "id">): Promise<HomeworkMaterialRecord> {
    const record = {
      id: `material-${this.materials.length + 1}`,
      ...input,
    };
    this.materials.push(record);
    return record;
  }

  async updateMaterial(
    id: string,
    input: Pick<HomeworkMaterialRecord, "title" | "description">,
  ): Promise<HomeworkMaterialRecord | undefined> {
    const record = await this.findMaterialById(id);
    if (!record) return undefined;

    record.title = input.title;
    record.description = input.description;
    return record;
  }

  async softDeleteMaterial(id: string, deletedAt: string): Promise<HomeworkMaterialRecord | undefined> {
    const record = await this.findMaterialById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }

  async listMaterialFiles(materialId: string): Promise<HomeworkMaterialFileRecord[]> {
    return this.materialFiles.filter((candidate) => candidate.materialId === materialId).map(withoutMaterialFileContent);
  }

  async findMaterialFileById(id: string): Promise<HomeworkMaterialFileRecord | undefined> {
    return this.materialFiles.find((candidate) => candidate.id === id);
  }

  async createMaterialFile(input: Omit<HomeworkMaterialFileRecord, "id">): Promise<HomeworkMaterialFileRecord> {
    const record = {
      id: `material-file-${this.materialFiles.length + 1}`,
      ...input,
    };
    this.materialFiles.push(record);
    return withoutMaterialFileContent(record);
  }

  async listMaterialAssignments(materialId: string): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.materialAssignments.filter((candidate) => candidate.materialId === materialId);
  }

  async listAllMaterialAssignments(): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.materialAssignments;
  }

  async createMaterialAssignment(
    input: Omit<HomeworkMaterialAssignmentRecord, "id">,
  ): Promise<HomeworkMaterialAssignmentRecord> {
    const record = {
      id: `material-assignment-${this.materialAssignments.length + 1}`,
      ...input,
    };
    this.materialAssignments.push(record);
    return record;
  }

  async list(): Promise<HomeworkRecord[]> {
    return this.homework;
  }

  async findById(id: string): Promise<HomeworkRecord | undefined> {
    return this.homework.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<HomeworkRecord, "id">): Promise<HomeworkRecord> {
    const record = {
      id: `homework-${this.homework.length + 1}`,
      ...input,
    };
    this.homework.push(record);
    return record;
  }

  async update(
    id: string,
    input: Partial<Pick<HomeworkRecord, "classId" | "title" | "description" | "dueAt">>,
  ): Promise<HomeworkRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.classId !== undefined) record.classId = input.classId;
    if (input.title !== undefined) record.title = input.title;
    if (input.description !== undefined) record.description = input.description;
    if (input.dueAt !== undefined) record.dueAt = input.dueAt;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<HomeworkRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }

  async updateCheckStatus(
    id: string,
    checkedAt: string | undefined,
    checkedBy: string | undefined,
  ): Promise<HomeworkRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.checkedAt = checkedAt;
    record.checkedBy = checkedBy;
    return record;
  }

  async listSubmissions(homeworkId: string): Promise<HomeworkSubmissionRow[]> {
    return this.submissions.filter((row) => row.homeworkId === homeworkId);
  }

  async listSubmissionsByStudent(studentId: string): Promise<HomeworkSubmissionRow[]> {
    return this.submissions.filter((row) => row.studentId === studentId);
  }

  async markSubmitted(input: SubmissionKey & { submittedAt: string }): Promise<HomeworkSubmissionRow | undefined> {
    const row = this.findOrCreateSubmission(input);
    if (row.checkedAt) return undefined;
    row.submittedAt ??= input.submittedAt;
    return { ...row };
  }

  async markChecked(
    input: Omit<SubmissionKey, "studentId"> & { studentIds: string[]; checkedAt: string; checkedById: string },
  ): Promise<HomeworkSubmissionRow[]> {
    const rows = this.submissions.filter(
      (row) => row.tenantId === input.tenantId && row.homeworkId === input.homeworkId && input.studentIds.includes(row.studentId),
    );
    for (const row of rows) {
      if (row.submittedAt && !row.checkedAt) {
        row.checkedAt = input.checkedAt;
        row.checkedById = input.checkedById;
      }
    }
    return rows.map((row) => ({ ...row }));
  }

  private findOrCreateSubmission(key: SubmissionKey): HomeworkSubmissionRow {
    let row = this.submissions.find(
      (candidate) => candidate.tenantId === key.tenantId && candidate.homeworkId === key.homeworkId && candidate.studentId === key.studentId,
    );
    if (!row) {
      row = { id: `homework-submission-${this.submissions.length + 1}`, tenantId: key.tenantId, homeworkId: key.homeworkId, studentId: key.studentId };
      this.submissions.push(row);
    }
    return row;
  }
}

export class PostgresHomeworkStore implements HomeworkStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listMaterials(): Promise<HomeworkMaterialRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialRow>(`SELECT * FROM "HomeworkMaterial"`);
      return result.rows.map(toHomeworkMaterialRecord);
    });
  }

  async findMaterialById(id: string): Promise<HomeworkMaterialRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialRow>(`SELECT * FROM "HomeworkMaterial" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toHomeworkMaterialRecord(result.rows[0]) : undefined;
    });
  }

  async createMaterial(input: Omit<HomeworkMaterialRecord, "id">): Promise<HomeworkMaterialRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialRow>(
        `INSERT INTO "HomeworkMaterial" ("id", "tenantId", "title", "description", "updatedAt")
         VALUES ($1, $2, $3, $4, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.title, input.description ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("HOMEWORK_MATERIAL_CREATE_FAILED");
      }
      return toHomeworkMaterialRecord(record);
    });
  }

  async updateMaterial(
    id: string,
    input: Pick<HomeworkMaterialRecord, "title" | "description">,
  ): Promise<HomeworkMaterialRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialRow>(
        `UPDATE "HomeworkMaterial"
         SET "title" = $2,
             "description" = $3,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.title, input.description ?? null],
      );
      return result.rows[0] ? toHomeworkMaterialRecord(result.rows[0]) : undefined;
    });
  }

  async softDeleteMaterial(id: string, deletedAt: string): Promise<HomeworkMaterialRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialRow>(
        `UPDATE "HomeworkMaterial"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toHomeworkMaterialRecord(result.rows[0]) : undefined;
    });
  }

  async listMaterialFiles(materialId: string): Promise<HomeworkMaterialFileRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialFileRow>(
        `SELECT * FROM "HomeworkMaterialFile"
         WHERE "materialId" = $1
         ORDER BY "createdAt" DESC`,
        [materialId],
      );
      return result.rows.map(toHomeworkMaterialFileRecord).map(withoutMaterialFileContent);
    });
  }

  async findMaterialFileById(id: string): Promise<HomeworkMaterialFileRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialFileRow>(
        `SELECT * FROM "HomeworkMaterialFile"
         WHERE "id" = $1
         LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toHomeworkMaterialFileRecord(result.rows[0]) : undefined;
    });
  }

  async createMaterialFile(input: Omit<HomeworkMaterialFileRecord, "id">): Promise<HomeworkMaterialFileRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialFileRow>(
        `INSERT INTO "HomeworkMaterialFile" ("id", "tenantId", "materialId", "uploadedById", "fileName", "contentType", "byteSize", "sha256", "contentBase64", "storageKey", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.materialId,
          input.uploadedById ?? null,
          input.fileName,
          input.contentType,
          input.byteSize,
          input.sha256,
          input.contentBase64 ?? null,
          input.storageKey ?? null,
          input.createdAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("HOMEWORK_MATERIAL_FILE_CREATE_FAILED");
      }
      return withoutMaterialFileContent(toHomeworkMaterialFileRecord(record));
    });
  }

  async listMaterialAssignments(materialId: string): Promise<HomeworkMaterialAssignmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialAssignmentRow>(
        `SELECT * FROM "HomeworkMaterialAssignment"
         WHERE "materialId" = $1
         ORDER BY "createdAt" DESC`,
        [materialId],
      );
      return result.rows.map(toHomeworkMaterialAssignmentRecord);
    });
  }

  async listAllMaterialAssignments(): Promise<HomeworkMaterialAssignmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialAssignmentRow>(
        `SELECT * FROM "HomeworkMaterialAssignment" ORDER BY "createdAt" DESC`,
      );
      return result.rows.map(toHomeworkMaterialAssignmentRecord);
    });
  }

  async createMaterialAssignment(
    input: Omit<HomeworkMaterialAssignmentRecord, "id">,
  ): Promise<HomeworkMaterialAssignmentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkMaterialAssignmentRow>(
        `INSERT INTO "HomeworkMaterialAssignment" ("id", "tenantId", "materialId", "studentId", "courseId", "termId", "assignedById", "note", "dueAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.materialId,
          input.studentId,
          input.courseId ?? null,
          input.termId ?? null,
          input.assignedById ?? null,
          input.note ?? null,
          input.dueAt ?? null,
          input.createdAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("HOMEWORK_MATERIAL_ASSIGNMENT_CREATE_FAILED");
      }
      return toHomeworkMaterialAssignmentRecord(record);
    });
  }

  async list(): Promise<HomeworkRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkRow>(`SELECT * FROM "Homework"`);
      return result.rows.map(toHomeworkRecord);
    });
  }

  async findById(id: string): Promise<HomeworkRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkRow>(`SELECT * FROM "Homework" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toHomeworkRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<HomeworkRecord, "id">): Promise<HomeworkRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkRow>(
        `INSERT INTO "Homework" ("id", "tenantId", "classId", "sourceMaterialId", "sourceMaterialTitle", "title", "description", "dueAt", "checkedAt", "checkedById", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.classId,
          input.sourceMaterialId ?? null,
          input.sourceMaterialTitle ?? null,
          input.title,
          input.description ?? null,
          input.dueAt ?? null,
          input.checkedAt ?? null,
          input.checkedBy ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("HOMEWORK_CREATE_FAILED");
      }
      return toHomeworkRecord(record);
    });
  }

  async update(
    id: string,
    input: Partial<Pick<HomeworkRecord, "classId" | "title" | "description" | "dueAt">>,
  ): Promise<HomeworkRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkRow>(
        `UPDATE "Homework"
         SET "classId" = COALESCE($2, "classId"),
             "title" = COALESCE($3, "title"),
             "description" = CASE WHEN $4 THEN $5 ELSE "description" END,
             "dueAt" = CASE WHEN $6 THEN $7 ELSE "dueAt" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [
          id,
          input.classId ?? null,
          input.title ?? null,
          input.description !== undefined,
          input.description ?? null,
          input.dueAt !== undefined,
          input.dueAt ?? null,
        ],
      );
      return result.rows[0] ? toHomeworkRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<HomeworkRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkRow>(
        `UPDATE "Homework"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toHomeworkRecord(result.rows[0]) : undefined;
    });
  }

  async updateCheckStatus(
    id: string,
    checkedAt: string | undefined,
    checkedBy: string | undefined,
  ): Promise<HomeworkRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkRow>(
        `UPDATE "Homework"
         SET "checkedAt" = $2,
             "checkedById" = $3,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, checkedAt ?? null, checkedBy ?? null],
      );
      return result.rows[0] ? toHomeworkRecord(result.rows[0]) : undefined;
    });
  }

  async listSubmissions(homeworkId: string): Promise<HomeworkSubmissionRow[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkSubmissionDbRow>(`SELECT * FROM "HomeworkSubmission" WHERE "homeworkId" = $1`, [homeworkId]);
      return result.rows.map(toHomeworkSubmissionRow);
    });
  }

  async listSubmissionsByStudent(studentId: string): Promise<HomeworkSubmissionRow[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<HomeworkSubmissionDbRow>(`SELECT * FROM "HomeworkSubmission" WHERE "studentId" = $1`, [studentId]);
      return result.rows.map(toHomeworkSubmissionRow);
    });
  }

  async markSubmitted(input: SubmissionKey & { submittedAt: string }): Promise<HomeworkSubmissionRow | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      // 0 rows back means the conflicting row is already checked: the caller answers 409.
      const result = await client.query<HomeworkSubmissionDbRow>(
        `INSERT INTO "HomeworkSubmission" ("id", "tenantId", "homeworkId", "studentId", "submittedAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT ("tenantId", "homeworkId", "studentId") DO UPDATE
           SET "submittedAt" = COALESCE("HomeworkSubmission"."submittedAt", EXCLUDED."submittedAt"),
               "updatedAt" = now()
           WHERE "HomeworkSubmission"."checkedAt" IS NULL
         RETURNING *`,
        [randomUUID(), input.tenantId, input.homeworkId, input.studentId, input.submittedAt],
      );
      return result.rows[0] ? toHomeworkSubmissionRow(result.rows[0]) : undefined;
    });
  }

  async markChecked(
    input: Omit<SubmissionKey, "studentId"> & { studentIds: string[]; checkedAt: string; checkedById: string },
  ): Promise<HomeworkSubmissionRow[]> {
    return withTenantQuery(this.pool, async (client) => {
      await client.query(
        `UPDATE "HomeworkSubmission"
         SET "checkedAt" = $4, "checkedById" = $5, "updatedAt" = now()
         WHERE "tenantId" = $1 AND "homeworkId" = $2 AND "studentId" = ANY($3::text[])
           AND "submittedAt" IS NOT NULL AND "checkedAt" IS NULL`,
        [input.tenantId, input.homeworkId, input.studentIds, input.checkedAt, input.checkedById],
      );
      const result = await client.query<HomeworkSubmissionDbRow>(
        `SELECT * FROM "HomeworkSubmission" WHERE "homeworkId" = $1 AND "studentId" = ANY($2::text[])`,
        [input.homeworkId, input.studentIds],
      );
      return result.rows.map(toHomeworkSubmissionRow);
    });
  }
}

export function createHomeworkStore(): HomeworkStore {
  return resolvePersistenceDriver(process.env.HOMEWORK_STORE) === "postgres" ? new PostgresHomeworkStore() : new InMemoryHomeworkStore();
}

interface HomeworkMaterialRow {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  deletedAt: Date | null;
}

interface HomeworkMaterialFileRow {
  id: string;
  tenantId: string;
  materialId: string;
  uploadedById: string | null;
  fileName: string;
  contentType: HomeworkMaterialFileRecord["contentType"];
  byteSize: number;
  sha256: string;
  contentBase64: string | null;
  storageKey: string | null;
  createdAt: Date | string;
  deletedAt: Date | string | null;
}

interface HomeworkMaterialAssignmentRow {
  id: string;
  tenantId: string;
  materialId: string;
  studentId: string;
  courseId: string | null;
  termId: string | null;
  assignedById: string | null;
  note: string | null;
  dueAt: Date | string | null;
  createdAt: Date | string;
  deletedAt: Date | string | null;
}

interface HomeworkRow {
  id: string;
  tenantId: string;
  classId: string;
  sourceMaterialId: string | null;
  sourceMaterialTitle: string | null;
  title: string;
  description: string | null;
  dueAt: Date | null;
  checkedAt: Date | null;
  checkedById: string | null;
  deletedAt: Date | null;
}

function toHomeworkMaterialRecord(record: HomeworkMaterialRow): HomeworkMaterialRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    title: record.title,
    description: record.description ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}

function toHomeworkMaterialFileRecord(record: HomeworkMaterialFileRow): HomeworkMaterialFileRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    materialId: record.materialId,
    uploadedById: record.uploadedById ?? undefined,
    fileName: record.fileName,
    contentType: record.contentType,
    byteSize: record.byteSize,
    sha256: record.sha256,
    contentBase64: record.contentBase64 ?? undefined,
    storageKey: record.storageKey ?? undefined,
    createdAt: toIsoString(record.createdAt),
    deletedAt: record.deletedAt ? toIsoString(record.deletedAt) : undefined,
  };
}

function toHomeworkMaterialAssignmentRecord(record: HomeworkMaterialAssignmentRow): HomeworkMaterialAssignmentRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    materialId: record.materialId,
    studentId: record.studentId,
    courseId: record.courseId ?? undefined,
    termId: record.termId ?? undefined,
    assignedById: record.assignedById ?? undefined,
    note: record.note ?? undefined,
    dueAt: record.dueAt ? toIsoString(record.dueAt) : undefined,
    createdAt: toIsoString(record.createdAt),
    deletedAt: record.deletedAt ? toIsoString(record.deletedAt) : undefined,
  };
}

function toHomeworkRecord(record: HomeworkRow): HomeworkRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    classId: record.classId,
    sourceMaterialId: record.sourceMaterialId ?? undefined,
    sourceMaterialTitle: record.sourceMaterialTitle ?? undefined,
    title: record.title,
    description: record.description ?? undefined,
    dueAt: record.dueAt?.toISOString(),
    checkedAt: record.checkedAt?.toISOString(),
    checkedBy: record.checkedById ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}

interface HomeworkSubmissionDbRow {
  id: string;
  tenantId: string;
  homeworkId: string;
  studentId: string;
  submittedAt: Date | null;
  checkedAt: Date | null;
  checkedById: string | null;
}

function toHomeworkSubmissionRow(record: HomeworkSubmissionDbRow): HomeworkSubmissionRow {
  return {
    id: record.id,
    tenantId: record.tenantId,
    homeworkId: record.homeworkId,
    studentId: record.studentId,
    submittedAt: record.submittedAt?.toISOString(),
    checkedAt: record.checkedAt?.toISOString(),
    checkedById: record.checkedById ?? undefined,
  };
}

function withoutMaterialFileContent(record: HomeworkMaterialFileRecord): HomeworkMaterialFileRecord {
  const { contentBase64: _contentBase64, storageKey: _storageKey, ...publicRecord } = record;
  return publicRecord;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
