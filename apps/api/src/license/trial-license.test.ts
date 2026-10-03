import { describe, expect, it } from "vitest";
import type { LicenseTermRecord } from "@o-okul/shared-types";
import { resolveTenantLicense } from "./license-term-store.js";
import { licenseTermCreateBodySchema } from "./license-validation.js";

const trialStart = "2026-10-05T00:00:00.000Z";
const trialEnd = "2026-10-12T00:00:00.000Z";

describe("card-free trial license (DEC-20261004-01)", () => {
  const parse = (body: Record<string, unknown>) => licenseTermCreateBodySchema.safeParse(body);
  const issues = (body: Record<string, unknown>) => {
    const result = parse(body);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  it("accepts a 7-day, 100-student trial and rejects anything longer or larger", () => {
    expect(parse({ planCode: "TRIAL", startsAt: trialStart, endsAt: trialEnd, activeStudentLimit: 100 }).success).toBe(true);
    expect(issues({ planCode: "TRIAL", startsAt: trialStart, endsAt: "2026-10-12T00:00:01.000Z", activeStudentLimit: 100 }))
      .toEqual(["LICENSE_TRIAL_DURATION_EXCEEDED"]);
    expect(issues({ planCode: "TRIAL", startsAt: trialStart, endsAt: trialEnd, activeStudentLimit: 101 }))
      .toEqual(["LICENSE_TRIAL_STUDENT_LIMIT_EXCEEDED"]);
  });

  it("rejects an undefined plan code and keeps paid plans unrestricted", () => {
    expect(parse({ planCode: "FREE", startsAt: trialStart, endsAt: trialEnd, activeStudentLimit: 10 }).success).toBe(false);
    expect(parse({ planCode: "PRO", startsAt: trialStart, endsAt: "2027-10-05T00:00:00.000Z", activeStudentLimit: 500 }).success).toBe(true);
  });

  it("an expired trial is read-only, and a paid term starting at trial end continues the same tenant as ACTIVE", () => {
    const trial: LicenseTermRecord = { id: "trial", tenantId: "t", planCode: "TRIAL", startsAt: trialStart, endsAt: trialEnd, activeStudentLimit: 100 };
    const paid: LicenseTermRecord = { id: "paid", tenantId: "t", planCode: "PRO", startsAt: trialEnd, endsAt: "2027-10-12T00:00:00.000Z", activeStudentLimit: 500 };
    const afterTrial = new Date("2026-10-13T00:00:00.000Z");

    expect(resolveTenantLicense([trial], afterTrial)?.state).toBe("READ_ONLY");
    expect(resolveTenantLicense([trial, paid], new Date("2026-10-08T00:00:00.000Z"))).toMatchObject({ state: "ACTIVE", term: { id: "trial" } });
    expect(resolveTenantLicense([trial, paid], afterTrial)).toMatchObject({ state: "ACTIVE", term: { id: "paid", activeStudentLimit: 500 } });
  });
});
