import type { LicenseState } from "./domain.js";

export interface LicenseTermWindow {
  startsAt: string;
  endsAt: string;
  cancelledAt?: string;
}

const dayInMilliseconds = 24 * 60 * 60 * 1_000;
const readOnlyDays = 14;
const expiryDays = 91;

export function resolveLicenseState(term: LicenseTermWindow, at = new Date()): LicenseState {
  const startsAt = parseInstant(term.startsAt);
  const endsAt = parseInstant(term.endsAt);
  const current = at.getTime();
  if (!Number.isFinite(current) || startsAt >= endsAt) {
    throw new Error("LICENSE_TERM_INVALID");
  }
  if (term.cancelledAt !== undefined) {
    parseInstant(term.cancelledAt);
    return "CANCELLED";
  }
  if (current < startsAt) return "SCHEDULED";
  if (current < endsAt) return "ACTIVE";
  if (current < endsAt + readOnlyDays * dayInMilliseconds) return "READ_ONLY";
  if (current < endsAt + expiryDays * dayInMilliseconds) return "FROZEN";
  return "EXPIRED";
}

/** KV-8 guardian notifications: any term resolving to ACTIVE, the same ACTIVE the API request gate allows. */
export function hasActiveLicenseTerm(terms: readonly LicenseTermWindow[], at = new Date()): boolean {
  return terms.some((term) => resolveLicenseState(term, at) === "ACTIVE");
}

function parseInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("LICENSE_TERM_INVALID");
  return parsed;
}
