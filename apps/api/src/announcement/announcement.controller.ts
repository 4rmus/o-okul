import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { AnnouncementService, type AnnouncementRecord } from "./announcement.service.js";

@Controller("announcements")
@UseGuards(RolesGuard)
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @Roles("TENANT_ADMIN", "TEACHER")
  async list(@Query() query: ListQuery): Promise<AnnouncementRecord[]> {
    return applyListQuery(await this.announcements.list(getRequestContext()), query, announcementListFields);
  }

  @Get(":id")
  @Roles("TENANT_ADMIN", "TEACHER")
  findOne(@Param("id") id: string): Promise<AnnouncementRecord> {
    return this.announcements.findOne(getRequestContext(), id);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<AnnouncementRecord>): Promise<AnnouncementRecord> {
    return this.announcements.create(getRequestContext(), body);
  }
}

const announcementListFields = [
  { name: "title", read: (record: AnnouncementRecord) => record.title },
  { name: "body", read: (record: AnnouncementRecord) => record.body },
  { name: "audience", read: (record: AnnouncementRecord) => record.audience },
  { name: "publishedAt", read: (record: AnnouncementRecord) => record.publishedAt },
];
