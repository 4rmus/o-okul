import { randomUUID } from "node:crypto";
import type { ClassRecord as SharedClassRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { StudentEnrollmentStore } from "../student/student-enrollment-store.js";
import type { StudentStore } from "../student/student-store.js";

export interface ClassRecord extends SharedClassRecord {
  deletedAt?: string;
}

type ClassUpdateInput = Partial<Pick<ClassRecord, "name" | "alanId" | "campusId" | "gradeLevelId" | "section">>;
type ClassGradeLevelCascade = (classId: string, gradeLevelId: string | undefined) => Promise<{
  studentsUpdated: number;
  enrollmentsUpdated: number;
}>;

export interface ClassGradeLevelCascadeResult {
  record: ClassRecord;
  studentsUpdated: number;
  enrollmentsUpdated: number;
}

export interface ClassStore {
  list(): Promise<ClassRecord[]>;
  findById(id: string): Promise<ClassRecord | undefined>;
  create(input: Omit<ClassRecord, "id">): Promise<ClassRecord>;
  update(id: string, input: ClassUpdateInput): Promise<ClassRecord | undefined>;
  updateWithGradeLevelCascade(id: string, input: ClassUpdateInput): Promise<ClassGradeLevelCascadeResult | undefined>;
  softDelete(id: string, deletedAt: string): Promise<ClassRecord | undefined>;
}

export const classStoreToken = Symbol("ClassStore");
export const activeClassNameUniqueConstraint = "Class_tenantId_active_name_key";

export function normalizeClassName(value: string): string {
  return value.replace(/\s/gu, "").toLocaleLowerCase("tr-TR");
}

const demoClasses: ClassRecord[] = [
  { id: "class-a", tenantId: "tenant-a", name: "8-A", campusId: "campus-main", gradeLevelId: "grade-8", section: "A" },
  { id: "class-b", tenantId: "tenant-b", name: "7-B", gradeLevelId: "grade-7", section: "B" },
];

export class InMemoryClassStore implements ClassStore {
  private readonly classes = demoClasses.map((record) => ({ ...record }));

  constructor(private readonly cascadeGradeLevel?: ClassGradeLevelCascade) {}

  async list(): Promise<ClassRecord[]> {
    return this.classes;
  }

  async findById(id: string): Promise<ClassRecord | undefined> {
    return this.classes.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<ClassRecord, "id">): Promise<ClassRecord> {
    this.assertActiveNameAvailable(input.tenantId, input.name);
    const record = {
      id: `class-${this.classes.length + 1}`,
      ...input,
      name: input.name.trim(),
    };
    this.classes.push(record);
    return record;
  }

  async update(id: string, input: ClassUpdateInput): Promise<ClassRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.name !== undefined) {
      this.assertActiveNameAvailable(record.tenantId, input.name, id);
      record.name = input.name.trim();
    }
    if (input.alanId !== undefined) record.alanId = input.alanId;
    if (input.campusId !== undefined) record.campusId = input.campusId;
    if (input.gradeLevelId !== undefined) record.gradeLevelId = input.gradeLevelId || undefined;
    if (input.section !== undefined) record.section = input.section;
    return record;
  }

  async updateWithGradeLevelCascade(id: string, input: ClassUpdateInput): Promise<ClassGradeLevelCascadeResult | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;
    if (input.name !== undefined) this.assertActiveNameAvailable(existing.tenantId, input.name, id);
    const cascade = input.gradeLevelId !== undefined && input.gradeLevelId !== existing.gradeLevelId
      ? await this.cascadeGradeLevel?.(id, input.gradeLevelId || undefined)
      : undefined;
    const record = await this.update(id, input);
    return record ? {
      record,
      studentsUpdated: cascade?.studentsUpdated ?? 0,
      enrollmentsUpdated: cascade?.enrollmentsUpdated ?? 0,
    } : undefined;
  }

  async softDelete(id: string, deletedAt: string): Promise<ClassRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }

  private assertActiveNameAvailable(tenantId: string, name: string, excludedId?: string): void {
    const nameKey = normalizeClassName(name);
    if (this.classes.some((record) =>
      record.id !== excludedId
      && record.tenantId === tenantId
      && !record.deletedAt
      && normalizeClassName(record.name) === nameKey)) {
      throw Object.assign(new Error("CLASS_NAME_ALREADY_EXISTS"), {
        code: "23505",
        constraint: activeClassNameUniqueConstraint,
      });
    }
  }
}

export class PostgresClassStore implements ClassStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<ClassRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(`SELECT * FROM "Class"`);
      return result.rows.map(toClassRecord);
    });
  }

  async findById(id: string): Promise<ClassRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(`SELECT * FROM "Class" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toClassRecord(result.rows[0]) : undefined;
    });
  }

  async updateWithGradeLevelCascade(id: string, input: ClassUpdateInput): Promise<ClassGradeLevelCascadeResult | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const locked = await client.query<ClassRow>(
        `SELECT * FROM "Class" WHERE "id" = $1 FOR UPDATE`,
        [id],
      );
      const existing = locked.rows[0];
      if (!existing) return undefined;

      if (input.gradeLevelId !== undefined && !input.gradeLevelId) {
        const linked = await client.query<{ count: number | string }>(
          `SELECT COUNT(*)::int AS count FROM "Student" WHERE "classId" = $1`,
          [id],
        );
        if (Number(linked.rows[0]?.count ?? 0) > 0) {
          throw new Error("CLASS_GRADE_LEVEL_REQUIRED_FOR_STUDENTS");
        }
      }

      const result = await client.query<ClassRow>(
        `UPDATE "Class"
         SET "name" = COALESCE($2, "name"),
             "alanId" = CASE WHEN $3 THEN $4 ELSE "alanId" END,
             "campusId" = CASE WHEN $5 THEN $6 ELSE "campusId" END,
             "gradeLevelId" = CASE WHEN $7 THEN $8 ELSE "gradeLevelId" END,
             "section" = CASE WHEN $9 THEN $10 ELSE "section" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        classUpdateValues(id, input),
      );
      const record = result.rows[0];
      if (!record) return undefined;

      let studentsUpdated = 0;
      let enrollmentsUpdated = 0;
      if (input.gradeLevelId !== undefined && input.gradeLevelId !== existing.gradeLevelId) {
        const students = await client.query<{ id: string }>(
          `UPDATE "Student"
           SET "gradeLevelId" = $2,
               "updatedAt" = now()
           WHERE "classId" = $1
           RETURNING "id"`,
          [id, input.gradeLevelId || null],
        );
        const enrollments = await client.query<{ id: string }>(
          `UPDATE "StudentEnrollment"
           SET "gradeLevelId" = $2,
               "updatedAt" = now()
           WHERE "classId" = $1
             AND "status" = 'ACTIVE'
             AND "endsAt" IS NULL
           RETURNING "id"`,
          [id, input.gradeLevelId || null],
        );
        studentsUpdated = students.rows.length;
        enrollmentsUpdated = enrollments.rows.length;
      }

      return { record: toClassRecord(record), studentsUpdated, enrollmentsUpdated };
    });
  }

  async create(input: Omit<ClassRecord, "id">): Promise<ClassRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(
        `INSERT INTO "Class" ("id", "tenantId", "alanId", "campusId", "gradeLevelId", "name", "section", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.alanId ?? null,
          input.campusId ?? null,
          input.gradeLevelId || null,
          input.name.trim(),
          input.section ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("CLASS_CREATE_FAILED");
      }
      return toClassRecord(record);
    });
  }

  async update(id: string, input: ClassUpdateInput): Promise<ClassRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(
        `UPDATE "Class"
         SET "name" = COALESCE($2, "name"),
             "alanId" = CASE WHEN $3 THEN $4 ELSE "alanId" END,
             "campusId" = CASE WHEN $5 THEN $6 ELSE "campusId" END,
             "gradeLevelId" = CASE WHEN $7 THEN $8 ELSE "gradeLevelId" END,
             "section" = CASE WHEN $9 THEN $10 ELSE "section" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [
          id,
          input.name?.trim() ?? null,
          input.alanId !== undefined,
          input.alanId ?? null,
          input.campusId !== undefined,
          input.campusId ?? null,
          input.gradeLevelId !== undefined,
          input.gradeLevelId || null,
          input.section !== undefined,
          input.section ?? null,
        ],
      );
      return result.rows[0] ? toClassRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<ClassRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(
        `UPDATE "Class"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toClassRecord(result.rows[0]) : undefined;
    });
  }
}

export function createClassStore(
  studentStore?: StudentStore,
  enrollmentStore?: StudentEnrollmentStore,
): ClassStore {
  if (resolvePersistenceDriver(process.env.CLASS_STORE) === "postgres") return new PostgresClassStore();
  const cascadeGradeLevel = studentStore && enrollmentStore
    ? async (classId: string, gradeLevelId: string | undefined) => {
        const linkedStudents = (await studentStore.list()).filter((student) => student.classId === classId);
        if (!gradeLevelId && linkedStudents.length > 0) throw new Error("CLASS_GRADE_LEVEL_REQUIRED_FOR_STUDENTS");
        const [studentsUpdated, enrollmentsUpdated] = await Promise.all([
          studentStore.updateGradeLevelForClass(classId, gradeLevelId),
          enrollmentStore.updateOpenGradeLevelForClass(classId, gradeLevelId),
        ]);
        return { studentsUpdated, enrollmentsUpdated };
      }
    : undefined;
  return new InMemoryClassStore(cascadeGradeLevel);
}

interface ClassRow {
  id: string;
  tenantId: string;
  alanId: string | null;
  campusId: string | null;
  gradeLevelId: string | null;
  name: string;
  section: string | null;
  deletedAt: Date | null;
}

function classUpdateValues(id: string, input: ClassUpdateInput): unknown[] {
  return [
    id,
    input.name?.trim() ?? null,
    input.alanId !== undefined,
    input.alanId ?? null,
    input.campusId !== undefined,
    input.campusId ?? null,
    input.gradeLevelId !== undefined,
    input.gradeLevelId || null,
    input.section !== undefined,
    input.section ?? null,
  ];
}

function toClassRecord(record: ClassRow): ClassRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    alanId: record.alanId ?? undefined,
    campusId: record.campusId ?? undefined,
    gradeLevelId: record.gradeLevelId ?? undefined,
    name: record.name,
    section: record.section ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}
