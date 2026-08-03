import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery, withTenantQuery } from "../db/tenant-query.js";
import type { StudentRecord } from "./student.service.js";
import type {
  ApiCursorListMeta,
  StudentEnrollmentRecord,
  StudentPortalAccessRecord,
  StudentPortalAccessUpdateRequest,
  StudentPortalAccessUpdateResult,
} from "@o-okul/shared-types";
import type { StudentEnrollmentInput } from "./student-enrollment-store.js";

type StudentInput = Omit<StudentRecord, "id" | "status"> & Partial<Pick<StudentRecord, "status" | "studentNo">>;
const studentNoStart = 100;

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

export interface StudentStore {
  list(): Promise<StudentRecord[]>;
  listPortalAccess(tenantId: string, query: StudentPortalAccessQuery): Promise<StudentPortalAccessPage>;
  updatePortalAccess(
    tenantId: string,
    id: string,
    input: StudentPortalAccessUpdateRequest,
  ): Promise<StudentPortalAccessUpdateResult | undefined>;
  findById(id: string): Promise<StudentRecord | undefined>;
  findProfileById(id: string): Promise<StudentProfileStorageRecord | undefined>;
  findByUserId(tenantId: string, userId: string): Promise<StudentRecord | undefined>;
  findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<StudentProfileStorageRecord | undefined>;
  create(input: StudentInput): Promise<StudentRecord>;
  createMany(inputs: StudentInput[]): Promise<StudentRecord[]>;
  createWithEnrollment?(
    input: StudentInput,
    enrollment: Omit<StudentEnrollmentInput, "tenantId" | "studentId">,
  ): Promise<StudentRecord>;
  createManyWithEnrollments?(
    inputs: Array<{
      student: StudentInput;
      enrollment?: Omit<StudentEnrollmentInput, "tenantId" | "studentId">;
    }>,
  ): Promise<StudentRecord[]>;
  updateWithEnrollmentTransition?(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>,
    transition: StudentEnrollmentTransition,
  ): Promise<StudentEnrollmentTransitionResult | undefined>;
  update(id: string, input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>): Promise<StudentRecord | undefined>;
  updateProfile(id: string, input: StudentProfileUpdate): Promise<StudentProfileStorageRecord | undefined>;
  bindUser(tenantId: string, id: string, userId: string): Promise<StudentRecord | undefined>;
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

  async listPortalAccess(tenantId: string, query: StudentPortalAccessQuery): Promise<StudentPortalAccessPage> {
    const normalizedQuery = query.q?.trim().toLocaleLowerCase("tr-TR");
    const records = this.students
      .filter((student) => student.tenantId === tenantId && !student.deletedAt)
      .filter((student) => !query.studentIds || query.studentIds.includes(student.id))
      .filter((student) => !normalizedQuery || `${student.firstName} ${student.lastName} ${student.studentNo}`.toLocaleLowerCase("tr-TR").includes(normalizedQuery))
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

  async createMany(inputs: StudentInput[]): Promise<StudentRecord[]> {
    const created: StudentRecord[] = [];
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
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>,
  ): Promise<StudentRecord | undefined> {
    const student = await this.findById(id);
    if (!student) return undefined;

    if (input.firstName !== undefined) student.firstName = input.firstName;
    if (input.lastName !== undefined) student.lastName = input.lastName;
    if (input.classId !== undefined) student.classId = input.classId || undefined;
    if (input.responsibleTeacherId !== undefined) student.responsibleTeacherId = input.responsibleTeacherId || undefined;
    if (input.status !== undefined) student.status = input.status;
    return student;
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
             AND lower(
               coalesce(search_student."firstName", '') || ' ' ||
               coalesce(search_student."lastName", '') || ' ' ||
               coalesce(search_student."studentNo", '')
             ) LIKE $2 ESCAPE '\\'
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
        [tenantId, searchPattern(query.q), cursorId ?? null, query.limit + 1, query.studentIds ?? null],
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

  async findProfileById(id: string): Promise<StudentProfileStorageRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `SELECT * FROM "Student" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toStudentProfileStorageRecord(result.rows[0]) : undefined;
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
      await lockStudentNoAllocation(client, input.tenantId);
      const studentNo = normalizeStudentNo(input.studentNo) ?? await nextStudentNo(client, input.tenantId);
      const result = await client.query<StudentRow>(
        `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "classId", "responsibleTeacherId", "status", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          studentNo,
          input.firstName,
          input.lastName,
          input.classId ?? null,
          input.responsibleTeacherId ?? null,
          input.status ?? "ACTIVE",
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("STUDENT_CREATE_FAILED");
      }
      return toStudentRecord(record);
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

  async createManyWithEnrollments(
    inputs: Array<{
      student: StudentInput;
      enrollment?: Omit<StudentEnrollmentInput, "tenantId" | "studentId">;
    }>,
  ): Promise<StudentRecord[]> {
    if (inputs.length === 0) return [];

    return withTenantQuery(this.pool, async (client) => {
      const created: StudentRecord[] = [];
      for (const input of inputs) {
        const student = await insertStudent(client, input.student);
        if (input.enrollment) {
          await insertEnrollment(client, student, input.enrollment);
        }
        created.push(student);
      }
      return created;
    });
  }

  async updateWithEnrollmentTransition(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>,
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

  async createMany(inputs: StudentInput[]): Promise<StudentRecord[]> {
    if (inputs.length === 0) return [];

    return withTenantQuery(this.pool, async (client) => {
      const created: StudentRecord[] = [];
      for (const input of inputs) {
        await lockStudentNoAllocation(client, input.tenantId);
        const studentNo = normalizeStudentNo(input.studentNo) ?? await nextStudentNo(client, input.tenantId);
        const result = await client.query<StudentRow>(
          `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "classId", "status", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           RETURNING *`,
          [randomUUID(), input.tenantId, studentNo, input.firstName, input.lastName, input.classId ?? null, input.status ?? "ACTIVE"],
        );
        if (!result.rows[0]) {
          throw new Error("STUDENT_CREATE_FAILED");
        }
        created.push(toStudentRecord(result.rows[0]));
      }
      return created;
    });
  }

  async update(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>,
  ): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await updateStudent(client, id, input);
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
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

async function insertStudent(client: Queryable, input: StudentInput): Promise<StudentRecord> {
  await lockStudentNoAllocation(client, input.tenantId);
  const studentNo = normalizeStudentNo(input.studentNo) ?? await nextStudentNo(client, input.tenantId);
  const result = await client.query<StudentRow>(
    `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "classId", "responsibleTeacherId", "status", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     RETURNING *`,
    [
      randomUUID(),
      input.tenantId,
      studentNo,
      input.firstName,
      input.lastName,
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
       "id", "tenantId", "studentId", "academicYearId", "termId", "classId",
       "status", "startsAt", "endsAt", "reason", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, now())
     RETURNING *`,
    [
      randomUUID(),
      student.tenantId,
      student.id,
      input.academicYearId ?? null,
      input.termId ?? null,
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

function updateStudent(
  client: Queryable,
  id: string,
  input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>,
): Promise<{ rows: StudentRow[]; rowCount?: number | null }> {
  return client.query<StudentRow>(
    `UPDATE "Student"
     SET "firstName" = COALESCE($2, "firstName"),
         "lastName" = COALESCE($3, "lastName"),
         "classId" = CASE WHEN $4 THEN $5 ELSE "classId" END,
         "responsibleTeacherId" = CASE WHEN $6 THEN $7 ELSE "responsibleTeacherId" END,
         "status" = COALESCE($8, "status"),
         "updatedAt" = now()
     WHERE "id" = $1
       AND "deletedAt" IS NULL
     RETURNING *`,
    [
      id,
      input.firstName ?? null,
      input.lastName ?? null,
      input.classId !== undefined,
      input.classId || null,
      input.responsibleTeacherId !== undefined,
      input.responsibleTeacherId || null,
      input.status ?? null,
    ],
  );
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

function searchPattern(value: string | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase("tr-TR");
  return normalized ? `%${normalized.replace(/[\\%_]/g, "\\$&")}%` : null;
}

function maskEmail(value: string): string {
  const [localPart = "", domain = ""] = value.split("@");
  if (!domain) return "E-posta kayıtlı";
  return `${localPart.slice(0, 2) || "••"}••@${domain.replace(/^[^.]*/, "•••")}`;
}
