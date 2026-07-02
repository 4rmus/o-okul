import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  PaymentInstallmentUpdateRequest,
  PaymentPlanCreateRequest,
  PaymentPlanWithInstallmentsRecord,
  PaymentTransactionCreateRequest,
  PaymentTransactionRecord,
  PaymentTransactionVoidRequest,
} from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredDateString, requiredIsoDateTime, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { CapabilityGuard } from "../rbac/capability.guard.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { PaymentService } from "./payment.service.js";

const paymentInstallmentStatusSchema = z.enum(["PENDING", "PAID", "OVERDUE", "CANCELED"]);
const paymentTransactionMethodSchema = z.enum(["CASH", "BANK_TRANSFER", "CARD_POS", "OTHER"]);
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
const paymentTransactionBodySchema = z.object({
  amount: z.number().int().positive(),
  currency: optionalTrimmedString,
  installmentId: optionalTrimmedString,
  method: paymentTransactionMethodSchema,
  note: optionalTrimmedString,
  paidAt: requiredIsoDateTime("PAYMENT_TRANSACTION_PAID_AT_INVALID"),
}).strict();
const paymentTransactionVoidBodySchema = z.object({
  note: optionalTrimmedString,
}).strict();

interface PaymentPlanListQuery extends ListQuery {
  campusId?: string;
  classId?: string;
  courseId?: string;
  gradeLevelId?: string;
  studentId?: string;
  termId?: string;
}

@Controller("payment-plans")
@UseGuards(RolesGuard, CapabilityGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  @RequireCapability("finance:manage")
  list(
    @Query() query: PaymentPlanListQuery,
  ): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return this.payments
      .list(getRequestContext(), query)
      .then((records) => applyListQuery(records, query, paymentPlanListFields));
  }

  @Post()
  @RequireCapability("finance:manage")
  create(
    @Body(zodBody(paymentPlanBodySchema)) body: PaymentPlanCreateRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.payments.create(getRequestContext(), body, idempotencyKey);
  }

  @Delete(":planId")
  @RequireCapability("finance:manage")
  cancelPlan(
    @Param("planId") planId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.payments.cancelPlan(getRequestContext(), planId, idempotencyKey);
  }

  @Get(":planId/transactions")
  @RequireCapability("finance:manage")
  listTransactions(@Param("planId") planId: string): Promise<PaymentTransactionRecord[]> {
    return this.payments.listTransactions(getRequestContext(), planId);
  }

  @Post(":planId/transactions")
  @RequireCapability("finance:manage")
  createTransaction(
    @Param("planId") planId: string,
    @Body(zodBody(paymentTransactionBodySchema)) body: PaymentTransactionCreateRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PaymentTransactionRecord> {
    return this.payments.createTransaction(getRequestContext(), planId, body, idempotencyKey);
  }

  @Post(":planId/transactions/:transactionId/void")
  @RequireCapability("finance:manage")
  voidTransaction(
    @Param("planId") planId: string,
    @Param("transactionId") transactionId: string,
    @Body(zodBody(paymentTransactionVoidBodySchema)) body: PaymentTransactionVoidRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PaymentTransactionRecord> {
    return this.payments.voidTransaction(getRequestContext(), planId, transactionId, body, idempotencyKey);
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

const paymentPlanListFields = [
  { name: "title", read: (record: PaymentPlanWithInstallmentsRecord) => record.title },
  { name: "studentId", read: (record: PaymentPlanWithInstallmentsRecord) => record.studentId },
  { name: "campusId", read: (record: PaymentPlanWithInstallmentsRecord) => record.campusId },
  { name: "gradeLevelId", read: (record: PaymentPlanWithInstallmentsRecord) => record.gradeLevelId },
  { name: "classId", read: (record: PaymentPlanWithInstallmentsRecord) => record.classId },
  { name: "courseId", read: (record: PaymentPlanWithInstallmentsRecord) => record.courseId },
  { name: "termId", read: (record: PaymentPlanWithInstallmentsRecord) => record.termId },
  { name: "totalAmount", read: (record: PaymentPlanWithInstallmentsRecord) => record.totalAmount },
  { name: "currency", read: (record: PaymentPlanWithInstallmentsRecord) => record.currency },
  { name: "createdAt", read: (record: PaymentPlanWithInstallmentsRecord) => record.createdAt },
];
