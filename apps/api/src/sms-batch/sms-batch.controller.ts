import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
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
  @Roles("TENANT_ADMIN")
  create(@Body() body: CreateSmsBatchInput): Promise<SmsBatchQueueResult> {
    return this.batches.enqueue(getRequestContext(), body);
  }

  @Post("recipients/preview")
  @Roles("TENANT_ADMIN")
  previewRecipients(@Body() body: SmsBatchRecipientPreviewInput): Promise<SmsBatchRecipientPreviewResult> {
    return this.batches.previewRecipients(getRequestContext(), body);
  }

  @Get(":jobId")
  @Roles("TENANT_ADMIN")
  findDeliveryReport(@Param("jobId") jobId: string): Promise<SmsBatchDeliveryReportRecord> {
    return this.batches.findDeliveryReport(getRequestContext(), jobId);
  }
}
