export const featureRolloutKeys = [
  "web.teacher-portal-v2",
  "web.student-portal-v2",
  "web.control-plane-v2",
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
