import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type {
  ApiCursorListMeta,
  EmployeeCreateRequest,
  EmployeeAccessRecord,
  EmployeeAccessListQuery,
  EmployeeAccessSort,
  TenantAssignableRoleName,
  TenantMembershipUpdateRequest,
  TenantMembershipUpdateResult,
} from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery } from "../db/tenant-query.js";
import { hashPassword, removeInMemoryAuthUserRole, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { buildTenantMembershipDualWriteRows } from "../identity-provisioning/tenant-membership-dual-write.js";
import { assertTenantSeatCapacity } from "../tenant/tenant-seat-limit.js";

export type TenantUserRole = TenantAssignableRoleName;

export interface TenantUserRecord {
  id: string;
  email?: string;
  name: string;
  tenantId: string;
  roles: TenantUserRole[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTenantUserInput {
  tenantId: string;
  email: string;
  name: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  password?: string;
  passwordHash?: string;
  roles: TenantUserRole[];
}

export interface EmployeeAccessPage {
  records: EmployeeAccessRecord[];
  meta: ApiCursorListMeta;
}

export interface UserManagementStore {
  listTenantUsers(tenantId: string): Promise<TenantUserRecord[]>;
  listEmployees(tenantId: string): Promise<EmployeeAccessRecord[]>;
  listEmployeeAccessPage(tenantId: string, query: EmployeeAccessListQuery): Promise<EmployeeAccessPage>;
  findEmployee(tenantId: string, employeeId: string): Promise<EmployeeAccessRecord | undefined>;
  createEmployee(tenantId: string, input: EmployeeCreateRequest): Promise<EmployeeAccessRecord>;
  bindEmployeeUser(tenantId: string, employeeId: string, userId: string): Promise<boolean>;
  findTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined>;
  createOrAttachTenantUser(input: CreateTenantUserInput): Promise<TenantUserRecord>;
  setTenantRoles(tenantId: string, userId: string, roles: TenantUserRole[]): Promise<TenantUserRecord | undefined>;
  removeTenantRole(tenantId: string, userId: string, role: TenantUserRole): Promise<TenantUserRecord | undefined>;
  updateTenantMembership(
    tenantId: string,
    membershipId: string,
    input: TenantMembershipUpdateRequest & { actorCanManageOwners: boolean },
  ): Promise<TenantMembershipUpdateResult | undefined>;
}

export const userManagementStoreToken = Symbol("UserManagementStore");

const demoUsers: TenantUserRecord[] = [
  {
    id: "user-tenant-a",
    email: "admin-a@example.test",
    name: "Tenant A Admin",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "teacher-tenant-a",
    email: "teacher-a@example.test",
    name: "Teacher A",
    tenantId: "tenant-a",
    roles: ["TEACHER"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "student-tenant-a",
    email: "student-a@example.test",
    name: "Student A",
    tenantId: "tenant-a",
    roles: ["STUDENT"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "guardian-tenant-a",
    email: "guardian-a@example.test",
    name: "Guardian A",
    tenantId: "tenant-a",
    roles: ["GUARDIAN"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "user-tenant-b",
    email: "admin-b@example.test",
    name: "Tenant B Admin",
    tenantId: "tenant-b",
    roles: ["TENANT_ADMIN"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

const demoEmployees: EmployeeAccessRecord[] = [
  {
    id: "employee-admin-a",
    tenantId: "tenant-a",
    employeeNo: "A-001",
    firstName: "Tenant A",
    lastName: "Admin",
    workEmail: "admin-a@example.test",
    status: "ACTIVE",
    userId: "user-tenant-a",
    accountStatus: "ACTIVE",
    access: {
      membershipId: "membership-admin-a",
      staffRole: "TENANT_ADMIN",
      hasTeacherPersona: false,
      status: "ACTIVE",
      version: 1,
      scopeMode: "TENANT",
      campusIds: [],
    },
  },
  {
    id: "employee-admin-b",
    tenantId: "tenant-b",
    employeeNo: "B-001",
    firstName: "Tenant B",
    lastName: "Admin",
    workEmail: "admin-b@example.test",
    status: "ACTIVE",
    userId: "user-tenant-b",
    accountStatus: "ACTIVE",
    access: {
      membershipId: "membership-admin-b",
      staffRole: "TENANT_ADMIN",
      hasTeacherPersona: false,
      status: "ACTIVE",
      version: 1,
      scopeMode: "TENANT",
      campusIds: [],
    },
  },
  {
    id: "employee-operations-a",
    tenantId: "tenant-a",
    employeeNo: "A-002",
    firstName: "Ada",
    lastName: "Operasyon",
    workEmail: "operations-a@example.test",
    status: "ACTIVE",
    userId: "user-operations-a",
    accountStatus: "ACTIVE",
    access: {
      membershipId: "membership-operations-a",
      staffRole: "OPERATIONS_STAFF",
      hasTeacherPersona: false,
      status: "ACTIVE",
      version: 1,
      scopeMode: "TENANT",
      campusIds: [],
    },
  },
];

export class InMemoryUserManagementStore implements UserManagementStore {
  private readonly users = demoUsers.map((user) => ({ ...user, roles: [...user.roles] }));
  private readonly employees = demoEmployees.map(cloneEmployeeAccessRecord);

  async listTenantUsers(tenantId: string): Promise<TenantUserRecord[]> {
    return this.users.filter((user) => user.tenantId === tenantId && user.roles.length > 0).map(cloneRequiredTenantUser);
  }

  async listEmployees(tenantId: string): Promise<EmployeeAccessRecord[]> {
    return this.employees.filter((employee) => employee.tenantId === tenantId).map(cloneEmployeeAccessRecord);
  }

  async listEmployeeAccessPage(tenantId: string, query: EmployeeAccessListQuery): Promise<EmployeeAccessPage> {
    const normalizedQuery = normalizeEmployeeSearch(query.q);
    const cursor = query.cursor ? decodeEmployeeCursor(query.cursor) : undefined;
    assertEmployeeCursor(cursor, tenantId, normalizedQuery, query.sort);
    const records = this.employees
      .filter((employee) => employee.tenantId === tenantId && matchesEmployeeSearch(employee, normalizedQuery))
      .map(cloneEmployeeAccessRecord)
      .sort((left, right) => compareEmployeeAccess(left, right, query.sort));
    return paginateEmployeeAccess(records, tenantId, query, cursor?.id);
  }

  async findEmployee(tenantId: string, employeeId: string): Promise<EmployeeAccessRecord | undefined> {
    const employee = this.employees.find((candidate) => candidate.tenantId === tenantId && candidate.id === employeeId);
    return employee ? cloneEmployeeAccessRecord(employee) : undefined;
  }

  async createEmployee(tenantId: string, input: EmployeeCreateRequest): Promise<EmployeeAccessRecord> {
    if (input.employeeNo && this.employees.some((employee) => employee.tenantId === tenantId && employee.employeeNo === input.employeeNo)) {
      throw new Error("EMPLOYEE_NO_CONFLICT");
    }
    const record: EmployeeAccessRecord = {
      id: `employee-${this.employees.length + 1}`,
      tenantId,
      employeeNo: input.employeeNo,
      firstName: input.firstName,
      lastName: input.lastName,
      workEmail: input.workEmail,
      status: input.status,
      employmentStartsAt: input.employmentStartsAt,
    };
    this.employees.push(record);
    return cloneEmployeeAccessRecord(record);
  }

  async bindEmployeeUser(tenantId: string, employeeId: string, userId: string): Promise<boolean> {
    const employee = this.employees.find((candidate) => candidate.tenantId === tenantId && candidate.id === employeeId);
    const user = this.users.find((candidate) => candidate.tenantId === tenantId && candidate.id === userId);
    const staffRole = user?.roles.find((role): role is "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF" => (
      ["TENANT_OWNER", "TENANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF"].includes(role)
    ));
    if (!employee || !user || !staffRole || employee.userId || employee.status !== "ACTIVE") return false;
    employee.userId = userId;
    employee.accountStatus = "ACTIVE";
    employee.access = {
      membershipId: `membership-${userId}`,
      staffRole,
      hasTeacherPersona: false,
      status: "ACTIVE",
      version: 1,
      scopeMode: "TENANT",
      campusIds: [],
    };
    return true;
  }

  async findTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined> {
    return cloneTenantUser(this.users.find((user) => user.tenantId === tenantId && user.id === userId && user.roles.length > 0));
  }

  async createOrAttachTenantUser(input: CreateTenantUserInput): Promise<TenantUserRecord> {
    const existing = this.users.find((user) => user.tenantId === input.tenantId && user.email === input.email);
    if (existing) {
      existing.name = input.name;
      existing.roles = [...input.roles];
      existing.updatedAt = new Date().toISOString();
      upsertInMemoryAuthUser({
        id: existing.id,
        email: existing.email,
        name: existing.name,
        nationalIdHash: input.nationalIdHash,
        password: input.password,
        passwordHash: input.passwordHash,
        tenantId: existing.tenantId,
        roles: existing.roles,
      });
      return cloneRequiredTenantUser(existing);
    }

    const now = new Date().toISOString();
    const record: TenantUserRecord = {
      id: `user-${this.users.length + 1}`,
      email: input.email,
      name: input.name,
      tenantId: input.tenantId,
      roles: [...input.roles],
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(record);
    upsertInMemoryAuthUser({
      id: record.id,
      email: record.email,
      name: record.name,
      nationalIdHash: input.nationalIdHash,
      password: input.password,
      passwordHash: input.passwordHash,
      tenantId: record.tenantId,
      roles: record.roles,
    });
    return cloneRequiredTenantUser(record);
  }

  async setTenantRoles(tenantId: string, userId: string, roles: TenantUserRole[]): Promise<TenantUserRecord | undefined> {
    const user = this.users.find((candidate) => candidate.tenantId === tenantId && candidate.id === userId);
    if (!user) return undefined;

    user.roles = [...roles];
    user.updatedAt = new Date().toISOString();
    return cloneTenantUser(user);
  }

  async removeTenantRole(tenantId: string, userId: string, role: TenantUserRole): Promise<TenantUserRecord | undefined> {
    const user = this.users.find((candidate) => candidate.tenantId === tenantId && candidate.id === userId);
    if (!user) return undefined;

    user.roles = user.roles.filter((candidate) => candidate !== role);
    user.updatedAt = new Date().toISOString();
    removeInMemoryAuthUserRole(tenantId, userId, role);
    return cloneTenantUser(user);
  }

  async updateTenantMembership(
    tenantId: string,
    membershipId: string,
    input: TenantMembershipUpdateRequest & { actorCanManageOwners: boolean },
  ): Promise<TenantMembershipUpdateResult | undefined> {
    const employee = this.employees.find((candidate) => (
      candidate.tenantId === tenantId && candidate.access?.membershipId === membershipId
    ));
    if (!employee?.access || !employee.userId) return undefined;
    if (employee.access.status === "ENDED") throw new Error("TENANT_MEMBERSHIP_ENDED");
    if (employee.access.version !== input.expectedVersion) throw new Error("TENANT_MEMBERSHIP_VERSION_CONFLICT");
    if ((employee.access.staffRole === "TENANT_OWNER" || input.staffRole === "TENANT_OWNER") && !input.actorCanManageOwners) {
      throw new Error("TENANT_OWNER_MANAGE_REQUIRED");
    }
    if (input.status === "ACTIVE" && employee.status !== "ACTIVE") {
      throw new Error("EMPLOYEE_PROFILE_NOT_ACTIVE");
    }
    const allowedCampusIds = tenantId === "tenant-a" ? ["campus-main"] : tenantId === "tenant-b" ? ["campus-b"] : [];
    if (input.campusIds.some((campusId) => !allowedCampusIds.includes(campusId))) {
      throw new Error("TENANT_MEMBERSHIP_CAMPUS_NOT_FOUND");
    }
    if (
      employee.access.staffRole === "TENANT_OWNER" &&
      employee.access.status === "ACTIVE" &&
      (input.staffRole !== "TENANT_OWNER" || input.status !== "ACTIVE") &&
      this.employees.filter((candidate) => (
        candidate.tenantId === tenantId &&
        candidate.access?.staffRole === "TENANT_OWNER" &&
        candidate.access.status === "ACTIVE"
      )).length <= 1
    ) {
      throw new Error("LAST_ACTIVE_TENANT_OWNER_REQUIRED");
    }

    const nextAccountStatus = desiredAccountStatus(employee.access.status, employee.accountStatus, input.status);
    const changed =
      employee.access.staffRole !== input.staffRole ||
      employee.access.hasTeacherPersona !== input.hasTeacherPersona ||
      employee.access.status !== input.status ||
      employee.access.scopeMode !== input.scopeMode ||
      !sameStringSet(employee.access.campusIds, input.campusIds) ||
      employee.accountStatus !== nextAccountStatus;
    if (changed) {
      employee.access = {
        membershipId,
        staffRole: input.staffRole,
        hasTeacherPersona: input.hasTeacherPersona,
        status: input.status,
        version: employee.access.version + 1,
        scopeMode: input.scopeMode,
        campusIds: [...input.campusIds].sort(),
      };
      employee.accountStatus = nextAccountStatus;
    }
    return { employee: cloneEmployeeAccessRecord(employee), sessionsRevoked: 0 };
  }
}

export class PostgresUserManagementStore implements UserManagementStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listTenantUsers(tenantId: string): Promise<TenantUserRecord[]> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TenantUserRow>(
        `SELECT
           u."id",
           u."email",
           u."name",
           m."tenantId",
           array_agg(m."role"::text ORDER BY m."role"::text) AS roles,
           min(u."createdAt") AS "createdAt",
           max(u."updatedAt") AS "updatedAt"
         FROM "TenantMembership" m
         JOIN "User" u ON u."id" = m."userId"
         WHERE m."tenantId" = $1
         GROUP BY u."id", u."email", u."name", m."tenantId"
         ORDER BY lower(coalesce(u."email", u."name")) ASC`,
        [tenantId],
      );
      return result.rows.map(toTenantUserRecord);
    });
  }

  async listEmployees(tenantId: string): Promise<EmployeeAccessRecord[]> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<EmployeeAccessRow>(
        `SELECT
           e."id",
           e."tenantId",
           e."employeeNo",
           e."firstName",
           e."lastName",
           e."workEmail",
           e."status",
           e."employmentStartsAt",
           e."employmentEndsAt",
           e."userId",
           u."accountStatus",
           access."membershipId",
           access."staffRole",
           access."hasTeacherPersona",
           access."membershipStatus",
           access."version",
           access."scopeMode",
           access."campusIds"
         FROM "Employee" e
         LEFT JOIN "User" u
           ON u."tenantId" = e."tenantId" AND u."id" = e."userId"
         LEFT JOIN LATERAL (
           SELECT
             m."id" AS "membershipId",
             m."staffRole"::text AS "staffRole",
             m."hasTeacherPersona",
             m."status" AS "membershipStatus",
             m."version",
             m."scopeMode",
             ARRAY(
               SELECT scope."campusId"
               FROM "MembershipCampusScope" scope
               WHERE scope."tenantId" = m."tenantId" AND scope."membershipId" = m."id"
               ORDER BY scope."campusId"
             ) AS "campusIds"
           FROM "TenantMembership" m
           WHERE m."tenantId" = e."tenantId"
             AND m."userId" = e."userId"
             AND (m."staffRole" IS NOT NULL OR m."hasTeacherPersona" OR m."hasStudentPersona")
           ORDER BY m."version" DESC, m."createdAt" DESC
           LIMIT 1
         ) access ON true
         WHERE e."tenantId" = $1 AND e."deletedAt" IS NULL
         ORDER BY lower(e."lastName"), lower(e."firstName"), e."id"`,
        [tenantId],
      );
      return result.rows.map(toEmployeeAccessRecord);
    });
  }

  async listEmployeeAccessPage(tenantId: string, query: EmployeeAccessListQuery): Promise<EmployeeAccessPage> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const normalizedQuery = normalizeEmployeeSearch(query.q);
      const cursor = query.cursor ? decodeEmployeeCursor(query.cursor) : undefined;
      assertEmployeeCursor(cursor, tenantId, normalizedQuery, query.sort);
      const sort = employeeSortDefinition(query.sort);
      const search = employeeSearchPattern(normalizedQuery);
      const anchor = cursor
        ? await findEmployeeCursorAnchor(client, tenantId, cursor.id, sort, search)
        : undefined;
      if (cursor && !anchor) throw new Error("EMPLOYEE_CURSOR_INVALID");

      const values: unknown[] = [tenantId];
      const conditions = ['e."tenantId" = $1', 'e."deletedAt" IS NULL'];
      if (search) {
        values.push(search);
        conditions.push(`${employeeSearchSql} LIKE $${values.length} ESCAPE '\\'`);
      }
      if (anchor) {
        values.push(anchor.cursorKey, cursor!.id);
        const cursorKeyIndex = values.length - 1;
        const cursorIdIndex = values.length;
        const comparison = employeeCursorComparison(sort.direction, query.direction);
        conditions.push(`(${sort.keySql} ${comparison} $${cursorKeyIndex} OR (${sort.keySql} = $${cursorKeyIndex} AND e."id" ${comparison} $${cursorIdIndex}))`);
      }
      values.push(query.limit + 1);
      const limitIndex = values.length;
      const order = query.direction === "previous" ? reverseEmployeeSortDirection(sort.direction) : sort.direction;
      const result = await client.query<EmployeeAccessRow>(
        `SELECT
           e."id",
           e."tenantId",
           e."employeeNo",
           e."firstName",
           e."lastName",
           e."workEmail",
           e."status",
           e."employmentStartsAt",
           e."employmentEndsAt",
           e."userId",
           u."accountStatus",
           access."membershipId",
           access."staffRole",
           access."hasTeacherPersona",
           access."membershipStatus",
           access."version",
           access."scopeMode",
           access."campusIds",
           ${sort.keySql} AS "cursorKey"
         FROM "Employee" e
         LEFT JOIN "User" u
           ON u."tenantId" = e."tenantId" AND u."id" = e."userId"
         LEFT JOIN LATERAL (
           SELECT
             m."id" AS "membershipId",
             m."staffRole"::text AS "staffRole",
             m."hasTeacherPersona",
             m."status" AS "membershipStatus",
             m."version",
             m."scopeMode",
             ARRAY(
               SELECT scope."campusId"
               FROM "MembershipCampusScope" scope
               WHERE scope."tenantId" = m."tenantId" AND scope."membershipId" = m."id"
               ORDER BY scope."campusId"
             ) AS "campusIds"
           FROM "TenantMembership" m
           WHERE m."tenantId" = e."tenantId"
             AND m."userId" = e."userId"
             AND (m."staffRole" IS NOT NULL OR m."hasTeacherPersona" OR m."hasStudentPersona")
           ORDER BY m."version" DESC, m."createdAt" DESC
           LIMIT 1
         ) access ON true
         WHERE ${conditions.join(" AND ")}
         ORDER BY ${sort.keySql} ${order}, e."id" ${order}
         LIMIT $${limitIndex}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const rows = result.rows.slice(0, query.limit);
      if (query.direction === "previous") rows.reverse();
      return employeeAccessPageFromRows(rows, tenantId, query, hasMore);
    });
  }

  async findEmployee(tenantId: string, employeeId: string): Promise<EmployeeAccessRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<EmployeeProfileRow>(
        `SELECT "id", "tenantId", "employeeNo", "firstName", "lastName", "workEmail", "status",
                "employmentStartsAt", "employmentEndsAt", "userId"
         FROM "Employee"
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, employeeId],
      );
      return result.rows[0] ? toEmployeeProfileRecord(result.rows[0]) : undefined;
    });
  }

  async createEmployee(tenantId: string, input: EmployeeCreateRequest): Promise<EmployeeAccessRecord> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<EmployeeProfileRow>(
        `INSERT INTO "Employee" (
           "id", "tenantId", "employeeNo", "firstName", "lastName", "workEmail", "phone",
           "status", "employmentStartsAt", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, now())
         RETURNING "id", "tenantId", "employeeNo", "firstName", "lastName", "workEmail", "status",
                   "employmentStartsAt", "employmentEndsAt", "userId"`,
        [
          randomUUID(), tenantId, input.employeeNo ?? null, input.firstName, input.lastName,
          input.workEmail?.toLowerCase() ?? null, input.phone ?? null, input.status, input.employmentStartsAt ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) throw new Error("EMPLOYEE_CREATE_FAILED");
      return toEmployeeProfileRecord(record);
    });
  }

  async bindEmployeeUser(tenantId: string, employeeId: string, userId: string): Promise<boolean> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE "Employee"
         SET "userId" = $3, "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2 AND "userId" IS NULL
           AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
         RETURNING "id"`,
        [tenantId, employeeId, userId],
      );
      return Boolean(result.rows[0]);
    });
  }

  async findTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TenantUserRow>(
        `SELECT
           u."id",
           u."email",
           u."name",
           m."tenantId",
           array_agg(m."role"::text ORDER BY m."role"::text) AS roles,
           min(u."createdAt") AS "createdAt",
           max(u."updatedAt") AS "updatedAt"
         FROM "TenantMembership" m
         JOIN "User" u ON u."id" = m."userId"
         WHERE m."tenantId" = $1 AND u."id" = $2
         GROUP BY u."id", u."email", u."name", m."tenantId"
         LIMIT 1`,
        [tenantId, userId],
      );
      return result.rows[0] ? toTenantUserRecord(result.rows[0]) : undefined;
    });
  }

  async createOrAttachTenantUser(input: CreateTenantUserInput): Promise<TenantUserRecord> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      await client.query<{ id: string }>(
        `SELECT "id" FROM "Tenant" WHERE "id" = $1 FOR NO KEY UPDATE`,
        [input.tenantId],
      );
      const normalizedEmail = input.email.trim().toLowerCase();
      const passwordHash = input.passwordHash ?? hashPassword(input.password ?? "", randomUUID());
      const passwordHashVersion = passwordHash.startsWith("scrypt:v2:") ? 2 : 1;
      const existingByEmail = await client.query<{ id: string }>(
        `SELECT "id"
         FROM "User"
         WHERE "tenantId" = $2
           AND coalesce("emailNormalized", lower(btrim("email"))) = $1
         LIMIT 1`,
        [normalizedEmail, input.tenantId],
      );
      let userId = existingByEmail.rows[0]?.id;
      if (userId) {
        await client.query(
          `UPDATE "User"
           SET "emailNormalized" = $3,
               "loginName" = coalesce("loginName", $3),
               "loginNameNormalized" = coalesce("loginNameNormalized", $3),
               "updatedAt" = now()
           WHERE "tenantId" = $1 AND "id" = $2`,
          [input.tenantId, userId, normalizedEmail],
        );
      } else {
        const created = await client.query<{ id: string }>(
          `INSERT INTO "User" (
             "id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized",
             "nationalIdEncrypted", "nationalIdHash", "name", "passwordHash", "passwordHashVersion", "accountStatus", "updatedAt"
           )
           VALUES ($1, $2, $3, $3, $3, $3, $4, $5, $6, $7, $8, 'ACTIVE', now())
           ON CONFLICT ("tenantId", "nationalIdHash") DO UPDATE
           SET "email" = EXCLUDED."email",
               "emailNormalized" = EXCLUDED."emailNormalized",
               "loginName" = coalesce("User"."loginName", EXCLUDED."loginName"),
               "loginNameNormalized" = coalesce("User"."loginNameNormalized", EXCLUDED."loginNameNormalized"),
               "nationalIdEncrypted" = EXCLUDED."nationalIdEncrypted",
               "name" = EXCLUDED."name",
               "passwordHash" = EXCLUDED."passwordHash",
               "passwordHashVersion" = EXCLUDED."passwordHashVersion",
               "accountStatus" = 'ACTIVE',
               "updatedAt" = now()
           RETURNING "id"`,
          [
            randomUUID(),
            input.tenantId,
            normalizedEmail,
            input.nationalIdEncrypted,
            input.nationalIdHash,
            input.name,
            passwordHash,
            passwordHashVersion,
          ],
        );
        userId = created.rows[0]?.id;
      }
      if (!userId) {
        throw new Error("USER_CREATE_FAILED");
      }

      await this.replaceMemberships(client, input.tenantId, userId, input.roles);
      const record = await this.findTenantUserWithClient(client, input.tenantId, userId);
      if (!record) {
        throw new Error("USER_MEMBERSHIP_CREATE_FAILED");
      }
      return record;
    });
  }

  async setTenantRoles(tenantId: string, userId: string, roles: TenantUserRole[]): Promise<TenantUserRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT "id" FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2 LIMIT 1`,
        [tenantId, userId],
      );
      if (!existing.rows[0]) return undefined;

      await this.replaceMemberships(client, tenantId, userId, roles);
      return this.findTenantUserWithClient(client, tenantId, userId);
    });
  }

  async updateTenantMembership(
    tenantId: string,
    membershipId: string,
    input: TenantMembershipUpdateRequest & { actorCanManageOwners: boolean },
  ): Promise<TenantMembershipUpdateResult | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const currentResult = await client.query<TenantMembershipLifecycleRow>(
        `SELECT
           m."id" AS "membershipId",
           m."userId",
           m."staffRole"::text AS "staffRole",
           m."hasTeacherPersona",
           m."status" AS "membershipStatus",
           m."version",
           m."scopeMode",
           u."accountStatus",
           e."id" AS "employeeId",
           e."status" AS "employeeStatus",
           ARRAY(
             SELECT scope."campusId"
             FROM "MembershipCampusScope" scope
             WHERE scope."tenantId" = m."tenantId" AND scope."membershipId" = m."id"
             ORDER BY scope."campusId"
           ) AS "campusIds"
         FROM "TenantMembership" m
         JOIN "User" u
           ON u."tenantId" = m."tenantId" AND u."id" = m."userId"
         JOIN "Employee" e
           ON e."tenantId" = m."tenantId" AND e."userId" = m."userId" AND e."deletedAt" IS NULL
         WHERE m."tenantId" = $1
           AND m."id" = $2
           AND (m."staffRole" IS NOT NULL OR m."hasTeacherPersona")
           AND NOT m."hasStudentPersona"
         FOR UPDATE OF m, u, e`,
        [tenantId, membershipId],
      );
      const current = currentResult.rows[0];
      if (!current) return undefined;
      if (current.membershipStatus === "ENDED") throw new Error("TENANT_MEMBERSHIP_ENDED");
      if (current.version !== input.expectedVersion) throw new Error("TENANT_MEMBERSHIP_VERSION_CONFLICT");
      if ((current.staffRole === "TENANT_OWNER" || input.staffRole === "TENANT_OWNER") && !input.actorCanManageOwners) {
        throw new Error("TENANT_OWNER_MANAGE_REQUIRED");
      }
      if (input.status === "ACTIVE" && current.employeeStatus !== "ACTIVE") {
        throw new Error("EMPLOYEE_PROFILE_NOT_ACTIVE");
      }

      await client.query(
        `SELECT "id"
         FROM "TenantMembership"
         WHERE "tenantId" = $1 AND "userId" = $2
         FOR UPDATE`,
        [tenantId, current.userId],
      );

      const ownerRows = await client.query<{ id: string }>(
        `SELECT "id"
         FROM "TenantMembership"
         WHERE "tenantId" = $1
           AND "staffRole" = 'TENANT_OWNER'
           AND "status" = 'ACTIVE'
         FOR UPDATE`,
        [tenantId],
      );
      if (
        current.staffRole === "TENANT_OWNER" &&
        current.membershipStatus === "ACTIVE" &&
        (input.staffRole !== "TENANT_OWNER" || input.status !== "ACTIVE") &&
        ownerRows.rows.length <= 1
      ) {
        throw new Error("LAST_ACTIVE_TENANT_OWNER_REQUIRED");
      }

      if (input.campusIds.length > 0) {
        const campuses = await client.query<{ id: string }>(
          `SELECT "id"
           FROM "Campus"
           WHERE "tenantId" = $1
             AND "id" = ANY($2::text[])
             AND "deletedAt" IS NULL
           FOR SHARE`,
          [tenantId, input.campusIds],
        );
        if (campuses.rows.length !== input.campusIds.length) {
          throw new Error("TENANT_MEMBERSHIP_CAMPUS_NOT_FOUND");
        }
      }

      const changed =
        current.staffRole !== (input.staffRole ?? null) ||
        current.hasTeacherPersona !== input.hasTeacherPersona ||
        current.membershipStatus !== input.status ||
        current.scopeMode !== input.scopeMode ||
        !sameStringSet(current.campusIds, input.campusIds) ||
        current.accountStatus !== desiredAccountStatus(current.membershipStatus, current.accountStatus, input.status);
      if (!changed) {
        const employee = await this.findEmployeeByMembershipWithClient(client, tenantId, membershipId);
        if (!employee) throw new Error("TENANT_MEMBERSHIP_PROJECTION_FAILED");
        return { employee, sessionsRevoked: 0 };
      }

      const nextVersion = current.version + 1;
      const canonicalRole = input.staffRole ?? "TEACHER";
      await client.query(
        `DELETE FROM "TenantMembership"
         WHERE "tenantId" = $1 AND "userId" = $2 AND "id" <> $3`,
        [tenantId, current.userId, membershipId],
      );
      const updatedMembership = await client.query<{ id: string }>(
        `UPDATE "TenantMembership"
         SET "role" = $4,
             "staffRole" = $5,
             "hasTeacherPersona" = $6,
             "hasStudentPersona" = false,
             "status" = $7,
             "version" = $8,
             "endsAt" = CASE WHEN $7 = 'ENDED' THEN now() ELSE NULL END,
             "endedReason" = CASE WHEN $7 = 'ENDED' THEN $9 ELSE NULL END,
             "scopeMode" = $10,
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "userId" = $2 AND "id" = $3 AND "version" = $11
         RETURNING "id"`,
        [
          tenantId,
          current.userId,
          membershipId,
          canonicalRole,
          input.staffRole ?? null,
          input.hasTeacherPersona,
          input.status,
          nextVersion,
          input.endedReason ?? null,
          input.scopeMode,
          input.expectedVersion,
        ],
      );
      if (!updatedMembership.rows[0]) throw new Error("TENANT_MEMBERSHIP_VERSION_CONFLICT");

      if (input.staffRole && input.hasTeacherPersona) {
        await client.query(
          `INSERT INTO "TenantMembership" (
             "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
             "status", "version", "startsAt", "endsAt", "endedReason", "scopeMode", "updatedAt"
           )
           SELECT $1, $2, $3, 'TEACHER', NULL, false, false,
                  $4, $5, "startsAt", "endsAt", "endedReason", $6, now()
           FROM "TenantMembership"
           WHERE "tenantId" = $2 AND "id" = $7`,
          [randomUUID(), tenantId, current.userId, input.status, nextVersion, input.scopeMode, membershipId],
        );
      }

      await client.query(
        `DELETE FROM "MembershipCampusScope" WHERE "tenantId" = $1 AND "membershipId" = $2`,
        [tenantId, membershipId],
      );
      for (const campusId of [...input.campusIds].sort()) {
        await client.query(
          `INSERT INTO "MembershipCampusScope" ("id", "tenantId", "membershipId", "campusId")
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), tenantId, membershipId, campusId],
        );
      }

      await client.query(
        `UPDATE "User"
         SET "accountStatus" = $3,
             "membershipVersion" = $4,
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2`,
        [
          tenantId,
          current.userId,
          desiredAccountStatus(current.membershipStatus, current.accountStatus, input.status),
          nextVersion,
        ],
      );
      const sessions = await client.query<{ id: string }>(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED', "updatedAt" = now()
         WHERE "tenantId" = $1 AND "userId" = $2 AND "status" = 'ACTIVE'
         RETURNING "id"`,
        [tenantId, current.userId],
      );

      const employee = await this.findEmployeeByMembershipWithClient(client, tenantId, membershipId);
      if (!employee) throw new Error("TENANT_MEMBERSHIP_PROJECTION_FAILED");
      return { employee, sessionsRevoked: sessions.rows.length };
    });
  }

  async removeTenantRole(tenantId: string, userId: string, role: TenantUserRole): Promise<TenantUserRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const existing = await client.query<{ role: TenantUserRole }>(
        `SELECT "role"::text AS role
         FROM "TenantMembership"
         WHERE "tenantId" = $1 AND "userId" = $2
         ORDER BY "role"::text`,
        [tenantId, userId],
      );
      if (!existing.rows.some((row) => row.role === role)) return undefined;

      await this.replaceMemberships(
        client,
        tenantId,
        userId,
        existing.rows.map((row) => row.role).filter((candidate) => candidate !== role),
      );
      return this.findTenantUserWithClient(client, tenantId, userId);
    });
  }

  private async findTenantUserWithClient(
    client: Queryable,
    tenantId: string,
    userId: string,
  ): Promise<TenantUserRecord | undefined> {
    const result = await client.query<TenantUserRow>(
      `SELECT
         u."id",
         u."email",
         u."name",
         m."tenantId",
         array_agg(m."role"::text ORDER BY m."role"::text) AS roles,
         min(u."createdAt") AS "createdAt",
         max(u."updatedAt") AS "updatedAt"
       FROM "TenantMembership" m
       JOIN "User" u ON u."id" = m."userId"
       WHERE m."tenantId" = $1 AND u."id" = $2
       GROUP BY u."id", u."email", u."name", m."tenantId"
       LIMIT 1`,
      [tenantId, userId],
    );
    return result.rows[0] ? toTenantUserRecord(result.rows[0]) : undefined;
  }

  private async findEmployeeByMembershipWithClient(
    client: Queryable,
    tenantId: string,
    membershipId: string,
  ): Promise<EmployeeAccessRecord | undefined> {
    const result = await client.query<EmployeeAccessRow>(
      `SELECT
         e."id", e."tenantId", e."employeeNo", e."firstName", e."lastName", e."workEmail", e."status",
         e."employmentStartsAt", e."employmentEndsAt", e."userId", u."accountStatus",
         m."id" AS "membershipId", m."staffRole"::text AS "staffRole", m."hasTeacherPersona",
         m."status" AS "membershipStatus", m."version", m."scopeMode",
         ARRAY(
           SELECT scope."campusId"
           FROM "MembershipCampusScope" scope
           WHERE scope."tenantId" = m."tenantId" AND scope."membershipId" = m."id"
           ORDER BY scope."campusId"
         ) AS "campusIds"
       FROM "TenantMembership" m
       JOIN "User" u ON u."tenantId" = m."tenantId" AND u."id" = m."userId"
       JOIN "Employee" e ON e."tenantId" = m."tenantId" AND e."userId" = m."userId" AND e."deletedAt" IS NULL
       WHERE m."tenantId" = $1 AND m."id" = $2
       LIMIT 1`,
      [tenantId, membershipId],
    );
    return result.rows[0] ? toEmployeeAccessRecord(result.rows[0]) : undefined;
  }

  private async replaceMemberships(client: Queryable, tenantId: string, userId: string, roles: TenantUserRole[]): Promise<void> {
    const existing = await client.query<{ id: string; version: number }>(
      `SELECT "id", "version"
       FROM "TenantMembership"
       WHERE "tenantId" = $1 AND "userId" = $2
       FOR UPDATE`,
      [tenantId, userId],
    );
    if (!existing.rows[0]) {
      await this.assertTenantSeatAvailableForNewMembership(client, tenantId);
    }

    const membershipVersion = existing.rows.length > 0
      ? Math.max(...existing.rows.map((row) => optionalNumber(row.version) ?? 1)) + 1
      : 1;
    const rows = buildTenantMembershipDualWriteRows(roles);
    await client.query(`DELETE FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2`, [tenantId, userId]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO "TenantMembership" (
           "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
           "status", "version", "scopeMode", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, 'TENANT', now())`,
        [
          randomUUID(),
          tenantId,
          userId,
          row.role,
          row.staffRole,
          row.hasTeacherPersona,
          row.hasStudentPersona,
          membershipVersion,
        ],
      );
    }
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE "User"
         SET "membershipVersion" = "membershipVersion" + 1,
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2`,
        [tenantId, userId],
      );
    }
  }

  private async assertTenantSeatAvailableForNewMembership(client: Queryable, tenantId: string): Promise<void> {
    const tenant = await client.query<{ seatLimit: number | null }>(
      `SELECT "seatLimit" FROM "Tenant" WHERE "id" = $1 FOR NO KEY UPDATE`,
      [tenantId],
    );
    const seatLimit = tenant.rows[0]?.seatLimit;
    if (seatLimit === undefined || seatLimit === null) return;

    const usage = await client.query<{ activeSeatCount: number | string | null }>(
      `SELECT COUNT(DISTINCT "userId")::int AS "activeSeatCount" FROM "TenantMembership" WHERE "tenantId" = $1`,
      [tenantId],
    );
    assertTenantSeatCapacity({
      seatLimit,
      activeSeatCount: optionalNumber(usage.rows[0]?.activeSeatCount),
    });
  }
}

export function createUserManagementStore(): UserManagementStore {
  return resolvePersistenceDriver(process.env.USER_MANAGEMENT_STORE ?? process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresUserManagementStore()
    : new InMemoryUserManagementStore();
}

type EmployeeSortDirection = "ASC" | "DESC";

interface EmployeeSortDefinition {
  keySql: string;
  direction: EmployeeSortDirection;
}

interface EmployeeCursor {
  v: 1;
  context: string;
  sort: EmployeeAccessSort;
  id: string;
}

const employeeSearchSql = `lower(
  coalesce(e."firstName", '') || ' ' ||
  coalesce(e."lastName", '') || ' ' ||
  coalesce(e."employeeNo", '') || ' ' ||
  coalesce(e."workEmail", '')
)`;

function employeeSortDefinition(sort: EmployeeAccessSort): EmployeeSortDefinition {
  switch (sort) {
    case "-lastName":
      return { keySql: 'lower(e."lastName")', direction: "DESC" };
    case "firstName":
      return { keySql: 'lower(e."firstName")', direction: "ASC" };
    case "employeeNo":
      return { keySql: 'lower(coalesce(e."employeeNo", \'\'))', direction: "ASC" };
    case "lastName":
      return { keySql: 'lower(e."lastName")', direction: "ASC" };
  }
}

function reverseEmployeeSortDirection(direction: EmployeeSortDirection): EmployeeSortDirection {
  return direction === "ASC" ? "DESC" : "ASC";
}

function employeeCursorComparison(sortDirection: EmployeeSortDirection, direction: EmployeeAccessListQuery["direction"]): ">" | "<" {
  return (direction === "next") === (sortDirection === "ASC") ? ">" : "<";
}

async function findEmployeeCursorAnchor(
  client: Queryable,
  tenantId: string,
  employeeId: string,
  sort: EmployeeSortDefinition,
  search: string | null,
): Promise<{ cursorKey: string } | undefined> {
  const values: unknown[] = [tenantId, employeeId];
  const conditions = ['e."tenantId" = $1', 'e."id" = $2', 'e."deletedAt" IS NULL'];
  if (search) {
    values.push(search);
    conditions.push(`${employeeSearchSql} LIKE $${values.length} ESCAPE '\\'`);
  }
  const result = await client.query<{ cursorKey: string }>(
    `SELECT ${sort.keySql} AS "cursorKey"
     FROM "Employee" e
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    values,
  );
  return result.rows[0];
}

function normalizeEmployeeSearch(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function employeeSearchPattern(value: string): string | null {
  return value ? `%${value.replace(/[\\%_]/g, "\\$&")}%` : null;
}

function matchesEmployeeSearch(employee: EmployeeAccessRecord, query: string): boolean {
  if (!query) return true;
  return [employee.firstName, employee.lastName, employee.employeeNo, employee.workEmail]
    .some((value) => normalizeEmployeeSearch(value).includes(query));
}

function compareEmployeeAccess(left: EmployeeAccessRecord, right: EmployeeAccessRecord, sort: EmployeeAccessSort): number {
  const direction = sort === "-lastName" ? -1 : 1;
  const leftKey = employeeAccessSortKey(left, sort);
  const rightKey = employeeAccessSortKey(right, sort);
  return direction * (leftKey.localeCompare(rightKey, "tr-TR", { sensitivity: "base" }) || left.id.localeCompare(right.id));
}

function employeeAccessSortKey(employee: EmployeeAccessRecord, sort: EmployeeAccessSort): string {
  if (sort === "firstName") return normalizeEmployeeSearch(employee.firstName);
  if (sort === "employeeNo") return normalizeEmployeeSearch(employee.employeeNo);
  return normalizeEmployeeSearch(employee.lastName);
}

function paginateEmployeeAccess(
  records: EmployeeAccessRecord[],
  tenantId: string,
  query: EmployeeAccessListQuery,
  cursorId: string | undefined,
): EmployeeAccessPage {
  const anchorIndex = cursorId ? records.findIndex((record) => record.id === cursorId) : -1;
  if (cursorId && anchorIndex < 0) throw new Error("EMPLOYEE_CURSOR_INVALID");
  const start = query.direction === "previous"
    ? Math.max(0, anchorIndex - query.limit)
    : cursorId ? anchorIndex + 1 : 0;
  const end = query.direction === "previous" ? anchorIndex : start + query.limit;
  const page = records.slice(start, end);
  return {
    records: page,
    meta: employeeAccessCursorMeta(page, tenantId, query, query.direction === "previous" ? start > 0 : end < records.length),
  };
}

function employeeAccessPageFromRows(
  rows: EmployeeAccessRow[],
  tenantId: string,
  query: EmployeeAccessListQuery,
  hasMore: boolean,
): EmployeeAccessPage {
  const records = rows.map(toEmployeeAccessRecord);
  return { records, meta: employeeAccessCursorMeta(records, tenantId, query, hasMore) };
}

function employeeAccessCursorMeta(
  records: EmployeeAccessRecord[],
  tenantId: string,
  query: EmployeeAccessListQuery,
  hasMore: boolean,
): ApiCursorListMeta {
  const first = records[0];
  const last = records.at(-1);
  return {
    limit: query.limit,
    previousCursor: first && (query.direction === "previous" ? hasMore : Boolean(query.cursor))
      ? encodeEmployeeCursor(tenantId, query, first.id)
      : undefined,
    nextCursor: last && (query.direction === "next" ? hasMore : Boolean(query.cursor))
      ? encodeEmployeeCursor(tenantId, query, last.id)
      : undefined,
  };
}

function encodeEmployeeCursor(tenantId: string, query: EmployeeAccessListQuery, employeeId: string): string {
  const cursor: EmployeeCursor = {
    v: 1,
    context: employeeCursorContext(tenantId, normalizeEmployeeSearch(query.q), query.sort),
    sort: query.sort,
    id: employeeId,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeEmployeeCursor(cursor: string): EmployeeCursor {
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (!decoded.length || decoded.toString("base64url") !== cursor) throw new Error("EMPLOYEE_CURSOR_INVALID");
    const value = JSON.parse(decoded.toString("utf8")) as Partial<EmployeeCursor>;
    if (
      value.v !== 1 ||
      typeof value.context !== "string" ||
      !isEmployeeAccessSort(value.sort) ||
      typeof value.id !== "string" ||
      !value.id
    ) {
      throw new Error("EMPLOYEE_CURSOR_INVALID");
    }
    return value as EmployeeCursor;
  } catch {
    throw new Error("EMPLOYEE_CURSOR_INVALID");
  }
}

function assertEmployeeCursor(
  cursor: EmployeeCursor | undefined,
  tenantId: string,
  query: string,
  sort: EmployeeAccessSort,
): void {
  if (!cursor) return;
  if (cursor.sort !== sort || cursor.context !== employeeCursorContext(tenantId, query, sort)) {
    throw new Error("EMPLOYEE_CURSOR_INVALID");
  }
}

function employeeCursorContext(tenantId: string, query: string, sort: EmployeeAccessSort): string {
  return createHash("sha256").update(`${tenantId}\u0000${query}\u0000${sort}`).digest("base64url");
}

function isEmployeeAccessSort(value: unknown): value is EmployeeAccessSort {
  return value === "lastName" || value === "-lastName" || value === "firstName" || value === "employeeNo";
}

interface TenantUserRow {
  id: string;
  email: string | null;
  name: string;
  tenantId: string;
  roles: TenantUserRole[];
  createdAt: Date;
  updatedAt: Date;
}

interface EmployeeAccessRow {
  id: string;
  tenantId: string;
  employeeNo: string | null;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  status: string;
  employmentStartsAt: Date | null;
  employmentEndsAt: Date | null;
  userId: string | null;
  accountStatus: string | null;
  membershipId: string | null;
  staffRole: "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF" | null;
  hasTeacherPersona: boolean | null;
  membershipStatus: string | null;
  version: number | null;
  scopeMode: "TENANT" | "CAMPUSES" | null;
  campusIds: string[] | null;
  cursorKey?: string;
}

interface EmployeeProfileRow {
  id: string;
  tenantId: string;
  employeeNo: string | null;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  status: string;
  employmentStartsAt: Date | null;
  employmentEndsAt: Date | null;
  userId: string | null;
}

interface TenantMembershipLifecycleRow {
  membershipId: string;
  userId: string;
  staffRole: "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF" | null;
  hasTeacherPersona: boolean;
  membershipStatus: "ACTIVE" | "SUSPENDED" | "ENDED";
  version: number;
  scopeMode: "TENANT" | "CAMPUSES";
  accountStatus: string;
  employeeId: string;
  employeeStatus: string;
  campusIds: string[];
}

function toTenantUserRecord(row: TenantUserRow): TenantUserRecord {
  return {
    id: row.id,
    email: row.email ?? undefined,
    name: row.name,
    tenantId: row.tenantId,
    roles: row.roles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEmployeeAccessRecord(row: EmployeeAccessRow): EmployeeAccessRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeNo: row.employeeNo ?? undefined,
    firstName: row.firstName,
    lastName: row.lastName,
    workEmail: row.workEmail ?? undefined,
    status: row.status,
    employmentStartsAt: row.employmentStartsAt?.toISOString(),
    employmentEndsAt: row.employmentEndsAt?.toISOString(),
    userId: row.userId ?? undefined,
    accountStatus: row.accountStatus ?? undefined,
    access: row.membershipId
      ? {
          membershipId: row.membershipId,
          staffRole: row.staffRole ?? undefined,
          hasTeacherPersona: row.hasTeacherPersona ?? false,
          status: row.membershipStatus ?? "INACTIVE",
          version: row.version ?? 0,
          scopeMode: row.scopeMode ?? "TENANT",
          campusIds: row.campusIds ?? [],
        }
      : undefined,
  };
}

function toEmployeeProfileRecord(row: EmployeeProfileRow): EmployeeAccessRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeNo: row.employeeNo ?? undefined,
    firstName: row.firstName,
    lastName: row.lastName,
    workEmail: row.workEmail ?? undefined,
    status: row.status,
    employmentStartsAt: row.employmentStartsAt?.toISOString().slice(0, 10),
    employmentEndsAt: row.employmentEndsAt?.toISOString().slice(0, 10),
    userId: row.userId ?? undefined,
  };
}

function cloneTenantUser(user: TenantUserRecord | undefined): TenantUserRecord | undefined {
  return user ? { ...user, roles: [...user.roles] } : undefined;
}

function cloneRequiredTenantUser(user: TenantUserRecord): TenantUserRecord {
  return { ...user, roles: [...user.roles] };
}

function cloneEmployeeAccessRecord(employee: EmployeeAccessRecord): EmployeeAccessRecord {
  return {
    ...employee,
    access: employee.access ? { ...employee.access, campusIds: [...employee.access.campusIds] } : undefined,
  };
}

function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" ? value : Number(value);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function desiredAccountStatus(currentMembershipStatus: string, currentAccountStatus: string | undefined, nextMembershipStatus: string): string {
  if (nextMembershipStatus !== "ACTIVE") return "DISABLED";
  return currentMembershipStatus === "ACTIVE" ? (currentAccountStatus ?? "ACTIVE") : "ACTIVE";
}
