import { z } from "zod";
import { requiredTrimmedString } from "../http/zod-validation.js";

const isoInstant = z.string().datetime({ offset: true });

export const licenseTermCreateBodySchema = z.object({
  planCode: requiredTrimmedString,
  startsAt: isoInstant,
  endsAt: isoInstant,
  activeStudentLimit: z.number().int().positive(),
  auditReference: requiredTrimmedString,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.startsAt) >= Date.parse(value.endsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "LICENSE_TERM_DATES_INVALID" });
  }
});

export type LicenseTermCreateBody = z.infer<typeof licenseTermCreateBodySchema>;
