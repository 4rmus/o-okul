import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  SupportTicketAttachmentDownloadResult,
  SupportTicketAttachmentRecord,
  SupportTicketCommentRecord,
  SupportTicketRecord,
} from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  SupportTicketService,
  type CreateSupportTicketAttachmentInput,
  type CreateSupportTicketCommentInput,
} from "./support-ticket.service.js";

@Controller("support-tickets")
@UseGuards(RolesGuard)
export class SupportTicketController {
  constructor(private readonly tickets: SupportTicketService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<SupportTicketRecord[]> {
    return applyListQuery(await this.tickets.list(getRequestContext()), query, supportTicketListFields);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<SupportTicketRecord> {
    return this.tickets.findOne(getRequestContext(), id);
  }

  @Post()
  @Roles("TEACHER")
  create(@Body() body: Partial<SupportTicketRecord>): Promise<SupportTicketRecord> {
    return this.tickets.create(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TENANT_ADMIN")
  update(
    @Param("id") id: string,
    @Body() body: Partial<Pick<SupportTicketRecord, "priority" | "status">>,
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
    @Body() body: CreateSupportTicketAttachmentInput,
  ): Promise<SupportTicketAttachmentRecord> {
    return this.tickets.addAttachment(getRequestContext(), id, body);
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
    @Body() body: CreateSupportTicketCommentInput,
  ): Promise<SupportTicketCommentRecord> {
    return this.tickets.addComment(getRequestContext(), id, body);
  }
}

const supportTicketListFields = [
  { name: "subject", read: (record: SupportTicketRecord) => record.subject },
  { name: "message", read: (record: SupportTicketRecord) => record.message },
  { name: "priority", read: (record: SupportTicketRecord) => record.priority },
  { name: "status", read: (record: SupportTicketRecord) => record.status },
  { name: "requesterId", read: (record: SupportTicketRecord) => record.requesterId },
  { name: "createdAt", read: (record: SupportTicketRecord) => record.createdAt },
];
