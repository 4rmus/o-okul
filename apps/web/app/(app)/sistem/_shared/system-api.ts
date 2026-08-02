import type { TenantCreateFormPayload, TenantFormPayload } from "../../../../src/form-validation.js";
import { apiBaseUrl, apiListRequest, apiRequest, type ListResult } from "../../../../src/api-client.js";
import { buildListUrl, type ListQueryState } from "../../../../src/list-controls.js";

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  seatLimit?: number;
  activeSeatCount?: number;
  status: string;
}

export interface TenantCreateResponse {
  tenant: TenantRecord;
  owner: {
    id: string;
    employeeId: string;
    tenantId: string;
    roles: string[];
  };
  campuses: Array<{ id: string; tenantId: string; name: string; code?: string; unitType?: string }>;
  licenseTerm: { id: string; tenantId: string; planCode: string; startsAt: string; endsAt: string; activeStudentLimit: number };
}

export function loadTenants(accessToken: string, listQuery: ListQueryState): Promise<ListResult<TenantRecord>> {
  return apiListRequest<TenantRecord>(accessToken, buildListUrl(`${apiBaseUrl}/tenants`, listQuery));
}

export function loadTenant(accessToken: string, id: string): Promise<TenantRecord> {
  return apiRequest<TenantRecord>(accessToken, `${apiBaseUrl}/tenants/${encodeURIComponent(id)}`);
}

export function createTenant(accessToken: string, input: TenantCreateFormPayload): Promise<TenantCreateResponse> {
  return apiRequest<TenantCreateResponse>(accessToken, `${apiBaseUrl}/tenants`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    method: "POST",
  });
}

export function updateTenant(accessToken: string, id: string, input: TenantFormPayload): Promise<TenantRecord> {
  return apiRequest<TenantRecord>(accessToken, `${apiBaseUrl}/tenants/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}
