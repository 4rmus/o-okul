export interface TenantMembershipDualWriteRow {
  role: string;
  staffRole: "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF" | null;
  hasTeacherPersona: boolean;
  hasStudentPersona: boolean;
}

const staffRoleByLegacyRole = new Map<string, NonNullable<TenantMembershipDualWriteRow["staffRole"]>>([
  ["TENANT_OWNER", "TENANT_OWNER"],
  ["TENANT_ADMIN", "TENANT_ADMIN"],
  ["ASSISTANT_ADMIN", "OPERATIONS_STAFF"],
  ["OPERATIONS_STAFF", "OPERATIONS_STAFF"],
  ["FINANCE_STAFF", "FINANCE_STAFF"],
]);

const allowedRoles = new Set([...staffRoleByLegacyRole.keys(), "TEACHER", "STUDENT", "GUARDIAN"]);

export function buildTenantMembershipDualWriteRows(roles: readonly string[]): TenantMembershipDualWriteRow[] {
  const uniqueRoles = [...new Set(roles)];
  if (uniqueRoles.some((role) => !allowedRoles.has(role))) {
    throw new Error("TENANT_ROLE_INVALID");
  }

  const staffRoles = uniqueRoles.filter((role) => staffRoleByLegacyRole.has(role));
  const hasTeacherPersona = uniqueRoles.includes("TEACHER");
  const hasStudentPersona = uniqueRoles.includes("STUDENT");
  const hasGuardianRole = uniqueRoles.includes("GUARDIAN");
  if (
    staffRoles.length > 1 ||
    (hasStudentPersona && uniqueRoles.length > 1) ||
    (hasGuardianRole && uniqueRoles.length > 1)
  ) {
    throw new Error("INVALID_TENANT_ROLE_COMBINATION");
  }

  const canonicalRole = staffRoles[0] ?? (hasStudentPersona ? "STUDENT" : hasTeacherPersona ? "TEACHER" : undefined);
  return uniqueRoles.map((role) => ({
    role,
    staffRole: role === canonicalRole ? (staffRoleByLegacyRole.get(role) ?? null) : null,
    hasTeacherPersona: role === canonicalRole && hasTeacherPersona,
    hasStudentPersona: role === canonicalRole && hasStudentPersona,
  }));
}
