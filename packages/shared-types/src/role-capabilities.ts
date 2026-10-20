export const tenantRoles = ["SYSTEM_ADMIN", "TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF", "TEACHER", "STUDENT", "GUARDIAN"] as const;
export const tenantAssignableRoles = ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF", "TEACHER", "STUDENT", "GUARDIAN"] as const;
export const portalSubjectRoles = ["TEACHER", "STUDENT", "GUARDIAN"] as const;

export type TenantRoleName = (typeof tenantRoles)[number];
export type TenantAssignableRoleName = (typeof tenantAssignableRoles)[number];
export type PortalSubjectRoleName = (typeof portalSubjectRoles)[number];
export type RoleCapability = `${string}:${string}`;

export const tenantRoleLabels: Record<TenantRoleName, string> = {
  SYSTEM_ADMIN: "Sistem yöneticisi",
  TENANT_OWNER: "Kurum sahibi",
  TENANT_ADMIN: "Kurum yöneticisi",
  ASSISTANT_ADMIN: "Yardımcı yönetici",
  OPERATIONS_STAFF: "Operasyon çalışanı",
  FINANCE_STAFF: "Finans çalışanı",
  TEACHER: "Öğretmen",
  STUDENT: "Öğrenci",
  GUARDIAN: "Veli",
};

export const roleCapabilities: Record<TenantRoleName, readonly RoleCapability[]> = {
  SYSTEM_ADMIN: ["account:self", "audit:*", "system:*", "tenant:clean-reset", "tenant:lifecycle", "tenant:manage"],
  TENANT_OWNER: [
    "academic:*", "account:self", "announcement:*", "attendance:*", "audit:*", "class:*", "finance:*", "homework:*",
    "note:*", "notification:device", "observability:*", "operation:*", "owner:*", "privacy:*", "role-preview:*",
    "search:*", "security:*", "setup:*", "staff:*", "student:*", "support:*", "tenant-audit:read", "user:*",
  ],
  TENANT_ADMIN: [
    "academic:*", "account:self", "announcement:*", "attendance:*", "audit:*", "class:*", "finance:*", "homework:*",
    "note:*", "notification:device", "observability:*", "operation:*", "privacy:*", "role-preview:*", "search:*",
    "security:*", "setup:*", "staff:*", "student:*", "support:*", "tenant-audit:read", "user:*",
  ],
  ASSISTANT_ADMIN: [
    "academic:*", "account:self", "announcement:*", "attendance:*", "class:*", "homework:*", "note:*",
    "notification:device", "search:*", "setup:manage", "setup:read", "staff:*", "student:*", "support:*",
  ],
  OPERATIONS_STAFF: [
    "academic:*", "account:self", "announcement:*", "attendance:*", "class:*", "homework:*", "note:*",
    "notification:device", "search:*", "setup:manage", "setup:read", "staff:*", "student:*", "support:*",
  ],
  FINANCE_STAFF: ["account:self", "finance:*"],
  TEACHER: [
    "academic:read", "academic:read-catalog", "academic:write-assigned", "account:self", "announcement:read",
    "attendance:read-assigned", "attendance:write-assigned", "class:read", "homework:read-assigned",
    "homework:write-assigned", "note:read-assigned", "note:write-assigned", "notification:device", "portal:teacher",
    "search:read", "staff:read-teachers", "student:list", "student:read", "student:read-guardians", "support:read-own",
    "support:write-own",
  ],
  STUDENT: ["academic:read-catalog", "account:self", "notification:device", "portal:student", "self:read", "student:read"],
  GUARDIAN: ["academic:read-catalog", "account:self", "notification:device", "portal:guardian", "student:read", "ward:read"],
};

export function capabilitiesForRoles(roles: readonly string[]): RoleCapability[] {
  if (roles.includes("SYSTEM_ADMIN")) return [...roleCapabilities.SYSTEM_ADMIN];

  const capabilities = new Set<RoleCapability>();
  for (const role of roles) {
    if (!isTenantRoleName(role)) continue;
    for (const capability of roleCapabilities[role]) {
      capabilities.add(capability);
    }
  }
  return [...capabilities];
}

export function hasCapabilityForRoles(
  roles: readonly string[],
  required: string,
  capabilities: readonly string[] = capabilitiesForRoles(roles),
): boolean {
  if (roles.includes("SYSTEM_ADMIN") && required.startsWith("system:")) {
    return true;
  }

  return capabilities.some((capability) => capability === required || matchesCapabilityWildcard(capability, required));
}

export function canAccessExamWorkspace(
  roles: readonly string[],
  activePersona?: "STAFF" | "TEACHER" | "STUDENT" | "GUARDIAN",
): boolean {
  const allowedRoles = ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN"];
  const hasAllowedRole = roles.some((role) => allowedRoles.includes(role));
  return hasAllowedRole && (
    activePersona === "STAFF"
    || (activePersona === undefined && roles.length === 1)
  );
}

// FINANCE_STAFF rank kalıtımı almaz (apps/api/src/rbac/roles.ts); başka kurum rolü yoksa
// kurum özeti ve bildirim cihazı uçları 403 döner. Web yönlendirmesi bu ayrımı kullanır.
export function isFinanceOnlyStaff(roles: readonly string[]): boolean {
  return roles.includes("FINANCE_STAFF")
    && !roles.some((role) => ["SYSTEM_ADMIN", "TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF"].includes(role));
}

export function isTenantRoleName(role: string): role is TenantRoleName {
  return tenantRoles.includes(role as TenantRoleName);
}

export function isTenantAssignableRoleName(role: string): role is TenantAssignableRoleName {
  return tenantAssignableRoles.includes(role as TenantAssignableRoleName);
}

export function isPortalSubjectRoleName(role: string): role is PortalSubjectRoleName {
  return portalSubjectRoles.includes(role as PortalSubjectRoleName);
}

export function tenantRoleLabel(role: TenantRoleName) {
  return tenantRoleLabels[role];
}

function matchesCapabilityWildcard(capability: string, required: string) {
  return capability.endsWith(":*") && required.startsWith(capability.slice(0, -1));
}
