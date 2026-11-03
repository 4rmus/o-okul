import { upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity } from "../test-auth.js";

// DEC-20261102-03 test personas: OPERATIONS_STAFF memberships in tenant-a (demo class-a/student-a sit in campus-main).
export const tenantWideOperationsStaffEmail = "ops-tenant@example.test";
export const campusOperationsStaffEmail = "ops-campus@example.test";

/** Callers reset the in-memory users (resetInMemoryAuthUsers) before and after the suite. */
export function registerExamOperationsStaff(): void {
  for (const [key, email, scope] of [
    ["tenant", tenantWideOperationsStaffEmail, { scopeMode: "TENANT" as const, campusIds: [] }],
    ["campus", campusOperationsStaffEmail, { scopeMode: "CAMPUSES" as const, campusIds: ["campus-main"] }],
  ] as const) {
    upsertInMemoryAuthUser({
      id: `user-ops-${key}`,
      email,
      name: "Operasyon Çalışanı",
      password: "password",
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      membership: {
        id: `membership-ops-${key}`,
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: scope.scopeMode,
        campusIds: [...scope.campusIds],
      },
    });
    registerTestLoginIdentity(email, { tenantSlug: "dna-egitim" });
  }
}

// DEC-20261102-03: a tenant-wide OPERATIONS_STAFF membership that also opens a teacher persona. The STAFF-persona
// session carries only [OPERATIONS_STAFF]; the TEACHER-persona session carries only [TEACHER] (auth.service
// resolvePersonaSessionContext), so the two never meet in one request context.
export const dualPersonaOperationsStaffEmail = "ops-teacher@example.test";
export const dualPersonaOperationsStaffUserId = "user-ops-teacher";

/** Callers reset the in-memory users; the TEACHER persona also needs a Teacher row bound to this user id. */
export function registerDualPersonaOperationsStaff(): void {
  upsertInMemoryAuthUser({
    id: dualPersonaOperationsStaffUserId,
    email: dualPersonaOperationsStaffEmail,
    name: "Operasyon Öğretmeni",
    password: "password",
    tenantId: "tenant-a",
    roles: ["OPERATIONS_STAFF", "TEACHER"],
    membership: {
      id: "membership-ops-teacher",
      staffRole: "OPERATIONS_STAFF",
      hasTeacherPersona: true,
      hasStudentPersona: false,
      version: 1,
      scopeMode: "TENANT",
      campusIds: [],
    },
  });
  registerTestLoginIdentity(dualPersonaOperationsStaffEmail, { tenantSlug: "dna-egitim" });
}
