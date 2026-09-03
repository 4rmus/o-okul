"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  SetupReadinessKey,
  SetupReadinessReadModel,
} from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest } from "../../../../../src/api-client.js";

const readinessKeys: SetupReadinessKey[] = [
  "institution",
  "campus",
  "academic-year",
  "academic-term",
  "grade-level",
  "class",
  "course",
  "teacher",
  "student",
];
const optionalReadinessKeys = new Set<SetupReadinessKey>(["teacher", "student"]);

export function useSetupProgress(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-setup-progress", tenantId],
    queryFn: async () => {
      const result = await apiRequest<unknown>(accessToken, `${apiBaseUrl}/setup/readiness`);
      const readiness = parseSetupReadinessReadModel(result);
      if (!readiness) {
        throw new Error("INVALID_SETUP_READINESS_RESPONSE");
      }
      return readiness;
    },
    enabled,
    refetchOnWindowFocus: false,
  });
}

function parseSetupReadinessReadModel(value: unknown): SetupReadinessReadModel | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.status !== "READY" && record.status !== "ACTION_REQUIRED") return undefined;
  if (!Number.isInteger(record.completedCount) || !Number.isInteger(record.totalCount)) return undefined;
  if (record.totalCount !== readinessKeys.length || !Array.isArray(record.steps) || record.steps.length !== readinessKeys.length) return undefined;
  if ((record.completedCount as number) < 0 || (record.completedCount as number) > (record.totalCount as number)) return undefined;

  const steps = record.steps.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const step = value as Record<string, unknown>;
    if (
      step.key !== readinessKeys[index]
      || !Number.isInteger(step.count)
      || (step.count as number) < 0
      || typeof step.ready !== "boolean"
      || step.ready !== ((step.count as number) > 0)
      || (step.required !== undefined && typeof step.required !== "boolean")
    ) return undefined;
    const key = step.key as SetupReadinessKey;
    return {
      key,
      count: step.count as number,
      ready: step.ready,
      required: typeof step.required === "boolean" ? step.required : !optionalReadinessKeys.has(key),
    };
  });
  if (steps.some((step) => !step)) return undefined;
  const normalizedSteps = steps as SetupReadinessReadModel["steps"];
  if (record.completedCount !== normalizedSteps.filter((step) => step.ready).length) return undefined;

  return {
    status: normalizedSteps.every((step) => !step.required || step.ready) ? "READY" : "ACTION_REQUIRED",
    completedCount: record.completedCount as number,
    totalCount: record.totalCount as number,
    steps: normalizedSteps,
  };
}
