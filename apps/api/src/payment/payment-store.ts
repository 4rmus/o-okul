import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type {
  PaymentInstallmentRecord,
  PaymentInstallmentStatus,
  PaymentPlanRecord,
  PaymentPlanWithInstallmentsRecord,
} from "@o-okul/shared-types";

export interface CreatePaymentPlanStoreInput {
  plan: Omit<PaymentPlanRecord, "id" | "createdAt">;
  installments: Array<Omit<PaymentInstallmentRecord, "id" | "tenantId" | "planId" | "createdAt">>;
}

export interface PaymentPlanListFilters {
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
}

export interface PaymentPlanStore {
  list(filters?: PaymentPlanListFilters): Promise<PaymentPlanWithInstallmentsRecord[]>;
  listByStudent(studentId: string, filters?: PaymentPlanListFilters): Promise<PaymentPlanWithInstallmentsRecord[]>;
  findById(id: string): Promise<PaymentPlanWithInstallmentsRecord | undefined>;
  create(input: CreatePaymentPlanStoreInput): Promise<PaymentPlanWithInstallmentsRecord>;
  updateInstallment(
    planId: string,
    installmentId: string,
    input: Pick<PaymentInstallmentRecord, "amount" | "dueDate" | "status"> & Pick<Partial<PaymentInstallmentRecord>, "paidAt">,
  ): Promise<PaymentPlanWithInstallmentsRecord | undefined>;
}

export const paymentPlanStoreToken = Symbol("PaymentPlanStore");

const demoPaymentPlans: PaymentPlanRecord[] = [
  {
    id: "payment-plan-a",
    tenantId: "tenant-a",
    studentId: "student-a",
    title: "2026 Haziran ödeme planı",
    totalAmount: 100000,
    currency: "TRY",
    createdAt: "2026-06-05T09:00:00.000Z",
  },
  {
    id: "payment-plan-b",
    tenantId: "tenant-b",
    studentId: "student-b",
    title: "Tenant B ödeme planı",
    totalAmount: 100000,
    currency: "TRY",
    createdAt: "2026-06-05T09:00:00.000Z",
  },
];

const demoPaymentInstallments: PaymentInstallmentRecord[] = [
  {
    id: "payment-installment-a-1",
    tenantId: "tenant-a",
    planId: "payment-plan-a",
    installmentNo: 1,
    amount: 50000,
    dueDate: "2026-07-01",
    status: "PENDING",
    createdAt: "2026-06-05T09:00:00.000Z",
  },
  {
    id: "payment-installment-a-2",
    tenantId: "tenant-a",
    planId: "payment-plan-a",
    installmentNo: 2,
    amount: 50000,
    dueDate: "2026-08-01",
    status: "PENDING",
    createdAt: "2026-06-05T09:00:00.000Z",
  },
  {
    id: "payment-installment-b-1",
    tenantId: "tenant-b",
    planId: "payment-plan-b",
    installmentNo: 1,
    amount: 100000,
    dueDate: "2026-07-01",
    status: "PENDING",
    createdAt: "2026-06-05T09:00:00.000Z",
  },
];

export class InMemoryPaymentPlanStore implements PaymentPlanStore {
  private readonly plans = demoPaymentPlans.map((record) => ({ ...record }));
  private readonly installments = demoPaymentInstallments.map((record) => ({ ...record }));

  async list(filters: PaymentPlanListFilters = {}): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return this.withInstallments(filterPaymentPlans(this.plans.filter((record) => !record.deletedAt), filters));
  }

  async listByStudent(studentId: string, filters: PaymentPlanListFilters = {}): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return this.withInstallments(filterPaymentPlans(this.plans.filter((record) => record.studentId === studentId && !record.deletedAt), filters));
  }

  async findById(id: string): Promise<PaymentPlanWithInstallmentsRecord | undefined> {
    const plan = this.plans.find((record) => record.id === id && !record.deletedAt);
    return plan ? this.withInstallments([plan]).then((records) => records[0]) : undefined;
  }

  async create(input: CreatePaymentPlanStoreInput): Promise<PaymentPlanWithInstallmentsRecord> {
    const plan = {
      id: `payment-plan-${this.plans.length + 1}`,
      createdAt: new Date().toISOString(),
      ...input.plan,
    };
    const installments = input.installments.map((installment, index) => ({
      id: `payment-installment-${this.installments.length + index + 1}`,
      tenantId: plan.tenantId,
      planId: plan.id,
      createdAt: plan.createdAt,
      ...installment,
    }));
    this.plans.push(plan);
    this.installments.push(...installments);
    return { ...plan, installments };
  }

  async updateInstallment(
    planId: string,
    installmentId: string,
    input: Pick<PaymentInstallmentRecord, "amount" | "dueDate" | "status"> & Pick<Partial<PaymentInstallmentRecord>, "paidAt">,
  ): Promise<PaymentPlanWithInstallmentsRecord | undefined> {
    const plan = this.plans.find((record) => record.id === planId && !record.deletedAt);
    if (!plan) return undefined;

    const installment = this.installments.find((record) => record.id === installmentId && record.planId === planId && !record.deletedAt);
    if (!installment) return undefined;

    installment.amount = input.amount;
    installment.dueDate = input.dueDate;
    installment.status = input.status;
    installment.paidAt = input.paidAt;
    return this.withInstallments([plan]).then((records) => records[0]);
  }

  private async withInstallments(plans: PaymentPlanRecord[]): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return plans.map((plan) => ({
      ...plan,
      installments: this.installments
        .filter((installment) => installment.planId === plan.id && !installment.deletedAt)
        .sort((a, b) => a.installmentNo - b.installmentNo),
    }));
  }
}

export class PostgresPaymentPlanStore implements PaymentPlanStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(filters: PaymentPlanListFilters = {}): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const plans = await selectPlans(client, filters);
      return withInstallments(client, plans);
    });
  }

  async listByStudent(studentId: string, filters: PaymentPlanListFilters = {}): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const plans = await selectPlans(client, { ...filters, studentId });
      return withInstallments(client, plans);
    });
  }

  async findById(id: string): Promise<PaymentPlanWithInstallmentsRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const plans = await selectPlans(client, { id });
      const records = await withInstallments(client, plans);
      return records[0];
    });
  }

  async create(input: CreatePaymentPlanStoreInput): Promise<PaymentPlanWithInstallmentsRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const planId = randomUUID();
      const planResult = await client.query<PaymentPlanRow>(
        `INSERT INTO "PaymentPlan" (
           "id",
           "tenantId",
           "studentId",
           "campusId",
           "gradeLevelId",
           "classId",
           "courseId",
           "termId",
           "title",
           "totalAmount",
           "currency",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING *`,
        [
          planId,
          input.plan.tenantId,
          input.plan.studentId,
          input.plan.campusId ?? null,
          input.plan.gradeLevelId ?? null,
          input.plan.classId ?? null,
          input.plan.courseId ?? null,
          input.plan.termId ?? null,
          input.plan.title,
          input.plan.totalAmount,
          input.plan.currency,
        ],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        throw new Error("PAYMENT_PLAN_CREATE_FAILED");
      }

      if (input.installments.length > 0) {
        const values: unknown[] = [];
        const placeholders = input.installments.map((installment, index) => {
          values.push(
            randomUUID(),
            input.plan.tenantId,
            planId,
            installment.installmentNo,
            installment.amount,
            installment.dueDate,
            installment.status,
            installment.paidAt ?? null,
          );
          const offset = index * 8;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::date, $${offset + 7}, $${offset + 8}, now())`;
        });
        await client.query(
          `INSERT INTO "PaymentInstallment"
             ("id", "tenantId", "planId", "installmentNo", "amount", "dueDate", "status", "paidAt", "updatedAt")
           VALUES ${placeholders.join(", ")}`,
          values,
        );
      }

      const records = await withInstallments(client, [toPaymentPlanRecord(plan)]);
      const record = records[0];
      if (!record) {
        throw new Error("PAYMENT_PLAN_CREATE_FAILED");
      }
      return record;
    });
  }

  async updateInstallment(
    planId: string,
    installmentId: string,
    input: Pick<PaymentInstallmentRecord, "amount" | "dueDate" | "status"> & Pick<Partial<PaymentInstallmentRecord>, "paidAt">,
  ): Promise<PaymentPlanWithInstallmentsRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const updated = await client.query<{ planId: string }>(
        `UPDATE "PaymentInstallment"
         SET "amount" = $3,
             "dueDate" = $4::date,
             "status" = $5,
             "paidAt" = $6,
             "updatedAt" = now()
         WHERE "planId" = $1
           AND "id" = $2
           AND "deletedAt" IS NULL
         RETURNING "planId"`,
        [planId, installmentId, input.amount, input.dueDate, input.status, input.paidAt ?? null],
      );
      if (!updated.rows[0]) return undefined;

      const plans = await selectPlans(client, { id: planId });
      const records = await withInstallments(client, plans);
      return records[0];
    });
  }
}

export function createPaymentPlanStore(): PaymentPlanStore {
  return resolvePersistenceDriver(process.env.PAYMENT_PLAN_STORE) === "postgres" ? new PostgresPaymentPlanStore() : new InMemoryPaymentPlanStore();
}

interface PaymentPlanRow {
  id: string;
  tenantId: string;
  studentId: string;
  campusId: string | null;
  gradeLevelId: string | null;
  classId: string | null;
  courseId: string | null;
  termId: string | null;
  title: string;
  totalAmount: number;
  currency: string;
  createdAt: Date;
  deletedAt: Date | null;
}

interface PaymentInstallmentRow {
  id: string;
  tenantId: string;
  planId: string;
  installmentNo: number;
  amount: number;
  dueDate: string | Date;
  status: PaymentInstallmentStatus;
  paidAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

interface PaymentPlanQueryFilters extends PaymentPlanListFilters {
  id?: string;
  studentId?: string;
}

async function selectPlans(client: Queryable, filtersInput: PaymentPlanQueryFilters = {}): Promise<PaymentPlanRecord[]> {
  const filters = [`"deletedAt" IS NULL`];
  const values: string[] = [];

  if (filtersInput.studentId) {
    values.push(filtersInput.studentId);
    filters.push(`"studentId" = $${values.length}`);
  }
  if (filtersInput.id) {
    values.push(filtersInput.id);
    filters.push(`"id" = $${values.length}`);
  }
  for (const field of ["campusId", "gradeLevelId", "classId", "courseId", "termId"] as const) {
    const value = filtersInput[field];
    if (value) {
      values.push(value);
      filters.push(`"${field}" = $${values.length}`);
    }
  }

  const result = await client.query<PaymentPlanRow>(
    `SELECT *
     FROM "PaymentPlan"
     WHERE ${filters.join(" AND ")}
     ORDER BY "createdAt" DESC, "id" ASC`,
    values,
  );
  return result.rows.map(toPaymentPlanRecord);
}

async function withInstallments(
  client: Queryable,
  plans: PaymentPlanRecord[],
): Promise<PaymentPlanWithInstallmentsRecord[]> {
  if (plans.length === 0) return [];

  const result = await client.query<PaymentInstallmentRow>(
    `SELECT *
     FROM "PaymentInstallment"
     WHERE "planId" = ANY($1::text[])
       AND "deletedAt" IS NULL
     ORDER BY "installmentNo" ASC, "id" ASC`,
    [plans.map((plan) => plan.id)],
  );
  const byPlan = new Map<string, PaymentInstallmentRecord[]>();
  for (const installment of result.rows.map(toPaymentInstallmentRecord)) {
    const existing = byPlan.get(installment.planId) ?? [];
    existing.push(installment);
    byPlan.set(installment.planId, existing);
  }

  return plans.map((plan) => ({
    ...plan,
    installments: byPlan.get(plan.id) ?? [],
  }));
}

function toPaymentPlanRecord(row: PaymentPlanRow): PaymentPlanRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    campusId: row.campusId ?? undefined,
    gradeLevelId: row.gradeLevelId ?? undefined,
    classId: row.classId ?? undefined,
    courseId: row.courseId ?? undefined,
    termId: row.termId ?? undefined,
    title: row.title,
    totalAmount: row.totalAmount,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString(),
  };
}

function filterPaymentPlans(plans: PaymentPlanRecord[], filters: PaymentPlanListFilters): PaymentPlanRecord[] {
  return plans
    .filter((plan) => !filters.campusId || plan.campusId === filters.campusId)
    .filter((plan) => !filters.gradeLevelId || plan.gradeLevelId === filters.gradeLevelId)
    .filter((plan) => !filters.classId || plan.classId === filters.classId)
    .filter((plan) => !filters.courseId || plan.courseId === filters.courseId)
    .filter((plan) => !filters.termId || plan.termId === filters.termId);
}

function toPaymentInstallmentRecord(row: PaymentInstallmentRow): PaymentInstallmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planId: row.planId,
    installmentNo: row.installmentNo,
    amount: row.amount,
    dueDate: formatDate(row.dueDate),
    status: row.status,
    paidAt: row.paidAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString(),
  };
}

function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}
