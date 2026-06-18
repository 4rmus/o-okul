import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { AuditLogListItemRecord, StudentAuditSummaryRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { AuditLogService, type AuditLogRecord } from "./audit-log.service.js";

interface AuditLogListQuery extends ListQuery {
  entityId?: string;
  entityType?: string;
  studentId?: string;
}

@Controller("audit-logs")
@UseGuards(RolesGuard)
export class AuditLogController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get("safe-list")
  @RequireCapability("audit:read")
  async safeList(@Query() query: ListQuery): Promise<AuditLogListItemRecord[]> {
    return applyListQuery(await this.auditLogs.safeList(getRequestContext()), query, auditLogSafeListFields);
  }

  @Get("student-summary")
  @RequireCapability("audit:read")
  async studentSummary(
    @Query("studentId") studentId: string | undefined,
    @Query("limit") limit: string | undefined,
  ): Promise<StudentAuditSummaryRecord[]> {
    return this.auditLogs.studentSummary(getRequestContext(), studentId, readOptionalPositiveLimit(limit));
  }

  @Get()
  @RequireCapability("audit:read")
  async list(@Query() query: AuditLogListQuery): Promise<AuditLogRecord[]> {
    return applyListQuery(await this.auditLogs.list(getRequestContext(), {
      entityId: query.entityId,
      entityType: query.entityType,
      studentId: query.studentId,
    }), query, auditLogListFields);
  }
}

const auditLogListFields = [
  { name: "action", read: (record: AuditLogRecord) => record.action },
  { name: "entityType", read: (record: AuditLogRecord) => record.entityType },
  { name: "entityId", read: (record: AuditLogRecord) => record.entityId },
  { name: "actorUserId", read: (record: AuditLogRecord) => record.actorUserId },
  { name: "createdAt", read: (record: AuditLogRecord) => record.createdAt },
];

const auditLogSafeListFields = [
  { name: "action", read: (record: AuditLogListItemRecord) => record.actionLabel },
  { name: "category", read: (record: AuditLogListItemRecord) => record.category },
  { name: "entityType", read: (record: AuditLogListItemRecord) => record.entityLabel },
  { name: "actor", read: (record: AuditLogListItemRecord) => record.actorLabel },
  { name: "createdAt", read: (record: AuditLogListItemRecord) => record.createdAt },
];

function readOptionalPositiveLimit(value: string | undefined) {
  if (!value) return 5;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}
