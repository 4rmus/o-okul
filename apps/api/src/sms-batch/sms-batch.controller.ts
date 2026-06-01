import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SmsBatchService, type CreateSmsBatchInput, type SmsBatchQueueResult } from "./sms-batch.service.js";

@Controller("sms-batches")
@UseGuards(RolesGuard)
export class SmsBatchController {
  constructor(private readonly batches: SmsBatchService) {}

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: CreateSmsBatchInput): Promise<SmsBatchQueueResult> {
    return this.batches.enqueue(getRequestContext(), body);
  }
}
