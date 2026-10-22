/**
 * Process-local counters for security side effects that failed after the main action had already committed, so
 * the caller was not failed (DEC-20261021-01: the MFA reset still returns its one-time code). `MetricsService`
 * renders them as `o_okul_auth_security_side_effect_failures_total{event}`; labels are a fixed set, never ids or
 * addresses. The warn/error log line written next to each increment carries the ids for follow-up.
 */
export const securitySideEffectEvents = ["mfa_notice_enqueue", "mfa_reset_audit"] as const;
export type SecuritySideEffectEvent = (typeof securitySideEffectEvents)[number];

const failures = new Map<SecuritySideEffectEvent, number>(securitySideEffectEvents.map((event) => [event, 0]));

export function recordSecuritySideEffectFailure(event: SecuritySideEffectEvent): void {
  failures.set(event, (failures.get(event) ?? 0) + 1);
}

export function securitySideEffectFailureCounts(): Array<{ event: SecuritySideEffectEvent; count: number }> {
  return securitySideEffectEvents.map((event) => ({ event, count: failures.get(event) ?? 0 }));
}

/** Tests only. */
export function resetSecuritySideEffectFailureCounts(): void {
  for (const event of securitySideEffectEvents) failures.set(event, 0);
}
