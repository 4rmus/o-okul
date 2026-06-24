import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
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
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
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
@UseGuards(RolesGuard)
export class SupportTicketController {
  constructor(private readonly tickets: SupportTicketService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: SupportTicketListQuery): Promise<SupportTicketRecord[]> {
    return applyListQuery(await this.tickets.list(getRequestContext(), query), query, supportTicketListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<SupportTicketRecord> {
    return this.tickets.findOne(getRequestContext(), id);
  }

  @Post()
  @Roles("TEACHER")
  create(
    @Body(zodBody(supportTicketCreateBodySchema)) body: SupportTicketCreateBody,
  ): Promise<SupportTicketRecord> {
    return this.tickets.create(getRequestContext(), body);
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
  @Roles("TEACHER")
  listAttachments(@Param("id") id: string): Promise<SupportTicketAttachmentRecord[]> {
    return this.tickets.listAttachments(getRequestContext(), id);
  }

  @Get(":id/attachments/:attachmentId/download")
  @Roles("TEACHER")
  downloadAttachment(
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ): Promise<SupportTicketAttachmentDownloadResult> {
    return this.tickets.downloadAttachment(getRequestContext(), id, attachmentId);
  }

  @Post(":id/attachments")
  @Roles("TEACHER")
  addAttachment(
    @Param("id") id: string,
    @Body(zodBody(supportTicketAttachmentCreateBodySchema)) body: SupportTicketAttachmentCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SupportTicketAttachmentRecord> {
    return this.tickets.addAttachment(getRequestContext(), id, body, idempotencyKey);
  }

  @Get(":id/comments")
  @Roles("TEACHER")
  listComments(@Param("id") id: string): Promise<SupportTicketCommentRecord[]> {
    return this.tickets.listComments(getRequestContext(), id);
  }

  @Post(":id/comments")
  @Roles("TEACHER")
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
