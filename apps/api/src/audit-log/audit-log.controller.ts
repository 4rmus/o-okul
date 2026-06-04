import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { AuditLogService, type AuditLogRecord } from "./audit-log.service.js";

@Controller("audit-logs")
@UseGuards(RolesGuard)
export class AuditLogController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get()
  @RequireCapability("audit:read")
  async list(@Query() query: ListQuery): Promise<AuditLogRecord[]> {
    return applyListQuery(await this.auditLogs.list(getRequestContext()), query, auditLogListFields);
  }
}

const auditLogListFields = [
  { name: "action", read: (record: AuditLogRecord) => record.action },
  { name: "entityType", read: (record: AuditLogRecord) => record.entityType },
  { name: "entityId", read: (record: AuditLogRecord) => record.entityId },
  { name: "actorUserId", read: (record: AuditLogRecord) => record.actorUserId },
  { name: "createdAt", read: (record: AuditLogRecord) => record.createdAt },
];
