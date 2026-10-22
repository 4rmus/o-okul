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
  // An expired PENDING invitation is still in the list; the row must keep offering a fresh invitation (UAT F-03).
  const pendingInvitations: Array<Record<string, unknown>> = [{
    id: "invitation-expired-a",
    tenantId: "tenant-a",
    subjectType: "EMPLOYEE",
    subjectId: "employee-unlinked-a",
    email: "eski@example.test",
    name: "Yeni Admin",
    role: "OPERATIONS_STAFF",
    kind: "EMAIL_LINK",
    status: "PENDING",
    expiresAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2025-12-31T10:00:00.000Z",
    updatedAt: "2025-12-31T10:00:00.000Z",
  }];
  const revokedInvitations: string[] = [];
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
      if (url.searchParams.get("cursor") === "stale-cursor") {
        await route.fulfill({
          body: JSON.stringify({ error: { code: "EMPLOYEE_CURSOR_INVALID", message: "İstek geçersiz." } }),
          contentType: "application/json",
          headers: corsHeaders,
          status: 400,
        });
        return;
      }
      if (url.searchParams.get("cursor") === "employee-page-2") {
        await json(route, [unlinkedEmployee], { limit: 50, previousCursor: "employee-page-1" });
        return;
      }
      await json(route, [employee, unlinkedEmployee], { limit: 50, nextCursor: "employee-page-2" });
      return;
    }
    if (path === "/identity-invitations" && request.method() === "GET") {
      await json(route, pendingInvitations);
      return;
    }
    const revoke = /^\/identity-invitations\/([^/]+)\/revoke$/u.exec(path);
    if (revoke && request.method() === "POST") {
      revokedInvitations.push(revoke[1]!);
      const revoked = pendingInvitations.find((candidate) => candidate.id === revoke[1]);
      pendingInvitations.splice(0, pendingInvitations.length);
      await json(route, { ...revoked, status: "REVOKED" });
      return;
    }
    if (path === "/employees/employee-unlinked-a/account-invitations" && request.method() === "POST") {
      capturedInvitation = request.postDataJSON() as Record<string, unknown>;
      expect(request.headers()).not.toHaveProperty("x-step-up-token");
      const created = {
        id: "invitation-admin-a",
        tenantId: "tenant-a",
        subjectType: "EMPLOYEE",
        subjectId: "employee-unlinked-a",
        email: "yeni.admin@example.test",
        name: "Yeni Admin",
        role: "TENANT_ADMIN",
        kind: "EMAIL_LINK",
        status: "PENDING",
        expiresAt: "2099-08-02T10:00:00.000Z",
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T10:00:00.000Z",
      };
      pendingInvitations.push(created);
      await json(route, created);
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
  const managementGroup = page.getByRole("button", { name: "Kişiler", exact: true });
  if ((await managementGroup.getAttribute("aria-expanded")) !== "true") await managementGroup.click();
  // Hub modeli (Berrak §2): Personel hub'ı → "Çalışanlar ve yetkiler" sekmesi.
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Personel", exact: true }).click();
  await expect(page).toHaveURL(/\/kurum\/ogretmenler$/u);
  const staffTabs = page.getByRole("navigation", { name: "Personel bölümleri" });
  await expect(staffTabs.getByRole("link", { name: "Öğretmenler", exact: true })).toHaveAttribute("aria-current", "page");
  await staffTabs.getByRole("link", { name: "Çalışanlar ve yetkiler", exact: true }).click();
  await expect(page).toHaveURL(/\/kurum\/calisanlar$/u);
  await expect(page.getByRole("navigation", { name: "Personel bölümleri" }).getByRole("link", { name: "Çalışanlar ve yetkiler", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Personel", exact: true })).toHaveAttribute("aria-current", "page");
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
  const toastRegion = page.locator('.uh-toast-region[aria-live="polite"]');
  await expect(toastRegion).toHaveCount(1);
  await expect(toastRegion).toContainText("Hesap daveti gönderime alındı.");
  await page.getByRole("button", { name: "Bildirimi kapat" }).click();
  await expect(toastRegion).not.toContainText("Hesap daveti gönderime alındı.");

  // UAT F-03: the row shows the pending invitation and lets the admin withdraw it before the 24-hour expiry.
  const unlinkedRow = page.getByRole("row", { name: /Yeni Admin/ });
  await expect(unlinkedRow).toContainText("Davet bekliyor");
  await expect(page.getByRole("button", { name: "Yeni Admin için hesap daveti gönder" })).toHaveCount(0);
  await page.getByRole("button", { name: "Yeni Admin hesap davetini iptal et" }).click();
  await expect.poll(() => revokedInvitations).toEqual(["invitation-admin-a"]);
  await expect(toastRegion).toContainText("Yeni Admin için hesap daveti iptal edildi");
  await expect(unlinkedRow).toContainText("Hesap bağlı değil");
  await expect(page.getByRole("button", { name: "Yeni Admin hesap davetini iptal et" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Yeni Admin için hesap daveti gönder" })).toBeVisible();

  // A stale or earlier-format cursor kept in the URL is dropped and the first page loads without an error banner.
  // A reload restores the session through /auth/refresh, which needs the CSRF cookie the login form would leave.
  await page.context().addCookies([{ name: "csrfToken", url: new URL(page.url()).origin, value: "csrf-token" }]);
  await page.goto("/kurum/calisanlar?employeesCursor=stale-cursor&employeesQ=ada");
  await expect.poll(() => employeeRequests.some((url) => url.searchParams.get("cursor") === "stale-cursor")).toBe(true);
  await expect(page.getByRole("button", { name: "Ada Yılmaz erişimini düzenle" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("employeesCursor")).toBeNull();
  await expect.poll(() => employeeRequests.at(-1)?.searchParams.has("cursor")).toBe(false);
  expect(employeeRequests.some((url) => url.searchParams.get("cursor") === "stale-cursor")).toBe(true);
  expect(employeeRequests.at(-1)?.searchParams.get("q")).toBe("ada");
  await expect(page.locator(".uh-crud-page__error")).toHaveCount(0);
});

// UAT F-20: the 409 e-mail refusal of the same step reopens the invitation dialog with the field marked invalid.
for (const failInvite of [undefined, { code: "EMPLOYEE_INVITATION_ALREADY_PENDING", status: 400 }, { code: "EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND", status: 409 }]) test(`UAT F-02 yeni çalışan formundan aynı adımda yönetici daveti gönderilir${failInvite ? ` (davet hatası ${failInvite.code})` : ""}`, async ({ page }) => {
  let activeSession = false;
  const createdBodies: Array<Record<string, unknown>> = [];
  const invitationBodies: Array<Record<string, unknown>> = [];
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
    if (path === "/employees" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      createdBodies.push(body);
      await json(route, { id: "employee-new-admin", tenantId: "tenant-a", firstName: body.firstName, lastName: body.lastName, workEmail: body.workEmail, status: body.status });
      return;
    }
    if (path === "/employees/employee-new-admin/account-invitations" && request.method() === "POST") {
      invitationBodies.push(request.postDataJSON() as Record<string, unknown>);
      if (failInvite && invitationBodies.length === 1) {
        await route.fulfill({ body: JSON.stringify({ error: { code: failInvite.code } }), contentType: "application/json", headers: corsHeaders, status: failInvite.status });
        return;
      }
      await json(route, {
        id: "invitation-new-admin", tenantId: "tenant-a", subjectType: "EMPLOYEE", subjectId: "employee-new-admin",
        email: "mudur@example.test", name: "Müdür Yardımcısı", role: "TENANT_ADMIN", kind: "EMAIL_LINK", status: "PENDING",
        expiresAt: "2099-01-02T10:00:00.000Z", createdAt: "2099-01-01T10:00:00.000Z", updatedAt: "2099-01-01T10:00:00.000Z",
      });
      return;
    }
    if (path === "/employees" && request.method() === "GET") {
      await json(route, [], { limit: 50 });
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
  const managementGroup = page.getByRole("button", { name: "Kişiler", exact: true });
  if ((await managementGroup.getAttribute("aria-expanded")) !== "true") await managementGroup.click();
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Personel", exact: true }).click();
  await page.getByRole("navigation", { name: "Personel bölümleri" }).getByRole("link", { name: "Çalışanlar ve yetkiler", exact: true }).click();
  await expect(page).toHaveURL(/\/kurum\/calisanlar$/u);
  await page.getByRole("button", { name: "Yeni çalışan" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni çalışan" });
  await dialog.getByLabel("Ad", { exact: true }).fill("Müdür");
  await dialog.getByLabel("Soyad", { exact: true }).fill("Yardımcısı");
  await dialog.getByLabel("Hesap daveti").selectOption("TENANT_ADMIN");
  await expect(dialog.getByLabel("Profil durumu")).toBeDisabled();
  await expect(dialog.getByLabel("Profil durumu")).toHaveValue("ACTIVE");
  // Without a work e-mail the invitation cannot be sent; nothing is created.
  await dialog.getByRole("button", { name: "Oluştur ve davet gönder" }).click();
  await expect(dialog).toContainText("Hesap daveti için iş e-postası zorunludur.");
  expect(createdBodies).toHaveLength(0);

  await dialog.getByLabel("İş e-postası").fill("mudur@example.test");
  await dialog.getByRole("button", { name: "Oluştur ve davet gönder" }).click();
  await expect(dialog).toBeHidden();
  expect(createdBodies).toEqual([expect.objectContaining({ firstName: "Müdür", lastName: "Yardımcısı", workEmail: "mudur@example.test", status: "ACTIVE" })]);
  expect(invitationBodies).toEqual([{ email: "mudur@example.test", role: "TENANT_ADMIN" }]);
  if (failInvite) {
    // The profile stays; the invitation dialog reopens with the chosen role so the retry is one click.
    const retry = page.getByRole("dialog", { name: "Müdür Yardımcısı hesap daveti" });
    if (failInvite.status === 409) {
      const email = retry.getByLabel("İş e-postası");
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await expect(email).toHaveAccessibleDescription("Bu e-posta kurumda başka bir çalışanın hesabında kullanılıyor. Farklı bir e-posta girin.");
      await expect(retry.getByRole("alert")).toHaveCount(0);
    } else {
      await expect(retry).toContainText("Bu çalışan için zaten bekleyen bir davet var");
    }
    await expect(retry.getByLabel("Başlangıç rolü")).toHaveValue("TENANT_ADMIN");
    await expect(retry.getByLabel("İş e-postası")).toHaveValue("mudur@example.test");
    await retry.getByRole("button", { name: "Daveti gönder" }).click();
    await expect(retry).toBeHidden();
    expect(invitationBodies).toHaveLength(2);
    expect(createdBodies).toHaveLength(1);
    return;
  }
  await expect(page.locator('.uh-toast-region[aria-live="polite"]')).toContainText("Çalışan profili oluşturuldu ve hesap daveti gönderime alındı.");
});

test("UAT F-20 davet penceresi bağlı veya uyumsuz e-postada açık kalır ve alanı geçersiz işaretler", async ({ page }) => {
  let activeSession = false;
  const invitationBodies: Array<Record<string, unknown>> = [];
  const refusals = ["EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND", "EMPLOYEE_EMAIL_ACCOUNT_INCOMPATIBLE"];
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
    if (path === "/employees/employee-unlinked-a/account-invitations" && request.method() === "POST") {
      invitationBodies.push(request.postDataJSON() as Record<string, unknown>);
      const code = refusals[invitationBodies.length - 1];
      if (code) {
        await route.fulfill({ body: JSON.stringify({ error: { code } }), contentType: "application/json", headers: corsHeaders, status: 409 });
        return;
      }
      await json(route, {
        id: "invitation-f20", tenantId: "tenant-a", subjectType: "EMPLOYEE", subjectId: "employee-unlinked-a",
        email: "muhasebe@example.test", name: "Yeni Admin", role: "FINANCE_STAFF", kind: "EMAIL_LINK", status: "PENDING",
        expiresAt: "2099-01-02T10:00:00.000Z", createdAt: "2099-01-01T10:00:00.000Z", updatedAt: "2099-01-01T10:00:00.000Z",
      });
      return;
    }
    if (path === "/employees" && request.method() === "GET") {
      await json(route, [unlinkedEmployeeFixture()], { limit: 50 });
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
  const managementGroup = page.getByRole("button", { name: "Kişiler", exact: true });
  if ((await managementGroup.getAttribute("aria-expanded")) !== "true") await managementGroup.click();
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Personel", exact: true }).click();
  await page.getByRole("navigation", { name: "Personel bölümleri" }).getByRole("link", { name: "Çalışanlar ve yetkiler", exact: true }).click();
  await expect(page).toHaveURL(/\/kurum\/calisanlar$/u);
  await page.getByRole("button", { name: "Yeni Admin için hesap daveti gönder" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni Admin hesap daveti" });
  const email = dialog.getByLabel("İş e-postası");
  await email.fill("ogretmen@example.test");
  await dialog.getByLabel("Başlangıç rolü").selectOption("FINANCE_STAFF");
  await dialog.getByRole("button", { name: "Daveti gönder" }).click();

  await expect(dialog).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAccessibleDescription("Bu e-posta kurumda başka bir çalışanın hesabında kullanılıyor. Farklı bir e-posta girin.");
  await expect(email).toBeFocused();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  // Editing the address clears the error.
  await email.fill("ogrenci@example.test");
  await expect(email).not.toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("button", { name: "Daveti gönder" }).click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(dialog).toContainText("Bu e-posta çalışan hesabıyla birleştirilemeyen bir hesaba ait");

  await email.fill("muhasebe@example.test");
  await dialog.getByRole("button", { name: "Daveti gönder" }).click();
  await expect(dialog).toBeHidden();
  expect(invitationBodies).toEqual([
    { email: "ogretmen@example.test", role: "FINANCE_STAFF" },
    { email: "ogrenci@example.test", role: "FINANCE_STAFF" },
    { email: "muhasebe@example.test", role: "FINANCE_STAFF" },
  ]);
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
