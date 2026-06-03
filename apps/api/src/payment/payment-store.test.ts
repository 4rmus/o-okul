import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresPaymentPlanStore } from "./payment-store.js";

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
        await store.list({ courseId: "course-math", termId: "term-2026-spring" });
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
    expect(businessQueries[0]?.sql).toContain('"courseId" = $1');
    expect(businessQueries[0]?.sql).toContain('"termId" = $2');
    expect(businessQueries[0]?.values).toEqual(["course-math", "term-2026-spring"]);
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
});
