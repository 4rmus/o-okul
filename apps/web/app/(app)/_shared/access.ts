import {
  canAccessExamWorkspace,
  hasCapabilityForRoles as sharedHasCapabilityForRoles,
  type ActivePersona,
} from "@o-okul/shared-types";
import { institutionNavGroups } from "./navigation.js";

type NavigationItem = {
  href: string;
  label: string;
  requiredCapability?: string;
  requiredPersona?: "STAFF";
};

type SessionLike = {
  roles: readonly string[];
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
};

export function hasInstitutionAccess(roles: readonly string[]) {
  return roles.some((role) => ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF"].includes(role));
}

export function hasSystemAccess(roles: readonly string[]) {
  return roles.includes("SYSTEM_ADMIN");
}

export function hasSubjectPortalAccess(session: SessionLike, role: string, subjectType: SessionLike["subjectType"]) {
  return session.roles.includes(role) && session.subjectType === subjectType;
}

export function getInstitutionNavGroups(
  roles: readonly string[],
  activePersona?: ActivePersona,
  groups = institutionNavGroups,
) {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessNavigationItem(roles, item, activePersona)),
    }))
    .filter((group) => group.items.length > 0);
}

export function canAccessInstitutionPath(roles: readonly string[], pathname: string, activePersona?: ActivePersona) {
  const normalizedPathname = normalizeInstitutionPath(pathname);
  if (isExamWorkspacePath(normalizedPathname) && !canAccessExamWorkspace(roles, activePersona)) return false;
  const item = findInstitutionNavigationItem(normalizedPathname);
  if (!item) return false;
  if (item.href === "/kurum" && normalizedPathname !== "/kurum") return false;
  return canAccessNavigationItem(roles, item, activePersona);
}

export function canAccessHref(roles: readonly string[], href: string, activePersona?: ActivePersona) {
  const normalizedHref = normalizeInstitutionPath(href);
  if (isExamWorkspacePath(normalizedHref) && !canAccessExamWorkspace(roles, activePersona)) return false;
  const item = findInstitutionNavigationItem(normalizedHref);
  if (!item) return false;
  if (item.href === "/kurum" && normalizedHref !== "/kurum") return false;
  return canAccessNavigationItem(roles, item, activePersona);
}

export function canAccessNavigationItem(
  roles: readonly string[],
  item: NavigationItem,
  activePersona?: ActivePersona,
) {
  return (
    (!item.requiredCapability || hasCapabilityForRoles(roles, item.requiredCapability)) &&
    (!item.requiredPersona || activePersona === item.requiredPersona)
  );
}

export function hasCapabilityForRoles(roles: readonly string[], requiredCapability: string) {
  return sharedHasCapabilityForRoles(roles, requiredCapability);
}

function findInstitutionNavigationItem(pathname: string) {
  const items = institutionNavGroups.flatMap((group) => group.items);
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0];
}

function normalizeInstitutionPath(pathname: string) {
  return pathname.split(/[?#]/)[0] || "/";
}

function isExamWorkspacePath(pathname: string) {
  return /^\/kurum\/sinavlar\/[^/]+\/?$/.test(pathname);
}
