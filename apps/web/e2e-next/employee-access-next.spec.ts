import { expect, test, type Page } from "@playwright/test";
import type { EmployeeAccessRecord } from "@o-okul/shared-types";

const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": webOrigin,
};

test("çalışan rolü, öğretmen çalışma alanı ve kampüs kapsamını tek sürümlü işlemle günceller", async ({ page }) => {
  let activeSession = false;
  let capturedUpdate: Record<string, unknown> | undefined;
  let capturedInvitation: Record<string, unknown> | undefined;
  const employeeRequests: URL[] = [];
  let employee = employeeFixture();
  const unlinkedEmployee = unlinkedEmployeeFixture();

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    await route.continue();
  });
  await page.route("**/auth/refresh", async (route) => {
    if (!activeSession) {
      await route.fulfill({ headers: corsHeaders, status: 401 });
      return;
    }
    await json(route, authResponse());
  });
  await page.route("**/auth/login", async (route) => {
    activeSession = true;
    await json(route, authResponse());
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }
    expect(request.headers().authorization).toBe("Bearer next-access-token");

    if (path === "/employees" && request.method() === "GET") {
      const url = new URL(request.url());
      employeeRequests.push(url);
      if (url.searchParams.get("cursor") === "employee-page-2") {
        await json(route, [unlinkedEmployee], { limit: 50, previousCursor: "employee-page-1" });
        return;
      }
      await json(route, [employee, unlinkedEmployee], { limit: 50, nextCursor: "employee-page-2" });
      return;
    }
    if (path === "/employees/employee-unlinked-a/account-invitations" && request.method() === "POST") {
      capturedInvitation = request.postDataJSON() as Record<string, unknown>;
      expect(request.headers()).not.toHaveProperty("x-step-up-token");
      await json(route, {
        id: "invitation-admin-a",
        tenantId: "tenant-a",
        subjectType: "EMPLOYEE",
        subjectId: "employee-unlinked-a",
        email: "yeni.admin@example.test",
        name: "Yeni Admin",
        role: "TENANT_ADMIN",
        kind: "EMAIL_LINK",
        status: "PENDING",
        expiresAt: "2026-08-02T10:00:00.000Z",
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T10:00:00.000Z",
      });
      return;
    }
    if (path === "/campuses" && request.method() === "GET") {
      await json(route, [{ id: "campus-main", tenantId: "tenant-a", name: "Merkez Kampüs", code: "MRK" }]);
      return;
    }
    if (path === "/tenant-memberships/membership-employee-a" && request.method() === "PATCH") {
      capturedUpdate = request.postDataJSON() as Record<string, unknown>;
      expect(request.headers()).not.toHaveProperty("x-step-up-token");
      employee = {
        ...employee,
        access: {
          membershipId: "membership-employee-a",
          staffRole: "OPERATIONS_STAFF",
          hasTeacherPersona: true,
          status: "ACTIVE",
          version: 2,
          scopeMode: "CAMPUSES",
          campusIds: ["campus-main"],
        },
      };
      await json(route, { employee, sessionsRevoked: 1 });
      return;
    }
    if (path === "/me/tenant") {
      await json(route, { id: "tenant-a", name: "DNA Eğitim", plan: "TRIAL", slug: "dna-egitim", status: "ACTIVE" });
      return;
    }
    if (path === "/me/institution-dashboard") {
      await json(route, {
        activeStudentCount: 0,
        attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
        generatedAt: "2026-08-01T10:00:00.000Z",
        institution: { name: "DNA Eğitim" },
      });
      return;
    }
    await json(route, []);
  });

  await login(page);
  const managementGroup = page.getByRole("button", { name: "Yönetim", exact: true });
  if ((await managementGroup.getAttribute("aria-expanded")) !== "true") await managementGroup.click();
  await page.getByRole("link", { name: "Çalışanlar ve Yetkiler" }).click();
  await expect(page).toHaveURL(/\/kurum\/calisanlar$/u);
  await expect.poll(() => employeeRequests.at(-1)?.searchParams.get("limit")).toBe("50");
  await page.getByRole("button", { name: "Sonraki çalışanlar" }).click();
  await expect.poll(() => employeeRequests.at(-1)?.searchParams.get("cursor")).toBe("employee-page-2");
  await page.getByRole("button", { name: "Önceki çalışanlar" }).click();
  await expect.poll(() => employeeRequests.at(-1)?.searchParams.get("cursor")).toBe("employee-page-1");
  await page.getByRole("button", { name: "Ada Yılmaz erişimini düzenle" }).click();
  const dialog = page.getByRole("dialog", { name: "Ada Yılmaz erişimi" });
  await dialog.getByLabel("Çalışan rolü").selectOption("OPERATIONS_STAFF");
  await dialog.getByLabel("Öğretmen çalışma alanı").check();
  await dialog.getByLabel("Yetki kapsamı").selectOption("CAMPUSES");
  await dialog.getByLabel("Merkez Kampüs").check();
  await expect(dialog.getByLabel("İki aşamalı doğrulama kodu")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Erişimi güncelle" }).click();

  await expect(dialog).toBeHidden();
  expect(capturedUpdate).toEqual({
    campusIds: ["campus-main"],
    expectedVersion: 1,
    hasTeacherPersona: true,
    scopeMode: "CAMPUSES",
    staffRole: "OPERATIONS_STAFF",
    status: "ACTIVE",
  });
  await expect(page.getByRole("cell", { name: "Operasyon çalışanı + Öğretmen çalışma alanı" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1 kampüs" })).toBeVisible();

  await page.getByRole("button", { name: "Yeni Admin için hesap daveti gönder" }).click();
  const invitationDialog = page.getByRole("dialog", { name: "Yeni Admin hesap daveti" });
  await invitationDialog.getByLabel("İş e-postası").fill("yeni.admin@example.test");
  await invitationDialog.getByLabel("Başlangıç rolü").selectOption("TENANT_ADMIN");
  await expect(invitationDialog.getByLabel("İki aşamalı doğrulama kodu")).toHaveCount(0);
  await invitationDialog.getByRole("button", { name: "Daveti gönder" }).click();
  await expect(invitationDialog).toBeHidden();
  expect(capturedInvitation).toEqual({ email: "yeni.admin@example.test", role: "TENANT_ADMIN" });
});

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="tenantSlug"]').fill("dna-egitim");
  await page.locator('input[name="loginName"]').fill("admin-a@example.test");
  await page.locator('input[name="password"]').fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/kurum$/u);
}

async function json(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
  data: unknown,
  meta?: Record<string, unknown>,
) {
  await route.fulfill({
    body: JSON.stringify({ data, ...(meta ? { meta } : {}) }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 200,
  });
}

function authResponse() {
  return {
    accessToken: "next-access-token",
    session: {
      id: "session-a",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-a",
      userId: "user-admin-a",
    },
  };
}

function unlinkedEmployeeFixture(): EmployeeAccessRecord {
  return {
    id: "employee-unlinked-a",
    tenantId: "tenant-a",
    firstName: "Yeni",
    lastName: "Admin",
    workEmail: "yeni.admin@example.test",
    status: "ACTIVE",
  };
}

function employeeFixture(): EmployeeAccessRecord {
  return {
    id: "employee-a",
    tenantId: "tenant-a",
    employeeNo: "A-001",
    firstName: "Ada",
    lastName: "Yılmaz",
    workEmail: "ada@example.test",
    status: "ACTIVE",
    userId: "user-employee-a",
    accountStatus: "ACTIVE",
    access: {
      membershipId: "membership-employee-a",
      staffRole: "TENANT_ADMIN",
      hasTeacherPersona: false,
      status: "ACTIVE",
      version: 1,
      scopeMode: "TENANT",
      campusIds: [],
    },
  };
}
