import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  ApiCursorListMeta,
  EmployeeAccessSort,
  IdentityInvitationListQuery,
  StudentListSort,
  TenantUserListSort,
} from "@o-okul/shared-types";
import { PostgresIdentityInvitationStore, identityInvitationCursorInvalid } from "../identity-invitation/identity-invitation-store.js";
import { PostgresStudentStore, studentCursorInvalid, type StudentRegistryQuery } from "../student/student-store.js";
import { PostgresUserManagementStore, employeeCursorInvalid, tenantUserCursorInvalid } from "../user-management/user-management-store.js";
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
// Tenant C holds the Turkish-name fixtures and the rows the boundary-mutation tests change between pages.
const tenantC = "cursor-keyset-tenant-c";
const tenantIds = [tenantA, tenantB, tenantC];

const studentSorts: StudentListSort[] = ["lastName", "-lastName", "firstName", "-firstName", "studentNo", "-studentNo", "classId", "-classId"];
const tenantUserSorts: TenantUserListSort[] = ["email", "-email", "name", "-name"];
const invitationSorts: IdentityInvitationListQuery["sort"][] = ["-createdAt", "createdAt"];
const employeeSorts: EmployeeAccessSort[] = ["lastName", "-lastName", "firstName", "employeeNo"];

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
    await seedTurkishFixtures(admin, tenantC);
    await seedEmployees(admin, tenantA, 14);
    await seedEmployees(admin, tenantB, 4);
    await seedTurkishEmployees(admin, tenantC);
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
      // A cursor only carries a keyset position; pointing it at a tenant B id still pages tenant A rows only.
      const foreignRowCursor = retargetCursor(tenantACursor, tenantBWalk.forward[0]!);
      const foreignRowPage = await students.listRegistryPage(tenantA, { cursor: foreignRowCursor, direction: "next", limit: 5, sort: "lastName" });
      expect(foreignRowPage.records.length).toBeGreaterThan(0);
      expect(foreignRowPage.records.every((record) => record.tenantId === tenantA)).toBe(true);
      await expect(students.listRegistryPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 5, sort: "firstName" }))
        .rejects.toThrow(studentCursorInvalid);
      await expect(students.listRegistryPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 5, sort: "lastName", q: "bulut" }))
        .rejects.toThrow(studentCursorInvalid);
    });

    it.each(["soft-deleted", "filtered out", "renamed"] as const)(
      "continues after a boundary row that was %s between pages",
      async (change) => {
        const query = { direction: "next" as const, limit: 2, sort: "lastName" as const, status: "ACTIVE" as const };
        const before = await studentReferenceOrder(admin, tenantC, "lastName", `"status" = 'ACTIVE'`);
        expect(before.length).toBeGreaterThanOrEqual(5);
        const first = await students.listRegistryPage(tenantC, query);
        expect(first.records.map((record) => record.id)).toEqual(before.slice(0, 2));
        const boundaryId = before[1]!;
        const original = (await admin.query<{ lastName: string }>(`SELECT "lastName" FROM "Student" WHERE "id" = $1`, [boundaryId])).rows[0]!;
        const mutation = {
          "soft-deleted": `UPDATE "Student" SET "deletedAt" = now() WHERE "id" = $1`,
          "filtered out": `UPDATE "Student" SET "status" = 'PASSIVE' WHERE "id" = $1`,
          renamed: `UPDATE "Student" SET "lastName" = 'ZZZ SONRA' WHERE "id" = $1`,
        }[change];
        await admin.query(mutation, [boundaryId]);
        try {
          const second = await students.listRegistryPage(tenantC, { ...query, cursor: first.meta.nextCursor });
          expect(second.records.map((record) => record.id)).toEqual(before.slice(2, 4));
        } finally {
          await admin.query(
            `UPDATE "Student" SET "deletedAt" = NULL, "status" = 'ACTIVE', "lastName" = $2 WHERE "id" = $1`,
            [boundaryId, original.lastName],
          );
        }
      },
    );

    it.each(["ışık", "IŞIK", "Işık", "işık"])("finds the stored IŞIK student for q=%s (registry and portal access)", async (q) => {
      const registry = await students.listRegistryPage(tenantC, { direction: "next", limit: 10, sort: "lastName", q });
      expect(registry.records.map((record) => record.id)).toEqual([`${tenantC}-student-isik`]);
      expect(registry.meta.total).toBe(1);
      const portal = await students.listPortalAccess(tenantC, { direction: "next", limit: 10, q });
      expect(portal.records.map((record) => record.studentId)).toEqual([`${tenantC}-student-isik`]);
    });

    it.each(["ismail", "İsmail", "ISMAIL", "İSMAİL"])("finds the stored İSMAİL student for q=%s", async (q) => {
      const registry = await students.listRegistryPage(tenantC, { direction: "next", limit: 10, sort: "lastName", q });
      expect(registry.records.map((record) => record.id)).toEqual([`${tenantC}-student-ismail`]);
    });

    it("folds only I variants: an ASCII 'isik' does not match IŞIK", async () => {
      const registry = await students.listRegistryPage(tenantC, { direction: "next", limit: 10, sort: "lastName", q: "isik" });
      expect(registry.records).toEqual([]);
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
      const foreignRowPage = await users.listTenantUserPage(tenantA, { cursor: retargetCursor(tenantACursor, tenantBWalk.forward[0]!), direction: "next", limit: 4, sort: "name" });
      expect(foreignRowPage.records.every((record) => record.tenantId === tenantA)).toBe(true);
      await expect(users.listTenantUserPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 4, sort: "email" }))
        .rejects.toThrow(tenantUserCursorInvalid);
    });
  });

  describe("GET /tenant-users boundary changes and Turkish search", () => {
    it("continues after a boundary account renamed between pages", async () => {
      const query = { direction: "next" as const, limit: 2, sort: "name" as const };
      const before = await tenantUserReferenceOrder(admin, tenantC, "name");
      const first = await users.listTenantUserPage(tenantC, query);
      expect(first.records.map((record) => record.id)).toEqual(before.slice(0, 2));
      const boundaryId = before[1]!;
      const original = (await admin.query<{ name: string }>(`SELECT "name" FROM "User" WHERE "id" = $1`, [boundaryId])).rows[0]!;
      await admin.query(`UPDATE "User" SET "name" = 'ZZZ SONRA' WHERE "id" = $1`, [boundaryId]);
      try {
        const second = await users.listTenantUserPage(tenantC, { ...query, cursor: first.meta.nextCursor });
        expect(second.records.map((record) => record.id)).toEqual(before.slice(2, 4));
      } finally {
        await admin.query(`UPDATE "User" SET "name" = $2 WHERE "id" = $1`, [boundaryId, original.name]);
      }
    });

    it.each([
      ["ışık", "isik"], ["IŞIK", "isik"], ["Işık", "isik"],
      ["ismail", "ismail"], ["İsmail", "ismail"], ["ISMAIL", "ismail"],
    ])("matches q=%s to the stored Turkish-uppercase name", async (q, expected) => {
      const page = await users.listTenantUserPage(tenantC, { direction: "next", limit: 10, sort: "name", q });
      expect(page.records.map((record) => record.id)).toEqual([`${tenantC}-user-${expected}`]);
    });
  });

  describe("GET /employees (PostgresUserManagementStore.listEmployeeAccessPage)", () => {
    const fetchEmployees = (tenantId: string, sort: EmployeeAccessSort, q?: string): FetchPage<{ id: string; tenantId: string }> =>
      (cursor, direction) => users.listEmployeeAccessPage(tenantId, { cursor, direction, limit: 4, sort, q });

    it.each(employeeSorts)("walks sort=%s forward to the end and back to the start", async (sort) => {
      const expected = await employeeReferenceOrder(admin, tenantA, sort);
      expect(expected).toHaveLength(14);
      const walk = await walkBothWays(fetchEmployees(tenantA, sort), 4);
      expect(walk.forward).toEqual(expected);
      expect(walk.backward).toEqual(expected);
      expect(walk.forwardPages.length).toBeGreaterThanOrEqual(3);
      expect(walk.backwardPages).toEqual(walk.forwardPages);
      expect(walk.records.every((record) => record.tenantId === tenantA)).toBe(true);
    });

    it("never returns tenant B employees and rejects foreign, re-sorted and re-searched cursors", async () => {
      const tenantBWalk = await walkBothWays(fetchEmployees(tenantB, "lastName"), 4);
      expect(tenantBWalk.forward).toEqual(await employeeReferenceOrder(admin, tenantB, "lastName"));

      const tenantBCursor = (await users.listEmployeeAccessPage(tenantB, { direction: "next", limit: 2, sort: "lastName" })).meta.nextCursor!;
      await expect(users.listEmployeeAccessPage(tenantA, { cursor: tenantBCursor, direction: "next", limit: 4, sort: "lastName" }))
        .rejects.toThrow(employeeCursorInvalid);
      const tenantACursor = (await users.listEmployeeAccessPage(tenantA, { direction: "next", limit: 4, sort: "lastName" })).meta.nextCursor!;
      await expect(users.listEmployeeAccessPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 4, sort: "firstName" }))
        .rejects.toThrow(employeeCursorInvalid);
      await expect(users.listEmployeeAccessPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 4, sort: "lastName", q: "kaya" }))
        .rejects.toThrow(employeeCursorInvalid);
      const foreignRowPage = await users.listEmployeeAccessPage(tenantA, {
        cursor: retargetCursor(tenantACursor, tenantBWalk.forward[0]!), direction: "next", limit: 4, sort: "lastName",
      });
      expect(foreignRowPage.records.every((record) => record.tenantId === tenantA)).toBe(true);
      const legacy = Buffer.from(JSON.stringify({ v: 1, context: "legacy", sort: "lastName", id: `${tenantA}-employee-000` }), "utf8").toString("base64url");
      await expect(users.listEmployeeAccessPage(tenantA, { cursor: legacy, direction: "next", limit: 4, sort: "lastName" }))
        .rejects.toThrow(employeeCursorInvalid);
    });

    it.each(["soft-deleted", "renamed"] as const)("continues after a boundary employee %s between pages", async (change) => {
      const query = { direction: "next" as const, limit: 2, sort: "lastName" as const };
      const before = await employeeReferenceOrder(admin, tenantC, "lastName");
      expect(before.length).toBeGreaterThanOrEqual(5);
      const first = await users.listEmployeeAccessPage(tenantC, query);
      expect(first.records.map((record) => record.id)).toEqual(before.slice(0, 2));
      const boundaryId = before[1]!;
      const original = (await admin.query<{ lastName: string }>(`SELECT "lastName" FROM "Employee" WHERE "id" = $1`, [boundaryId])).rows[0]!;
      await admin.query(
        change === "soft-deleted"
          ? `UPDATE "Employee" SET "deletedAt" = now() WHERE "id" = $1`
          : `UPDATE "Employee" SET "lastName" = 'ZZZ SONRA' WHERE "id" = $1`,
        [boundaryId],
      );
      try {
        const second = await users.listEmployeeAccessPage(tenantC, { ...query, cursor: first.meta.nextCursor });
        expect(second.records.map((record) => record.id)).toEqual(before.slice(2, 4));
      } finally {
        await admin.query(`UPDATE "Employee" SET "deletedAt" = NULL, "lastName" = $2 WHERE "id" = $1`, [boundaryId, original.lastName]);
      }
    });

    it.each([
      ["ışık", "isik"], ["IŞIK", "isik"], ["Işık", "isik"],
      ["ismail", "ismail"], ["İsmail", "ismail"], ["ISMAIL", "ismail"],
    ])("matches q=%s to the stored Turkish-uppercase employee", async (q, expected) => {
      const page = await users.listEmployeeAccessPage(tenantC, { direction: "next", limit: 10, sort: "lastName", q });
      expect(page.records.map((record) => record.id)).toEqual([`${tenantC}-employee-${expected}`]);
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
      const foreignRowPage = await invitations.listPage(tenantA, { cursor: retargetCursor(tenantACursor, tenantBWalk.forward[0]!), direction: "next", limit: 4, sort: "-createdAt" });
      expect(foreignRowPage.records.every((record) => record.tenantId === tenantA)).toBe(true);
      await expect(invitations.listPage(tenantA, { cursor: tenantACursor, direction: "next", limit: 4, sort: "-createdAt", status: "PENDING" }))
        .rejects.toThrow(identityInvitationCursorInvalid);
    });

    it("continues the PENDING walk after the boundary invitation is accepted between pages", async () => {
      const query = { direction: "next" as const, limit: 2, sort: "createdAt" as const, status: "PENDING" as const };
      const before = await invitationReferenceOrder(admin, tenantC, "createdAt", `"status" = 'PENDING'`);
      expect(before.length).toBeGreaterThanOrEqual(4);
      const first = await invitations.listPage(tenantC, query);
      expect(first.records.map((record) => record.id)).toEqual(before.slice(0, 2));
      await admin.query(`UPDATE "IdentityInvitation" SET "status" = 'ACCEPTED', "acceptedAt" = now() WHERE "id" = $1`, [before[1]]);
      try {
        const second = await invitations.listPage(tenantC, { ...query, cursor: first.meta.nextCursor });
        expect(second.records.map((record) => record.id)).toEqual(before.slice(2, 4));
      } finally {
        await admin.query(`UPDATE "IdentityInvitation" SET "status" = 'PENDING', "acceptedAt" = NULL WHERE "id" = $1`, [before[1]]);
      }
    });

    it.each([
      ["ışık", "isik"], ["IŞIK", "isik"], ["Işık", "isik"],
      ["ismail", "ismail"], ["İsmail", "ismail"], ["ISMAIL", "ismail"],
    ])("matches q=%s to the stored Turkish-uppercase invitation name", async (q, expected) => {
      const page = await invitations.listPage(tenantC, { direction: "next", limit: 10, sort: "createdAt", q });
      expect(page.records.map((record) => record.id)).toEqual([`${tenantC}-invitation-${expected}`]);
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

/**
 * Tenant C: students, accounts and invitations named with Turkish capitals ("IŞIK", "İSMAİL") plus plain names, so
 * search folding and between-page boundary changes are checked on rows no other test walks.
 */
async function seedTurkishFixtures(pool: pg.Pool, tenantId: string): Promise<void> {
  const people = [
    { key: "isik", firstName: "AYŞE", lastName: "IŞIK" },
    { key: "ismail", firstName: "İSMAİL", lastName: "KAYA" },
    { key: "aksoy", firstName: "CEM", lastName: "AKSOY" },
    { key: "bulut", firstName: "DENİZ", lastName: "BULUT" },
    { key: "demir", firstName: "ECE", lastName: "DEMİR" },
    { key: "ozturk", firstName: "FATMA", lastName: "ÖZTÜRK" },
  ];
  for (const [index, person] of people.entries()) {
    await pool.query(
      `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now())`,
      [`${tenantId}-student-${person.key}`, tenantId, `C-${String(index).padStart(4, "0")}`, person.firstName, person.lastName],
    );
    const userId = `${tenantId}-user-${person.key}`;
    await pool.query(
      `INSERT INTO "User" ("id", "tenantId", "name", "email", "emailNormalized", "passwordHash", "updatedAt")
       VALUES ($1, $2, $3, $4, $4, 'FIXTURE_HASH', now())`,
      [userId, tenantId, `${person.firstName} ${person.lastName}`, `${person.key}@${tenantId}.example.test`],
    );
    await pool.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt") VALUES ($1, $2, $3, 'TEACHER', now())`,
      [`${userId}-teacher`, tenantId, userId],
    );
    await pool.query(
      `INSERT INTO "IdentityInvitation" (
         "id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "kind", "tokenHash", "status",
         "expiresAt", "createdAt", "updatedAt"
       ) VALUES ($1, $2, 'TEACHER', $3, $4, $5, 'TEACHER'::"TenantRole", 'EMAIL_LINK', $6, 'PENDING', now() + interval '1 day',
         timestamp '2026-10-02 09:00:00' + make_interval(mins => $7), now())`,
      [
        `${tenantId}-invitation-${person.key}`,
        tenantId,
        `${tenantId}-subject-${person.key}`,
        `invite-${person.key}@${tenantId}.example.test`,
        `${person.firstName} ${person.lastName}`,
        `cursor-keyset-token-${tenantId}-${person.key}`,
        index,
      ],
    );
  }
}

const employeeSortSql: Record<string, string> = {
  lastName: `lower("lastName")`,
  firstName: `lower("firstName")`,
  employeeNo: `lower(coalesce("employeeNo", ''))`,
};

async function employeeReferenceOrder(pool: pg.Pool, tenantId: string, sort: EmployeeAccessSort): Promise<string[]> {
  const direction = sort.startsWith("-") ? "DESC" : "ASC";
  const result = await pool.query<{ id: string }>(
    `SELECT "id" FROM "Employee"
     WHERE "tenantId" = $1 AND "deletedAt" IS NULL
     ORDER BY ${employeeSortSql[sort.replace(/^-/, "")]} ${direction}, "id" ${direction}`,
    [tenantId],
  );
  return result.rows.map((row) => row.id);
}

/** `count` employees plus one soft-deleted; last names repeat case-insensitively and every third has no number. */
async function seedEmployees(pool: pg.Pool, tenantId: string, count: number): Promise<void> {
  const prefix = tenantId === tenantA ? "A" : "B";
  for (let index = 0; index < count; index += 1) {
    await pool.query(
      `INSERT INTO "Employee" ("id", "tenantId", "employeeNo", "firstName", "lastName", "workEmail", "status", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', now())`,
      [
        `${tenantId}-employee-${String(index).padStart(3, "0")}`,
        tenantId,
        index % 3 === 0 ? null : `${prefix}-E${String(index).padStart(3, "0")}`,
        firstNames[index % firstNames.length],
        lastNames[(index * 3) % lastNames.length],
        `employee-${index}@${tenantId}.example.test`,
      ],
    );
  }
  await pool.query(
    `INSERT INTO "Employee" ("id", "tenantId", "firstName", "lastName", "status", "deletedAt", "updatedAt")
     VALUES ($1, $2, 'Silinmis', 'Aksoy', 'ACTIVE', now(), now())`,
    [`${tenantId}-employee-deleted`, tenantId],
  );
}

async function seedTurkishEmployees(pool: pg.Pool, tenantId: string): Promise<void> {
  const people = [
    { key: "isik", firstName: "AYŞE", lastName: "IŞIK" },
    { key: "ismail", firstName: "İSMAİL", lastName: "KAYA" },
    { key: "aksoy", firstName: "CEM", lastName: "AKSOY" },
    { key: "bulut", firstName: "DENİZ", lastName: "BULUT" },
    { key: "demir", firstName: "ECE", lastName: "DEMİR" },
    { key: "ozturk", firstName: "FATMA", lastName: "ÖZTÜRK" },
  ];
  for (const person of people) {
    await pool.query(
      `INSERT INTO "Employee" ("id", "tenantId", "firstName", "lastName", "status", "updatedAt")
       VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
      [`${tenantId}-employee-${person.key}`, tenantId, person.firstName, person.lastName],
    );
  }
}

async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM "IdentityInvitation" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "Employee" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "Student" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "Class" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "TenantMembership" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "User" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
  await pool.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [tenantIds]);
}
