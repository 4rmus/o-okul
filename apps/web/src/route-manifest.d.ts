export type RouteFamily =
  | "MARKETING"
  | "AUTH"
  | "TENANT_DASHBOARD"
  | "REGISTRY"
  | "WORKFLOW"
  | "MASTER_DETAIL"
  | "PORTAL"
  | "CONTROL_PLANE";
export type RouteBoundary =
  | "PUBLIC"
  | "AUTHENTICATED_SELF"
  | "TENANT"
  | "PORTAL_SELF"
  | "CONTROL_PLANE"
  | "TRANSITIONAL_GUARDIAN";
export type ModuleDecision = "reuse" | "refactor" | "split" | "retire";
export interface RouteArchitecture {
  boundary: RouteBoundary;
  decision: ModuleDecision;
  family: RouteFamily;
  module: string;
  owner: string;
}
export const routeFamilies: readonly RouteFamily[];
export const routeBoundaries: readonly RouteBoundary[];
export const moduleDecisions: readonly { decision: ModuleDecision; module: string; owner: string }[];
export function resolveRouteArchitecture(routeTemplate: string): RouteArchitecture;
export type NavIconName =
  | "Activity"
  | "BarChart3"
  | "BookOpen"
  | "Building2"
  | "CalendarDays"
  | "ClipboardCheck"
  | "ClipboardList"
  | "CreditCard"
  | "FileText"
  | "GraduationCap"
  | "LayoutDashboard"
  | "Library"
  | "LifeBuoy"
  | "Megaphone"
  | "MessageSquareText"
  | "NotebookTabs"
  | "ScanLine"
  | "School"
  | "Settings"
  | "ShieldCheck"
  | "UserRoundCog"
  | "Users";
export interface NavRoute {
  breadcrumbLabel?: string;
  capability?: string;
  detailParent?: boolean;
  group: string;
  hiddenFromRail?: boolean;
  href: string;
  hub?: string;
  iconName: NavIconName;
  keywords?: readonly string[];
  label: string;
  operationEvidence?: boolean;
  persona?: "STAFF";
  requiresSms?: boolean;
}
export type PortalRole = "TEACHER" | "STUDENT" | "GUARDIAN";
export interface PortalHomeRoute {
  href: string;
  iconName: NavIconName;
  label: string;
  role: PortalRole;
  subjectType: PortalRole;
}
export interface PortalNavGroup {
  label: string;
  role: PortalRole;
  routes: readonly NavRoute[];
  subjectType: PortalRole;
}
export interface CommandAction {
  capability?: string;
  group: string;
  href: string;
  label: string;
  scope: "institution" | "system";
}
export const institutionNavGroupLabels: readonly string[];
export const institutionRoutes: readonly NavRoute[];
export const systemRoutes: readonly NavRoute[];
export const portalHomeRoutes: readonly PortalHomeRoute[];
export const portalNavGroups: readonly PortalNavGroup[];
export const pageLabels: Readonly<Record<string, string>>;
export const commandActions: readonly CommandAction[];
export function navigationRoutes(): NavRoute[];
export function breadcrumbLabels(): Record<string, string>;
export function detailParentSegments(): string[];
