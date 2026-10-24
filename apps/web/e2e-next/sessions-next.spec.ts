import { expect, test, type Page, type Route } from "@playwright/test";
import { NextRequest } from "next/server.js";
import { proxy } from "../proxy.js";
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
  // The shell logout, the bootstrap retry after reload and the button retry all send the CSRF cookie's value.
  expect(api.logoutCsrfHeaders).toEqual(["csrf-token", "csrf-token", "csrf-token"]);
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

test("oturum kapatma ağ hatasında da sorgu önbelleğini temizler; yeni girişte eski veri görünmez", async ({ page }) => {
  // SYSTEM_ADMIN lands on /sistem after sign-in, which renders with the empty mocks; the list is the same per user.
  const api = await openSessionsPage(page, "SYSTEM_ADMIN");
  await expect(page.getByText("Chrome · macOS")).toBeVisible();
  api.logoutMode = "abort";

  await page.locator("#next-sidebar").getByRole("button", { name: "Çıkış", exact: true }).click();

  await expect(page).toHaveURL(/\/login\?cikis=tamamlanamadi$/u);
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();

  // Same tab, client-side: the next sign-in must not be served the cached list of the session that just ended.
  api.deviceLabel = "Firefox · Linux";
  const releaseSessions = api.holdSessions();
  await page.getByLabel("Kurum Kodu").fill("system");
  await page.getByLabel("Kullanıcı adı veya e-posta").fill("system@example.test");
  await page.locator('input[name="password"]').fill("5551234567");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.locator("#next-sidebar").getByRole("link", { name: "Oturumlar" })).toBeVisible({ timeout: 15_000 });
  await page.locator("#next-sidebar").getByRole("link", { name: "Oturumlar" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Oturumlar" })).toBeVisible();
  await expect.poll(() => api.heldSessionRequests).toBe(1);
  await expect(page.getByText("Chrome · macOS")).toHaveCount(0);
  releaseSessions();
  await expect(page.getByText("Firefox · Linux")).toBeVisible();
  expect(api.loginRequests).toBe(1);
});

test("oturum kapatma reddedilen çıkış CSRF çerezini sildiyse çıkışı tamamlanmış sayar", async ({ page }) => {
  const api = await openSessionsPage(page, "TENANT_ADMIN");
  api.logoutStatus = 500;

  await page.locator("#next-sidebar").getByRole("button", { name: "Çıkış", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?cikis=tamamlanamadi$/u);
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();

  // Like the API since this change: a refused logout still clears the refresh and CSRF cookies.
  api.logoutStatus = 403;
  api.clearCookiesOnRefusal = true;
  await page.getByRole("button", { name: "Çıkışı tekrar dene" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Oturumunuz kapatıldı." })).toBeVisible();
  await expect(page.getByText(logoutPendingMessage)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/u);
  expect(api.logoutRequests).toBe(2);
  const refreshesBeforeReload = api.refreshRequests;
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Giriş" })).toBeVisible();
  await expect(page.getByText(logoutPendingMessage)).toHaveCount(0);
  expect(api.logoutRequests).toBe(2);
  expect(api.refreshRequests).toBe(refreshesBeforeReload);
});

test("oturum kapatma uyarı bayrağı giriş sayfası dışındaki sayfalarda yok sayılır", async ({ page }) => {
  const api = await openSessionsPage(page, "TENANT_ADMIN", "/hesap/oturumlar?cikis=tamamlanamadi");

  await expect(page).toHaveURL(/\/hesap\/oturumlar\?cikis=tamamlanamadi$/u);
  expect(api.logoutRequests).toBe(0);
  expect(api.refreshRequests).toBeGreaterThan(0);
});

test("oturum kapatma şifre değiştirme sayfasında sunucu çıkışı başarısızsa uyarır ve oturumu sürdürmez", async ({ page }) => {
  const api = await installSessionApi(page, { mustChangePassword: true, role: "TENANT_ADMIN" });
  await page.goto("/sifre-degistir");
  await expect(page.getByRole("heading", { level: 1, name: "Şifre değiştir" })).toBeVisible();
  api.logoutStatus = 500;

  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();

  await expect(page).toHaveURL(/\/login\?cikis=tamamlanamadi$/u);
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();
  const refreshesBeforeReload = api.refreshRequests;
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: logoutPendingMessage })).toBeVisible();
  expect(api.refreshRequests).toBe(refreshesBeforeReload);
  expect(api.logoutCsrfHeaders).toEqual(["csrf-token", "csrf-token"]);
});

test("oturum kapatma sistem adresinde 410 yerine sistem girişine döner", async ({ page }) => {
  const systemOrigin = new URL(tenantLoginUrl(appOrigin, "dna-egitim").replace("dna-egitim.", "sistem.")).origin;
  const api = await installSessionApi(page, { origin: systemOrigin, role: "SYSTEM_ADMIN" });
  await page.goto(`${systemOrigin}/sistem`);
  await expect(page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış", exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış", exact: true }).click();

  await expect(page).toHaveURL(`${systemOrigin}/giris`);
  await expect(page.getByRole("heading", { level: 1, name: "Giriş" })).toBeVisible();
  await expect(page.getByText("LEGACY_TENANT_LOGIN_RETIRED")).toHaveCount(0);
  expect(api.logoutRequests).toBe(1);
});

test("oturum kapatma uyarı bayrağı eski giriş yönlendirmesinde yalnız aynı adreste korunur", () => {
  const previousDomain = process.env.DOMAIN;
  const previousCutoff = process.env.LEGACY_TENANT_LOGIN_CUTOFF_AT;
  try {
    process.env.DOMAIN = "o-okul.com";
    process.env.LEGACY_TENANT_LOGIN_CUTOFF_AT = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString();
    const redirectFrom = (url: string) => proxy(new NextRequest(url, { headers: { host: new URL(url).host } })).headers.get("location");

    expect(redirectFrom("https://o-okul.com/k/dna-egitim/giris?cikis=tamamlanamadi")).toBe("https://dna-egitim.o-okul.com/giris");
    expect(redirectFrom("https://dna-egitim.o-okul.com/k/dna-egitim/giris?cikis=tamamlanamadi")).toBe("https://dna-egitim.o-okul.com/giris?cikis=tamamlanamadi");
    expect(redirectFrom("https://o-okul.com/sistem/giris?cikis=tamamlanamadi")).toBe("https://sistem.o-okul.com/giris");
    expect(redirectFrom("https://sistem.o-okul.com/sistem/giris?cikis=tamamlanamadi")).toBe("https://sistem.o-okul.com/giris?cikis=tamamlanamadi");
  } finally {
    restoreEnvironment("DOMAIN", previousDomain);
    restoreEnvironment("LEGACY_TENANT_LOGIN_CUTOFF_AT", previousCutoff);
  }
});

test("oturum kapatma tüm cihazları DELETE eder ve ortak girişe yönlendirir", async ({ page }) => {
  const { deleteRequests } = await openSessionsPage(page, "SYSTEM_ADMIN");

  await page.getByRole("button", { name: "Tüm oturumları kapat" }).click();
  await page.getByRole("button", { name: "Tümünü kapat", exact: true }).click();

  await expect.poll(() => deleteRequests).toEqual(["/me/sessions"]);
  await expect(page).toHaveURL(/\/login$/u);
});

async function openSessionsPage(page: Page, role: "SYSTEM_ADMIN" | "TENANT_ADMIN", path = "/hesap/oturumlar") {
  const api = await installSessionApi(page, { role });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Oturumlar" })).toBeVisible();
  return api;
}

interface SessionApiOptions {
  mustChangePassword?: boolean;
  origin?: string;
  role: "SYSTEM_ADMIN" | "TENANT_ADMIN";
}

async function installSessionApi(page: Page, { mustChangePassword = false, origin = appOrigin, role }: SessionApiOptions) {
  let sessionsGate: Promise<void> | undefined;
  const api = {
    clearCookiesOnRefusal: false,
    deleteRequests: [] as string[],
    deviceLabel: "Chrome · macOS",
    heldSessionRequests: 0,
    loginRequests: 0,
    logoutCsrfHeaders: [] as string[],
    logoutMode: "status" as "abort" | "status",
    logoutRequests: 0,
    logoutStatus: 204,
    refreshRequests: 0,
    /** Holds the next /me/sessions reads until the returned function is called. */
    holdSessions() {
      let release!: () => void;
      sessionsGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
  };
  const headers = { ...corsHeaders, "access-control-allow-origin": origin };
  await page.context().addCookies([{ name: "csrfToken", url: origin, value: "csrf-token" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers, status: 204 });
      return;
    }

    const pathName = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    if (pathName === "/auth/refresh") {
      api.refreshRequests += 1;
      await fulfillData(route, createAuthResponse(role, mustChangePassword), headers);
      return;
    }
    if (pathName === "/auth/login") {
      api.loginRequests += 1;
      await page.context().addCookies([{ name: "csrfToken", url: origin, value: "csrf-token" }]);
      await fulfillData(route, createAuthResponse(role, mustChangePassword), headers);
      return;
    }
    if (pathName === "/auth/logout") {
      api.logoutRequests += 1;
      api.logoutCsrfHeaders.push(request.headers()["x-csrf-token"] ?? "");
      if (api.logoutMode === "abort") {
        await route.abort("failed");
        return;
      }
      // A confirmed logout clears the CSRF cookie. A refused one keeps it unless the API reached the handler, which
      // clears both cookies before the CSRF check (clearCookiesOnRefusal); a gateway 5xx leaves them alone.
      if (api.logoutStatus === 204 || api.clearCookiesOnRefusal) await page.context().clearCookies({ name: "csrfToken" });
      await route.fulfill({
        headers,
        status: api.logoutStatus,
        ...(api.logoutStatus === 204 ? {} : { body: JSON.stringify({ error: { code: "LOGOUT_REFUSED" } }), contentType: "application/json" }),
      });
      return;
    }
    if (pathName === "/me/sessions" && request.method() === "GET") {
      if (sessionsGate) {
        api.heldSessionRequests += 1;
        await sessionsGate;
      }
      await fulfillData(route, [currentSession(role, api.deviceLabel)], headers);
      return;
    }
    if (pathName.startsWith("/me/sessions") && request.method() === "DELETE") {
      api.deleteRequests.push(pathName);
      await fulfillData(route, { revokedCount: 1 }, headers);
      return;
    }
    await fulfillData(route, [], headers);
  });
  return api;
}

function restoreEnvironment(name: "DOMAIN" | "LEGACY_TENANT_LOGIN_CUTOFF_AT", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function fulfillData(route: Route, data: unknown, headers: Record<string, string> = corsHeaders) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    headers,
    status: 200,
  });
}

function createAuthResponse(role: "SYSTEM_ADMIN" | "TENANT_ADMIN", mustChangePassword = false) {
  return {
    accessToken: "sessions-access-token",
    session: {
      id: "session-current",
      membershipVersion: 1,
      roles: [role],
      status: "ACTIVE",
      ...(role === "TENANT_ADMIN" ? { activePersona: "STAFF", membershipId: "membership-a", tenantId: "tenant-a" } : { tenantId: "system" }),
      ...(mustChangePassword ? { mustChangePassword: true } : {}),
      userId: "sessions-user",
    },
  };
}

function currentSession(role: "SYSTEM_ADMIN" | "TENANT_ADMIN", deviceLabel = "Chrome · macOS") {
  return {
    id: "session-current",
    ...(role === "TENANT_ADMIN" ? { activePersona: "STAFF" } : {}),
    clientIpPrefix: "203.0.113.0/24",
    createdAt: "2026-08-01T09:00:00.000Z",
    current: true,
    deviceLabel,
    expiresAt: "2026-08-31T12:00:00.000Z",
    lastSeenAt: "2026-08-01T12:00:00.000Z",
    roles: [role],
    status: "ACTIVE",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}
