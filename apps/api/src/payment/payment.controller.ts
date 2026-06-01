import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import type { PaymentPlanWithInstallmentsRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { PaymentService, type PaymentPlanInput } from "./payment.service.js";

@Controller("payment-plans")
@UseGuards(RolesGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  @Roles("TENANT_ADMIN")
  list(@Query("studentId") studentId?: string): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return this.payments.list(getRequestContext(), studentId);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<PaymentPlanInput>): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.payments.create(getRequestContext(), body);
  }
}
