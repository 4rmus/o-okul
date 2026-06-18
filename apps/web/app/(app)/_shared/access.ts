import { hasCapabilityForRoles as sharedHasCapabilityForRoles } from "@uzman-hocam/shared-types";
import { institutionNavGroups } from "./navigation.js";

type NavigationItem = {
  href: string;
  label: string;
  requiredCapability?: string;
};

type SessionLike = {
  roles: readonly string[];
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
};

const hiddenInstitutionPathCapabilities: Record<string, string> = {
  "/kurum/canli-yayin": "system:operations",
  "/kurum/denetim": "audit:read",
  "/kurum/gozlemlenebilirlik": "system:operations",
  "/kurum/guvenlik-denetimi": "system:operations",
  "/kurum/kvkk": "privacy:manage",
  "/kurum/sistem-sagligi": "system:operations",
  "/kurum/uat-rollback": "system:operations",
};

export function hasInstitutionAccess(roles: readonly string[]) {
  return roles.includes("TENANT_ADMIN") || roles.includes("ASSISTANT_ADMIN");
}

export function hasSystemAccess(roles: readonly string[]) {
  return roles.includes("SYSTEM_ADMIN");
}

export function hasSubjectPortalAccess(session: SessionLike, role: string, subjectType: SessionLike["subjectType"]) {
  return session.roles.includes(role) && session.subjectType === subjectType;
}

export function getInstitutionNavGroups(roles: readonly string[]) {
  return institutionNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessNavigationItem(roles, item)),
    }))
    .filter((group) => group.items.length > 0);
}

export function canAccessInstitutionPath(roles: readonly string[], pathname: string) {
  const normalizedPathname = normalizeInstitutionPath(pathname);
  const hiddenCapability = findHiddenInstitutionPathCapability(normalizedPathname);
  if (hiddenCapability) return hasCapabilityForRoles(roles, hiddenCapability);

  const item = findInstitutionNavigationItem(normalizedPathname);
  if (!item) return false;
  if (item.href === "/kurum" && normalizedPathname !== "/kurum") return false;
  return canAccessNavigationItem(roles, item);
}

export function canAccessHref(roles: readonly string[], href: string) {
  const normalizedHref = normalizeInstitutionPath(href);
  const hiddenCapability = findHiddenInstitutionPathCapability(normalizedHref);
  if (hiddenCapability) return hasCapabilityForRoles(roles, hiddenCapability);

  const item = findInstitutionNavigationItem(normalizedHref);
  if (!item) return false;
  if (item.href === "/kurum" && normalizedHref !== "/kurum") return false;
  return canAccessNavigationItem(roles, item);
}

export function canAccessNavigationItem(roles: readonly string[], item: NavigationItem) {
  return !item.requiredCapability || hasCapabilityForRoles(roles, item.requiredCapability);
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

function findHiddenInstitutionPathCapability(pathname: string) {
  return Object.entries(hiddenInstitutionPathCapabilities)
    .filter(([href]) => pathname === href || pathname.startsWith(`${href}/`))
    .sort(([left], [right]) => right.length - left.length)[0]?.[1];
}

function normalizeInstitutionPath(pathname: string) {
  return pathname.split(/[?#]/)[0] || "/";
}
