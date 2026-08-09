"use client";

import { useQuery } from "@tanstack/react-query";
import type { SetupReadinessResponse } from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest } from "../../../../../src/api-client.js";
import { setupWizardSteps, type SetupWizardStep } from "./wizard-steps.js";

export interface SetupStepProgress extends SetupWizardStep {
  count: number;
  isComplete: boolean;
}

export function useSetupProgress(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-setup-progress", tenantId],
    queryFn: async () => {
      const readiness = await apiRequest<SetupReadinessResponse>(accessToken, `${apiBaseUrl}/me/setup-readiness`);
      const readinessByStep = new Map(readiness.steps.map((step) => [step.id, step]));
      const steps: SetupStepProgress[] = setupWizardSteps.map((step) => {
        const readinessStep = readinessByStep.get(step.id);
        return { ...step, count: readinessStep?.count ?? 0, isComplete: readinessStep?.isComplete ?? false };
      });
      return {
        completedCount: readiness.completedCount,
        percent: readiness.percent,
        steps,
        totalCount: readiness.totalCount,
      };
    },
    enabled,
    refetchOnWindowFocus: false,
  });
}
