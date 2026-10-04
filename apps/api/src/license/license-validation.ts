import { licensePlanCodes, trialLicenseLimits } from "@o-okul/shared-types";
import { z } from "zod";

const isoInstant = z.string().datetime({ offset: true });

export const licenseTermCreateBodySchema = z.object({
  planCode: z.enum(licensePlanCodes),
  startsAt: isoInstant,
  endsAt: isoInstant,
  activeStudentLimit: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.startsAt) >= Date.parse(value.endsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "LICENSE_TERM_DATES_INVALID" });
  }
  if (value.planCode !== "TRIAL") return;
  // DEC-20261004-02: a trial is at most 7 days and 100 active students.
  if (Date.parse(value.endsAt) - Date.parse(value.startsAt) > trialLicenseLimits.maxDays * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "LICENSE_TRIAL_DURATION_EXCEEDED" });
  }
  if (value.activeStudentLimit > trialLicenseLimits.maxActiveStudents) {
    context.addIssue({ code: "custom", path: ["activeStudentLimit"], message: "LICENSE_TRIAL_STUDENT_LIMIT_EXCEEDED" });
  }
});

export type LicenseTermCreateBody = z.infer<typeof licenseTermCreateBodySchema>;
