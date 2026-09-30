import type { LucideIcon } from "lucide-react";
import {
  breadcrumbLabels,
  detailParentSegments,
  hubMembers,
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
  hub?: string;
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
    ...(route.hub ? { hub: route.hub } : {}),
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

export type RailItem = { href: string; icon: LucideIcon; label: string; matchHrefs: readonly string[] };

// Rail: her hub için kullanıcının erişebildiği ilk üye, hub etiketiyle tek girdi olur (§2).
// `groups` capability süzgecinden geçmiş olmalıdır; aktiflik tüm hub üyelerine göre hesaplanır.
export function buildInstitutionRailGroups(groups: readonly InstitutionNavGroup[]) {
  return groups
    .map((group) => {
      const seenHubs = new Set<string>();
      const items: RailItem[] = [];
      for (const item of group.items) {
        if (item.hub) {
          if (seenHubs.has(item.hub)) continue;
          seenHubs.add(item.hub);
          const root = institutionRoutes.find((route) => route.href === item.hub);
          items.push({
            href: item.href,
            icon: root ? navIcons[root.iconName] : item.icon,
            label: root ? root.menuLabel ?? root.label : item.label,
            matchHrefs: hubMembers(item.hub).map((member) => member.href),
          });
          continue;
        }
        if (item.hiddenFromRail) continue;
        const route = institutionRoutes.find((candidate) => candidate.href === item.href);
        items.push({ href: item.href, icon: item.icon, label: route?.menuLabel ?? item.label, matchHrefs: [item.href] });
      }
      return { label: group.label, items };
    })
    .filter((group) => group.items.length > 0);
}
