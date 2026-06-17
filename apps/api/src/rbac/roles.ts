import { isTenantRoleName, tenantRoles, type TenantRoleName } from "@uzman-hocam/shared-types";

export const roles = tenantRoles;

export type Role = TenantRoleName;

const roleRank: Record<Role, number> = {
  SYSTEM_ADMIN: 5,
  TENANT_ADMIN: 4,
  ASSISTANT_ADMIN: 3.5,
  TEACHER: 3,
  STUDENT: 2,
  GUARDIAN: 1,
};

export function hasRole(userRoles: readonly string[], requiredRole: Role): boolean {
  return userRoles.some((role) => isRole(role) && roleRank[role] >= roleRank[requiredRole]);
}

export function assertRole(userRoles: readonly string[], requiredRole: Role): void {
  if (!hasRole(userRoles, requiredRole)) {
    throw new Error("FORBIDDEN");
  }
}

export function isSystemAdmin(userRoles: readonly string[]): boolean {
  return userRoles.includes("SYSTEM_ADMIN");
}

const isRole = isTenantRoleName;
