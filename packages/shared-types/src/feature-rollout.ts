export const featureRolloutKeys = [
  "web.ia-v2",
  "web.shell-v2",
  "web.exam-workspace-v2",
  "web.student-registry-v2",
  "web.setup-v2",
  "web.teacher-portal-v2",
  "web.student-portal-v2",
  "web.control-plane-v2",
  "product.guardian-read-only",
] as const;

export type FeatureRolloutKey = (typeof featureRolloutKeys)[number];

export interface FeatureRolloutCatalogItem {
  featureKey: FeatureRolloutKey;
  defaultEnabled: false;
  owner: string;
  expiresAt: string;
  removalIssue: string;
}

export interface ResolvedFeatureRollouts {
  enabledFeatureKeys: FeatureRolloutKey[];
}
