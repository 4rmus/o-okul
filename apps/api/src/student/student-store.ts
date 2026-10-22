import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { getRequestContext } from "../context/request-context.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery, withTenantQuery } from "../db/tenant-query.js";
import type { StudentRecord } from "./student.service.js";
import type {
  ApiCursorListMeta,
  StudentEnrollmentRecord,
  StudentListSort,
  StudentPortalAccessRecord,
  StudentPortalAccessUpdateRequest,
  StudentPortalAccessUpdateResult,
} from "@o-okul/shared-types";
import type { StudentEnrollmentInput } from "./student-enrollment-store.js";
import type { StudentContactStoreInput } from "./student-contact-store.js";
import {
  type CursorPage,
  type CursorSortDirection,
  cursorKeysetCondition,
  cursorPageFromRows,
  cursorQueryOrder,
  decodeListCursor,
  foldSearchText,
  foldedSearchSql,
  likeSearchPattern,
  listCursorContext,
  normalizeSearchTerm,
  paginateCursorRecords,
} from "../listing/cursor-pagination.js";

type StudentInput = Omit<StudentRecord, "id" | "status"> & Partial<Pick<StudentRecord, "status" | "studentNo">>;
/** A bulk-created student with the profile columns written in the same insert (no post-commit profile update). */
export type StudentCreateManyInput = StudentInput & Pick<StudentProfileUpdate, "nationalIdEncrypted" | "nationalIdHash" | "phone" | "email">;
const studentNoStart = 100;
/** Rows per multi-row INSERT; every unnest() array parameter stays at or below this length. */
export const studentImportBatchChunkSize = 1000;

export interface StudentProfileStorageRecord extends StudentRecord {
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
}

export type StudentProfileUpdate = {
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
};

export interface StudentPortalAccessQuery {
  cursor?: string;
  direction: "next" | "previous";
  limit: number;
  q?: string;
  studentIds?: string[];
}

export interface StudentPortalAccessPage {
  records: StudentPortalAccessRecord[];
  meta: ApiCursorListMeta;
}

export const studentCursorInvalid = "STUDENT_CURSOR_INVALID";

export interface StudentRegistryQuery {
  cursor?: string;
  direction: "next" | "previous";
  limit: number;
  q?: string;
  sort: StudentListSort;
  ids?: string[];
  gradeLevelId?: string;
  /** The requested class filter, bound to the cursor; `classIds` is the derived scope the query applies. */
  classId?: string;
  classIds?: string[];
  responsibleTeacherId?: string;
  status?: StudentRecord["status"];
  hasContact?: boolean;
  campusIds?: string[];
  teacherId?: string;
  teacherStudentIds?: string[];
  teacherClassIds?: string[];
}

/** Cursor page of the student registry; `meta.total` is the filtered count shown on the list screen. */
export type StudentRegistryPage = CursorPage<StudentRecord>;

export interface StudentPortalSuspensionResult {
  userId?: string;
  membershipSuspended: boolean;
  sessionsRevoked: number;
  invitationsRevoked: number;
}

export interface StudentEnrollmentTransition {
  closeActive?: { endsAt: string; status?: StudentRecord["status"] };
  create?: Omit<StudentEnrollmentInput, "tenantId" | "studentId">;
  suspendPortalAccess?: { reason: string };
}

export interface StudentEnrollmentTransitionResult {
  student: StudentRecord;
  enrollment?: StudentEnrollmentRecord;
  portalAccess?: StudentPortalSuspensionResult;
}

/** Sentinel error messages thrown by `importBatch`; the service maps them to HTTP exceptions. */
export const studentImportBatchErrors = {
  classNotFound: "CLASS_NOT_FOUND",
  classGradeLevelMismatch: "STUDENT_CLASS_GRADE_LEVEL_MISMATCH",
  campusScopeForbidden: "STUDENT_CAMPUS_SCOPE_FORBIDDEN",
  activeStudentLimitReached: "ACTIVE_STUDENT_LIMIT_REACHED",
  nationalIdConflict: "STUDENT_NATIONAL_ID_CONFLICT",
  studentNoConflict: "STUDENT_NO_CONFLICT",
} as const;

export interface StudentImportBatchRow {
  /** Pre-generated so contacts, enrollments and audits can reference the student inside the same statement batch. */
  id: string;
  student: StudentCreateManyInput;
  enrollment?: Omit<StudentEnrollmentInput, "tenantId" | "studentId">;
  contact?: StudentContactStoreInput;
}

export interface StudentImportBatchAudit {
  entityType: string;
  entityId?: string;
  action: string;
  /** Already passed through `sanitizeAuditDiff`. */
  diff?: Record<string, unknown>;
}

export interface StudentImportBatchInput {
  tenantId: string;
  actorUserId?: string;
  rows: StudentImportBatchRow[];
  audits: StudentImportBatchAudit[];
  auditCreatedAt: string;
  /** Licensed active-student limit; checked again under the tenant student-number lock. */
  activeStudentLimit: number;
  /** Set for campus-restricted callers: every row needs a class on one of these campuses. */
  campusIds?: string[];
  /** Runs on the open transaction after every insert, e.g. to complete the idempotency key atomically. */
  finalize?: (client: Queryable, students: StudentRecord[]) => Promise<void>;
}

export interface StudentStore {
  list(): Promise<StudentRecord[]>;
  listRegistryPage(tenantId: string, query: StudentRegistryQuery): Promise<StudentRegistryPage>;
  /** Trimmed exact match against active (not soft-deleted) students; returns the matching trimmed numbers. */
  findExistingStudentNos(tenantId: string, studentNos: string[]): Promise<string[]>;
  /**
   * Returns the hashes already stored for the tenant. `includeDeleted` mirrors `Student_tenantId_nationalIdHash_key`,
   * which also covers soft-deleted rows.
   */
  findExistingNationalIdHashes(tenantId: string, nationalIdHashes: string[], options?: { includeDeleted?: boolean }): Promise<string[]>;
  /** Same rule as `o_okul_refresh_license_usage`: ACTIVE, not deleted, exactly one open ACTIVE enrollment. */
  countLicensedActiveStudents?(tenantId: string): Promise<number>;
  listPortalAccess(tenantId: string, query: StudentPortalAccessQuery): Promise<StudentPortalAccessPage>;
  updatePortalAccess(
    tenantId: string,
    id: string,
    input: StudentPortalAccessUpdateRequest,
  ): Promise<StudentPortalAccessUpdateResult | undefined>;
  findById(id: string): Promise<StudentRecord | undefined>;
  /** Pass tenantId when there is no request tenant (unauthenticated invitation accept). */
  findProfileById(id: string, tenantId?: string): Promise<StudentProfileStorageRecord | undefined>;
  findByUserId(tenantId: string, userId: string): Promise<StudentRecord | undefined>;
  findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<StudentProfileStorageRecord | undefined>;
  updateGradeLevelForClass(classId: string, gradeLevelId: string | undefined): Promise<number>;
  create(input: StudentInput): Promise<StudentRecord>;
  createMany(inputs: StudentCreateManyInput[]): Promise<StudentRecord[]>;
  createWithEnrollment?(
    input: StudentInput,
    enrollment: Omit<StudentEnrollmentInput, "tenantId" | "studentId">,
  ): Promise<StudentRecord>;
  /**
   * DEC-20261021-02: writes students (with profile PII), enrollments, contacts and audits in one tenant transaction
   * with set-based statements; returns the students in input order. Throws `studentImportBatchErrors` sentinels.
   */
  importBatch?(input: StudentImportBatchInput): Promise<StudentRecord[]>;
  updateWithEnrollmentTransition?(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "gradeLevelId" | "classId" | "responsibleTeacherId" | "status">>,
    transition: StudentEnrollmentTransition,
  ): Promise<StudentEnrollmentTransitionResult | undefined>;
  update(id: string, input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "gradeLevelId" | "classId" | "responsibleTeacherId" | "status">>): Promise<StudentRecord | undefined>;
  updateProfile(id: string, input: StudentProfileUpdate): Promise<StudentProfileStorageRecord | undefined>;
  bindUser(tenantId: string, id: string, userId: string): Promise<StudentRecord | undefined>;
  /** Clears the account link only while it still points at userId (invitation accept rollback). */
  unbindUser(tenantId: string, id: string, userId: string): Promise<boolean>;
  softDelete(id: string, deletedAt: string): Promise<StudentRecord | undefined>;
  purgePii(id: string): Promise<StudentRecord | undefined>;
  updateTenant(id: string, tenantId: string): Promise<StudentRecord | undefined>;
}

export const studentStoreToken = Symbol("StudentStore");

const demoStudents: StudentProfileStorageRecord[] = [
  {
    id: "student-a",
    tenantId: "tenant-a",
    firstName: "Ada",
    lastName: "A",
    studentNo: "100",
    userId: "student-tenant-a",
    gradeLevelId: "grade-8",
    classId: "class-a",
    responsibleTeacherId: "teacher-a",
    status: "ACTIVE",
  },
  { id: "student-b", tenantId: "tenant-b", firstName: "Bora", lastName: "B", studentNo: "100", status: "ACTIVE" },
];

interface InMemoryStudentPortalMembership {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  version: number;
  accountStatus: string;
}

export class InMemoryStudentStore implements StudentStore {
  private readonly students = demoStudents.map((record) => ({ ...record }));
  private readonly portalMemberships = new Map<string, InMemoryStudentPortalMembership>(
    demoStudents
      .filter((student): student is StudentProfileStorageRecord & { userId: string } => Boolean(student.userId))
      .map((student) => [student.id, {
        id: `membership-${student.id}`,
        status: "ACTIVE",
        version: 1,
        accountStatus: "ACTIVE",
      }]),
  );

  async list(): Promise<StudentRecord[]> {
    return this.students.filter((student) => !student.deletedAt);
  }

  async listRegistryPage(tenantId: string, query: StudentRegistryQuery): Promise<StudentRegistryPage> {
    const normalizedQuery = normalizeSearchTerm(query.q);
    const sort = studentRegistrySortDefinition(query.sort);
    const records = this.students
      .filter((student) => student.tenantId === tenantId && !student.deletedAt)
      .filter((student) => !query.ids || query.ids.includes(student.id))
      .filter((student) => !query.gradeLevelId || student.gradeLevelId === query.gradeLevelId)
      .filter((student) => !query.classIds || Boolean(student.classId && query.classIds.includes(student.classId)))
      .filter((student) => !query.responsibleTeacherId || student.responsibleTeacherId === query.responsibleTeacherId)
      .filter((student) => !query.status || student.status === query.status)
      .filter((student) => query.hasContact === undefined || query.hasContact === false)
      .filter((student) => !query.teacherId || student.responsibleTeacherId === query.teacherId
        || Boolean(query.teacherStudentIds?.includes(student.id))
        || Boolean(student.classId && query.teacherClassIds?.includes(student.classId)))
      .filter((student) => !normalizedQuery || foldSearchText(`${student.firstName} ${student.lastName} ${student.studentNo ?? ""}`).includes(normalizedQuery));
    return paginateCursorRecords(
      records,
      query,
      studentRegistryCursorContext(tenantId, query),
      (record) => ({ key: sort.keyOf(record), id: record.id }),
      sort.direction,
      studentCursorInvalid,
      { total: records.length },
    );
  }

  async findExistingStudentNos(tenantId: string, studentNos: string[]): Promise<string[]> {
    const wanted = new Set(studentNos);
    return [...new Set(this.students
      .filter((student) => student.tenantId === tenantId && !student.deletedAt && Boolean(student.studentNo))
      .map((student) => student.studentNo!.trim())
      .filter((studentNo) => wanted.has(studentNo)))];
  }

  async findExistingNationalIdHashes(
    tenantId: string,
    nationalIdHashes: string[],
    options: { includeDeleted?: boolean } = {},
  ): Promise<string[]> {
    const wanted = new Set(nationalIdHashes);
    return [...new Set(this.students
      .filter((student) => student.tenantId === tenantId && (options.includeDeleted || !student.deletedAt))
      .map((student) => student.nationalIdHash)
      .filter((hash): hash is string => Boolean(hash && wanted.has(hash))))];
  }

  async listPortalAccess(tenantId: string, query: StudentPortalAccessQuery): Promise<StudentPortalAccessPage> {
    const normalizedQuery = normalizeSearchTerm(query.q);
    const records = this.students
      .filter((student) => student.tenantId === tenantId && !student.deletedAt)
      .filter((student) => !query.studentIds || query.studentIds.includes(student.id))
      .filter((student) => !normalizedQuery || foldSearchText(`${student.firstName} ${student.lastName} ${student.studentNo}`).includes(normalizedQuery))
      .sort(compareStudentPortalRecords)
      .map((student) => toInMemoryStudentPortalAccessRecord(student, this.portalMemberships.get(student.id)));
    return paginateStudentPortalAccess(records, query);
  }

  async updatePortalAccess(
    tenantId: string,
    id: string,
    input: StudentPortalAccessUpdateRequest,
  ): Promise<StudentPortalAccessUpdateResult | undefined> {
    const student = this.students.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!student) return undefined;
    if (!student.userId) throw new Error("STUDENT_PORTAL_ACCOUNT_NOT_LINKED");
    if (input.status === "ACTIVE" && student.status !== "ACTIVE") throw new Error("STUDENT_PORTAL_PROFILE_NOT_ACTIVE");
    const membership = this.portalMemberships.get(student.id);
    if (!membership) throw new Error("STUDENT_PORTAL_ACCOUNT_NOT_LINKED");
    if (membership.version !== input.expectedVersion) throw new Error("STUDENT_PORTAL_VERSION_CONFLICT");

    if (membership.status !== input.status) {
      membership.status = input.status;
      membership.version += 1;
      membership.accountStatus = input.status === "ACTIVE" ? "ACTIVE" : "DISABLED";
    }
    return {
      studentId: student.id,
      tenantId: student.tenantId,
      userId: student.userId,
      accountStatus: membership.accountStatus,
      membership: { id: membership.id, status: membership.status, version: membership.version },
      sessionsRevoked: 0,
    };
  }

  async findById(id: string): Promise<StudentRecord | undefined> {
    return this.students.find((candidate) => candidate.id === id && !candidate.deletedAt);
  }

  async findProfileById(id: string): Promise<StudentProfileStorageRecord | undefined> {
    return this.students.find((candidate) => candidate.id === id && !candidate.deletedAt);
  }

  async findByUserId(tenantId: string, userId: string): Promise<StudentRecord | undefined> {
    return this.students.find((candidate) => candidate.tenantId === tenantId && candidate.userId === userId && !candidate.deletedAt);
  }

  async findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<StudentProfileStorageRecord | undefined> {
    return this.students.find((candidate) => candidate.tenantId === tenantId && candidate.nationalIdHash === nationalIdHash && !candidate.deletedAt);
  }

  async create(input: StudentInput): Promise<StudentRecord> {
    const studentNo = normalizeStudentNo(input.studentNo) ?? this.nextStudentNo(input.tenantId);
    const student = {
      id: `student-${this.students.length + 1}`,
      status: "ACTIVE" as const,
      ...input,
      studentNo,
    };
    this.students.push(student);
    return student;
  }

  async createMany(inputs: StudentCreateManyInput[]): Promise<StudentRecord[]> {
    const created: StudentProfileStorageRecord[] = [];
    for (const input of inputs) {
      const studentNo = normalizeStudentNo(input.studentNo) ?? this.nextStudentNo(input.tenantId, created);
      const student = {
        id: `student-${this.students.length + created.length + 1}`,
        status: "ACTIVE" as const,
        ...input,
        studentNo,
      };
      created.push(student);
    }
    this.students.push(...created);
    return created;
  }

  private nextStudentNo(tenantId: string, pending: StudentRecord[] = []): string {
    const activeNumbers = new Set(
      [...this.students, ...pending]
        .filter((student) => student.tenantId === tenantId && !student.deletedAt)
        .map((student) => Number(student.studentNo))
        .filter((studentNo) => Number.isInteger(studentNo) && studentNo >= studentNoStart),
    );
    let candidate = studentNoStart;
    while (activeNumbers.has(candidate)) {
      candidate += 1;
    }
    return String(candidate);
  }

  async update(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "gradeLevelId" | "classId" | "responsibleTeacherId" | "status">>,
  ): Promise<StudentRecord | undefined> {
    const student = await this.findById(id);
    if (!student) return undefined;

    if (input.firstName !== undefined) student.firstName = input.firstName;
    if (input.lastName !== undefined) student.lastName = input.lastName;
    if (input.gradeLevelId !== undefined) student.gradeLevelId = input.gradeLevelId || undefined;
    if (input.classId !== undefined) student.classId = input.classId || undefined;
    if (input.responsibleTeacherId !== undefined) student.responsibleTeacherId = input.responsibleTeacherId || undefined;
    if (input.status !== undefined) student.status = input.status;
    return student;
  }

  async updateGradeLevelForClass(classId: string, gradeLevelId: string | undefined): Promise<number> {
    let updated = 0;
    for (const student of this.students) {
      if (student.classId !== classId) continue;
      student.gradeLevelId = gradeLevelId;
      updated += 1;
    }
    return updated;
  }

  async updateProfile(id: string, input: StudentProfileUpdate): Promise<StudentProfileStorageRecord | undefined> {
    const student = await this.findProfileById(id);
    if (!student) return undefined;

    if (input.nationalIdEncrypted !== undefined) student.nationalIdEncrypted = input.nationalIdEncrypted;
    if (input.nationalIdHash !== undefined) student.nationalIdHash = input.nationalIdHash;
    if (input.phone !== undefined) student.phone = input.phone;
    if (input.email !== undefined) student.email = input.email;
    if (input.photoKey !== undefined) student.photoKey = input.photoKey;
    return student;
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<StudentRecord | undefined> {
    const student = this.students.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!student) return undefined;

    student.userId = userId;
    return student;
  }

  async unbindUser(tenantId: string, id: string, userId: string): Promise<boolean> {
    const student = this.students.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && candidate.userId === userId);
    if (!student) return false;
    student.userId = undefined;
    return true;
  }

  async softDelete(id: string, deletedAt: string): Promise<StudentRecord | undefined> {
    const student = await this.findById(id);
    if (!student) return undefined;

    student.deletedAt = deletedAt;
    student.userId = undefined;
    return student;
  }

  async purgePii(id: string): Promise<StudentRecord | undefined> {
    const student = await this.findProfileById(id);
    if (!student) return undefined;

    student.firstName = "Anonim";
    student.lastName = "Ogrenci";
    delete student.nationalIdEncrypted;
    delete student.nationalIdHash;
    delete student.phone;
    delete student.email;
    delete student.photoKey;
    return student;
  }

  async updateTenant(id: string, tenantId: string): Promise<StudentRecord | undefined> {
    const student = await this.findById(id);
    if (!student) return undefined;

    student.tenantId = tenantId;
    return student;
  }
}

export class PostgresStudentStore implements StudentStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<StudentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(`SELECT * FROM "Student" WHERE "deletedAt" IS NULL`);
      return result.rows.map(toStudentRecord);
    });
  }

  async listRegistryPage(tenantId: string, query: StudentRegistryQuery): Promise<StudentRegistryPage> {
    const context = studentRegistryCursorContext(tenantId, query);
    const position = query.cursor ? decodeListCursor(query.cursor, context, studentCursorInvalid) : undefined;
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const values: unknown[] = [tenantId];
      const filters = [`student."tenantId" = $1`, `student."deletedAt" IS NULL`];
      const addFilter = (sql: (parameter: string) => string, value: unknown) => {
        values.push(value);
        filters.push(sql(`$${values.length}`));
      };

      if (query.ids) addFilter((parameter) => `student."id" = ANY(${parameter}::text[])`, query.ids);
      if (query.gradeLevelId) addFilter((parameter) => `student."gradeLevelId" = ${parameter}`, query.gradeLevelId);
      if (query.classIds) addFilter((parameter) => `student."classId" = ANY(${parameter}::text[])`, query.classIds);
      if (query.responsibleTeacherId) addFilter((parameter) => `student."responsibleTeacherId" = ${parameter}`, query.responsibleTeacherId);
      if (query.status) addFilter((parameter) => `student."status" = ${parameter}`, query.status);
      if (query.campusIds) {
        addFilter((parameter) => `EXISTS (
          SELECT 1 FROM "Class" scoped_class
          WHERE scoped_class."tenantId" = student."tenantId"
            AND scoped_class."id" = student."classId"
            AND scoped_class."deletedAt" IS NULL
            AND scoped_class."campusId" = ANY(${parameter}::text[])
        )`, query.campusIds);
      }
      if (query.teacherId) {
        values.push(query.teacherId, query.teacherStudentIds ?? [], query.teacherClassIds ?? []);
        const teacherParameter = `$${values.length - 2}`;
        const studentsParameter = `$${values.length - 1}`;
        const classesParameter = `$${values.length}`;
        filters.push(`(
          student."responsibleTeacherId" = ${teacherParameter}
          OR student."id" = ANY(${studentsParameter}::text[])
          OR student."classId" = ANY(${classesParameter}::text[])
        )`);
      }
      if (query.hasContact !== undefined) {
        filters.push(`${query.hasContact ? "" : "NOT "}EXISTS (
          SELECT 1 FROM "StudentContact" contact
          WHERE contact."tenantId" = student."tenantId"
            AND contact."studentId" = student."id"
            AND contact."deletedAt" IS NULL
        )`);
      }
      const pattern = likeSearchPattern(query.q);
      if (pattern) {
        addFilter((parameter) => `${foldedSearchSql(`
          coalesce(student."firstName", '') || ' ' ||
          coalesce(student."lastName", '') || ' ' ||
          coalesce(student."studentNo", '')
        `)} LIKE ${parameter} ESCAPE '\\'`, pattern);
      }

      const totalResult = await client.query<{ total: number | string }>(
        `SELECT COUNT(*)::int AS total FROM "Student" student WHERE ${filters.join(" AND ")}`,
        values,
      );
      const sort = studentRegistrySortDefinition(query.sort);
      if (position) {
        filters.push(cursorKeysetCondition(sort.keySql, 'student."id"', sort.direction, query.direction, position, values));
      }
      values.push(query.limit + 1);
      const order = cursorQueryOrder(sort.direction, query.direction);
      const result = await client.query<StudentRow & { cursorKey: string }>(
        `SELECT student.*, ${sort.keySql} AS "cursorKey"
         FROM "Student" student
         WHERE ${filters.join(" AND ")}
         ORDER BY ${sort.keySql} ${order}, student."id" ${order}
         LIMIT $${values.length}`,
        values,
      );
      return cursorPageFromRows(result.rows, query, context, (row) => ({ key: row.cursorKey, id: row.id }), toStudentRecord, {
        total: Number(totalResult.rows[0]?.total ?? 0),
      });
    });
  }

  async findExistingStudentNos(tenantId: string, studentNos: string[]): Promise<string[]> {
    if (studentNos.length === 0) return [];
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<{ studentNo: string }>(
        `SELECT DISTINCT btrim("studentNo") AS "studentNo"
         FROM "Student"
         WHERE "tenantId" = $1
           AND "deletedAt" IS NULL
           AND btrim("studentNo") = ANY($2::text[])`,
        [tenantId, [...new Set(studentNos)]],
      );
      return result.rows.map((row) => row.studentNo);
    });
  }

  async findExistingNationalIdHashes(
    tenantId: string,
    nationalIdHashes: string[],
    options: { includeDeleted?: boolean } = {},
  ): Promise<string[]> {
    if (nationalIdHashes.length === 0) return [];
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<{ nationalIdHash: string }>(
        `SELECT DISTINCT "nationalIdHash"
         FROM "Student"
         WHERE "tenantId" = $1
           AND "nationalIdHash" = ANY($2::text[])
           AND ($3::boolean OR "deletedAt" IS NULL)`,
        [tenantId, [...new Set(nationalIdHashes)], options.includeDeleted === true],
      );
      return result.rows.map((row) => row.nationalIdHash);
    });
  }

  async countLicensedActiveStudents(tenantId: string): Promise<number> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      return selectLicensedActiveStudentCount(client, tenantId);
    });
  }

  async listPortalAccess(tenantId: string, query: StudentPortalAccessQuery): Promise<StudentPortalAccessPage> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const cursorId = query.cursor ? decodeStudentPortalCursor(query.cursor) : undefined;
      if (cursorId) {
        const anchor = await client.query(
          `SELECT 1
           FROM "Student"
           WHERE "tenantId" = $1
             AND "id" = $2
             AND "deletedAt" IS NULL
             AND ($3::text[] IS NULL OR "id" = ANY($3::text[]))`,
          [tenantId, cursorId, query.studentIds ?? null],
        );
        if (!anchor.rows[0]) throw new Error("STUDENT_PORTAL_CURSOR_INVALID");
      }

      const comparison = query.direction === "previous" ? "<" : ">";
      const order = query.direction === "previous" ? "DESC" : "ASC";
      const result = await client.query<StudentPortalAccessRow>(
        `WITH anchor AS (
           SELECT lower("lastName") AS "lastNameKey", lower("firstName") AS "firstNameKey", "id"
           FROM "Student"
           WHERE "tenantId" = $1 AND "id" = $3 AND "deletedAt" IS NULL
         ), matching_students AS (
           SELECT search_student."id"
           FROM "Student" search_student
           WHERE search_student."tenantId" = $1
             AND search_student."deletedAt" IS NULL
             AND ${foldedSearchSql(`
               coalesce(search_student."firstName", '') || ' ' ||
               coalesce(search_student."lastName", '') || ' ' ||
               coalesce(search_student."studentNo", '')
             `)} LIKE $2 ESCAPE '\\'
           UNION ALL
           SELECT email_student."id"
           FROM "User" email_user
           JOIN "Student" email_student
             ON email_student."tenantId" = email_user."tenantId"
            AND email_student."userId" = email_user."id"
            AND email_student."deletedAt" IS NULL
           WHERE email_user."tenantId" = $1
             AND lower(coalesce(email_user."emailNormalized", '')) LIKE $2 ESCAPE '\\'
           UNION ALL
           SELECT invitation_search."subjectId"
           FROM "IdentityInvitation" invitation_search
           WHERE invitation_search."tenantId" = $1
             AND invitation_search."subjectType" = 'STUDENT'
             AND invitation_search."status" = 'PENDING'
             AND lower(coalesce(invitation_search."email", '')) LIKE $2 ESCAPE '\\'
         )
         SELECT
           s."id" AS "studentId",
           s."tenantId",
           s."studentNo",
           s."firstName",
           s."lastName",
           s."status" AS "studentStatus",
           s."userId",
           u."accountStatus",
           membership."id" AS "membershipId",
           membership."status" AS "membershipStatus",
           membership."version" AS "membershipVersion",
           invitation."id" AS "invitationId",
           invitation."kind" AS "invitationKind",
           invitation."status" AS "invitationStatus",
           invitation."email" AS "invitationEmail",
           invitation."expiresAt" AS "invitationExpiresAt",
           COALESCE((
             SELECT COUNT(*)::int
             FROM "AuthSession" session
             WHERE session."tenantId" = s."tenantId"
               AND session."userId" = s."userId"
               AND session."status" = 'ACTIVE'
           ), 0) AS "activeSessionCount"
         FROM "Student" s
         LEFT JOIN "User" u
           ON u."tenantId" = s."tenantId" AND u."id" = s."userId"
         LEFT JOIN LATERAL (
           SELECT m."id", m."status", m."version"
           FROM "TenantMembership" m
           WHERE m."tenantId" = s."tenantId"
             AND m."userId" = s."userId"
             AND m."hasStudentPersona"
           LIMIT 1
         ) membership ON true
         LEFT JOIN LATERAL (
           SELECT invitation_row."id", invitation_row."kind", invitation_row."status", invitation_row."email", invitation_row."expiresAt"
           FROM "IdentityInvitation" invitation_row
           WHERE invitation_row."tenantId" = s."tenantId"
             AND invitation_row."subjectType" = 'STUDENT'
             AND invitation_row."subjectId" = s."id"
             AND invitation_row."status" = 'PENDING'
           ORDER BY invitation_row."createdAt" DESC, invitation_row."id" DESC
           LIMIT 1
         ) invitation ON true
         WHERE s."tenantId" = $1
           AND s."deletedAt" IS NULL
           AND ($5::text[] IS NULL OR s."id" = ANY($5::text[]))
           AND ($2::text IS NULL OR s."id" IN (SELECT matched."id" FROM matching_students matched))
           AND (
             $3::text IS NULL
             OR (lower(s."lastName"), lower(s."firstName"), s."id") ${comparison}
                (SELECT "lastNameKey", "firstNameKey", "id" FROM anchor)
           )
         ORDER BY lower(s."lastName") ${order}, lower(s."firstName") ${order}, s."id" ${order}
         LIMIT $4`,
        [tenantId, likeSearchPattern(query.q), cursorId ?? null, query.limit + 1, query.studentIds ?? null],
      );
      const hasMore = result.rows.length > query.limit;
      const pageRows = result.rows.slice(0, query.limit);
      if (query.direction === "previous") pageRows.reverse();
      const records = pageRows.map(toStudentPortalAccessRecord);
      return {
        records,
        meta: studentPortalCursorMeta(records, query, hasMore),
      };
    });
  }

  async updatePortalAccess(
    tenantId: string,
    id: string,
    input: StudentPortalAccessUpdateRequest,
  ): Promise<StudentPortalAccessUpdateResult | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const current = await client.query<StudentPortalAccessLifecycleRow>(
        `SELECT s."id" AS "studentId",
                s."status" AS "studentStatus",
                s."userId",
                u."accountStatus",
                m."id" AS "membershipId",
                m."status" AS "membershipStatus",
                m."version" AS "membershipVersion"
         FROM "Student" s
         JOIN "User" u
           ON u."tenantId" = s."tenantId" AND u."id" = s."userId"
         JOIN "TenantMembership" m
           ON m."tenantId" = s."tenantId"
          AND m."userId" = s."userId"
          AND (m."role" = 'STUDENT' OR m."hasStudentPersona" = true)
         WHERE s."tenantId" = $1
           AND s."id" = $2
           AND s."deletedAt" IS NULL
         FOR UPDATE OF s, u, m`,
        [tenantId, id],
      );
      const row = current.rows[0];
      if (!row) {
        const student = await client.query(
          `SELECT 1
           FROM "Student"
           WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
           FOR UPDATE`,
          [tenantId, id],
        );
        if (!student.rows[0]) return undefined;
        throw new Error("STUDENT_PORTAL_ACCOUNT_NOT_LINKED");
      }
      if (!row.userId || !row.membershipId || !row.membershipStatus || row.membershipVersion === null || !row.accountStatus) {
        throw new Error("STUDENT_PORTAL_ACCOUNT_NOT_LINKED");
      }
      if (row.membershipStatus === "ENDED") throw new Error("STUDENT_PORTAL_MEMBERSHIP_ENDED");
      if (row.membershipVersion !== input.expectedVersion) throw new Error("STUDENT_PORTAL_VERSION_CONFLICT");
      if (input.status === "ACTIVE" && row.studentStatus !== "ACTIVE") {
        throw new Error("STUDENT_PORTAL_PROFILE_NOT_ACTIVE");
      }

      const desiredAccountStatus = input.status === "ACTIVE" ? "ACTIVE" : "DISABLED";
      if (row.membershipStatus === input.status && row.accountStatus === desiredAccountStatus) {
        return toStudentPortalAccessUpdateResult(
          tenantId,
          row.studentId,
          row.userId,
          row.membershipId,
          input.status,
          row.membershipVersion,
          0,
        );
      }

      const membership = await client.query<{ version: number }>(
        `UPDATE "TenantMembership"
         SET "status" = $3,
             "version" = "version" + 1,
             "endsAt" = NULL,
             "endedReason" = $4,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "version" = $5
           AND "status" <> 'ENDED'
         RETURNING "version"`,
        [tenantId, row.membershipId, input.status, input.status === "SUSPENDED" ? "PORTAL_ACCESS_SUSPENDED" : null, input.expectedVersion],
      );
      const nextVersion = membership.rows[0]?.version;
      if (!nextVersion) throw new Error("STUDENT_PORTAL_VERSION_CONFLICT");
      await client.query(
        `UPDATE "User"
         SET "accountStatus" = $3,
             "membershipVersion" = $4,
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2`,
        [tenantId, row.userId, desiredAccountStatus, nextVersion],
      );
      const sessions = await client.query<{ id: string }>(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "userId" = $2
           AND "status" = 'ACTIVE'
         RETURNING "id"`,
        [tenantId, row.userId],
      );
      return toStudentPortalAccessUpdateResult(
        tenantId,
        row.studentId,
        row.userId,
        row.membershipId,
        input.status,
        nextVersion,
        sessions.rows.length,
      );
    });
  }

  async findById(id: string): Promise<StudentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `SELECT * FROM "Student" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async findProfileById(id: string, tenantId?: string): Promise<StudentProfileStorageRecord | undefined> {
    if (tenantId) {
      return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
        return selectStudentProfileById(client, id);
      });
    }
    return withTenantQuery(this.pool, async (client) => {
      return selectStudentProfileById(client, id);
    });
  }

  async findByUserId(tenantId: string, userId: string): Promise<StudentRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<StudentRow>(
        `SELECT * FROM "Student" WHERE "tenantId" = $1 AND "userId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        [tenantId, userId],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<StudentProfileStorageRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<StudentRow>(
        `SELECT * FROM "Student"
         WHERE "tenantId" = $1
           AND "nationalIdHash" = $2
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, nationalIdHash],
      );
      return result.rows[0] ? toStudentProfileStorageRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: StudentInput): Promise<StudentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      return insertStudent(client, input);
    });
  }

  async createWithEnrollment(
    input: StudentInput,
    enrollment: Omit<StudentEnrollmentInput, "tenantId" | "studentId">,
  ): Promise<StudentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const student = await insertStudent(client, input);
      await insertEnrollment(client, student, enrollment);
      return student;
    });
  }

  async importBatch(input: StudentImportBatchInput): Promise<StudentRecord[]> {
    if (input.rows.length === 0) return [];
    const context = getRequestContext();
    if (context.bypassRls || context.tenantId !== input.tenantId) throw new Error("FORBIDDEN_TENANT");
    if (input.rows.some((row) => row.student.tenantId !== input.tenantId || (row.contact && row.contact.tenantId !== input.tenantId))) {
      throw new Error("FORBIDDEN_TENANT");
    }

    try {
      return await withTenantQuery(this.pool, async (client) => {
        return importStudentBatch(client, input);
      });
    } catch (error) {
      throw translateStudentImportBatchError(error);
    }
  }

  async updateWithEnrollmentTransition(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "gradeLevelId" | "classId" | "responsibleTeacherId" | "status">>,
    transition: StudentEnrollmentTransition,
  ): Promise<StudentEnrollmentTransitionResult | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await updateStudent(client, id, input);
      const row = result.rows[0];
      if (!row) return undefined;
      const student = toStudentRecord(row);

      if (transition.closeActive) {
        await client.query(
          `UPDATE "StudentEnrollment"
           SET "endsAt" = $2::date,
               "status" = COALESCE($3, "status"),
               "updatedAt" = now()
           WHERE "studentId" = $1
             AND "endsAt" IS NULL`,
          [id, transition.closeActive.endsAt, transition.closeActive.status ?? null],
        );
      }
      const enrollment = transition.create
        ? await insertEnrollment(client, student, transition.create)
        : undefined;
      const portalAccess = transition.suspendPortalAccess
        ? await suspendStudentPortalAccess(client, student, transition.suspendPortalAccess.reason)
        : undefined;
      return { student, enrollment, portalAccess };
    });
  }

  async createMany(inputs: StudentCreateManyInput[]): Promise<StudentRecord[]> {
    if (inputs.length === 0) return [];

    return withTenantQuery(this.pool, async (client) => {
      const created: StudentRecord[] = [];
      for (const input of inputs) {
        created.push(await insertStudent(client, input));
      }
      return created;
    });
  }

  async update(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "gradeLevelId" | "classId" | "responsibleTeacherId" | "status">>,
  ): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await updateStudent(client, id, input);
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async updateGradeLevelForClass(classId: string, gradeLevelId: string | undefined): Promise<number> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE "Student"
         SET "gradeLevelId" = $2,
             "updatedAt" = now()
         WHERE "classId" = $1
         RETURNING "id"`,
        [classId, gradeLevelId ?? null],
      );
      return result.rows.length;
    });
  }

  async updateProfile(id: string, input: StudentProfileUpdate): Promise<StudentProfileStorageRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "nationalIdEncrypted" = COALESCE($2, "nationalIdEncrypted"),
             "nationalIdHash" = COALESCE($3, "nationalIdHash"),
             "phone" = CASE WHEN $4 THEN $5 ELSE "phone" END,
             "email" = CASE WHEN $6 THEN $7 ELSE "email" END,
             "photoKey" = CASE WHEN $8 THEN $9 ELSE "photoKey" END,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "deletedAt" IS NULL
         RETURNING *`,
        [
          id,
          input.nationalIdEncrypted ?? null,
          input.nationalIdHash ?? null,
          input.phone !== undefined,
          input.phone ?? null,
          input.email !== undefined,
          input.email ?? null,
          input.photoKey !== undefined,
          input.photoKey ?? null,
        ],
      );
      return result.rows[0] ? toStudentProfileStorageRecord(result.rows[0]) : undefined;
    });
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<StudentRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "userId" = $3,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "deletedAt" IS NULL
         RETURNING *`,
        [tenantId, id, userId],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async unbindUser(tenantId: string, id: string, userId: string): Promise<boolean> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE "Student"
         SET "userId" = NULL,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "userId" = $3
         RETURNING "id"`,
        [tenantId, id, userId],
      );
      return result.rows.length > 0;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async purgePii(id: string): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "firstName" = 'Anonim',
             "lastName" = 'Ogrenci',
             "nationalIdEncrypted" = NULL,
             "nationalIdHash" = NULL,
             "phone" = NULL,
             "email" = NULL,
             "photoKey" = NULL,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async updateTenant(id: string, tenantId: string): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "tenantId" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, tenantId],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }
}

export function createStudentStore(): StudentStore {
  return resolvePersistenceDriver(process.env.STUDENT_STORE) === "postgres" ? new PostgresStudentStore() : new InMemoryStudentStore();
}

async function lockStudentNoAllocation(client: Queryable, tenantId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
}

async function insertStudent(client: Queryable, input: StudentInput | StudentCreateManyInput): Promise<StudentRecord> {
  await assertClassPlacementMatches(client, input.tenantId, input.gradeLevelId, input.classId);
  await lockStudentNoAllocation(client, input.tenantId);
  const studentNo = normalizeStudentNo(input.studentNo) ?? await nextStudentNo(client, input.tenantId);
  const profile: Partial<StudentCreateManyInput> = input;
  const hasProfile = profile.nationalIdEncrypted !== undefined || profile.nationalIdHash !== undefined
    || profile.phone !== undefined || profile.email !== undefined;
  const result = hasProfile
    ? await client.query<StudentRow>(
      `INSERT INTO "Student" (
         "id", "tenantId", "studentNo", "firstName", "lastName", "gradeLevelId", "classId", "responsibleTeacherId", "status",
         "nationalIdEncrypted", "nationalIdHash", "phone", "email", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
       RETURNING *`,
      [
        randomUUID(),
        input.tenantId,
        studentNo,
        input.firstName,
        input.lastName,
        input.gradeLevelId ?? null,
        input.classId ?? null,
        input.responsibleTeacherId ?? null,
        input.status ?? "ACTIVE",
        profile.nationalIdEncrypted ?? null,
        profile.nationalIdHash ?? null,
        profile.phone ?? null,
        profile.email ?? null,
      ],
    )
    : await client.query<StudentRow>(
      `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "gradeLevelId", "classId", "responsibleTeacherId", "status", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       RETURNING *`,
      [
        randomUUID(),
        input.tenantId,
        studentNo,
        input.firstName,
        input.lastName,
        input.gradeLevelId ?? null,
        input.classId ?? null,
        input.responsibleTeacherId ?? null,
        input.status ?? "ACTIVE",
      ],
    );
  const row = result.rows[0];
  if (!row) throw new Error("STUDENT_CREATE_FAILED");
  return toStudentRecord(row);
}

async function insertEnrollment(
  client: Queryable,
  student: StudentRecord,
  input: Omit<StudentEnrollmentInput, "tenantId" | "studentId">,
): Promise<StudentEnrollmentRecord> {
  const result = await client.query<StudentEnrollmentRow>(
    `INSERT INTO "StudentEnrollment" (
       "id", "tenantId", "studentId", "academicYearId", "termId", "gradeLevelId", "classId",
       "status", "startsAt", "endsAt", "reason", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11, now())
     RETURNING *`,
    [
      randomUUID(),
      student.tenantId,
      student.id,
      input.academicYearId ?? null,
      input.termId ?? null,
      input.gradeLevelId ?? null,
      input.classId ?? null,
      input.status,
      input.startsAt,
      input.endsAt ?? null,
      input.reason ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("STUDENT_ENROLLMENT_CREATE_FAILED");
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    academicYearId: row.academicYearId ?? undefined,
    termId: row.termId ?? undefined,
    gradeLevelId: row.gradeLevelId ?? undefined,
    classId: row.classId ?? undefined,
    status: row.status,
    startsAt: toDateString(row.startsAt),
    endsAt: row.endsAt ? toDateString(row.endsAt) : undefined,
    reason: row.reason ?? undefined,
    createdAt: row.createdAt ? toIsoString(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? toIsoString(row.updatedAt) : undefined,
  };
}

async function suspendStudentPortalAccess(
  client: Queryable,
  student: StudentRecord,
  reason: string,
): Promise<StudentPortalSuspensionResult> {
  const revokedInvitations = await client.query<{ id: string }>(
    `UPDATE "IdentityInvitation"
     SET "status" = 'REVOKED',
         "updatedAt" = now()
     WHERE "tenantId" = $1
       AND "subjectType" = 'STUDENT'
       AND "subjectId" = $2
       AND "status" = 'PENDING'
     RETURNING "id"`,
    [student.tenantId, student.id],
  );
  if (revokedInvitations.rows.length > 0) {
    await client.query(
      `UPDATE "SecretDeliveryOutbox"
       SET "status" = 'EXPIRED',
           "payloadEncrypted" = NULL,
           "claimedAt" = NULL,
           "lastErrorCode" = NULL,
           "updatedAt" = now()
       WHERE "purpose" = 'IDENTITY_INVITATION'
         AND "sourceId" = ANY($1::text[])
         AND "payloadEncrypted" IS NOT NULL`,
      [revokedInvitations.rows.map((invitation) => invitation.id)],
    );
  }

  if (!student.userId) {
    return {
      membershipSuspended: false,
      sessionsRevoked: 0,
      invitationsRevoked: revokedInvitations.rows.length,
    };
  }

  const membership = await client.query<{ id: string }>(
    `UPDATE "TenantMembership"
     SET "status" = 'SUSPENDED',
         "version" = "version" + 1,
         "endedReason" = $3,
         "updatedAt" = now()
     WHERE "tenantId" = $1
       AND "userId" = $2
       AND ("role" = 'STUDENT' OR "hasStudentPersona" = true)
       AND "status" <> 'ENDED'
     RETURNING "id"`,
    [student.tenantId, student.userId, reason],
  );
  await client.query(
    `UPDATE "User"
     SET "accountStatus" = 'DISABLED',
         "membershipVersion" = "membershipVersion" + 1,
         "updatedAt" = now()
     WHERE "tenantId" = $1 AND "id" = $2`,
    [student.tenantId, student.userId],
  );
  const sessions = await client.query<{ id: string }>(
    `UPDATE "AuthSession"
     SET "status" = 'REVOKED',
         "updatedAt" = now()
     WHERE "tenantId" = $1
       AND "userId" = $2
       AND "status" = 'ACTIVE'
     RETURNING "id"`,
    [student.tenantId, student.userId],
  );
  await client.query(
    `UPDATE "NotificationDeviceToken"
     SET "disabledAt" = COALESCE("disabledAt", now()),
         "updatedAt" = now()
     WHERE "tenantId" = $1
       AND "userId" = $2
       AND "subjectType" = 'STUDENT'
       AND "subjectId" = $3
       AND "disabledAt" IS NULL`,
    [student.tenantId, student.userId, student.id],
  );

  return {
    userId: student.userId,
    membershipSuspended: membership.rows.length > 0,
    sessionsRevoked: sessions.rows.length,
    invitationsRevoked: revokedInvitations.rows.length,
  };
}

async function updateStudent(
  client: Queryable,
  id: string,
  input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "gradeLevelId" | "classId" | "responsibleTeacherId" | "status">>,
): Promise<{ rows: StudentRow[]; rowCount?: number | null }> {
  if (input.gradeLevelId !== undefined || input.classId !== undefined) {
    const current = await client.query<Pick<StudentRow, "tenantId" | "gradeLevelId" | "classId">>(
      `SELECT "tenantId", "gradeLevelId", "classId"
       FROM "Student"
       WHERE "id" = $1
         AND "deletedAt" IS NULL
       LIMIT 1`,
      [id],
    );
    const record = current.rows[0];
    if (!record) return { rows: [] };
    await assertClassPlacementMatches(
      client,
      record.tenantId,
      input.gradeLevelId !== undefined ? input.gradeLevelId || undefined : record.gradeLevelId ?? undefined,
      input.classId !== undefined ? input.classId || undefined : record.classId ?? undefined,
    );
  }

  return client.query<StudentRow>(
    `UPDATE "Student"
     SET "firstName" = COALESCE($2, "firstName"),
         "lastName" = COALESCE($3, "lastName"),
         "gradeLevelId" = CASE WHEN $4 THEN $5 ELSE "gradeLevelId" END,
         "classId" = CASE WHEN $6 THEN $7 ELSE "classId" END,
         "responsibleTeacherId" = CASE WHEN $8 THEN $9 ELSE "responsibleTeacherId" END,
         "status" = COALESCE($10, "status"),
         "updatedAt" = now()
     WHERE "id" = $1
       AND "deletedAt" IS NULL
     RETURNING *`,
    [
      id,
      input.firstName ?? null,
      input.lastName ?? null,
      input.gradeLevelId !== undefined,
      input.gradeLevelId || null,
      input.classId !== undefined,
      input.classId || null,
      input.responsibleTeacherId !== undefined,
      input.responsibleTeacherId || null,
      input.status ?? null,
    ],
  );
}

async function assertClassPlacementMatches(
  client: Queryable,
  tenantId: string,
  gradeLevelId: string | undefined,
  classId: string | undefined,
): Promise<void> {
  if (!classId) return;
  const result = await client.query<{ gradeLevelId: string | null }>(
    `SELECT "gradeLevelId"
     FROM "Class"
     WHERE "tenantId" = $1
       AND "id" = $2
       AND "deletedAt" IS NULL
     FOR SHARE`,
    [tenantId, classId],
  );
  const schoolClass = result.rows[0];
  if (!schoolClass) throw new Error("CLASS_NOT_FOUND");
  if (!gradeLevelId || schoolClass.gradeLevelId !== gradeLevelId) {
    throw new Error("STUDENT_CLASS_GRADE_LEVEL_MISMATCH");
  }
}

async function nextStudentNo(client: Queryable, tenantId: string): Promise<string> {
  const result = await client.query<{ studentNo: string }>(
    `SELECT candidate::text AS "studentNo"
     FROM generate_series(
       ${studentNoStart},
       (
         SELECT GREATEST(
           COALESCE(
             MAX(
               CASE
                 WHEN "studentNo" ~ '^[0-9]+$' AND "studentNo"::integer >= ${studentNoStart}
                   THEN "studentNo"::integer
                 ELSE NULL
               END
             ),
             0
           ) + 1,
           ${studentNoStart}
         )
         FROM "Student"
         WHERE "tenantId" = $1
           AND "deletedAt" IS NULL
       )
     ) AS candidate
     WHERE NOT EXISTS (
       SELECT 1
       FROM "Student"
       WHERE "tenantId" = $1
         AND "deletedAt" IS NULL
         AND "studentNo" = candidate::text
     )
     ORDER BY candidate
     LIMIT 1`,
    [tenantId],
  );
  const studentNo = result.rows[0]?.studentNo;
  if (!studentNo) {
    throw new Error("STUDENT_NO_ALLOCATION_FAILED");
  }
  return studentNo;
}

async function selectLicensedActiveStudentCount(client: Queryable, tenantId: string): Promise<number> {
  // Mirrors the count in o_okul_refresh_license_usage (20260801210000).
  const result = await client.query<{ count: number | string }>(
    `SELECT count(*)::int AS "count"
     FROM "Student" student
     WHERE student."tenantId" = $1
       AND student."deletedAt" IS NULL
       AND student."status" = 'ACTIVE'
       AND 1 = (
         SELECT count(*)
         FROM "StudentEnrollment" enrollment
         WHERE enrollment."tenantId" = student."tenantId"
           AND enrollment."studentId" = student."id"
           AND enrollment."status" = 'ACTIVE'
           AND enrollment."endsAt" IS NULL
       )`,
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * DEC-20261021-02 set-based import. Runs on the caller's tenant transaction: class rows are share-locked, then the
 * tenant student-number lock serializes concurrent creates so the license count, duplicate checks and number
 * allocation below see every committed student. Inserts are multi-row `INSERT ... SELECT FROM unnest(...)` chunks.
 */
async function importStudentBatch(client: Queryable, input: StudentImportBatchInput): Promise<StudentRecord[]> {
  const { tenantId, rows } = input;
  const campusIds = input.campusIds ? new Set(input.campusIds) : undefined;
  const classIds = [...new Set(rows.map((row) => row.student.classId).filter((classId): classId is string => Boolean(classId)))];
  const classes = new Map<string, { gradeLevelId: string | null; campusId: string | null }>();
  if (classIds.length > 0) {
    const result = await client.query<{ id: string; gradeLevelId: string | null; campusId: string | null }>(
      `SELECT "id", "gradeLevelId", "campusId"
       FROM "Class"
       WHERE "tenantId" = $1
         AND "id" = ANY($2::text[])
         AND "deletedAt" IS NULL
       FOR SHARE`,
      [tenantId, classIds],
    );
    for (const row of result.rows) classes.set(row.id, row);
  }
  for (const { student } of rows) {
    if (!student.classId) {
      if (campusIds) throw new Error(studentImportBatchErrors.campusScopeForbidden);
      continue;
    }
    const schoolClass = classes.get(student.classId);
    if (!schoolClass) throw new Error(studentImportBatchErrors.classNotFound);
    if (campusIds && (!schoolClass.campusId || !campusIds.has(schoolClass.campusId))) {
      throw new Error(studentImportBatchErrors.campusScopeForbidden);
    }
    if (!student.gradeLevelId || schoolClass.gradeLevelId !== student.gradeLevelId) {
      throw new Error(studentImportBatchErrors.classGradeLevelMismatch);
    }
  }

  await lockStudentNoAllocation(client, tenantId);

  const incomingActive = rows.filter((row) => row.enrollment?.status === "ACTIVE" && !row.enrollment.endsAt
    && (row.student.status ?? "ACTIVE") === "ACTIVE").length;
  const currentActive = await selectLicensedActiveStudentCount(client, tenantId);
  if (currentActive + incomingActive > input.activeStudentLimit) {
    throw new Error(studentImportBatchErrors.activeStudentLimitReached);
  }

  const nationalIdHashes = rows.map((row) => row.student.nationalIdHash).filter((hash): hash is string => Boolean(hash));
  if (nationalIdHashes.length > 0) {
    // No deletedAt filter: Student_tenantId_nationalIdHash_key also covers soft-deleted students.
    const existing = await client.query(
      `SELECT 1 FROM "Student" WHERE "tenantId" = $1 AND "nationalIdHash" = ANY($2::text[]) LIMIT 1`,
      [tenantId, nationalIdHashes],
    );
    if (existing.rows.length > 0) throw new Error(studentImportBatchErrors.nationalIdConflict);
  }

  const explicitStudentNos = rows
    .map((row) => normalizeStudentNo(row.student.studentNo))
    .filter((studentNo): studentNo is string => Boolean(studentNo));
  if (explicitStudentNos.length > 0) {
    const existing = await client.query(
      `SELECT 1 FROM "Student"
       WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND btrim("studentNo") = ANY($2::text[])
       LIMIT 1`,
      [tenantId, explicitStudentNos],
    );
    if (existing.rows.length > 0) throw new Error(studentImportBatchErrors.studentNoConflict);
  }

  const missingNumberCount = rows.length - explicitStudentNos.length;
  const allocated = missingNumberCount > 0
    ? await allocateStudentNos(client, tenantId, explicitStudentNos, missingNumberCount)
    : [];
  let allocatedIndex = 0;
  const studentNos = rows.map((row) => normalizeStudentNo(row.student.studentNo) ?? allocated[allocatedIndex++]!);

  const createdById = new Map<string, StudentRecord>();
  for (const chunk of chunkIndexes(rows.length)) {
    const chunkRows = chunk.map((index) => rows[index]!);
    const result = await client.query<StudentRow>(
      `INSERT INTO "Student" (
         "id", "tenantId", "studentNo", "firstName", "lastName", "gradeLevelId", "classId", "responsibleTeacherId", "status",
         "nationalIdEncrypted", "nationalIdHash", "phone", "email", "updatedAt"
       )
       SELECT input."id", $1, input."studentNo", input."firstName", input."lastName", input."gradeLevelId", input."classId",
              input."responsibleTeacherId", input."status", input."nationalIdEncrypted", input."nationalIdHash",
              input."phone", input."email", now()
       FROM unnest(
         $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
         $10::text[], $11::text[], $12::text[], $13::text[]
       ) AS input(
         "id", "studentNo", "firstName", "lastName", "gradeLevelId", "classId", "responsibleTeacherId", "status",
         "nationalIdEncrypted", "nationalIdHash", "phone", "email"
       )
       RETURNING *`,
      [
        tenantId,
        chunkRows.map((row) => row.id),
        chunk.map((index) => studentNos[index]!),
        chunkRows.map((row) => row.student.firstName),
        chunkRows.map((row) => row.student.lastName),
        chunkRows.map((row) => row.student.gradeLevelId ?? null),
        chunkRows.map((row) => row.student.classId ?? null),
        chunkRows.map((row) => row.student.responsibleTeacherId ?? null),
        chunkRows.map((row) => row.student.status ?? "ACTIVE"),
        chunkRows.map((row) => row.student.nationalIdEncrypted ?? null),
        chunkRows.map((row) => row.student.nationalIdHash ?? null),
        chunkRows.map((row) => row.student.phone ?? null),
        chunkRows.map((row) => row.student.email ?? null),
      ],
    );
    for (const row of result.rows) createdById.set(row.id, toStudentRecord(row));
  }
  const students = rows.map((row) => {
    const student = createdById.get(row.id);
    if (!student) throw new Error("STUDENT_CREATE_FAILED");
    return student;
  });

  const enrollments = rows.filter((row) => row.enrollment);
  for (const chunk of chunkIndexes(enrollments.length)) {
    const chunkRows = chunk.map((index) => enrollments[index]!);
    await client.query(
      `INSERT INTO "StudentEnrollment" (
         "id", "tenantId", "studentId", "academicYearId", "termId", "gradeLevelId", "classId",
         "status", "startsAt", "endsAt", "reason", "updatedAt"
       )
       SELECT input."id", $1, input."studentId", input."academicYearId", input."termId", input."gradeLevelId", input."classId",
              input."status", input."startsAt", input."endsAt", input."reason", now()
       FROM unnest(
         $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::date[], $10::date[], $11::text[]
       ) AS input(
         "id", "studentId", "academicYearId", "termId", "gradeLevelId", "classId", "status", "startsAt", "endsAt", "reason"
       )`,
      [
        tenantId,
        chunkRows.map(() => randomUUID()),
        chunkRows.map((row) => row.id),
        chunkRows.map((row) => row.enrollment!.academicYearId ?? null),
        chunkRows.map((row) => row.enrollment!.termId ?? null),
        chunkRows.map((row) => row.enrollment!.gradeLevelId ?? null),
        chunkRows.map((row) => row.enrollment!.classId ?? null),
        chunkRows.map((row) => row.enrollment!.status),
        chunkRows.map((row) => row.enrollment!.startsAt),
        chunkRows.map((row) => row.enrollment!.endsAt ?? null),
        chunkRows.map((row) => row.enrollment!.reason ?? null),
      ],
    );
  }

  const contacts = rows.map((row) => row.contact).filter((contact): contact is StudentContactStoreInput => Boolean(contact));
  for (const chunk of chunkIndexes(contacts.length)) {
    const chunkContacts = chunk.map((index) => contacts[index]!);
    await client.query(
      `INSERT INTO "StudentContact" (
         "id", "tenantId", "studentId", "firstName", "lastName", "relationType",
         "phoneEncrypted", "phoneHash", "emailEncrypted", "emailHash",
         "canReceiveSms", "canReceiveAnnouncements", "canReceiveFinance",
         "consentSource", "consentRecordedAt", "updatedAt"
       )
       SELECT input."id", $1, input."studentId", input."firstName", input."lastName", input."relationType",
              input."phoneEncrypted", input."phoneHash", input."emailEncrypted", input."emailHash",
              input."canReceiveSms", input."canReceiveAnnouncements", input."canReceiveFinance",
              input."consentSource", input."consentRecordedAt", now()
       FROM unnest(
         $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
         $11::boolean[], $12::boolean[], $13::boolean[], $14::text[], $15::timestamptz[]
       ) AS input(
         "id", "studentId", "firstName", "lastName", "relationType", "phoneEncrypted", "phoneHash", "emailEncrypted", "emailHash",
         "canReceiveSms", "canReceiveAnnouncements", "canReceiveFinance", "consentSource", "consentRecordedAt"
       )`,
      [
        tenantId,
        chunkContacts.map(() => randomUUID()),
        chunkContacts.map((contact) => contact.studentId),
        chunkContacts.map((contact) => contact.firstName),
        chunkContacts.map((contact) => contact.lastName),
        chunkContacts.map((contact) => contact.relationType),
        chunkContacts.map((contact) => contact.phoneEncrypted ?? null),
        chunkContacts.map((contact) => contact.phoneHash ?? null),
        chunkContacts.map((contact) => contact.emailEncrypted ?? null),
        chunkContacts.map((contact) => contact.emailHash ?? null),
        chunkContacts.map((contact) => contact.canReceiveSms),
        chunkContacts.map((contact) => contact.canReceiveAnnouncements),
        chunkContacts.map((contact) => contact.canReceiveFinance),
        chunkContacts.map((contact) => contact.consentSource ?? null),
        chunkContacts.map((contact) => contact.consentRecordedAt ?? null),
      ],
    );
  }

  for (const chunk of chunkIndexes(input.audits.length)) {
    const chunkAudits = chunk.map((index) => input.audits[index]!);
    // Same columns and casts as PostgresAuditLogStore.create: diff is jsonb, createdAt is the TIMESTAMP(3) partition key.
    await client.query(
      `INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff", "createdAt")
       SELECT input."id", $1, $2, input."entityType", input."entityId", input."action", input."diff"::jsonb, $3::timestamp(3)
       FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
         AS input("id", "entityType", "entityId", "action", "diff")`,
      [
        tenantId,
        input.actorUserId ?? null,
        input.auditCreatedAt,
        chunkAudits.map(() => randomUUID()),
        chunkAudits.map((audit) => audit.entityType),
        chunkAudits.map((audit) => audit.entityId ?? null),
        chunkAudits.map((audit) => audit.action),
        chunkAudits.map((audit) => (audit.diff === undefined ? null : JSON.stringify(audit.diff))),
      ],
    );
  }

  await input.finalize?.(client, students);
  return students;
}

/** Allocates `count` numbers like `nextStudentNo` would one by one, skipping every explicit number in the file. */
async function allocateStudentNos(client: Queryable, tenantId: string, reserved: string[], count: number): Promise<string[]> {
  const result = await client.query<{ studentNo: string }>(
    `WITH used AS (
       SELECT "studentNo" AS "studentNo" FROM "Student" WHERE "tenantId" = $1 AND "deletedAt" IS NULL
       UNION
       SELECT unnest($2::text[])
     )
     SELECT candidate::text AS "studentNo"
     FROM generate_series(${studentNoStart}::bigint, ${studentNoStart}::bigint + (SELECT count(*) FROM used) + $3::bigint) AS candidate
     WHERE NOT EXISTS (SELECT 1 FROM used WHERE used."studentNo" = candidate::text)
     ORDER BY candidate
     LIMIT $3`,
    [tenantId, reserved, count],
  );
  if (result.rows.length !== count) throw new Error("STUDENT_NO_ALLOCATION_FAILED");
  return result.rows.map((row) => row.studentNo);
}

function chunkIndexes(length: number): number[][] {
  const chunks: number[][] = [];
  for (let start = 0; start < length; start += studentImportBatchChunkSize) {
    chunks.push(Array.from({ length: Math.min(studentImportBatchChunkSize, length - start) }, (_, offset) => start + offset));
  }
  return chunks;
}

function translateStudentImportBatchError(error: unknown): unknown {
  const candidate = error as { code?: unknown; constraint?: unknown } | null;
  if (candidate?.code !== "23505") return error;
  if (candidate.constraint === "Student_tenantId_nationalIdHash_key") return new Error(studentImportBatchErrors.nationalIdConflict);
  if (candidate.constraint === "Student_tenantId_studentNo_active_key") return new Error(studentImportBatchErrors.studentNoConflict);
  return error;
}

function normalizeStudentNo(value: string | undefined): string | undefined {
  const studentNo = value?.trim();
  return studentNo ? studentNo : undefined;
}

interface StudentRow {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  studentNo: string | null;
  gradeLevelId: string | null;
  classId: string | null;
  responsibleTeacherId: string | null;
  status: StudentRecord["status"];
  nationalIdEncrypted: string | null;
  nationalIdHash: string | null;
  phone: string | null;
  email: string | null;
  photoKey: string | null;
  userId: string | null;
  deletedAt: Date | null;
}

interface StudentPortalAccessRow {
  studentId: string;
  tenantId: string;
  studentNo: string | null;
  firstName: string;
  lastName: string;
  studentStatus: StudentRecord["status"];
  userId: string | null;
  accountStatus: string | null;
  membershipId: string | null;
  membershipStatus: "ACTIVE" | "SUSPENDED" | "ENDED" | null;
  membershipVersion: number | null;
  invitationId: string | null;
  invitationKind: "EMAIL_LINK" | "STUDENT_CODE" | null;
  invitationStatus: "PENDING" | "ACCEPTED" | "REVOKED" | null;
  invitationEmail: string | null;
  invitationExpiresAt: Date | string | null;
  activeSessionCount: number | string;
}

interface StudentPortalAccessLifecycleRow {
  studentId: string;
  studentStatus: StudentRecord["status"];
  userId: string | null;
  accountStatus: string | null;
  membershipId: string | null;
  membershipStatus: "ACTIVE" | "SUSPENDED" | "ENDED" | null;
  membershipVersion: number | null;
}

interface StudentEnrollmentRow {
  id: string;
  tenantId: string;
  studentId: string;
  academicYearId: string | null;
  termId: string | null;
  gradeLevelId: string | null;
  classId: string | null;
  status: StudentRecord["status"];
  startsAt: Date | string;
  endsAt: Date | string | null;
  reason: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

function toDateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toStudentPortalAccessUpdateResult(
  tenantId: string,
  studentId: string,
  userId: string,
  membershipId: string,
  status: "ACTIVE" | "SUSPENDED",
  version: number,
  sessionsRevoked: number,
): StudentPortalAccessUpdateResult {
  return {
    studentId,
    tenantId,
    userId,
    accountStatus: status === "ACTIVE" ? "ACTIVE" : "DISABLED",
    membership: { id: membershipId, status, version },
    sessionsRevoked,
  };
}

function toStudentRecord(row: StudentRow): StudentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentNo: row.studentNo ?? undefined,
    firstName: row.firstName,
    lastName: row.lastName,
    gradeLevelId: row.gradeLevelId ?? undefined,
    classId: row.classId ?? undefined,
    responsibleTeacherId: row.responsibleTeacherId ?? undefined,
    status: row.status,
    userId: row.userId ?? undefined,
    deletedAt: row.deletedAt?.toISOString(),
  };
}

function toStudentProfileStorageRecord(row: StudentRow): StudentProfileStorageRecord {
  return {
    ...toStudentRecord(row),
    nationalIdEncrypted: row.nationalIdEncrypted ?? undefined,
    nationalIdHash: row.nationalIdHash ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    photoKey: row.photoKey ?? undefined,
  };
}

function toStudentPortalAccessRecord(row: StudentPortalAccessRow): StudentPortalAccessRecord {
  const membership = row.membershipId && row.membershipStatus && row.membershipVersion
    ? { id: row.membershipId, status: row.membershipStatus, version: row.membershipVersion }
    : undefined;
  const invitation = row.invitationId && row.invitationKind && row.invitationStatus && row.invitationExpiresAt
    ? {
        id: row.invitationId,
        kind: row.invitationKind,
        status: row.invitationStatus,
        emailMasked: row.invitationEmail ? maskEmail(row.invitationEmail) : undefined,
        expiresAt: toIsoString(row.invitationExpiresAt),
      }
    : undefined;
  return {
    studentId: row.studentId,
    tenantId: row.tenantId,
    studentNo: row.studentNo ?? undefined,
    firstName: row.firstName,
    lastName: row.lastName,
    studentStatus: row.studentStatus,
    accessState: resolveStudentPortalAccessState({
      studentStatus: row.studentStatus,
      userId: row.userId,
      accountStatus: row.accountStatus,
      membershipStatus: row.membershipStatus,
      hasPendingInvitation: Boolean(invitation),
    }),
    userId: row.userId ?? undefined,
    accountStatus: row.accountStatus ?? undefined,
    membership,
    invitation,
    activeSessionCount: Number(row.activeSessionCount),
  };
}

function toInMemoryStudentPortalAccessRecord(
  student: StudentProfileStorageRecord,
  portalMembership?: InMemoryStudentPortalMembership,
): StudentPortalAccessRecord {
  const membership = student.userId && portalMembership
    ? { id: portalMembership.id, status: portalMembership.status, version: portalMembership.version }
    : undefined;
  return {
    studentId: student.id,
    tenantId: student.tenantId,
    studentNo: student.studentNo,
    firstName: student.firstName,
    lastName: student.lastName,
    studentStatus: student.status,
    accessState: resolveStudentPortalAccessState({
      studentStatus: student.status,
      userId: student.userId ?? null,
      accountStatus: portalMembership?.accountStatus ?? null,
      membershipStatus: membership?.status ?? null,
      hasPendingInvitation: false,
    }),
    userId: student.userId,
    accountStatus: portalMembership?.accountStatus,
    membership,
    activeSessionCount: 0,
  };
}

function resolveStudentPortalAccessState(input: {
  studentStatus: StudentRecord["status"];
  userId: string | null;
  accountStatus: string | null;
  membershipStatus: "ACTIVE" | "SUSPENDED" | "ENDED" | null;
  hasPendingInvitation: boolean;
}): StudentPortalAccessRecord["accessState"] {
  if (!input.userId) return input.hasPendingInvitation ? "INVITED" : "NOT_INVITED";
  if (!input.membershipStatus || input.hasPendingInvitation) return "INCONSISTENT";
  return input.studentStatus === "ACTIVE" && input.accountStatus === "ACTIVE" && input.membershipStatus === "ACTIVE"
    ? "ACTIVE"
    : "SUSPENDED";
}

function paginateStudentPortalAccess(
  records: StudentPortalAccessRecord[],
  query: StudentPortalAccessQuery,
): StudentPortalAccessPage {
  const cursorId = query.cursor ? decodeStudentPortalCursor(query.cursor) : undefined;
  const anchorIndex = cursorId ? records.findIndex((record) => record.studentId === cursorId) : -1;
  if (cursorId && anchorIndex < 0) throw new Error("STUDENT_PORTAL_CURSOR_INVALID");
  const start = query.direction === "previous"
    ? Math.max(0, anchorIndex - query.limit)
    : cursorId ? anchorIndex + 1 : 0;
  const end = query.direction === "previous" ? anchorIndex : start + query.limit;
  const page = records.slice(start, end);
  return {
    records: page,
    meta: {
      limit: query.limit,
      previousCursor: start > 0 && page[0] ? encodeStudentPortalCursor(page[0].studentId) : undefined,
      nextCursor: end < records.length && page.at(-1) ? encodeStudentPortalCursor(page.at(-1)!.studentId) : undefined,
    },
  };
}

function studentPortalCursorMeta(
  records: StudentPortalAccessRecord[],
  query: StudentPortalAccessQuery,
  hasMore: boolean,
): ApiCursorListMeta {
  const first = records[0];
  const last = records.at(-1);
  return {
    limit: query.limit,
    previousCursor: first && (query.direction === "previous" ? hasMore : Boolean(query.cursor))
      ? encodeStudentPortalCursor(first.studentId)
      : undefined,
    nextCursor: last && (query.direction === "next" ? hasMore : Boolean(query.cursor))
      ? encodeStudentPortalCursor(last.studentId)
      : undefined,
  };
}

function compareStudentPortalRecords(left: StudentProfileStorageRecord, right: StudentProfileStorageRecord): number {
  return left.lastName.localeCompare(right.lastName, "tr-TR", { sensitivity: "base" })
    || left.firstName.localeCompare(right.firstName, "tr-TR", { sensitivity: "base" })
    || left.id.localeCompare(right.id);
}

function encodeStudentPortalCursor(studentId: string): string {
  return Buffer.from(studentId, "utf8").toString("base64url");
}

function decodeStudentPortalCursor(cursor: string): string {
  const studentId = Buffer.from(cursor, "base64url").toString("utf8");
  if (!studentId || Buffer.from(studentId, "utf8").toString("base64url") !== cursor) {
    throw new Error("STUDENT_PORTAL_CURSOR_INVALID");
  }
  return studentId;
}

/**
 * Keyset sort keys. Nullable columns sort as '' so the key is never NULL (a NULL key would break the
 * `(key, id) > (cursorKey, cursorId)` predicate); students without a number or class come first in ascending order.
 * `keyOf` is the in-memory counterpart of `keySql`.
 */
function studentRegistrySortDefinition(sort: StudentListSort): {
  keySql: string;
  keyOf(student: StudentRecord): string;
  direction: CursorSortDirection;
} {
  const field = sort.replace(/^-/, "");
  const direction: CursorSortDirection = sort.startsWith("-") ? "DESC" : "ASC";
  if (field === "firstName") return { keySql: 'lower(student."firstName")', keyOf: (student) => student.firstName.toLowerCase(), direction };
  if (field === "studentNo") return { keySql: `coalesce(student."studentNo", '')`, keyOf: (student) => student.studentNo ?? "", direction };
  if (field === "classId") return { keySql: `coalesce(student."classId", '')`, keyOf: (student) => student.classId ?? "", direction };
  return { keySql: 'lower(student."lastName")', keyOf: (student) => student.lastName.toLowerCase(), direction };
}

function studentRegistryCursorContext(tenantId: string, query: StudentRegistryQuery): string {
  // Binds the request filters only. The derived scope lists (classIds from campus scope, teacher student/class ids)
  // are re-applied by every page query, so a scope change between pages narrows or widens the next page instead of
  // invalidating the cursor; it can never return a row outside the caller's current scope.
  return listCursorContext("students", tenantId, {
    classId: query.classId,
    gradeLevelId: query.gradeLevelId,
    hasContact: query.hasContact,
    ids: query.ids,
    q: normalizeSearchTerm(query.q),
    responsibleTeacherId: query.responsibleTeacherId,
    sort: query.sort,
    status: query.status,
    teacherId: query.teacherId,
  });
}

function maskEmail(value: string): string {
  const [localPart = "", domain = ""] = value.split("@");
  if (!domain) return "E-posta kayıtlı";
  return `${localPart.slice(0, 2) || "••"}••@${domain.replace(/^[^.]*/, "•••")}`;
}

async function selectStudentProfileById(client: Queryable, id: string): Promise<StudentProfileStorageRecord | undefined> {
  const result = await client.query<StudentRow>(
    `SELECT * FROM "Student" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
    [id],
  );
  return result.rows[0] ? toStudentProfileStorageRecord(result.rows[0]) : undefined;
}
