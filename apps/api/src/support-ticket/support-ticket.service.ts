import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  SupportTicketAttachmentDownloadResult,
  SupportTicketAttachmentRecord as SharedSupportTicketAttachmentRecord,
  SupportTicketCommentRecord as SharedSupportTicketCommentRecord,
  SupportTicketRecord as SharedSupportTicketRecord,
  UploadContentType,
} from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { assertUploadContentMatchesContentType } from "../upload/upload-validation.js";
import {
  supportTicketAttachmentStorageToken,
  type SupportTicketAttachmentStorage,
} from "./support-ticket-attachment-storage.js";
import { supportTicketStoreToken, type SupportTicketStore } from "./support-ticket-store.js";

export type SupportTicketPriority = SharedSupportTicketRecord["priority"];
export type SupportTicketStatus = SharedSupportTicketRecord["status"];

export interface SupportTicketRecord extends SharedSupportTicketRecord {
  deletedAt?: string;
}

export interface SupportTicketAttachmentRecord extends SharedSupportTicketAttachmentRecord {
  contentBase64?: string;
  storageKey?: string;
  deletedAt?: string;
}

export type SupportTicketAttachmentDownload = SupportTicketAttachmentDownloadResult;

export interface SupportTicketCommentRecord extends SharedSupportTicketCommentRecord {
  deletedAt?: string;
}

export type SupportTicketAttachmentContentType = UploadContentType;

export interface CreateSupportTicketAttachmentInput {
  fileName?: string;
  contentType?: string;
  fileBase64?: string;
}

export interface CreateSupportTicketCommentInput {
  body?: string;
}

const maxAttachmentBytes = 64 * 1024;

@Injectable()
export class SupportTicketService {
  constructor(
    @Inject(supportTicketStoreToken) private readonly store: SupportTicketStore,
    @Inject(supportTicketAttachmentStorageToken)
    private readonly attachmentStorage: SupportTicketAttachmentStorage,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<SupportTicketRecord[]> {
    return filterTenantResources(context, await this.store.list()).filter((ticket) => !ticket.deletedAt);
  }

  async findOne(context: RequestContext, id: string): Promise<SupportTicketRecord> {
    const ticket = await this.store.findById(id);
    if (!ticket || ticket.deletedAt) {
      throw new NotFoundException("SUPPORT_TICKET_NOT_FOUND");
    }

    this.assertAccess(context, ticket);
    return ticket;
  }

  async create(
    context: RequestContext,
    input: Partial<SupportTicketRecord>,
  ): Promise<SupportTicketRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);

    const record = await this.store.create({
      tenantId,
      requesterId: context.userId,
      subject: requiredText(input.subject, "SUPPORT_TICKET_SUBJECT_REQUIRED"),
      message: requiredText(input.message, "SUPPORT_TICKET_MESSAGE_REQUIRED"),
      priority: resolvePriority(input.priority),
      status: "OPEN",
      createdAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicket",
      entityId: record.id,
      action: "support_ticket.created",
      diff: { priority: record.priority, status: record.status, subject: record.subject },
    });
    return record;
  }

  async update(
    context: RequestContext,
    id: string,
    input: Partial<Pick<SupportTicketRecord, "priority" | "status">>,
  ): Promise<SupportTicketRecord> {
    const ticket = await this.findOne(context, id);
    if (input.priority === undefined && input.status === undefined) {
      throw new BadRequestException("SUPPORT_TICKET_UPDATE_REQUIRED");
    }

    const previousState = { priority: ticket.priority, status: ticket.status };
    const record = await this.store.update(id, {
      priority: input.priority !== undefined ? resolvePriority(input.priority) : ticket.priority,
      status: input.status !== undefined ? resolveStatus(input.status) : ticket.status,
    });
    if (!record) {
      throw new NotFoundException("SUPPORT_TICKET_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicket",
      entityId: record.id,
      action: "support_ticket.updated",
      diff: {
        before: previousState,
        after: { priority: record.priority, status: record.status },
      },
    });
    return record;
  }

  async listAttachments(context: RequestContext, ticketId: string): Promise<SupportTicketAttachmentRecord[]> {
    await this.findOne(context, ticketId);
    return filterTenantResources(context, await this.store.listAttachments(ticketId)).filter(
      (attachment) => !attachment.deletedAt,
    );
  }

  async downloadAttachment(
    context: RequestContext,
    ticketId: string,
    attachmentId: string,
  ): Promise<SupportTicketAttachmentDownload> {
    const ticket = await this.findOne(context, ticketId);
    const attachment = await this.store.findAttachmentById(attachmentId);
    if (!attachment || attachment.deletedAt || attachment.ticketId !== ticket.id) {
      throw new NotFoundException("SUPPORT_TICKET_ATTACHMENT_NOT_FOUND");
    }

    this.assertAccess(context, attachment);
    const fileBase64 = attachment.storageKey
      ? (await this.attachmentStorage.get(attachment.storageKey)).toString("base64")
      : attachment.contentBase64;
    if (!fileBase64) {
      throw new NotFoundException("SUPPORT_TICKET_ATTACHMENT_NOT_FOUND");
    }

    return {
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      fileBase64,
    };
  }

  async addAttachment(
    context: RequestContext,
    ticketId: string,
    input: CreateSupportTicketAttachmentInput,
  ): Promise<SupportTicketAttachmentRecord> {
    const ticket = await this.findOne(context, ticketId);
    const body = readAttachmentBytes(input.fileBase64);
    const contentType = resolveAttachmentContentType(input.contentType);
    assertUploadContentMatchesContentType(body, contentType, "SUPPORT_TICKET_ATTACHMENT_CONTENT_MISMATCH");
    const fileName = normalizeAttachmentFileName(input.fileName);
    const sha256 = createSha256(body);
    const storedAttachment = await this.attachmentStorage.put({
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      fileName,
      contentType,
      body,
      sha256,
    });

    const attachment = await this.store.createAttachment({
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      uploadedById: context.userId,
      fileName,
      contentType,
      byteSize: body.length,
      sha256,
      contentBase64: storedAttachment.contentBase64,
      storageKey: storedAttachment.storageKey,
      createdAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: attachment.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicketAttachment",
      entityId: attachment.id,
      action: "support_ticket_attachment.created",
      diff: {
        ticketId: ticket.id,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        sha256: attachment.sha256,
      },
    });
    return attachment;
  }

  async listComments(context: RequestContext, ticketId: string): Promise<SupportTicketCommentRecord[]> {
    await this.findOne(context, ticketId);
    return filterTenantResources(context, await this.store.listComments(ticketId)).filter((comment) => !comment.deletedAt);
  }

  async addComment(
    context: RequestContext,
    ticketId: string,
    input: CreateSupportTicketCommentInput,
  ): Promise<SupportTicketCommentRecord> {
    const ticket = await this.findOne(context, ticketId);
    const body = requiredText(input.body, "SUPPORT_TICKET_COMMENT_BODY_REQUIRED");
    const comment = await this.store.createComment({
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      authorId: context.userId,
      body,
      createdAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: comment.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicketComment",
      entityId: comment.id,
      action: "support_ticket_comment.created",
      diff: { ticketId: ticket.id, bodyLength: body.length },
    });
    return comment;
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

function resolvePriority(value: SupportTicketPriority | undefined): SupportTicketPriority {
  if (value === undefined) return "NORMAL";
  if (value !== "LOW" && value !== "NORMAL" && value !== "HIGH") {
    throw new BadRequestException("SUPPORT_TICKET_PRIORITY_INVALID");
  }
  return value;
}

function resolveStatus(value: SupportTicketStatus): SupportTicketStatus {
  if (value !== "OPEN" && value !== "IN_PROGRESS" && value !== "RESOLVED" && value !== "CLOSED") {
    throw new BadRequestException("SUPPORT_TICKET_STATUS_INVALID");
  }
  return value;
}

function normalizeAttachmentFileName(fileName: string | undefined): string {
  const value = requiredText(fileName, "SUPPORT_TICKET_ATTACHMENT_FILE_NAME_REQUIRED");
  const name = value.split(/[\\/]/).at(-1)?.trim();
  if (!name) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_NAME_REQUIRED");
  }
  if (name.length > 120 || /[\u0000-\u001f]/.test(name)) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_NAME_INVALID");
  }
  return name;
}

function resolveAttachmentContentType(value: string | undefined): SupportTicketAttachmentContentType {
  if (
    value === "application/pdf" ||
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "text/plain"
  ) {
    return value;
  }
  throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_CONTENT_TYPE_INVALID");
}

function readAttachmentBytes(fileBase64: string | undefined): Buffer {
  const trimmed = fileBase64?.trim();
  if (!trimmed) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_REQUIRED");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_INVALID");
  }

  const body = Buffer.from(trimmed, "base64");
  if (body.length === 0) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_REQUIRED");
  }
  if (body.length > maxAttachmentBytes) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_TOO_LARGE");
  }

  return body;
}

function createSha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}
