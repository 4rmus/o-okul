import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { assertTenantResourceAccess } from "../tenant/tenant-access.js";

export function assertTenantAccess(context: RequestContext, resource: { tenantId: string }): void {
  try {
    assertTenantResourceAccess(context, resource);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
    throw new ForbiddenException(message);
  }
}

export function resolveWriteTenantId(context: RequestContext, tenantId: string | undefined): string {
  const resolvedTenantId = tenantId ?? context.tenantId;
  if (!resolvedTenantId) {
    throw new ForbiddenException("TENANT_CONTEXT_MISSING");
  }

  assertTenantAccess(context, { tenantId: resolvedTenantId });
  return resolvedTenantId;
}

export function presentFields<TRecord>(record: TRecord, fields: Array<keyof TRecord>): string[] {
  return fields.filter((field) => record[field] !== undefined && record[field] !== "").map(String);
}

export function changedInputFields<TRecord>(
  input: Partial<TRecord>,
  fields: Array<keyof TRecord>,
): string[] {
  return fields.filter((field) => input[field] !== undefined).map(String);
}

export function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function optionalDate(value: string | undefined, message: string): string | undefined {
  const trimmed = optionalText(value);
  if (trimmed === undefined) return undefined;
  if (!isCalendarDateString(trimmed)) {
    throw new BadRequestException(message);
  }
  return trimmed;
}

export function isCalendarDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
