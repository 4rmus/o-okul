import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  PaymentInstallmentRecord,
  PaymentInstallmentStatus,
  PaymentPlanWithInstallmentsRecord,
} from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { type CampusStore, campusStoreToken } from "../school/campus-store.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type CourseStore, courseStoreToken } from "../school/course-store.js";
import { type GradeLevelStore, gradeLevelStoreToken } from "../school/grade-level-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { type PaymentPlanListFilters as StorePaymentPlanListFilters, type PaymentPlanStore, paymentPlanStoreToken } from "./payment-store.js";

export interface PaymentInstallmentInput {
  installmentNo: number;
  amount: number;
  dueDate: string;
  status?: PaymentInstallmentStatus;
  paidAt?: string;
}

export interface PaymentPlanInput {
  studentId: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  title: string;
  totalAmount: number;
  currency?: string;
  installments: PaymentInstallmentInput[];
}

export interface PaymentPlanListFilters extends StorePaymentPlanListFilters {
  studentId?: string;
}

export interface PaymentInstallmentUpdateInput {
  amount?: number;
  dueDate?: string;
  status?: PaymentInstallmentStatus;
  paidAt?: string;
}

type PaymentPlanContextFields = Required<Pick<StorePaymentPlanListFilters, "campusId" | "gradeLevelId" | "classId" | "courseId" | "termId">>;

const installmentStatuses: PaymentInstallmentStatus[] = ["PENDING", "PAID", "OVERDUE", "CANCELED"];

@Injectable()
export class PaymentService {
  constructor(
    @Inject(paymentPlanStoreToken) private readonly store: PaymentPlanStore,
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(campusStoreToken) private readonly campusStore: CampusStore,
    @Inject(classStoreToken) private readonly classStore: ClassStore,
    @Inject(courseStoreToken) private readonly courseStore: CourseStore,
    @Inject(gradeLevelStoreToken) private readonly gradeLevelStore: GradeLevelStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    private readonly idempotency: IdempotencyService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext, filters: PaymentPlanListFilters = {}): Promise<PaymentPlanWithInstallmentsRecord[]> {
    this.assertTenantAdmin(context);
    const resolvedFilters = resolvePaymentPlanFilters(filters);
    if (resolvedFilters.studentId) {
      const student = await this.findStudentForTenant(context, resolvedFilters.studentId);
      return filterTenantResources(context, await this.store.listByStudent(student.id, resolvedFilters)).filter((record) => !record.deletedAt);
    }

    return filterTenantResources(context, await this.store.list(resolvedFilters)).filter((record) => !record.deletedAt);
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

  async create(
    context: RequestContext,
    input: Partial<PaymentPlanInput>,
    idempotencyKey?: string,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.idempotency.run(
      context,
      { key: idempotencyKey, operation: "payment.plan.create", request: input },
      () => this.createPaymentPlan(context, input),
    );
  }

  private async createPaymentPlan(context: RequestContext, input: Partial<PaymentPlanInput>): Promise<PaymentPlanWithInstallmentsRecord> {
    this.assertTenantAdmin(context);
    const student = await this.findStudentForTenant(context, requiredText(input.studentId, "PAYMENT_PLAN_STUDENT_REQUIRED"));
    const paymentContext = await this.resolvePaymentContext(student.tenantId, student, input);
    const installments = resolveInstallments(input.installments);
    const record = await this.store.create({
      plan: {
        tenantId: student.tenantId,
        studentId: student.id,
        ...paymentContext,
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
        campusId: record.campusId,
        gradeLevelId: record.gradeLevelId,
        classId: record.classId,
        courseId: record.courseId,
        termId: record.termId,
        currency: record.currency,
        installmentCount: record.installments.length,
        fieldsSet: ["title", "totalAmount", "installments", ...presentPaymentContextFields(record)],
      },
    });
    return record;
  }

  async updateInstallment(
    context: RequestContext,
    planId: string,
    installmentId: string,
    input: Partial<PaymentInstallmentUpdateInput>,
    idempotencyKey?: string,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.idempotency.run(
      context,
      { key: idempotencyKey, operation: "payment.installment.update", request: { planId, installmentId, input } },
      () => this.updatePaymentInstallment(context, planId, installmentId, input),
    );
  }

  private async updatePaymentInstallment(
    context: RequestContext,
    planId: string,
    installmentId: string,
    input: Partial<PaymentInstallmentUpdateInput>,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    this.assertTenantAdmin(context);
    const existingPlan = await this.findPlanForTenant(context, planId);
    const existingInstallment = existingPlan.installments.find((installment) => installment.id === installmentId);
    if (!existingInstallment) {
      throw new NotFoundException("PAYMENT_INSTALLMENT_NOT_FOUND");
    }

    const amount = input.amount === undefined
      ? existingInstallment.amount
      : positiveInt(input.amount, "PAYMENT_INSTALLMENT_AMOUNT_INVALID");
    const dueDate = input.dueDate === undefined ? existingInstallment.dueDate : requiredDate(input.dueDate);
    const status = input.status === undefined ? existingInstallment.status : resolveStatus(input.status);
    const paidAt = resolveUpdatedPaidAt(status, input.paidAt, existingInstallment.paidAt);
    const record = await this.store.updateInstallment(existingPlan.id, existingInstallment.id, {
      amount,
      dueDate,
      status,
      paidAt,
    });
    if (!record) {
      throw new NotFoundException("PAYMENT_INSTALLMENT_NOT_FOUND");
    }

    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "PaymentInstallment",
      entityId: existingInstallment.id,
      action: "payment_installment.updated",
      diff: {
        planId: record.id,
        installmentNo: existingInstallment.installmentNo,
        amountChanged: existingInstallment.amount !== amount,
        dueDateChanged: existingInstallment.dueDate !== dueDate,
        fromStatus: existingInstallment.status,
        toStatus: status,
        paidAtSet: Boolean(paidAt),
      },
    });

    return record;
  }

  private async resolvePaymentContext(
    tenantId: string,
    student: { classId?: string },
    input: Partial<PaymentPlanInput>,
  ): Promise<Partial<PaymentPlanContextFields>> {
    const explicitClassId = optionalText(input.classId);
    const contextFields: Partial<PaymentPlanContextFields> = {
      campusId: optionalText(input.campusId),
      classId: explicitClassId ?? optionalText(student.classId),
      courseId: optionalText(input.courseId),
      gradeLevelId: optionalText(input.gradeLevelId),
      termId: optionalText(input.termId),
    };

    let classRecord: { tenantId: string; campusId?: string; gradeLevelId?: string; deletedAt?: string } | undefined;
    if (contextFields.classId) {
      const candidate = await this.classStore.findById(contextFields.classId);
      if (explicitClassId) {
        await this.assertTenantLookup(candidate, tenantId, "PAYMENT_PLAN_CLASS_NOT_FOUND");
      }
      if (candidate && candidate.tenantId === tenantId && !candidate.deletedAt) {
        classRecord = candidate;
      } else if (!explicitClassId) {
        contextFields.classId = undefined;
      }
    }

    if (classRecord?.campusId) {
      if (contextFields.campusId && contextFields.campusId !== classRecord.campusId) {
        throw new BadRequestException("PAYMENT_PLAN_CLASS_CAMPUS_MISMATCH");
      }
      contextFields.campusId ??= classRecord.campusId;
    }
    if (classRecord?.gradeLevelId) {
      if (contextFields.gradeLevelId && contextFields.gradeLevelId !== classRecord.gradeLevelId) {
        throw new BadRequestException("PAYMENT_PLAN_CLASS_GRADE_LEVEL_MISMATCH");
      }
      contextFields.gradeLevelId ??= classRecord.gradeLevelId;
    }

    if (contextFields.campusId) {
      await this.assertTenantLookup(await this.campusStore.findById(contextFields.campusId), tenantId, "PAYMENT_PLAN_CAMPUS_NOT_FOUND");
    }
    if (contextFields.gradeLevelId) {
      await this.assertTenantLookup(await this.gradeLevelStore.findById(contextFields.gradeLevelId), tenantId, "PAYMENT_PLAN_GRADE_LEVEL_NOT_FOUND");
    }
    if (contextFields.courseId) {
      await this.assertTenantLookup(await this.courseStore.findById(contextFields.courseId), tenantId, "PAYMENT_PLAN_COURSE_NOT_FOUND");
    }
    if (contextFields.termId) {
      await this.assertTenantLookup(await this.academicCalendarStore.findTermById(contextFields.termId), tenantId, "PAYMENT_PLAN_TERM_NOT_FOUND");
    }

    return contextFields;
  }

  private async assertTenantLookup(
    record: { tenantId: string; deletedAt?: string } | undefined,
    tenantId: string,
    errorCode: string,
  ): Promise<void> {
    if (!record || record.tenantId !== tenantId || record.deletedAt) {
      throw new BadRequestException(errorCode);
    }
  }

  private async findStudentForTenant(context: RequestContext, studentId: string) {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    this.assertTenantAccess(context, student);
    return student;
  }

  private async findPlanForTenant(context: RequestContext, planId: string) {
    const plan = await this.store.findById(requiredText(planId, "PAYMENT_PLAN_ID_REQUIRED"));
    if (!plan) {
      throw new NotFoundException("PAYMENT_PLAN_NOT_FOUND");
    }

    this.assertTenantAccess(context, plan);
    return plan;
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

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolvePaymentPlanFilters(filters: PaymentPlanListFilters): PaymentPlanListFilters {
  return {
    campusId: optionalText(filters.campusId),
    classId: optionalText(filters.classId),
    courseId: optionalText(filters.courseId),
    gradeLevelId: optionalText(filters.gradeLevelId),
    studentId: optionalText(filters.studentId),
    termId: optionalText(filters.termId),
  };
}

function presentPaymentContextFields(record: Partial<PaymentPlanContextFields>): string[] {
  return ["campusId", "gradeLevelId", "classId", "courseId", "termId"].filter((field) => Boolean(record[field as keyof PaymentPlanContextFields]));
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
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
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

function resolveUpdatedPaidAt(
  status: PaymentInstallmentStatus,
  inputPaidAt: string | undefined,
  existingPaidAt: string | undefined,
): string | undefined {
  if (status !== "PAID") return undefined;
  return optionalDateTime(inputPaidAt) ?? existingPaidAt ?? new Date().toISOString();
}
