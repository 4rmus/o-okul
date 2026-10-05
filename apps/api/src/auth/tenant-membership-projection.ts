export type CanonicalStaffRole = "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF";

export interface CanonicalMembershipProjection {
  id: string;
  staffRole: CanonicalStaffRole | null;
  hasTeacherPersona: boolean;
  hasStudentPersona: boolean;
  version: number;
  scopeMode?: "TENANT" | "CAMPUSES";
  campusIds?: string[];
}

const staffRoles = new Set([
  "TENANT_OWNER",
  "TENANT_ADMIN",
  "ASSISTANT_ADMIN",
  "OPERATIONS_STAFF",
  "FINANCE_STAFF",
]);

const compatibleLegacyStaffRoles: Record<CanonicalStaffRole, readonly string[]> = {
  TENANT_OWNER: ["TENANT_OWNER", "TENANT_ADMIN"],
  TENANT_ADMIN: ["TENANT_ADMIN"],
  OPERATIONS_STAFF: ["OPERATIONS_STAFF", "ASSISTANT_ADMIN"],
  FINANCE_STAFF: ["FINANCE_STAFF"],
};

export function assertTenantMembershipParity(
  legacyRoles: readonly string[],
  canonical: CanonicalMembershipProjection,
): string[] {
  const roles = [...new Set(legacyRoles)].sort();
  const legacyStaffRoles = roles.filter((role) => staffRoles.has(role));
  const compatibleStaffRoles = canonical.staffRole ? compatibleLegacyStaffRoles[canonical.staffRole] : [];
  const staffParity = canonical.staffRole
    ? legacyStaffRoles.length === 1 && compatibleStaffRoles.includes(legacyStaffRoles[0] ?? "")
    : legacyStaffRoles.length === 0;
  const teacherParity = roles.includes("TEACHER") === canonical.hasTeacherPersona;
  const studentParity = roles.includes("STUDENT") === canonical.hasStudentPersona;
  // KV-3b: GUARDIAN may sit next to a staff/teacher membership as its own persona, never next to STUDENT.
  const guardianParity = !(roles.includes("GUARDIAN") && canonical.hasStudentPersona);

  if (!staffParity || !teacherParity || !studentParity || !guardianParity) {
    throw new Error("AUTH_MEMBERSHIP_PARITY_MISMATCH");
  }
  if (canonical.hasStudentPersona && (canonical.staffRole !== null || canonical.hasTeacherPersona)) {
    throw new Error("AUTH_MEMBERSHIP_PARITY_MISMATCH");
  }

  return roles;
}

/**
 * KV-3b (DEC-20261003-01, 2026-10-05): who may receive the GUARDIAN role from the student contact link. A canonical
 * staff/teacher account (GUARDIAN becomes a separate persona, capabilities never merge) or an existing guardian
 * account. Student accounts, platform (SYSTEM_ADMIN) accounts and legacy accounts without a canonical membership
 * (whose roles would be unioned into one session) are refused.
 */
export function canAttachGuardianRole(user: {
  roles: readonly string[];
  membership?: Pick<CanonicalMembershipProjection, "hasStudentPersona">;
}): boolean {
  if (user.roles.some((role) => role === "STUDENT" || role === "SYSTEM_ADMIN")) return false;
  if (user.membership) return !user.membership.hasStudentPersona;
  return user.roles.length === 1 && user.roles[0] === "GUARDIAN";
}
