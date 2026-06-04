import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  SmsBatchService,
  type CreateSmsBatchInput,
  type SmsBatchQueueResult,
  type SmsBatchRecipientPreviewInput,
  type SmsBatchRecipientPreviewResult,
} from "./sms-batch.service.js";
import type { SmsBatchDeliveryReportRecord } from "./sms-batch-delivery-report-store.js";

@Controller("sms-batches")
@UseGuards(RolesGuard)
export class SmsBatchController {
  constructor(private readonly batches: SmsBatchService) {}

  @Post()
  @RequireCapability("announcement:manage")
  create(@Body() body: CreateSmsBatchInput): Promise<SmsBatchQueueResult> {
    return this.batches.enqueue(getRequestContext(), body);
  }

  @Post("recipients/preview")
  @RequireCapability("announcement:manage")
  previewRecipients(@Body() body: SmsBatchRecipientPreviewInput): Promise<SmsBatchRecipientPreviewResult> {
    return this.batches.previewRecipients(getRequestContext(), body);
  }

  @Get(":jobId")
  @RequireCapability("announcement:manage")
  findDeliveryReport(@Param("jobId") jobId: string): Promise<SmsBatchDeliveryReportRecord> {
    return this.batches.findDeliveryReport(getRequestContext(), jobId);
  }
}
