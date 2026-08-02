import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryPaymentPlanStore, PostgresPaymentPlanStore } from "./payment-store.js";

describe("InMemoryPaymentPlanStore", () => {
  it("kampüs listesi filtresinde kapsam dışındaki planı döndürmez", async () => {
    const store = new InMemoryPaymentPlanStore();
    const inScope = await store.create({
      plan: { tenantId: "tenant-a", studentId: "student-a", campusId: "campus-main", title: "Kapsam içi", totalAmount: 1000, currency: "TRY" },
      installments: [],
    });
    await store.create({
      plan: { tenantId: "tenant-a", studentId: "student-a", campusId: "campus-secondary", title: "Kapsam dışı", totalAmount: 1000, currency: "TRY" },
      installments: [],
    });

    await expect(store.list({ campusIds: ["campus-main"] })).resolves.toEqual([
      expect.objectContaining({ id: inScope.id, campusId: "campus-main" }),
    ]);
  });
});

describe("PostgresPaymentPlanStore", () => {
  it("ödeme planı akademik bağlamını tenant-aware SQL ile yazar ve okur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('UPDATE "PaymentInstallment"')) {
          return {
            rows: [{ planId: "payment-plan-a" }] as T[],
          };
        }

        if (sql.includes('"PaymentInstallment"')) {
          return {
            rows: [
              {
                id: "payment-installment-a",
                tenantId: "tenant-a",
                planId: "payment-plan-a",
                installmentNo: 1,
                amount: 50000,
                dueDate: "2026-07-01",
                status: "PENDING",
                paidAt: null,
                createdAt: new Date("2026-06-05T09:00:00.000Z"),
                deletedAt: null,
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "payment-plan-a",
              tenantId: "tenant-a",
              studentId: "student-a",
              campusId: "campus-main",
              gradeLevelId: "grade-8",
              classId: "class-a",
              courseId: "course-math",
              termId: "term-2026-spring",
              title: "2026 Yaz kursu",
              totalAmount: 50000,
              currency: "TRY",
              createdAt: new Date("2026-06-05T09:00:00.000Z"),
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };
    const store = new PostgresPaymentPlanStore(pool);

    const result = await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list({ campusIds: ["campus-main"], courseId: "course-math", termId: "term-2026-spring" });
        const created = await store.create({
          plan: {
            tenantId: "tenant-a",
            studentId: "student-a",
            campusId: "campus-main",
            gradeLevelId: "grade-8",
            classId: "class-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            title: "2026 Yaz kursu",
            totalAmount: 50000,
            currency: "TRY",
          },
          installments: [{ installmentNo: 1, amount: 50000, dueDate: "2026-07-01", status: "PENDING" }],
        });
        await store.updateInstallment("payment-plan-a", "payment-installment-a", {
          amount: 55000,
          dueDate: "2026-07-05",
          status: "PAID",
          paidAt: "2026-07-02T09:30:00.000Z",
        });
        return created;
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('FROM "PaymentPlan"');
    expect(businessQueries[0]?.sql).toContain('"campusId" = ANY($1::text[])');
    expect(businessQueries[0]?.sql).toContain('"courseId" = $2');
    expect(businessQueries[0]?.sql).toContain('"termId" = $3');
    expect(businessQueries[0]?.values).toEqual([["campus-main"], "course-math", "term-2026-spring"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "PaymentPlan"');
    expect(businessQueries[2]?.values?.slice(1, 11)).toEqual([
      "tenant-a",
      "student-a",
      "campus-main",
      "grade-8",
      "class-a",
      "course-math",
      "term-2026-spring",
      "2026 Yaz kursu",
      50000,
      "TRY",
    ]);
    expect(businessQueries[5]?.sql).toContain('UPDATE "PaymentInstallment"');
    expect(businessQueries[5]?.values).toEqual([
      "payment-plan-a",
      "payment-installment-a",
      55000,
      "2026-07-05",
      "PAID",
      "2026-07-02T09:30:00.000Z",
    ]);
    expect(result).toMatchObject({
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    });
  });

  it("tahsilat ve plan iptali SQL yollarını tenant-aware çalıştırır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const transactionRow = {
      id: "payment-transaction-a",
      tenantId: "tenant-a",
      planId: "payment-plan-a",
      installmentId: "payment-installment-a",
      amount: 50000,
      currency: "TRY",
      method: "CASH",
      paidAt: new Date("2026-07-02T09:30:00.000Z"),
      receiptNo: "R-000001",
      note: "Elden tahsilat",
      recordedByUserId: "user-tenant-a",
      voidedAt: null,
      voidReason: null,
      createdAt: new Date("2026-07-02T09:31:00.000Z"),
    };
    const planRow = {
      id: "payment-plan-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      campusId: null,
      gradeLevelId: null,
      classId: null,
      courseId: null,
      termId: null,
      title: "2026 Yaz kursu",
      totalAmount: 50000,
      currency: "TRY",
      createdAt: new Date("2026-06-05T09:00:00.000Z"),
      deletedAt: new Date("2026-07-03T09:00:00.000Z"),
    };
    const installmentRow = {
      id: "payment-installment-a",
      tenantId: "tenant-a",
      planId: "payment-plan-a",
      installmentNo: 1,
      amount: 50000,
      dueDate: "2026-07-01",
      status: "CANCELED",
      paidAt: null,
      createdAt: new Date("2026-06-05T09:00:00.000Z"),
      deletedAt: null,
    };
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("count(*)::int + 1")) {
          return { rows: [{ next: 1 }] as T[] };
        }
        if (sql.includes('INSERT INTO "PaymentTransaction"')) {
          return { rows: [transactionRow] as T[] };
        }
        if (sql.includes('UPDATE "PaymentTransaction"')) {
          return {
            rows: [{ ...transactionRow, voidedAt: new Date("2026-07-03T09:00:00.000Z"), voidReason: "Hatalı tahsilat" }] as T[],
          };
        }
        if (sql.includes('FROM "PaymentTransaction"')) {
          return { rows: [transactionRow] as T[] };
        }
        if (sql.includes('UPDATE "PaymentPlan"')) {
          return { rows: [planRow] as T[] };
        }
        if (sql.includes('FROM "PaymentInstallment"')) {
          return { rows: [installmentRow] as T[] };
        }
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresPaymentPlanStore(pool);

    const result = await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        const created = await store.createTransaction({
          tenantId: "tenant-a",
          planId: "payment-plan-a",
          installmentId: "payment-installment-a",
          amount: 50000,
          currency: "TRY",
          method: "CASH",
          paidAt: "2026-07-02T09:30:00.000Z",
          note: "Elden tahsilat",
          recordedByUserId: "user-tenant-a",
        });
        const listed = await store.listTransactions("payment-plan-a");
        const voided = await store.voidTransaction(
          "tenant-a",
          "payment-plan-a",
          "payment-transaction-a",
          "2026-07-03T09:00:00.000Z",
          "Hatalı tahsilat",
        );
        const canceled = await store.cancelPlan("payment-plan-a", "2026-07-03T09:00:00.000Z");
        return { canceled, created, listed, voided };
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    const insertTransaction = businessQueries.find((query) => query.sql.includes('INSERT INTO "PaymentTransaction"'));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(insertTransaction?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "payment-plan-a",
      "payment-installment-a",
      50000,
      "TRY",
      "CASH",
      "2026-07-02T09:30:00.000Z",
      "R-000001",
      "Elden tahsilat",
      "user-tenant-a",
    ]);
    expect(businessQueries.find((query) => query.sql.includes('UPDATE "PaymentTransaction"'))?.values).toEqual([
      "tenant-a",
      "payment-plan-a",
      "payment-transaction-a",
      "2026-07-03T09:00:00.000Z",
      "Hatalı tahsilat",
    ]);
    expect(businessQueries.find((query) => query.sql.includes('UPDATE "PaymentPlan"'))?.values).toEqual([
      "payment-plan-a",
      "2026-07-03T09:00:00.000Z",
    ]);
    expect(result.created).toMatchObject({ receiptNo: "R-000001", amount: 50000 });
    expect(result.listed).toHaveLength(1);
    expect(result.voided).toMatchObject({ voidReason: "Hatalı tahsilat" });
    expect(result.canceled?.installments).toEqual([expect.objectContaining({ status: "CANCELED" })]);
  });
});
