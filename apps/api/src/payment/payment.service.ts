import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  PaymentInstallmentRecord,
  PaymentInstallmentStatus,
  PaymentPlanWithInstallmentsRecord,
} from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { type PaymentPlanStore, paymentPlanStoreToken } from "./payment-store.js";

export interface PaymentInstallmentInput {
  installmentNo: number;
  amount: number;
  dueDate: string;
  status?: PaymentInstallmentStatus;
  paidAt?: string;
}

export interface PaymentPlanInput {
  studentId: string;
  title: string;
  totalAmount: number;
  currency?: string;
  installments: PaymentInstallmentInput[];
}

const installmentStatuses: PaymentInstallmentStatus[] = ["PENDING", "PAID", "OVERDUE", "CANCELED"];

@Injectable()
export class PaymentService {
  constructor(
    @Inject(paymentPlanStoreToken) private readonly store: PaymentPlanStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext, studentId?: string): Promise<PaymentPlanWithInstallmentsRecord[]> {
    this.assertTenantAdmin(context);
    if (studentId) {
      const student = await this.findStudentForTenant(context, studentId);
      return filterTenantResources(context, await this.store.listByStudent(student.id)).filter((record) => !record.deletedAt);
    }

    return filterTenantResources(context, await this.store.list()).filter((record) => !record.deletedAt);
  }

  async listCurrentGuardianStudent(
    context: RequestContext,
    studentId: string,
  ): Promise<PaymentPlanWithInstallmentsRecord[]> {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const student = await this.findStudentForTenant(context, studentId);
    const guardianLink = (await this.guardianStudentStore.listByStudent(student.id)).find((link) => link.guardianId === context.subjectId);
    if (!guardianLink) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
    if (!guardianLink.canViewFinance) {
      throw new ForbiddenException("FORBIDDEN_FINANCE_PERMISSION");
    }

    return filterTenantResources(context, await this.store.listByStudent(student.id)).filter((record) => !record.deletedAt);
  }

  async create(context: RequestContext, input: Partial<PaymentPlanInput>): Promise<PaymentPlanWithInstallmentsRecord> {
    this.assertTenantAdmin(context);
    const student = await this.findStudentForTenant(context, requiredText(input.studentId, "PAYMENT_PLAN_STUDENT_REQUIRED"));
    const installments = resolveInstallments(input.installments);
    const record = await this.store.create({
      plan: {
        tenantId: student.tenantId,
        studentId: student.id,
        title: requiredText(input.title, "PAYMENT_PLAN_TITLE_REQUIRED"),
        totalAmount: positiveInt(input.totalAmount, "PAYMENT_PLAN_TOTAL_AMOUNT_INVALID"),
        currency: optionalCurrency(input.currency),
      },
      installments,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "PaymentPlan",
      entityId: record.id,
      action: "payment_plan.created",
      diff: {
        studentId: record.studentId,
        currency: record.currency,
        installmentCount: record.installments.length,
        fieldsSet: ["title", "totalAmount", "installments"],
      },
    });
    return record;
  }

  private async findStudentForTenant(context: RequestContext, studentId: string) {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    this.assertTenantAccess(context, student);
    return student;
  }

  private assertTenantAdmin(context: RequestContext): void {
    if (!context.roles.includes("TENANT_ADMIN")) {
      throw new ForbiddenException("FORBIDDEN");
    }
  }

  private assertTenantAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
  }
}

function resolveInstallments(
  input: PaymentInstallmentInput[] | undefined,
): Array<Omit<PaymentInstallmentRecord, "id" | "tenantId" | "planId" | "createdAt">> {
  if (!input || input.length === 0) {
    throw new BadRequestException("PAYMENT_PLAN_INSTALLMENTS_REQUIRED");
  }

  const seen = new Set<number>();
  return input.map((installment) => {
    const installmentNo = positiveInt(installment.installmentNo, "PAYMENT_INSTALLMENT_NO_INVALID");
    if (seen.has(installmentNo)) {
      throw new BadRequestException("PAYMENT_INSTALLMENT_NO_DUPLICATE");
    }
    seen.add(installmentNo);
    return {
      installmentNo,
      amount: positiveInt(installment.amount, "PAYMENT_INSTALLMENT_AMOUNT_INVALID"),
      dueDate: requiredDate(installment.dueDate),
      status: resolveStatus(installment.status),
      paidAt: optionalDateTime(installment.paidAt),
    };
  });
}

function requiredText(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function positiveInt(value: number | undefined, errorCode: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(errorCode);
  }
  return value;
}

function optionalCurrency(value: string | undefined): string {
  const currency = value?.trim() || "TRY";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestException("PAYMENT_PLAN_CURRENCY_INVALID");
  }
  return currency;
}

function requiredDate(value: string | undefined): string {
  const trimmed = requiredText(value, "PAYMENT_INSTALLMENT_DUE_DATE_REQUIRED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestException("PAYMENT_INSTALLMENT_DUE_DATE_INVALID");
  }
  return trimmed;
}

function optionalDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("PAYMENT_INSTALLMENT_PAID_AT_INVALID");
  }
  return parsed.toISOString();
}

function resolveStatus(value: PaymentInstallmentStatus | undefined): PaymentInstallmentStatus {
  if (!value) return "PENDING";
  if (!installmentStatuses.includes(value)) {
    throw new BadRequestException("PAYMENT_INSTALLMENT_STATUS_INVALID");
  }
  return value;
}
