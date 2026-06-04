import { isSystemAdmin, type Role } from "./roles.js";

export type Capability = `${string}:${string}`;

const roleCapabilities: Record<Role, readonly Capability[]> = {
  SYSTEM_ADMIN: ["system:*", "tenant:*", "audit:*"],
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
    "staff:*",
    "student:*",
    "support:*",
    "user:*",
  ],
  ASSISTANT_ADMIN: ["academic:*", "announcement:*", "attendance:*", "class:*", "note:*", "staff:*", "student:*", "support:*"],
  TEACHER: ["academic:read", "attendance:write-assigned", "homework:write-assigned", "note:write-assigned"],
  STUDENT: ["self:read"],
  GUARDIAN: ["ward:read"],
};

export function capabilitiesForRoles(roles: readonly string[]): Capability[] {
  const capabilities = new Set<Capability>();
  for (const role of roles) {
    if (isRoleKey(role)) {
      for (const capability of roleCapabilities[role]) {
        capabilities.add(capability);
      }
    }
  }
  return [...capabilities];
}

export function hasCapability(context: { roles: readonly string[]; capabilities?: readonly string[] }, required: Capability): boolean {
  if (isSystemAdmin(context.roles) && required.startsWith("system:")) {
    return true;
  }

  const capabilities = context.capabilities ?? capabilitiesForRoles(context.roles);
  return capabilities.some((capability) => capability === required || matchesWildcard(capability, required));
}

function matchesWildcard(capability: string, required: Capability): boolean {
  if (!capability.endsWith(":*")) {
    return false;
  }
  return required.startsWith(capability.slice(0, -1));
}

function isRoleKey(role: string): role is Role {
  return role in roleCapabilities;
}
