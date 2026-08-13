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

export function useSetupProgress(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-setup-progress", tenantId],
    queryFn: async () => {
      const result = await apiRequest<unknown>(accessToken, `${apiBaseUrl}/setup/readiness`);
      if (!isSetupReadinessReadModel(result)) {
        throw new Error("INVALID_SETUP_READINESS_RESPONSE");
      }
      return result;
    },
    enabled,
    refetchOnWindowFocus: false,
  });
}

function isSetupReadinessReadModel(value: unknown): value is SetupReadinessReadModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<SetupReadinessReadModel>;
  if (record.status !== "READY" && record.status !== "ACTION_REQUIRED") return false;
  if (!Number.isInteger(record.completedCount) || !Number.isInteger(record.totalCount)) return false;
  if (record.totalCount !== readinessKeys.length || !Array.isArray(record.steps) || record.steps.length !== readinessKeys.length) return false;
  if (record.completedCount! < 0 || record.completedCount! > record.totalCount) return false;

  return record.steps.every((step, index) => (
    step?.key === readinessKeys[index]
    && Number.isInteger(step.count)
    && step.count >= 0
    && typeof step.ready === "boolean"
    && step.ready === (step.count > 0)
  )) && record.completedCount === record.steps.filter((step) => step.ready).length;
}
