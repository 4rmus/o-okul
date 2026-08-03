import { describe, expect, it } from "vitest";
import { resolveLicenseState } from "./license-state.js";

const term = {
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: "2027-01-01T00:00:00.000Z",
};

describe("resolveLicenseState", () => {
  it.each([
    ["2025-12-31T23:59:59.999Z", "SCHEDULED"],
    ["2026-01-01T00:00:00.000Z", "ACTIVE"],
    ["2026-12-31T23:59:59.999Z", "ACTIVE"],
    ["2027-01-01T00:00:00.000Z", "READ_ONLY"],
    ["2027-01-14T23:59:59.999Z", "READ_ONLY"],
    ["2027-01-15T00:00:00.000Z", "FROZEN"],
    ["2027-04-01T23:59:59.999Z", "FROZEN"],
    ["2027-04-02T00:00:00.000Z", "EXPIRED"],
  ])("%s anını %s olarak çözümler", (at, expected) => {
    expect(resolveLicenseState(term, new Date(at))).toBe(expected);
  });

  it("iptal edilmiş dönemi zamandan bağımsız CANCELLED çözümler", () => {
    expect(resolveLicenseState({ ...term, cancelledAt: "2026-06-01T00:00:00.000Z" }, new Date("2026-07-01T00:00:00.000Z")))
      .toBe("CANCELLED");
  });

  it.each([
    { startsAt: "invalid", endsAt: term.endsAt },
    { startsAt: term.startsAt, endsAt: term.startsAt },
    { ...term, cancelledAt: "invalid" },
  ])("geçersiz dönem verisini fail-closed reddeder", (invalidTerm) => {
    expect(() => resolveLicenseState(invalidTerm)).toThrow("LICENSE_TERM_INVALID");
  });
});
