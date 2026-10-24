import { expect, test, type Page, type Route } from "@playwright/test";
import { tenantLoginUrl } from "./helpers/tenant-login.js";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

const logoutPendingMessage = "Çıkış sunucuda tamamlanamadı. Oturumunuz bu tarayıcıda açık kalabilir; tekrar deneyin.";

test("oturum kapatma mevcut cihazı DELETE eder ve ortak girişe yönlendirir", async ({ page }) => {
  const { deleteRequests } = await openSessionsPage(page, "TENANT_ADMIN");

  await page.getByRole("button", { name: "Bu cihazdan çık" }).click();
  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();

  await expect.poll(() => deleteRequests).toEqual(["/me/sessions/session-current"]);
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByText(logoutPendingMessage)).toHaveCount(0);
});

test("oturum kapatma menüdeki çıkış başarılıysa uyarısız ortak girişe döner", async ({ page }) => {
  const api = await openSessionsPage(page, "TENANT_ADMIN");

  await page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış", exact: true }).click();

  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Giriş" })).toBeVisible();
  await expect(page.getByText(logoutPendingMessage)).toHaveCount(0);
  expect(api.logoutRequests).toBe(1);
});

test("oturum kapatma menüdeki çıkış sunucuda başarısızsa uyarır ve yenilenen giriş sayfası oturuma dönmez", async ({ page }) => {
  const api = await openSessionsPage(page, "TENANT_ADMIN");
  api.logoutStatus = 500;

  await page.locator("#next-sidebar").getByRole("button", { name: "Çıkış", exact: true }).click();

  await expect(page).toHaveURL(/\/login\?cikis=tamamlanamadi$/u);
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();
  const refreshesBeforeReload = api.refreshRequests;

  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?cikis=tamamlanamadi$/u);
  await expect.poll(() => api.logoutRequests).toBe(2);
  expect(api.refreshRequests).toBe(refreshesBeforeReload);

  api.logoutStatus = 204;
  await page.getByRole("button", { name: "Çıkışı tekrar dene" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Oturumunuz kapatıldı." })).toBeVisible();
  await expect(page.getByText(logoutPendingMessage)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/u);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Giriş" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/u);
  expect(api.refreshRequests).toBe(refreshesBeforeReload);
});

test("oturum kapatma bu cihazdan çıkışta sunucu çıkışı başarısızsa uyarır ve oturumu sürdürmez", async ({ page }) => {
  const api = await openSessionsPage(page, "TENANT_ADMIN");
  api.logoutStatus = 403;

  await page.getByRole("button", { name: "Bu cihazdan çık" }).click();
  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();

  await expect(page).toHaveURL(/\/login\?cikis=tamamlanamadi$/u);
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();
  const refreshesBeforeReload = api.refreshRequests;

  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();
  expect(api.refreshRequests).toBe(refreshesBeforeReload);

  await page.getByRole("button", { name: "Çıkışı tekrar dene" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Çıkış yine tamamlanamadı." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?cikis=tamamlanamadi$/u);
});

test("oturum kapatma uyarı bayrağı kurum adresindeki giriş yönlendirmesinde korunur", async ({ page }) => {
  const tenantLogin = new URL(tenantLoginUrl(appOrigin, "dna-egitim"));
  const requests: string[] = [];
  await page.context().addCookies([{ name: "csrfToken", url: tenantLogin.origin, value: "csrf-token" }]);
  await page.route("**/api/v1/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname.replace(/^\/api\/v1/u, "");
    if (route.request().method() !== "OPTIONS") requests.push(pathName);
    await route.fulfill({ headers: { ...corsHeaders, "access-control-allow-origin": tenantLogin.origin }, status: pathName === "/auth/refresh" ? 200 : 500 });
  });

  await page.goto(`${tenantLogin.origin}/login?cikis=tamamlanamadi&ad=gizli`);
  await expect(page).toHaveURL(`${tenantLogin.origin}/giris?cikis=tamamlanamadi`);
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();
  expect(requests).toContain("/auth/logout");
  expect(requests).not.toContain("/auth/refresh");
  await page.context().clearCookies({ name: "csrfToken" });

  await page.goto(`${tenantLogin.origin}/login`);
  await expect(page).toHaveURL(`${tenantLogin.origin}/giris`);
});

test("oturum kapatma tüm cihazları DELETE eder ve ortak girişe yönlendirir", async ({ page }) => {
  const { deleteRequests } = await openSessionsPage(page, "SYSTEM_ADMIN");

  await page.getByRole("button", { name: "Tüm oturumları kapat" }).click();
  await page.getByRole("button", { name: "Tümünü kapat", exact: true }).click();

  await expect.poll(() => deleteRequests).toEqual(["/me/sessions"]);
  await expect(page).toHaveURL(/\/login$/u);
});

async function openSessionsPage(page: Page, role: "SYSTEM_ADMIN" | "TENANT_ADMIN") {
  const api = { deleteRequests: [] as string[], logoutRequests: 0, logoutStatus: 204, refreshRequests: 0 };
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    const pathName = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    if (pathName === "/auth/refresh") {
      api.refreshRequests += 1;
      await fulfillData(route, createAuthResponse(role));
      return;
    }
    if (pathName === "/auth/logout") {
      api.logoutRequests += 1;
      // Like the API, a confirmed logout clears the CSRF cookie; a refused one leaves the session cookies alone.
      if (api.logoutStatus === 204) await page.context().clearCookies({ name: "csrfToken" });
      await route.fulfill({
        headers: corsHeaders,
        status: api.logoutStatus,
        ...(api.logoutStatus === 204 ? {} : { body: JSON.stringify({ error: { code: "LOGOUT_REFUSED" } }), contentType: "application/json" }),
      });
      return;
    }
    if (pathName === "/me/sessions" && request.method() === "GET") {
      await fulfillData(route, [currentSession(role)]);
      return;
    }
    if (pathName.startsWith("/me/sessions") && request.method() === "DELETE") {
      api.deleteRequests.push(pathName);
      await fulfillData(route, { revokedCount: 1 });
      return;
    }
    await fulfillData(route, []);
  });

  await page.goto("/hesap/oturumlar");
  await expect(page.getByRole("heading", { level: 1, name: "Oturumlar" })).toBeVisible();
  return api;
}

async function fulfillData(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 200,
  });
}

function createAuthResponse(role: "SYSTEM_ADMIN" | "TENANT_ADMIN") {
  return {
    accessToken: "sessions-access-token",
    session: {
      id: "session-current",
      membershipVersion: 1,
      roles: [role],
      status: "ACTIVE",
      ...(role === "TENANT_ADMIN" ? { activePersona: "STAFF", membershipId: "membership-a", tenantId: "tenant-a" } : {}),
      userId: "sessions-user",
    },
  };
}

function currentSession(role: "SYSTEM_ADMIN" | "TENANT_ADMIN") {
  return {
    id: "session-current",
    ...(role === "TENANT_ADMIN" ? { activePersona: "STAFF" } : {}),
    clientIpPrefix: "203.0.113.0/24",
    createdAt: "2026-08-01T09:00:00.000Z",
    current: true,
    deviceLabel: "Chrome · macOS",
    expiresAt: "2026-08-31T12:00:00.000Z",
    lastSeenAt: "2026-08-01T12:00:00.000Z",
    roles: [role],
    status: "ACTIVE",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}
