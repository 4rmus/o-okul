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
