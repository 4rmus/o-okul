import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import type {
  AnnouncementDeliveryQueueResult,
  AnnouncementDeliveryReportRecord,
  AnnouncementRecipientReport,
} from "@o-okul/shared-types";
import {
  AnnouncementService,
  type AnnouncementRecord,
} from "./announcement.service.js";
import {
  type AnnouncementCreateBody,
  type AnnouncementDeliveryResultBody,
  type AnnouncementDeliverySendBody,
  announcementCreateBodySchema,
  announcementDeliveryResultBodySchema,
  announcementDeliverySendBodySchema,
} from "./announcement-validation.js";

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

  @Get(":id/recipients")
  @RequireCapability("announcement:manage")
  recipients(@Param("id") id: string): Promise<AnnouncementRecipientReport> {
    return this.announcements.recipientReport(getRequestContext(), id);
  }

  @Get(":id/delivery-reports")
  @RequireCapability("announcement:manage")
  deliveryReports(@Param("id") id: string): Promise<AnnouncementDeliveryReportRecord[]> {
    return this.announcements.deliveryReports(getRequestContext(), id);
  }

  @Post(":id/delivery-results")
  @RequireCapability("announcement:manage")
  deliveryResult(
    @Param("id") id: string,
    @Body(zodBody(announcementDeliveryResultBodySchema)) body: AnnouncementDeliveryResultBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<AnnouncementDeliveryQueueResult> {
    return this.announcements.enqueueDeliveryResult(getRequestContext(), id, body, idempotencyKey);
  }

  @Post(":id/deliveries")
  @RequireCapability("announcement:manage")
  sendDelivery(
    @Param("id") id: string,
    @Body(zodBody(announcementDeliverySendBodySchema)) body: AnnouncementDeliverySendBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<AnnouncementDeliveryQueueResult> {
    return this.announcements.sendExternalDelivery(getRequestContext(), id, body, idempotencyKey);
  }

  @Post()
  @RequireCapability("announcement:manage")
  create(
    @Body(zodBody(announcementCreateBodySchema)) body: AnnouncementCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<AnnouncementRecord> {
    return this.announcements.create(getRequestContext(), body, idempotencyKey);
  }
}

const announcementListFields = [
  { name: "title", read: (record: AnnouncementRecord) => record.title },
  { name: "body", read: (record: AnnouncementRecord) => record.body },
  { name: "audience", read: (record: AnnouncementRecord) => record.audience },
  { name: "campusId", read: (record: AnnouncementRecord) => record.campusId },
  { name: "gradeLevelId", read: (record: AnnouncementRecord) => record.gradeLevelId },
  { name: "classId", read: (record: AnnouncementRecord) => record.classId },
  { name: "courseId", read: (record: AnnouncementRecord) => record.courseId },
  { name: "termId", read: (record: AnnouncementRecord) => record.termId },
  { name: "publishedAt", read: (record: AnnouncementRecord) => record.publishedAt },
];
