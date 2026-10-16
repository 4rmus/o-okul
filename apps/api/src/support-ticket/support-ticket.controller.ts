import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import type {
  SupportTicketAttachmentDownloadResult,
  SupportTicketAttachmentRecord,
  SupportTicketCommentRecord,
  SupportTicketRecord,
} from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import {
  SupportTicketService,
  type SupportTicketListFilters,
} from "./support-ticket.service.js";
import {
  type SupportTicketAttachmentCreateBody,
  type SupportTicketCommentCreateBody,
  type SupportTicketCreateBody,
  type SupportTicketUpdateBody,
  supportTicketAttachmentCreateBodySchema,
  supportTicketCommentCreateBodySchema,
  supportTicketCreateBodySchema,
  supportTicketUpdateBodySchema,
} from "./support-ticket-validation.js";

interface SupportTicketListQuery extends ListQuery, SupportTicketListFilters {}

@Controller("support-tickets")
export class SupportTicketController {
  constructor(private readonly tickets: SupportTicketService) {}

  @Get()
  @RequireCapability("support:read-own")
  async list(@Query() query: SupportTicketListQuery): Promise<SupportTicketRecord[]> {
    return applyListQuery(await this.tickets.list(getRequestContext(), query), query, supportTicketListFields);
  }

  @Get(":id")
  @RequireCapability("support:read-own")
  findOne(@Param("id") id: string): Promise<SupportTicketRecord> {
    return this.tickets.findOne(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("support:write-own")
  create(
    @Body(zodBody(supportTicketCreateBodySchema)) body: SupportTicketCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SupportTicketRecord> {
    return this.tickets.create(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("support:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(supportTicketUpdateBodySchema)) body: SupportTicketUpdateBody,
  ): Promise<SupportTicketRecord> {
    return this.tickets.update(getRequestContext(), id, body);
  }

  @Get(":id/attachments")
  @RequireCapability("support:read-own")
  listAttachments(@Param("id") id: string): Promise<SupportTicketAttachmentRecord[]> {
    return this.tickets.listAttachments(getRequestContext(), id);
  }

  @Get(":id/attachments/:attachmentId/download")
  @RequireCapability("support:read-own")
  downloadAttachment(
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ): Promise<SupportTicketAttachmentDownloadResult> {
    return this.tickets.downloadAttachment(getRequestContext(), id, attachmentId);
  }

  @Post(":id/attachments")
  @RequireCapability("support:write-own")
  addAttachment(
    @Param("id") id: string,
    @Body(zodBody(supportTicketAttachmentCreateBodySchema)) body: SupportTicketAttachmentCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SupportTicketAttachmentRecord> {
    return this.tickets.addAttachment(getRequestContext(), id, body, idempotencyKey);
  }

  @Get(":id/comments")
  @RequireCapability("support:read-own")
  listComments(@Param("id") id: string): Promise<SupportTicketCommentRecord[]> {
    return this.tickets.listComments(getRequestContext(), id);
  }

  @Post(":id/comments")
  @RequireCapability("support:write-own")
  addComment(
    @Param("id") id: string,
    @Body(zodBody(supportTicketCommentCreateBodySchema)) body: SupportTicketCommentCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SupportTicketCommentRecord> {
    return this.tickets.addComment(getRequestContext(), id, body, idempotencyKey);
  }
}

const supportTicketListFields = [
  { name: "subject", read: (record: SupportTicketRecord) => record.subject },
  { name: "message", read: (record: SupportTicketRecord) => record.message },
  { name: "priority", read: (record: SupportTicketRecord) => record.priority },
  { name: "status", read: (record: SupportTicketRecord) => record.status },
  { name: "requesterId", read: (record: SupportTicketRecord) => record.requesterId },
  { name: "studentId", read: (record: SupportTicketRecord) => record.studentId },
  { name: "campusId", read: (record: SupportTicketRecord) => record.campusId },
  { name: "gradeLevelId", read: (record: SupportTicketRecord) => record.gradeLevelId },
  { name: "classId", read: (record: SupportTicketRecord) => record.classId },
  { name: "courseId", read: (record: SupportTicketRecord) => record.courseId },
  { name: "termId", read: (record: SupportTicketRecord) => record.termId },
  { name: "createdAt", read: (record: SupportTicketRecord) => record.createdAt },
];
