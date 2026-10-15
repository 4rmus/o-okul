import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Headers } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { MessageTemplateService, type MessageTemplateRecord } from "./message-template.service.js";
import {
  type MessageTemplateCreateBody,
  type MessageTemplateUpdateBody,
  messageTemplateCreateBodySchema,
  messageTemplateUpdateBodySchema,
} from "./message-template-validation.js";

@Controller("message-templates")
export class MessageTemplateController {
  constructor(private readonly templates: MessageTemplateService) {}

  @Get()
  @RequireCapability("announcement:read")
  async list(@Query() query: ListQuery): Promise<MessageTemplateRecord[]> {
    return applyListQuery(await this.templates.list(getRequestContext()), query, messageTemplateListFields);
  }

  @Get(":id")
  @RequireCapability("announcement:read")
  findOne(@Param("id") id: string): Promise<MessageTemplateRecord> {
    return this.templates.findOne(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("announcement:manage")
  create(
    @Body(zodBody(messageTemplateCreateBodySchema)) body: MessageTemplateCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<MessageTemplateRecord> {
    return this.templates.create(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("announcement:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(messageTemplateUpdateBodySchema)) body: MessageTemplateUpdateBody,
  ): Promise<MessageTemplateRecord> {
    return this.templates.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("announcement:manage")
  delete(@Param("id") id: string): Promise<void> {
    return this.templates.delete(getRequestContext(), id);
  }
}

const messageTemplateListFields = [
  { name: "name", read: (record: MessageTemplateRecord) => record.name },
  { name: "channel", read: (record: MessageTemplateRecord) => record.channel },
  { name: "body", read: (record: MessageTemplateRecord) => record.body },
];
