import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { messageTemplateStoreToken, type MessageTemplateStore } from "./message-template-store.js";

export type MessageTemplateChannel = "SMS";

export interface MessageTemplateRecord {
  id: string;
  tenantId: string;
  name: string;
  channel: MessageTemplateChannel;
  body: string;
  deletedAt?: string;
}

@Injectable()
export class MessageTemplateService {
  constructor(
    @Inject(messageTemplateStoreToken) private readonly store: MessageTemplateStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<MessageTemplateRecord[]> {
    return filterTenantResources(context, await this.store.list()).filter((template) => !template.deletedAt);
  }

  async findOne(context: RequestContext, id: string): Promise<MessageTemplateRecord> {
    const template = await this.store.findById(id);
    if (!template || template.deletedAt) {
      throw new NotFoundException("MESSAGE_TEMPLATE_NOT_FOUND");
    }

    this.assertAccess(context, template);
    return template;
  }

  async create(context: RequestContext, input: Partial<MessageTemplateRecord>): Promise<MessageTemplateRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);

    const record = await this.store.create({
      tenantId,
      name: requiredText(input.name, "MESSAGE_TEMPLATE_NAME_REQUIRED"),
      channel: resolveChannel(input.channel),
      body: requiredText(input.body, "MESSAGE_TEMPLATE_BODY_REQUIRED"),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "MessageTemplate",
      entityId: record.id,
      action: "message_template.created",
      diff: { channel: record.channel, name: record.name },
    });
    return record;
  }

  async update(
    context: RequestContext,
    id: string,
    input: Partial<MessageTemplateRecord>,
  ): Promise<MessageTemplateRecord> {
    const template = await this.findOne(context, id);
    const previousState = { channel: template.channel, name: template.name, body: template.body };
    const record = await this.store.update(id, {
      name: input.name !== undefined ? requiredText(input.name, "MESSAGE_TEMPLATE_NAME_REQUIRED") : template.name,
      channel: input.channel !== undefined ? resolveChannel(input.channel) : template.channel,
      body: input.body !== undefined ? requiredText(input.body, "MESSAGE_TEMPLATE_BODY_REQUIRED") : template.body,
    });

    if (!record) {
      throw new NotFoundException("MESSAGE_TEMPLATE_NOT_FOUND");
    }

    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "MessageTemplate",
      entityId: record.id,
      action: "message_template.updated",
      diff: {
        before: previousState,
        after: { channel: record.channel, name: record.name, body: record.body },
      },
    });
    return record;
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findOne(context, id);
    const template = await this.store.softDelete(id, new Date().toISOString());
    if (!template) {
      throw new NotFoundException("MESSAGE_TEMPLATE_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: template.tenantId,
      actorUserId: context.userId,
      entityType: "MessageTemplate",
      entityId: template.id,
      action: "message_template.deleted",
      diff: { name: existing.name, deletedAt: template.deletedAt },
    });
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

function resolveChannel(value: MessageTemplateChannel | undefined): MessageTemplateChannel {
  if (value === undefined) return "SMS";
  if (value !== "SMS") {
    throw new BadRequestException("MESSAGE_TEMPLATE_CHANNEL_INVALID");
  }
  return value;
}
