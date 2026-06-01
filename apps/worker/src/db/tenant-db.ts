import { requireJobTenantContext } from "../context/job-context.js";

export interface TenantWrite {
  tenantId: string;
  entityId: string;
  action: string;
}

export class TenantDbAccess {
  readonly writes: TenantWrite[] = [];

  writeTenantEntity(entityId: string, action: string): TenantWrite {
    const context = requireJobTenantContext();
    const write = {
      tenantId: context.tenantId,
      entityId,
      action,
    };
    this.writes.push(write);
    return write;
  }
}
