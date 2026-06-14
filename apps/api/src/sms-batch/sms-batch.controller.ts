import { Body, Controller, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  SmsBatchService,
  type SmsBatchQueueResult,
  type SmsBatchRecipientPreviewResult,
} from "./sms-batch.service.js";
import type { SmsBatchDeliveryReportRecord } from "./sms-batch-delivery-report-store.js";
import {
  type SmsBatchCreateBody,
  type SmsBatchRecipientPreviewBody,
  smsBatchCreateBodySchema,
  smsBatchRecipientPreviewBodySchema,
} from "./sms-batch-validation.js";

@Controller("sms-batches")
@UseGuards(RolesGuard)
export class SmsBatchController {
  constructor(private readonly batches: SmsBatchService) {}

  @Post()
  @RequireCapability("announcement:manage")
  create(
    @Body(zodBody(smsBatchCreateBodySchema)) body: SmsBatchCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SmsBatchQueueResult> {
    return this.batches.enqueue(getRequestContext(), body, idempotencyKey);
  }

  @Post("recipients/preview")
  @RequireCapability("announcement:manage")
  previewRecipients(
    @Body(zodBody(smsBatchRecipientPreviewBodySchema)) body: SmsBatchRecipientPreviewBody,
  ): Promise<SmsBatchRecipientPreviewResult> {
    return this.batches.previewRecipients(getRequestContext(), body);
  }

  @Get(":jobId")
  @RequireCapability("announcement:manage")
  findDeliveryReport(@Param("jobId") jobId: string): Promise<SmsBatchDeliveryReportRecord> {
    return this.batches.findDeliveryReport(getRequestContext(), jobId);
  }
}
