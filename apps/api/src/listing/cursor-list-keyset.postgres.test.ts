import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  ApiCursorListMeta,
  IdentityInvitationListQuery,
  StudentListSort,
  TenantUserListSort,
} from "@o-okul/shared-types";
import { PostgresIdentityInvitationStore, identityInvitationCursorInvalid } from "../identity-invitation/identity-invitation-store.js";
import { PostgresStudentStore, studentCursorInvalid, type StudentRegistryQuery } from "../student/student-store.js";
import { PostgresUserManagementStore, tenantUserCursorInvalid } from "../user-management/user-management-store.js";
import type { CursorDirection } from "./cursor-pagination.js";

// Keyset cursor lists of f2609c04f (GET /students, /tenant-users, /identity-invitations) on real PostgreSQL under
// the `app` role and FORCE RLS: every sort is walked to the end and back, against an ORDER BY reference query.
const appDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
if (process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1" && (!appDatabaseUrl || !adminDatabaseUrl)) {
  throw new Error("EMPLOYEE_ACTIVATION_POSTGRES_URLS_REQUIRED");
}
const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

const tenantA = "cursor-keyset-tenant-a";
const tenantB = "cursor-keyset-tenant-b";
const tenantIds = [tenantA, tenantB];

const studentSorts: StudentListSort[] = ["lastName", "-lastName", "firstName", "-firstName", "studentNo", "-studentNo", "classId", "-classId"];
const tenantUserSorts: TenantUserListSort[] = ["email", "-email", "name", "-name"];
const invitationSorts: IdentityInvitationListQuery["sort"][] = ["-createdAt", "createdAt"];

type Page<T> = { records: T[]; meta: ApiCursorListMeta };
type FetchPage<T> = (cursor: string | undefined, direction: CursorDirection) => Promise<Page<T>>;

describePostgres("cursor list keyset pagination on PostgreSQL", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl, max: 3 });
  const students = new PostgresStudentStore(app);
  const users = new PostgresUserManagementStore(app);
  const invitations = new PostgresIdentityInvitationStore(app);

  beforeAll(async () => {
    await cleanup(admin);
    for (const tenantId of tenantIds) {
      await admin.query(`INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt") VALUES ($1, $1, $1, 'ACTIVE', now())`, [tenantId]);
    }
    await seedStudents(admin, tenantA, 23);
    await seedStudents(admin, tenantB, 6);
    await seedTenantUsers(admin, tenantA, 17);
    await seedTenantUsers(admin, tenantB, 5);
    await seedInvitations(admin, tenantA, 19);
    await seedInvitations(admin, tenantB, 5);
  });

  afterAll(async () => {
    await cleanup(admin);
    await Promise.all([admin.end(), app.end()]);
  });

  describe("GET /students registry (PostgresStudentStore.listRegistryPage)", () => {
    const fetchStudents = (tenantId: string, sort: StudentListSort, extra: Partial<StudentRegistryQuery> = {}): FetchPage<{ id: string; tenantId: string }> =>
      (cursor, direction) => students.listRegistryPage(tenantId, { cursor, direction, limit: 5, sort, ...extra });

    it.each(studentSorts)("walks sort=%s forward to the end and back to the start without gaps or duplicates", async (sort) => {
      const expected = await studentReferenceOrder(admin, tenantA, sort);
      expect(expected).toHaveLength(23);
      const walk = await walkBothWays(fetchStudents(tenantA, sort), 5);
      expect(walk.forward).toEqual(expected);
      expect(walk.backward).toEqual(expected);
      expect(walk.forwardPages.length).toBeGreaterThanOrEqual(3);
      expect(walk.backwardPages).toEqual(walk.forwardPages);
      expect(walk.records.every((record) => record.tenantId === tenantA)).toBe(true);
      expect(walk.totals).toEqual(new Set([23]));
    });

    it("orders NULL classId first ascending and last descending, with ties broken by id", async () => {
      const nullClassIds = (await admin.query<{ id: string }>(
        `SELECT "id" FROM "Student" WHERE "tenantId" = $1 AND "classId" IS NULL AND "deletedAt" IS NULL ORDER BY "id"`,
        [tenantA],
      )).rows.map((row) => row.id);
      expect(nullClassIds.length).toBeGreaterThan(5);
      const ascending = (await walkBothWays(fetchStudents(tenantA, "classId"), 5)).forward;
      const descending = (await walkBothWays(fetchStudents(tenantA, "-classId"), 5)).forward;
      expect(ascending.slice(0, nullClassIds.length)).toEqual(nullClassIds);
      expect(descending.slice(-nullClassIds.length)).toEqual([...nullClassIds].reverse());
    });

    it("matches q in SQL with LIKE wildcards escaped and keeps meta.total filtered", async () => {
      const byLastName = await walkBothWays(fetchStudents(tenantA, "lastName", { q: "  BULUT " }), 5);
      const expectedBulut = await studentReferenceOrder(admin, tenantA, "lastName", `lower("lastName") = 'bulut'`);
      expect(expectedBulut.length).toBeGreaterThan(5);
      expect(byLastName.forward).toEqual(expectedBulut);
      expect(byLastName.backward).toEqual(expectedBulut);
      expect(byLastName.totals).toEqual(new Set([expectedBulut.length]));

      const byStudentNo = await students.listRegistryPage(tenantA, { direction: "next", limit: 5, sort: "studentNo", q: "a-0007" });
      expect(byStudentNo.records.map((record) => record.studentNo)).toEqual(["A-0007"]);
      expect(byStudentNo.meta.total).toBe(1);

      for (const wildcard of ["_", "%"]) {
        const page = await students.listRegistryPage(tenantA, { direction: "next", limit: 5, sort: "lastName", q: wildcard });
        expect(page.records).toEqual([]);
        expect(page.meta.total).toBe(0);
      }
    });

    it("never returns tenant B rows and rejects foreign, re-targeted and re-sorted cursors", async () => {
      const tenantBWalk = await walkBothWays(fetchStudents(tenantB, "lastName"), 5);
      expect(tenantBWalk.forward).toEqual(await studentReferenceOrder(admin, tenantB, "lastName"));
      expect(tenantBWalk.records.every((record) => record.tenantId === tenantB)).toBe(true);
      expect(tenantBWalk.totals).toEqual(new Set([6]));

      const tenantBCursor = (await students.listRegistryPage(tenantB, { direction: "next", limit: 2, sort: "lastName" })).meta.nextCursor!;
      await expect(students.listRegistryPage(tenantA, { cursor: tenantBCursor, direction: "next", limit: 5, sort: "lastName" }))
        .rejects.toThrow(studentCursorInvalid);

      const tenantACursor = (await students.listRegistryPage(tenantA, { direction: "next", limit: 5, sort: "lastName" })).meta.nextCursor!;
      const foreignRowCursor = retargetCursor(tenantACursor, tenantBWalk.forward[0]!);
      await expect(students.listRegistryPage(tenantA, { cursor: foreignRowCursor, direction: "next", limit: 5, sort: "lastName" }))
        .rejects.toThrow(studentCursorInvalid);
      await expect(students.listRegistryPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 5, sort: "firstName" }))
        .rejects.toThrow(studentCursorInvalid);
      await expect(students.listRegistryPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 5, sort: "lastName", q: "bulut" }))
        .rejects.toThrow(studentCursorInvalid);
    });

    it("rejects a cursor whose anchor row was soft-deleted", async () => {
      const deletedId = (await admin.query<{ id: string }>(
        `SELECT "id" FROM "Student" WHERE "tenantId" = $1 AND "deletedAt" IS NOT NULL LIMIT 1`,
        [tenantA],
      )).rows[0]!.id;
      const cursor = (await students.listRegistryPage(tenantA, { direction: "next", limit: 5, sort: "lastName" })).meta.nextCursor!;
      await expect(students.listRegistryPage(tenantA, { cursor: retargetCursor(cursor, deletedId), direction: "next", limit: 5, sort: "lastName" }))
        .rejects.toThrow(studentCursorInvalid);
    });
  });

  describe("GET /tenant-users (PostgresUserManagementStore.listTenantUserPage)", () => {
    const fetchUsers = (tenantId: string, sort: TenantUserListSort, q?: string): FetchPage<{ id: string; tenantId: string; roles: string[] }> =>
      (cursor, direction) => users.listTenantUserPage(tenantId, { cursor, direction, limit: 4, sort, q });

    it.each(tenantUserSorts)("walks sort=%s forward and back with one row per account", async (sort) => {
      const expected = await tenantUserReferenceOrder(admin, tenantA, sort);
      expect(expected).toHaveLength(17);
      const walk = await walkBothWays(fetchUsers(tenantA, sort), 4);
      expect(walk.forward).toEqual(expected);
      expect(walk.backward).toEqual(expected);
      expect(walk.forwardPages.length).toBeGreaterThanOrEqual(3);
      expect(walk.backwardPages).toEqual(walk.forwardPages);
      expect(walk.records.every((record) => record.tenantId === tenantA)).toBe(true);
      expect(walk.totals).toEqual(new Set([17]));
      const multiRole = walk.records.find((record) => record.id === `${tenantA}-user-000`);
      expect(multiRole?.roles).toEqual(["GUARDIAN", "TEACHER"]);
    });

    it("matches q on name, email and role, escapes LIKE wildcards and reports the filtered total", async () => {
      const byName = await walkBothWays(fetchUsers(tenantA, "email", "ayse demir"), 4);
      const expectedByName = await tenantUserReferenceOrder(admin, tenantA, "email", `lower(u."name") = 'ayse demir'`);
      expect(expectedByName.length).toBeGreaterThan(4);
      expect(byName.forward).toEqual(expectedByName);
      expect(byName.backward).toEqual(expectedByName);
      expect(byName.totals).toEqual(new Set([expectedByName.length]));

      const byEmail = await users.listTenantUserPage(tenantA, { direction: "next", limit: 4, sort: "name", q: "USER-003@" });
      expect(byEmail.records.map((record) => record.id)).toEqual([`${tenantA}-user-003`]);
      expect(byEmail.meta.total).toBe(1);

      const byRole = await walkBothWays(fetchUsers(tenantA, "name", "guardian"), 4);
      expect(byRole.forward).toEqual([`${tenantA}-user-000`]);

      // `_` only matches the literal underscore in OPERATIONS_STAFF, never "any character".
      const underscore = await walkBothWays(fetchUsers(tenantA, "name", "_"), 4);
      const expectedUnderscore = await tenantUserReferenceOrder(admin, tenantA, "name", `EXISTS (
        SELECT 1 FROM "TenantMembership" staff WHERE staff."userId" = u."id" AND staff."role" = 'OPERATIONS_STAFF'
      )`);
      expect(expectedUnderscore.length).toBeGreaterThan(4);
      expect(underscore.forward).toEqual(expectedUnderscore);
      expect(underscore.totals).toEqual(new Set([expectedUnderscore.length]));
      const percent = await users.listTenantUserPage(tenantA, { direction: "next", limit: 4, sort: "name", q: "%" });
      expect(percent.records).toEqual([]);
      expect(percent.meta.total).toBe(0);
    });

    it("never returns tenant B accounts and rejects foreign and re-targeted cursors", async () => {
      const tenantBWalk = await walkBothWays(fetchUsers(tenantB, "name"), 4);
      expect(tenantBWalk.forward).toEqual(await tenantUserReferenceOrder(admin, tenantB, "name"));
      expect(tenantBWalk.totals).toEqual(new Set([5]));

      const tenantBCursor = (await users.listTenantUserPage(tenantB, { direction: "next", limit: 2, sort: "name" })).meta.nextCursor!;
      await expect(users.listTenantUserPage(tenantA, { cursor: tenantBCursor, direction: "next", limit: 4, sort: "name" }))
        .rejects.toThrow(tenantUserCursorInvalid);

      const tenantACursor = (await users.listTenantUserPage(tenantA, { direction: "next", limit: 4, sort: "name" })).meta.nextCursor!;
      await expect(users.listTenantUserPage(tenantA, { cursor: retargetCursor(tenantACursor, tenantBWalk.forward[0]!), direction: "next", limit: 4, sort: "name" }))
        .rejects.toThrow(tenantUserCursorInvalid);
      await expect(users.listTenantUserPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 4, sort: "email" }))
        .rejects.toThrow(tenantUserCursorInvalid);
    });
  });

  describe("GET /identity-invitations (PostgresIdentityInvitationStore.listPage)", () => {
    const fetchInvitations = (
      tenantId: string,
      sort: IdentityInvitationListQuery["sort"],
      extra: Partial<IdentityInvitationListQuery> = {},
    ): FetchPage<{ id: string; tenantId: string }> =>
      (cursor, direction) => invitations.listPage(tenantId, { cursor, direction, limit: 4, sort, ...extra });

    it.each(invitationSorts)("walks sort=%s across duplicate createdAt values forward and back", async (sort) => {
      const expected = await invitationReferenceOrder(admin, tenantA, sort);
      expect(expected).toHaveLength(19);
      const walk = await walkBothWays(fetchInvitations(tenantA, sort), 4);
      expect(walk.forward).toEqual(expected);
      expect(walk.backward).toEqual(expected);
      expect(walk.forwardPages.length).toBeGreaterThanOrEqual(3);
      expect(walk.backwardPages).toEqual(walk.forwardPages);
      expect(walk.records.every((record) => record.tenantId === tenantA)).toBe(true);
    });

    it("applies exact filters and q in SQL, with LIKE wildcards escaped", async () => {
      const teacherPending = await walkBothWays(fetchInvitations(tenantA, "-createdAt", { subjectType: "TEACHER", status: "PENDING" }), 4);
      const expectedTeacherPending = await invitationReferenceOrder(admin, tenantA, "-createdAt", `"subjectType" = 'TEACHER' AND "status" = 'PENDING'`);
      expect(expectedTeacherPending.length).toBeGreaterThan(4);
      expect(teacherPending.forward).toEqual(expectedTeacherPending);
      expect(teacherPending.backward).toEqual(expectedTeacherPending);

      const bySubjectId = await invitations.listPage(tenantA, { direction: "next", limit: 4, sort: "-createdAt", subjectId: `${tenantA}-subject-005` });
      expect(bySubjectId.records.map((record) => record.id)).toEqual([`${tenantA}-invitation-005`]);

      const byQuerySubjectId = await invitations.listPage(tenantA, { direction: "next", limit: 4, sort: "-createdAt", q: "SUBJECT-005" });
      expect(byQuerySubjectId.records.map((record) => record.id)).toEqual([`${tenantA}-invitation-005`]);

      const byName = await walkBothWays(fetchInvitations(tenantA, "createdAt", { q: "davet bulut" }), 4);
      expect(byName.forward).toEqual(await invitationReferenceOrder(admin, tenantA, "createdAt", `lower("name") = 'davet bulut'`));

      const byEmail = await invitations.listPage(tenantA, { direction: "next", limit: 4, sort: "-createdAt", q: `INVITE-011@${tenantA}` });
      expect(byEmail.records.map((record) => record.id)).toEqual([`${tenantA}-invitation-011`]);

      for (const wildcard of ["_", "%"]) {
        const page = await invitations.listPage(tenantA, { direction: "next", limit: 4, sort: "-createdAt", q: wildcard });
        expect(page.records).toEqual([]);
      }
    });

    it("never returns tenant B invitations and rejects foreign, re-targeted and re-filtered cursors", async () => {
      const tenantBWalk = await walkBothWays(fetchInvitations(tenantB, "-createdAt"), 4);
      expect(tenantBWalk.forward).toEqual(await invitationReferenceOrder(admin, tenantB, "-createdAt"));
      expect(tenantBWalk.records.every((record) => record.tenantId === tenantB)).toBe(true);

      const tenantBCursor = (await invitations.listPage(tenantB, { direction: "next", limit: 2, sort: "-createdAt" })).meta.nextCursor!;
      await expect(invitations.listPage(tenantA, { cursor: tenantBCursor, direction: "next", limit: 4, sort: "-createdAt" }))
        .rejects.toThrow(identityInvitationCursorInvalid);

      const tenantACursor = (await invitations.listPage(tenantA, { direction: "next", limit: 4, sort: "-createdAt" })).meta.nextCursor!;
      await expect(invitations.listPage(tenantA, { cursor: retargetCursor(tenantACursor, tenantBWalk.forward[0]!), direction: "next", limit: 4, sort: "-createdAt" }))
        .rejects.toThrow(identityInvitationCursorInvalid);
      await expect(invitations.listPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 4, sort: "-createdAt", status: "PENDING" }))
        .rejects.toThrow(identityInvitationCursorInvalid);
    });
  });
});

/**
 * Walks `next` from the first page until no `nextCursor`, then `previous` from the last page until no
 * `previousCursor`, and returns both id sequences plus the page boundaries of each walk.
 */
async function walkBothWays<T extends { id: string }>(fetchPage: FetchPage<T>, limit: number) {
  const forwardPages: string[][] = [];
  const records: T[] = [];
  const totals = new Set<number | undefined>();
  let page = await fetchPage(undefined, "next");
  expect(page.meta.previousCursor).toBeUndefined();
  for (let guard = 0; ; guard += 1) {
    expect(guard).toBeLessThan(100);
    expect(page.records.length).toBeLessThanOrEqual(limit);
    forwardPages.push(page.records.map((record) => record.id));
    records.push(...page.records);
    totals.add(page.meta.total);
    if (!page.meta.nextCursor) break;
    expect(page.records).toHaveLength(limit);
    page = await fetchPage(page.meta.nextCursor, "next");
    expect(page.records.length).toBeGreaterThan(0);
    expect(page.meta.previousCursor).toBeDefined();
  }

  const backwardPages: string[][] = [forwardPages.at(-1)!];
  let cursor = page.meta.previousCursor;
  for (let guard = 0; cursor; guard += 1) {
    expect(guard).toBeLessThan(100);
    const previous = await fetchPage(cursor, "previous");
    expect(previous.records.length).toBeGreaterThan(0);
    expect(previous.meta.nextCursor).toBeDefined();
    backwardPages.unshift(previous.records.map((record) => record.id));
    totals.add(previous.meta.total);
    cursor = previous.meta.previousCursor;
  }

  const forward = forwardPages.flat();
  const backward = backwardPages.flat();
  expect(new Set(forward).size).toBe(forward.length);
  expect(new Set(backward).size).toBe(backward.length);
  return { forward, backward, forwardPages, backwardPages, records, totals };
}

/** Same opaque cursor (tenant, filter and sort binding intact) pointing at a different anchor id. */
function retargetCursor(cursor: string, id: string): string {
  const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
  return Buffer.from(JSON.stringify({ ...payload, id }), "utf8").toString("base64url");
}

// Reference orders: one full ORDER BY per sort, read as the superuser without any keyset predicate.
const studentSortSql: Record<string, string> = {
  lastName: `lower("lastName")`,
  firstName: `lower("firstName")`,
  studentNo: `coalesce("studentNo", '')`,
  classId: `coalesce("classId", '')`,
};

async function studentReferenceOrder(pool: pg.Pool, tenantId: string, sort: StudentListSort, extraFilter?: string): Promise<string[]> {
  const direction = sort.startsWith("-") ? "DESC" : "ASC";
  const result = await pool.query<{ id: string }>(
    `SELECT "id" FROM "Student"
     WHERE "tenantId" = $1 AND "deletedAt" IS NULL ${extraFilter ? `AND ${extraFilter}` : ""}
     ORDER BY ${studentSortSql[sort.replace(/^-/, "")]} ${direction}, "id" ${direction}`,
    [tenantId],
  );
  return result.rows.map((row) => row.id);
}

async function tenantUserReferenceOrder(pool: pg.Pool, tenantId: string, sort: TenantUserListSort, extraFilter?: string): Promise<string[]> {
  const direction = sort.startsWith("-") ? "DESC" : "ASC";
  const key = sort.replace(/^-/, "") === "name" ? `lower(u."name")` : `lower(coalesce(u."email", u."name"))`;
  const result = await pool.query<{ id: string }>(
    `SELECT u."id" FROM "User" u
     WHERE EXISTS (SELECT 1 FROM "TenantMembership" m WHERE m."tenantId" = $1 AND m."userId" = u."id")
       ${extraFilter ? `AND ${extraFilter}` : ""}
     ORDER BY ${key} ${direction}, u."id" ${direction}`,
    [tenantId],
  );
  return result.rows.map((row) => row.id);
}

async function invitationReferenceOrder(
  pool: pg.Pool,
  tenantId: string,
  sort: IdentityInvitationListQuery["sort"],
  extraFilter?: string,
): Promise<string[]> {
  const direction = sort === "createdAt" ? "ASC" : "DESC";
  const result = await pool.query<{ id: string }>(
    `SELECT "id" FROM "IdentityInvitation"
     WHERE "tenantId" = $1 ${extraFilter ? `AND ${extraFilter}` : ""}
     ORDER BY "createdAt" ${direction}, "id" ${direction}`,
    [tenantId],
  );
  return result.rows.map((row) => row.id);
}

const lastNames = ["Aksoy", "BULUT", "celik", "Bulut", "Demir"];
const firstNames = ["Ada", "Bora", "Cem", "ada", "Ece"];

/**
 * `count` active students plus one soft-deleted student. Sort keys repeat (case-insensitively), and every third
 * student has no class, so NULL and duplicate keys fall on page boundaries. `studentNo` is NOT NULL in the schema.
 */
async function seedStudents(pool: pg.Pool, tenantId: string, count: number): Promise<void> {
  const prefix = tenantId === tenantA ? "A" : "B";
  const classIds = [`${tenantId}-class-1`, `${tenantId}-class-2`];
  for (const [index, classId] of classIds.entries()) {
    await pool.query(
      `INSERT INTO "Class" ("id", "tenantId", "name", "updatedAt") VALUES ($1, $2, $3, now())`,
      [classId, tenantId, `${prefix} Sinif ${index + 1}`],
    );
  }
  for (let index = 0; index < count; index += 1) {
    await pool.query(
      `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "classId", "status", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', now())`,
      [
        `${tenantId}-student-${String(index).padStart(3, "0")}`,
        tenantId,
        `${prefix}-${String(index).padStart(4, "0")}`,
        firstNames[index % firstNames.length],
        lastNames[(index * 7) % lastNames.length],
        index % 3 === 0 ? null : classIds[index % 2],
      ],
    );
  }
  await pool.query(
    `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "status", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, 'Silinmis', 'Bulut', 'PASSIVE', now(), now())`,
    [`${tenantId}-student-deleted`, tenantId, `${prefix}-DELETED`],
  );
}

/**
 * `count` accounts; user 000 holds two memberships (TEACHER + GUARDIAN) and must still be listed once. Names
 * repeat and every fourth account has no e-mail, so the email sort falls back to the name for those rows.
 */
async function seedTenantUsers(pool: pg.Pool, tenantId: string, count: number): Promise<void> {
  const names = ["Ayse Demir", "Mehmet Kaya", "ayse demir", "Zeynep Ak"];
  for (let index = 0; index < count; index += 1) {
    const id = `${tenantId}-user-${String(index).padStart(3, "0")}`;
    const email = index % 4 === 1 ? null : `user-${String(index).padStart(3, "0")}@${tenantId}.example.test`;
    await pool.query(
      `INSERT INTO "User" ("id", "tenantId", "name", "email", "emailNormalized", "passwordHash", "updatedAt")
       VALUES ($1, $2, $3, $4, $4, 'FIXTURE_HASH', now())`,
      [id, tenantId, names[index % names.length], email],
    );
    const roles = index === 0 ? ["TEACHER", "GUARDIAN"] : [index % 2 ? "TEACHER" : "OPERATIONS_STAFF"];
    for (const role of roles) {
      await pool.query(
        `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt") VALUES ($1, $2, $3, $4, now())`,
        [`${id}-${role.toLowerCase()}`, tenantId, id, role],
      );
    }
  }
}

/** `count` invitations whose `createdAt` repeats in groups of three, mixing subject types and statuses. */
async function seedInvitations(pool: pg.Pool, tenantId: string, count: number): Promise<void> {
  const subjectTypes = ["TEACHER", "GUARDIAN", "TEACHER", "STUDENT"];
  const statuses = ["PENDING", "PENDING", "REVOKED", "ACCEPTED"];
  const names = ["Davet Aksoy", "Davet Bulut", "davet bulut"];
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const subjectType = subjectTypes[index % subjectTypes.length]!;
    await pool.query(
      `INSERT INTO "IdentityInvitation" (
         "id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "kind", "tokenHash", "status",
         "expiresAt", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::"TenantRole", 'EMAIL_LINK', $8, $9, now() + interval '1 day',
         timestamp '2026-10-01 09:00:00' + make_interval(mins => $10), now())`,
      [
        `${tenantId}-invitation-${suffix}`,
        tenantId,
        subjectType,
        `${tenantId}-subject-${suffix}`,
        `invite-${suffix}@${tenantId}.example.test`,
        names[index % names.length],
        subjectType,
        `cursor-keyset-token-${tenantId}-${suffix}`,
        statuses[(index + Math.floor(index / 4)) % statuses.length],
        Math.floor(index / 3),
      ],
    );
  }
}

async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM "IdentityInvitation" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "Student" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "Class" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "TenantMembership" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "User" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [tenantIds]);
}
