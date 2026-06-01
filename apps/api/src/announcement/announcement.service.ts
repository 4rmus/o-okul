import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { announcementStoreToken, type AnnouncementStore } from "./announcement-store.js";

export type AnnouncementAudience = "SCHOOL" | "TEACHERS";

export interface AnnouncementRecord {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  publishedAt: string;
  deletedAt?: string;
}

@Injectable()
export class AnnouncementService {
  constructor(
    @Inject(announcementStoreToken) private readonly store: AnnouncementStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<AnnouncementRecord[]> {
    return filterTenantResources(context, await this.store.list()).filter((announcement) => !announcement.deletedAt);
  }

  async findOne(context: RequestContext, id: string): Promise<AnnouncementRecord> {
    const announcement = await this.store.findById(id);
    if (!announcement || announcement.deletedAt) {
      throw new NotFoundException("ANNOUNCEMENT_NOT_FOUND");
    }

    this.assertAccess(context, announcement);
    return announcement;
  }

  async create(context: RequestContext, input: Partial<AnnouncementRecord>): Promise<AnnouncementRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const title = requiredText(input.title, "ANNOUNCEMENT_TITLE_REQUIRED");
    const body = requiredText(input.body, "ANNOUNCEMENT_BODY_REQUIRED");
    const audience = resolveAudience(input.audience);

    const record = await this.store.create({
      tenantId,
      title,
      body,
      audience,
      publishedAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Announcement",
      entityId: record.id,
      action: "announcement.created",
      diff: { audience: record.audience, title: record.title },
    });
    return record;
  }

  private resolveTenantId(context: RequestContext, tenantId: string | undefined): string {
    const resolvedTenantId = tenantId ?? context.tenantId;
    if (!resolvedTenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId: resolvedTenantId });
    return resolvedTenantId;
  }

  private assertAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
  }
}

function requiredText(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function resolveAudience(value: AnnouncementAudience | undefined): AnnouncementAudience {
  if (value === undefined) return "SCHOOL";
  if (value !== "SCHOOL" && value !== "TEACHERS") {
    throw new BadRequestException("ANNOUNCEMENT_AUDIENCE_INVALID");
  }
  return value;
}
