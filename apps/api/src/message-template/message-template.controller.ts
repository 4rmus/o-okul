import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { MessageTemplateService, type MessageTemplateRecord } from "./message-template.service.js";

@Controller("message-templates")
@UseGuards(RolesGuard)
export class MessageTemplateController {
  constructor(private readonly templates: MessageTemplateService) {}

  @Get()
  @Roles("TENANT_ADMIN", "TEACHER")
  async list(@Query() query: ListQuery): Promise<MessageTemplateRecord[]> {
    return applyListQuery(await this.templates.list(getRequestContext()), query, messageTemplateListFields);
  }

  @Get(":id")
  @Roles("TENANT_ADMIN", "TEACHER")
  findOne(@Param("id") id: string): Promise<MessageTemplateRecord> {
    return this.templates.findOne(getRequestContext(), id);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<MessageTemplateRecord>): Promise<MessageTemplateRecord> {
    return this.templates.create(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TENANT_ADMIN")
  update(@Param("id") id: string, @Body() body: Partial<MessageTemplateRecord>): Promise<MessageTemplateRecord> {
    return this.templates.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TENANT_ADMIN")
  delete(@Param("id") id: string): Promise<void> {
    return this.templates.delete(getRequestContext(), id);
  }
}

const messageTemplateListFields = [
  { name: "name", read: (record: MessageTemplateRecord) => record.name },
  { name: "channel", read: (record: MessageTemplateRecord) => record.channel },
  { name: "body", read: (record: MessageTemplateRecord) => record.body },
];
