export type RouteFamily =
  | "MARKETING"
  | "AUTH"
  | "TENANT_DASHBOARD"
  | "REGISTRY"
  | "WORKFLOW"
  | "MASTER_DETAIL"
  | "PORTAL"
  | "CONTROL_PLANE";
export type RouteBoundary = "PUBLIC" | "TENANT" | "PORTAL_SELF" | "CONTROL_PLANE" | "TRANSITIONAL_GUARDIAN";
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
