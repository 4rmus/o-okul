export const tenantSeatLimitExceededCode = "TENANT_SEAT_LIMIT_EXCEEDED";

export interface TenantSeatUsage {
  seatLimit?: number | null;
  activeSeatCount?: number | null;
}

export class TenantSeatLimitExceededError extends Error {
  readonly code = tenantSeatLimitExceededCode;

  constructor() {
    super(tenantSeatLimitExceededCode);
    this.name = "TenantSeatLimitExceededError";
  }
}

export function assertTenantSeatCapacity(tenant: TenantSeatUsage): void {
  const seatLimit = tenant.seatLimit;
  if (seatLimit === undefined || seatLimit === null) return;

  const activeSeatCount = tenant.activeSeatCount ?? 0;
  if (activeSeatCount >= seatLimit) {
    throw new TenantSeatLimitExceededError();
  }
}

export function isTenantSeatLimitExceededError(error: unknown): boolean {
  return (
    error instanceof TenantSeatLimitExceededError ||
    (error instanceof Error && error.message === tenantSeatLimitExceededCode) ||
    Boolean(error && typeof error === "object" && "code" in error && error.code === tenantSeatLimitExceededCode)
  );
}
