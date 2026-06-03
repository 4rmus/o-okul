import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { PaymentPlanWithInstallmentsRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { PaymentService, type PaymentInstallmentUpdateInput, type PaymentPlanInput } from "./payment.service.js";

@Controller("payment-plans")
@UseGuards(RolesGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  @Roles("TENANT_ADMIN")
  list(
    @Query("studentId") studentId?: string,
    @Query("campusId") campusId?: string,
    @Query("gradeLevelId") gradeLevelId?: string,
    @Query("classId") classId?: string,
    @Query("courseId") courseId?: string,
    @Query("termId") termId?: string,
  ): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return this.payments.list(getRequestContext(), { studentId, campusId, gradeLevelId, classId, courseId, termId });
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<PaymentPlanInput>): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.payments.create(getRequestContext(), body);
  }

  @Patch(":planId/installments/:installmentId")
  @Roles("TENANT_ADMIN")
  updateInstallment(
    @Param("planId") planId: string,
    @Param("installmentId") installmentId: string,
    @Body() body: Partial<PaymentInstallmentUpdateInput>,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.payments.updateInstallment(getRequestContext(), planId, installmentId, body);
  }
}
