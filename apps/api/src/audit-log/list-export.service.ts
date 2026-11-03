import { BadRequestException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import type { ListExportAuditRecord, ListExportAuditRequest, ListExportKind } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { hasCapability, type Capability } from "../rbac/role-capabilities.js";
import { AuditLogService } from "./audit-log.service.js";
import { normalizeFiltersSummary } from "./list-export-validation.js";

/**
 * The capability that opens each exportable list's GET endpoint. Exporting needs exactly the right to read the list
 * (DEC-20261102-08: "listeyi görebilen rol dışa aktarabilir"); nothing wider and nothing narrower.
 */
export const listExportCapabilities: Record<ListExportKind, Capability> = {
  attendance: "attendance:read-assigned",
  classes: "class:read",
  students: "student:list",
  teachers: "staff:read-teachers",
};

@Injectable()
export class ListExportAuditService {
  constructor(
    private readonly auditLogs: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  /**
   * Writes one audit event (user, list, row count, the list's allow-listed filter keys) before the browser builds the CSV. The row
   * content never reaches the API. Portals have no export, so only a tenant STAFF persona may record one.
   */
  async record(context: RequestContext, input: ListExportAuditRequest, idempotencyKey?: string): Promise<ListExportAuditRecord> {
    const tenantId = requireTenantStaffContext(context);
    if (!hasCapability(context, listExportCapabilities[input.list])) {
      throw new ForbiddenException("FORBIDDEN");
    }
    const key = idempotencyKey?.trim();
    if (!key) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");

    const normalized: ListExportAuditRequest = {
      filtersSummary: normalizeFiltersSummary(input.list, input.filtersSummary),
      list: input.list,
      rowCount: input.rowCount,
    };
    if (!this.idempotency) return this.recordOnce(context, tenantId, normalized);
    return this.idempotency.run(
      context,
      { key, operation: "audit.list-export.record", request: { actorUserId: context.userId, input: normalized } },
      () => this.recordOnce(context, tenantId, normalized),
    );
  }

  private async recordOnce(context: RequestContext, tenantId: string, input: ListExportAuditRequest): Promise<ListExportAuditRecord> {
    const record = await this.auditLogs.record({
      action: "list.exported",
      actorUserId: context.userId,
      diff: {
        filtersSummary: input.filtersSummary,
        listType: input.list,
        rowCount: input.rowCount,
      },
      entityId: input.list,
      entityType: "ListExport",
      tenantId,
    });
    return {
      auditId: record.id,
      list: input.list,
      recordedAt: record.createdAt,
      rowCount: input.rowCount,
    };
  }
}

function requireTenantStaffContext(context: RequestContext): string {
  if (
    context.activePersona !== "STAFF" ||
    !context.tenantId ||
    context.bypassRls ||
    context.roles.includes("SYSTEM_ADMIN")
  ) {
    throw new ForbiddenException("TENANT_STAFF_CONTEXT_REQUIRED");
  }
  return context.tenantId;
}
