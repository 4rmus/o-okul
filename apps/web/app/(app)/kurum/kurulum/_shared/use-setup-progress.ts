"use client";

import { useQuery } from "@tanstack/react-query";
import type { GuardianRecord, GuardianStudentRecord } from "@o-okul/shared-types";
import { apiBaseUrl, apiListRequest, apiRequest, withQueryParams } from "../../../../../src/api-client.js";
import { setupWizardSteps, type SetupWizardStep } from "./wizard-steps.js";

export interface SetupStepProgress extends SetupWizardStep {
  count: number;
  isComplete: boolean;
}

export function useSetupProgress(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-setup-progress", tenantId],
    queryFn: async () => {
      const entries = await Promise.all(
        setupWizardSteps.map(async (step) => {
          const count = await loadStepCount(accessToken, step.id);
          return [step.id, count] as const;
        }),
      );
      const countByStep = new Map(entries);
      const steps: SetupStepProgress[] = setupWizardSteps.map((step) => {
        const count = countByStep.get(step.id) ?? 0;
        return { ...step, count, isComplete: count > 0 };
      });
      const completedCount = steps.filter((step) => step.isComplete).length;
      return {
        completedCount,
        percent: Math.round((completedCount / steps.length) * 100),
        steps,
        totalCount: steps.length,
      };
    },
    enabled,
    refetchOnWindowFocus: false,
  });
}

async function loadStepCount(accessToken: string, stepId: SetupWizardStep["id"]) {
  if (stepId === "guardian-links") return loadGuardianLinkCount(accessToken);

  const url = withQueryParams(`${apiBaseUrl}/${stepEndpointById[stepId]}`, { limit: "1" });
  const result = await apiListRequest<unknown>(accessToken, url);
  return result.meta.total;
}

async function loadGuardianLinkCount(accessToken: string) {
  const url = withQueryParams(`${apiBaseUrl}/guardians`, { limit: "50" });
  const guardians = await apiListRequest<GuardianRecord>(accessToken, url);
  const linkLists = await Promise.all(
    guardians.data.map((guardian) =>
      apiRequest<GuardianStudentRecord[]>(
        accessToken,
        `${apiBaseUrl}/guardians/${encodeURIComponent(guardian.id)}/students`,
      ),
    ),
  );
  return linkLists.reduce((total, links) => total + links.length, 0);
}

const stepEndpointById: Record<Exclude<SetupWizardStep["id"], "guardian-links">, string> = {
  campuses: "campuses",
  "grade-levels": "grade-levels",
  classes: "classes",
  courses: "courses",
  teachers: "teachers",
  students: "students",
  guardians: "guardians",
  "learning-outcomes": "learning-outcomes",
};
