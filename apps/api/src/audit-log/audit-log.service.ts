import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { isSystemAdmin } from "../rbac/roles.js";
import { auditLogStoreToken, type AuditLogStore } from "./audit-log-store.js";

export interface AuditLogRecord {
  id: string;
  tenantId?: string;
  actorUserId?: string;
  entityType: string;
  entityId?: string;
  action: string;
  diff?: Record<string, unknown>;
  createdAt: string;
}

export type CreateAuditLogInput = Omit<AuditLogRecord, "id" | "createdAt"> & {
  createdAt?: string;
};

@Injectable()
export class AuditLogService {
  constructor(@Inject(auditLogStoreToken) private readonly store: AuditLogStore) {}

  async list(context: RequestContext): Promise<AuditLogRecord[]> {
    if (isSystemAdmin(context.roles)) {
      return this.store.listForAdmin ? this.store.listForAdmin() : this.store.list();
    }

    const records = await this.store.list();
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }
    return records.filter((record) => record.tenantId === context.tenantId);
  }

  async record(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    return this.store.create({
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
  }
}
