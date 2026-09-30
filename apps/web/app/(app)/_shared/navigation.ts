import type { LucideIcon } from "lucide-react";
import {
  breadcrumbLabels,
  detailParentSegments,
  institutionNavGroupLabels,
  institutionRoutes,
  portalHomeRoutes,
  portalNavGroups,
  systemRoutes,
  type NavIconName,
  type NavRoute,
} from "../../../src/route-manifest.js";
import { isSmsEnabled } from "../../../src/sms-feature.js";
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  LifeBuoy,
  Megaphone,
  MessageSquareText,
  NotebookTabs,
  ScanLine,
  School,
  Settings,
  ShieldCheck,
  UserRoundCog,
  Users,
} from "lucide-react";

export type InstitutionNavigationItem = {
  href: string;
  hiddenFromRail?: boolean;
  icon: LucideIcon;
  label: string;
  requiredCapability?: string;
  requiredPersona?: "STAFF";
};

type InstitutionNavGroup = {
  label: string;
  items: InstitutionNavigationItem[];
};

type SystemNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

type SystemNavGroup = {
  label: string;
  items: SystemNavigationItem[];
};

type RolePortalItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  role: "TEACHER" | "STUDENT" | "GUARDIAN";
  subjectType: "TEACHER" | "STUDENT" | "GUARDIAN";
};

type RolePortalNavGroup = {
  label: string;
  role: "TEACHER" | "STUDENT" | "GUARDIAN";
  subjectType: "TEACHER" | "STUDENT" | "GUARDIAN";
  items: RolePortalNavigationItem[];
};

type RolePortalNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

// Kanonik kaynak apps/web/src/route-manifest.js; bu dosya yalnız ikon eşlemesi ve menü şekli üretir.
const navIcons: Record<NavIconName, LucideIcon> = {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  LifeBuoy,
  Megaphone,
  MessageSquareText,
  NotebookTabs,
  ScanLine,
  School,
  Settings,
  ShieldCheck,
  UserRoundCog,
  Users,
};

function toInstitutionItem(route: NavRoute): InstitutionNavigationItem {
  return {
    href: route.href,
    ...(route.hiddenFromRail ? { hiddenFromRail: true } : {}),
    icon: navIcons[route.iconName],
    label: route.label,
    ...(route.capability ? { requiredCapability: route.capability } : {}),
    ...(route.persona ? { requiredPersona: route.persona } : {}),
  };
}

function toItem(route: { href: string; iconName: NavIconName; label: string }) {
  return { href: route.href, icon: navIcons[route.iconName], label: route.label };
}

const enabledInstitutionRoutes = institutionRoutes.filter((route) => isSmsEnabled || !route.requiresSms);

export const institutionOperationEvidenceItems: readonly InstitutionNavigationItem[] = enabledInstitutionRoutes
  .filter((route) => route.operationEvidence)
  .map(toInstitutionItem);

export const institutionNavGroups: readonly InstitutionNavGroup[] = institutionNavGroupLabels.map((label) => ({
  label,
  items: enabledInstitutionRoutes.filter((route) => route.group === label).map(toInstitutionItem),
}));

export const systemNavGroups: readonly SystemNavGroup[] = [...new Set(systemRoutes.map((route) => route.group))].map((label) => ({
  label,
  items: systemRoutes.filter((route) => route.group === label).map(toItem),
}));

export const rolePortalItems: readonly RolePortalItem[] = portalHomeRoutes.map((route) => ({
  ...toItem(route),
  role: route.role,
  subjectType: route.subjectType,
}));

export const rolePortalNavGroups: readonly RolePortalNavGroup[] = portalNavGroups.map((group) => ({
  label: group.label,
  role: group.role,
  subjectType: group.subjectType,
  items: group.routes.map(toItem),
}));

export const staticBreadcrumbLabels: Record<string, string> = breadcrumbLabels();

export const dynamicDetailParents: string[] = detailParentSegments();
