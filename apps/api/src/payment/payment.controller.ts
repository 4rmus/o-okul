import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  PaymentInstallmentUpdateRequest,
  PaymentPlanCreateRequest,
  PaymentPlanWithInstallmentsRecord,
} from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredDateString, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { CapabilityGuard } from "../rbac/capability.guard.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { PaymentService } from "./payment.service.js";

const paymentInstallmentStatusSchema = z.enum(["PENDING", "PAID", "OVERDUE", "CANCELED"]);
const paymentDateString = requiredDateString("PAYMENT_DATE_INVALID");
const paymentInstallmentBodySchema = z.object({
  amount: z.number().int().positive(),
  dueDate: paymentDateString,
  installmentNo: z.number().int().positive(),
  paidAt: optionalTrimmedString,
  status: paymentInstallmentStatusSchema.optional(),
}).strict();
const paymentPlanBodySchema = z.object({
  campusId: optionalTrimmedString,
  classId: optionalTrimmedString,
  courseId: optionalTrimmedString,
  currency: optionalTrimmedString,
  gradeLevelId: optionalTrimmedString,
  installments: z.array(paymentInstallmentBodySchema).min(1),
  studentId: requiredTrimmedString,
  termId: optionalTrimmedString,
  title: requiredTrimmedString,
  totalAmount: z.number().int().positive(),
}).strict();
const paymentInstallmentUpdateBodySchema = z.object({
  amount: z.number().int().positive().optional(),
  dueDate: paymentDateString.optional(),
  paidAt: optionalTrimmedString,
  status: paymentInstallmentStatusSchema.optional(),
}).strict();

@Controller("payment-plans")
@UseGuards(RolesGuard, CapabilityGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  @RequireCapability("finance:manage")
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
  @RequireCapability("finance:manage")
  create(
    @Body(zodBody(paymentPlanBodySchema)) body: PaymentPlanCreateRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.payments.create(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":planId/installments/:installmentId")
  @RequireCapability("finance:manage")
  updateInstallment(
    @Param("planId") planId: string,
    @Param("installmentId") installmentId: string,
    @Body(zodBody(paymentInstallmentUpdateBodySchema)) body: PaymentInstallmentUpdateRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.payments.updateInstallment(getRequestContext(), planId, installmentId, body, idempotencyKey);
  }
}
