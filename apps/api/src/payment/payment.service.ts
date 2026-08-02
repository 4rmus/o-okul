import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  PaymentInstallmentRecord,
  PaymentInstallmentStatus,
  PaymentInstallmentUpdateRequest,
  PaymentPlanCreateRequest,
  PaymentPlanInstallmentInput,
  PaymentPlanWithInstallmentsRecord,
  PaymentTransactionCreateRequest,
  PaymentTransactionMethod,
  PaymentTransactionRecord,
  PaymentTransactionVoidRequest,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { requiredText } from "../shared/required-text.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { type CampusStore, campusStoreToken } from "../school/campus-store.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type CourseStore, courseStoreToken } from "../school/course-store.js";
import { type GradeLevelStore, gradeLevelStoreToken } from "../school/grade-level-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { type PaymentPlanListFilters as StorePaymentPlanListFilters, type PaymentPlanStore, paymentPlanStoreToken } from "./payment-store.js";

export interface PaymentPlanListFilters extends StorePaymentPlanListFilters {
  studentId?: string;
}

type PaymentPlanContextFields = Required<Pick<StorePaymentPlanListFilters, "campusId" | "gradeLevelId" | "classId" | "courseId" | "termId">>;

const installmentStatuses: PaymentInstallmentStatus[] = ["PENDING", "PAID", "OVERDUE", "CANCELED"];
const transactionMethods: PaymentTransactionMethod[] = ["CASH", "BANK_TRANSFER", "CARD_POS", "OTHER"];

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
    this.assertFinanceManage(context);
    const resolvedFilters = resolvePaymentPlanFilters(filters);
    const campusScopeFilters = this.financeCampusScopeFilters(context);
    if (resolvedFilters.studentId) {
      const student = await this.findStudentForTenant(context, resolvedFilters.studentId);
      return filterTenantResources(context, await this.store.listByStudent(student.id, { ...resolvedFilters, ...campusScopeFilters }))
        .filter((record) => !record.deletedAt);
    }

    return filterTenantResources(context, await this.store.list({ ...resolvedFilters, ...campusScopeFilters }))
      .filter((record) => !record.deletedAt);
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

    const plans = filterTenantResources(context, await this.store.listByStudent(student.id)).filter((record) => !record.deletedAt);
    return Promise.all(plans.map(async (plan) => ({
      ...plan,
      transactions: (await this.store.listTransactions(plan.id)).map(toPublicPaymentTransaction),
    })));
  }

  async create(
    context: RequestContext,
    input: Partial<PaymentPlanCreateRequest>,
    idempotencyKey?: string,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.idempotency.run(
      context,
      { key: idempotencyKey, operation: "payment.plan.create", request: input },
      () => this.createPaymentPlan(context, input),
    );
  }

  private async createPaymentPlan(context: RequestContext, input: Partial<PaymentPlanCreateRequest>): Promise<PaymentPlanWithInstallmentsRecord> {
    this.assertFinanceManage(context);
    const student = await this.findStudentForTenant(context, requiredText(input.studentId, "PAYMENT_PLAN_STUDENT_REQUIRED"));
    const paymentContext = await this.resolvePaymentContext(student.tenantId, student, input);
    this.assertPaymentCampusScope(context, paymentContext);
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
    input: PaymentInstallmentUpdateRequest,
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
    input: PaymentInstallmentUpdateRequest,
  ): Promise<PaymentPlanWithInstallmentsRecord> {
    this.assertFinanceManage(context);
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

  async listTransactions(context: RequestContext, planId: string): Promise<PaymentTransactionRecord[]> {
    this.assertFinanceManage(context);
    const plan = await this.findPlanForTenant(context, planId);
    return (await this.store.listTransactions(plan.id)).map(toPublicPaymentTransaction);
  }

  async createTransaction(
    context: RequestContext,
    planId: string,
    input: PaymentTransactionCreateRequest,
    idempotencyKey?: string,
  ): Promise<PaymentTransactionRecord> {
    return this.idempotency.run(
      context,
      { key: idempotencyKey, operation: "payment.transaction.create", request: { planId, input } },
      () => this.createPaymentTransaction(context, planId, input),
    );
  }

  private async createPaymentTransaction(
    context: RequestContext,
    planId: string,
    input: PaymentTransactionCreateRequest,
  ): Promise<PaymentTransactionRecord> {
    this.assertFinanceManage(context);
    const plan = await this.findPlanForTenant(context, planId);
    const installment = input.installmentId ? this.findPlanInstallment(plan, input.installmentId) : undefined;
    const record = await this.store.createTransaction({
      tenantId: plan.tenantId,
      planId: plan.id,
      installmentId: installment?.id,
      amount: positiveInt(input.amount, "PAYMENT_TRANSACTION_AMOUNT_INVALID"),
      currency: optionalCurrency(input.currency ?? plan.currency),
      method: resolveTransactionMethod(input.method),
      paidAt: requiredDateTime(input.paidAt, "PAYMENT_TRANSACTION_PAID_AT_INVALID"),
      note: optionalText(input.note),
      recordedByUserId: context.userId,
    });
    if (installment) {
      await this.syncInstallmentPaymentStatus(context, plan.id, installment.id);
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "PaymentTransaction",
      entityId: record.id,
      action: "payment_transaction.created",
      diff: {
        planId: record.planId,
        installmentId: record.installmentId,
        amount: record.amount,
        method: record.method,
        receiptNo: record.receiptNo,
      },
    });
    return toPublicPaymentTransaction(record);
  }

  async voidTransaction(
    context: RequestContext,
    planId: string,
    transactionId: string,
    input: PaymentTransactionVoidRequest,
    idempotencyKey?: string,
  ): Promise<PaymentTransactionRecord> {
    return this.idempotency.run(
      context,
      { key: idempotencyKey, operation: "payment.transaction.void", request: { planId, transactionId, input } },
      () => this.voidPaymentTransaction(context, planId, transactionId, input),
    );
  }

  private async voidPaymentTransaction(
    context: RequestContext,
    planId: string,
    transactionId: string,
    input: PaymentTransactionVoidRequest,
  ): Promise<PaymentTransactionRecord> {
    this.assertFinanceManage(context);
    const plan = await this.findPlanForTenant(context, planId);
    const existing = (await this.store.listTransactions(plan.id)).find((transaction) => transaction.id === transactionId);
    if (!existing) {
      throw new NotFoundException("PAYMENT_TRANSACTION_NOT_FOUND");
    }
    const record = await this.store.voidTransaction(plan.tenantId, plan.id, existing.id, new Date().toISOString(), optionalText(input.note));
    if (!record) {
      throw new NotFoundException("PAYMENT_TRANSACTION_NOT_FOUND");
    }
    if (record.installmentId) {
      await this.syncInstallmentPaymentStatus(context, plan.id, record.installmentId);
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "PaymentTransaction",
      entityId: record.id,
      action: "payment_transaction.voided",
      diff: { planId: record.planId, installmentId: record.installmentId, voidedAt: record.voidedAt },
    });
    return toPublicPaymentTransaction(record);
  }

  async cancelPlan(context: RequestContext, planId: string, idempotencyKey?: string): Promise<PaymentPlanWithInstallmentsRecord> {
    return this.idempotency.run(
      context,
      { key: idempotencyKey, operation: "payment.plan.cancel", request: { planId } },
      () => this.cancelPaymentPlan(context, planId),
    );
  }

  private async cancelPaymentPlan(context: RequestContext, planId: string): Promise<PaymentPlanWithInstallmentsRecord> {
    this.assertFinanceManage(context);
    const plan = await this.findPlanForTenant(context, planId);
    const transactions = await this.store.listTransactions(plan.id);
    if (transactions.some((transaction) => !transaction.voidedAt)) {
      throw new ConflictException("PAYMENT_PLAN_HAS_TRANSACTIONS");
    }
    const record = await this.store.cancelPlan(plan.id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("PAYMENT_PLAN_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "PaymentPlan",
      entityId: record.id,
      action: "payment_plan.canceled",
      diff: { studentId: record.studentId, installmentCount: record.installments.length },
    });
    return record;
  }

  private findPlanInstallment(
    plan: PaymentPlanWithInstallmentsRecord,
    installmentId: string,
  ): PaymentInstallmentRecord {
    const installment = plan.installments.find((candidate) => candidate.id === installmentId);
    if (!installment) {
      throw new NotFoundException("PAYMENT_INSTALLMENT_NOT_FOUND");
    }
    return installment;
  }

  private async syncInstallmentPaymentStatus(context: RequestContext, planId: string, installmentId: string): Promise<void> {
    const plan = await this.findPlanForTenant(context, planId);
    const installment = this.findPlanInstallment(plan, installmentId);
    if (installment.status === "CANCELED") return;

    const transactions = (await this.store.listTransactions(plan.id)).filter((transaction) =>
      transaction.installmentId === installment.id && !transaction.voidedAt
    );
    const paidAmount = transactions.reduce((total, transaction) => total + transaction.amount, 0);
    const nextStatus: PaymentInstallmentStatus = paidAmount >= installment.amount ? "PAID" : "PENDING";
    const nextPaidAt = nextStatus === "PAID"
      ? [...transactions].sort((left, right) => left.paidAt.localeCompare(right.paidAt)).at(-1)?.paidAt
      : undefined;
    if (installment.status === nextStatus && installment.paidAt === nextPaidAt) return;

    await this.store.updateInstallment(plan.id, installment.id, {
      amount: installment.amount,
      dueDate: installment.dueDate,
      status: nextStatus,
      paidAt: nextPaidAt,
    });
  }

  private async resolvePaymentContext(
    tenantId: string,
    student: { classId?: string },
    input: Partial<PaymentPlanCreateRequest>,
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
    const plan = await this.store.findById(
      requiredText(planId, "PAYMENT_PLAN_ID_REQUIRED"),
      this.financeCampusScopeFilters(context),
    );
    if (!plan) {
      throw new NotFoundException("PAYMENT_PLAN_NOT_FOUND");
    }

    this.assertTenantAccess(context, plan);
    return plan;
  }

  private assertFinanceManage(context: RequestContext): void {
    if (!hasCapability(context, "finance:manage")) {
      throw new ForbiddenException("FORBIDDEN");
    }
  }

  private financeCampusScopeFilters(context: RequestContext): Pick<StorePaymentPlanListFilters, "campusIds"> {
    if (!context.roles.includes("FINANCE_STAFF")) return {};
    if (!context.campusScope) throw new ForbiddenException("FINANCE_CAMPUS_SCOPE_MISSING");
    if (context.campusScope.scopeMode === "TENANT") return {};
    if (context.campusScope.scopeMode !== "CAMPUSES") throw new ForbiddenException("FINANCE_CAMPUS_SCOPE_INVALID");
    return { campusIds: [...new Set(context.campusScope.campusIds)] };
  }

  private assertPaymentCampusScope(
    context: RequestContext,
    paymentContext: { campusId?: string },
  ): void {
    const { campusIds } = this.financeCampusScopeFilters(context);
    if (campusIds && !campusIds.includes(paymentContext.campusId ?? "")) {
      throw new ForbiddenException("FINANCE_CAMPUS_SCOPE_FORBIDDEN");
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
  input: PaymentPlanInstallmentInput[] | undefined,
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

function requiredDateTime(value: string | undefined, errorCode: string): string {
  const parsed = new Date(requiredText(value, errorCode));
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(errorCode);
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

function resolveTransactionMethod(value: PaymentTransactionMethod): PaymentTransactionMethod {
  if (!transactionMethods.includes(value)) {
    throw new BadRequestException("PAYMENT_TRANSACTION_METHOD_INVALID");
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

function toPublicPaymentTransaction(record: PaymentTransactionRecord): PaymentTransactionRecord {
  const { recordedByUserId: _recordedByUserId, ...publicRecord } = record;
  return publicRecord;
}
