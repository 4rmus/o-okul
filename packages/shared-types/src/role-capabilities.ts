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
  TENANT_ADMIN: "Kurum admin",
  ASSISTANT_ADMIN: "Yardımcı yönetici",
  OPERATIONS_STAFF: "Operasyon çalışanı",
  FINANCE_STAFF: "Finans çalışanı",
  TEACHER: "Öğretmen",
  STUDENT: "Öğrenci",
  GUARDIAN: "Veli",
};

export const roleCapabilities: Record<TenantRoleName, readonly RoleCapability[]> = {
  SYSTEM_ADMIN: ["system:*", "tenant:*", "audit:*"],
  TENANT_OWNER: [
    "academic:*", "announcement:*", "attendance:*", "audit:*", "class:*", "finance:*", "note:*",
    "observability:*", "operation:*", "privacy:*", "role-preview:*", "security:*", "search:*", "setup:*",
    "staff:*", "student:*", "support:*", "user:*", "owner:*",
  ],
  TENANT_ADMIN: [
    "academic:*",
    "announcement:*",
    "attendance:*",
    "audit:*",
    "class:*",
    "finance:*",
    "note:*",
    "observability:*",
    "operation:*",
    "privacy:*",
    "role-preview:*",
    "security:*",
    "search:*",
    "setup:*",
    "staff:*",
    "student:*",
    "support:*",
    "user:*",
  ],
  ASSISTANT_ADMIN: [
    "academic:*",
    "announcement:*",
    "attendance:*",
    "class:*",
    "note:*",
    "search:*",
    "setup:manage",
    "staff:*",
    "student:*",
    "support:*",
  ],
  OPERATIONS_STAFF: [
    "academic:*", "announcement:*", "attendance:*", "class:*", "note:*", "search:*", "setup:manage",
    "staff:*", "student:*", "support:*",
  ],
  FINANCE_STAFF: ["finance:*"],
  TEACHER: ["academic:read", "attendance:write-assigned", "homework:write-assigned", "note:write-assigned", "search:read", "student:list", "student:read"],
  STUDENT: ["self:read", "student:read"],
  GUARDIAN: ["student:read", "ward:read"],
};

export function capabilitiesForRoles(roles: readonly string[]): RoleCapability[] {
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
