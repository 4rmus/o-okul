import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * UAT F-33: the finance list labels each row with "Ad Soyad · No" from the `student` summary that
 * `GET /payment-plans` now carries. FINANCE_STAFF has no `student:list`, so no `/students` request may leave the page,
 * and a plan whose student was soft-deleted shows a neutral fallback.
 */

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

// Only what the real API opens to FINANCE_STAFF; everything else answers 403 and is recorded.
const allowedForFinanceStaff = [/^\/auth\//, /^\/me\/profile$/, /^\/me\/sessions/, /^\/payment-plans/, /^\/feature-rollouts?/];

interface FinanceMockState {
  forbiddenRequests: string[];
  paymentPlanQueries: URLSearchParams[];
  requestedPaths: string[];
}

test.describe("UAT F-33 finans listesi öğrenci etiketi", () => {
  test("FINANCE_STAFF her satırda ad soyad ve okul numarasını /students çağırmadan görür", async ({ page }) => {
    const state = await openFinanceAsFinanceStaff(page);

    const table = page.getByRole("table", { name: "Ödeme taksitleri" });
    await expect(table.getByRole("cell", { name: "Ayşe Demir · 1001", exact: true })).toBeVisible();
    // A plan whose student record is soft-deleted carries no `student`; the row stays readable.
    await expect(table.getByRole("cell", { name: "Öğrenci kaydı silinmiş", exact: true })).toBeVisible();
    // A student without a school number shows the name alone.
    await expect(table.getByRole("cell", { name: "Can Yıldız", exact: true })).toBeVisible();
    await expect(page.getByText("Öğrenci kapsamı doğrulanmadı")).toHaveCount(0);
    await expect(page.getByText("Seçim listeleri alınamadı.")).toHaveCount(0);
    await expect(page.getByText("Ödeme planları alınamadı.")).toHaveCount(0);

    expect(state.requestedPaths.filter((path) => path.startsWith("/students"))).toEqual([]);
    expect(state.forbiddenRequests).toEqual([]);
  });

  test("öğrenci adına göre sıralama ve arama liste isteğine yansır", async ({ page }) => {
    const state = await openFinanceAsFinanceStaff(page);
    const controls = page.getByRole("group", { name: "Liste kontrolleri" });

    await controls.getByRole("combobox", { name: "Sırala" }).selectOption("studentName");
    await expect.poll(() => state.paymentPlanQueries.at(-1)?.get("sort")).toBe("studentName");

    await controls.getByRole("textbox", { name: "Ara" }).fill("Demir");
    await expect.poll(() => state.paymentPlanQueries.at(-1)?.get("q")).toBe("Demir");
    await expect.poll(() => state.paymentPlanQueries.at(-1)?.get("sort")).toBe("studentName");
    expect(state.forbiddenRequests).toEqual([]);
  });
});

async function openFinanceAsFinanceStaff(page: Page): Promise<FinanceMockState> {
  const state: FinanceMockState = { forbiddenRequests: [], paymentPlanQueries: [], requestedPaths: [] };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    state.requestedPaths.push(path);

    if (!allowedForFinanceStaff.some((pattern) => pattern.test(path))) {
      state.forbiddenRequests.push(`${request.method()} ${path}`);
      await route.fulfill({
        body: JSON.stringify({ error: { code: "FORBIDDEN" } }),
        headers: { ...corsHeadersFor(route), "content-type": "application/json" },
        status: 403,
      });
      return;
    }
    if (path === "/auth/refresh") return fulfillData(route, createFinanceStaffAuth());
    if (path === "/payment-plans" && request.method() === "GET") {
      state.paymentPlanQueries.push(url.searchParams);
      return fulfillList(route, createPaymentPlans());
    }
    return fulfillData(route, []);
  });

  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/kurum/finans");
  await expect(page.getByRole("region", { name: "Finans yönetimi" })).toBeVisible();
  return state;
}

function createFinanceStaffAuth() {
  return {
    accessToken: "finance-staff-access-token",
    session: {
      activePersona: "STAFF",
      id: "session-finance-staff",
      membershipVersion: 1,
      roles: ["FINANCE_STAFF"],
      status: "ACTIVE",
      tenantId: "tenant-finance-label",
      userId: "user-finance-staff",
    },
  };
}

function createPaymentPlans() {
  return [
    {
      createdAt: "2026-06-05T09:00:00.000Z",
      currency: "TRY",
      id: "payment-plan-a",
      installments: [createInstallment("payment-plan-a", "installment-a-1", "2026-06-01")],
      student: { firstName: "Ayşe", id: "student-a", lastName: "Demir", studentNo: "1001" },
      studentId: "student-a",
      tenantId: "tenant-finance-label",
      title: "2026 Haziran ödeme planı",
      totalAmount: 50000,
    },
    {
      createdAt: "2026-06-05T09:00:00.000Z",
      currency: "TRY",
      id: "payment-plan-b",
      installments: [createInstallment("payment-plan-b", "installment-b-1", "2026-07-01")],
      // Soft-deleted student: the API omits `student` on purpose.
      studentId: "student-deleted",
      tenantId: "tenant-finance-label",
      title: "Eski kayıt ödeme planı",
      totalAmount: 50000,
    },
    {
      createdAt: "2026-06-05T09:00:00.000Z",
      currency: "TRY",
      id: "payment-plan-c",
      installments: [createInstallment("payment-plan-c", "installment-c-1", "2026-08-01")],
      student: { firstName: "Can", id: "student-c", lastName: "Yıldız" },
      studentId: "student-c",
      tenantId: "tenant-finance-label",
      title: "Numarasız öğrenci planı",
      totalAmount: 50000,
    },
  ];
}

function createInstallment(planId: string, id: string, dueDate: string) {
  return {
    amount: 50000,
    createdAt: "2026-06-05T09:00:00.000Z",
    dueDate,
    id,
    installmentNo: 1,
    planId,
    status: "PENDING",
    tenantId: "tenant-finance-label",
  };
}

async function fulfillList(route: Route, data: unknown[]) {
  await route.fulfill({
    body: JSON.stringify({ data, meta: { limit: 10, page: 1, total: data.length, totalPages: 1 } }),
    headers: { ...corsHeadersFor(route), "content-type": "application/json" },
    status: 200,
  });
}

async function fulfillData(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    headers: { ...corsHeadersFor(route), "content-type": "application/json" },
    status: 200,
  });
}

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}
