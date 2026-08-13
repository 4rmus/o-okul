import {
  featureRolloutKeys,
  type FeatureRolloutKey,
  type ResolvedFeatureRollouts,
} from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest } from "./api-client.js";

export function featureRolloutQueryKey(
  tenantId: string | undefined,
  sessionId: string | undefined,
  activePersona: string | undefined,
) {
  return ["next-feature-rollouts", tenantId ?? "anonymous", sessionId ?? "none", activePersona ?? "legacy"] as const;
}

export async function loadFeatureRollouts(accessToken: string) {
  const rollouts = await apiRequest<unknown>(accessToken, `${apiBaseUrl}/me/feature-rollouts`);
  if (!isResolvedFeatureRollouts(rollouts)) {
    throw new Error("INVALID_FEATURE_ROLLOUT_RESPONSE");
  }
  return rollouts;
}

export function isFeatureEnabled(
  rollouts: ResolvedFeatureRollouts | undefined,
  featureKey: FeatureRolloutKey,
) {
  return Array.isArray(rollouts?.enabledFeatureKeys)
    && rollouts.enabledFeatureKeys.includes(featureKey);
}

function isResolvedFeatureRollouts(value: unknown): value is ResolvedFeatureRollouts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "enabledFeatureKeys") return false;

  const enabledFeatureKeys = (value as { enabledFeatureKeys?: unknown }).enabledFeatureKeys;
  if (!Array.isArray(enabledFeatureKeys)) return false;
  if (!enabledFeatureKeys.every((key) =>
    typeof key === "string" && featureRolloutKeys.includes(key as FeatureRolloutKey)
  )) return false;

  return new Set(enabledFeatureKeys).size === enabledFeatureKeys.length;
}
