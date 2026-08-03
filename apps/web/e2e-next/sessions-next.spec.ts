import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test("oturum kapatma mevcut cihazı DELETE eder ve ortak girişe yönlendirir", async ({ page }) => {
  const deleteRequests = await openSessionsPage(page, "TENANT_ADMIN");

  await page.getByRole("button", { name: "Bu cihazdan çık" }).click();
  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();

  await expect.poll(() => deleteRequests).toEqual(["/me/sessions/session-current"]);
  await expect(page).toHaveURL(/\/login$/u);
});

test("oturum kapatma tüm cihazları DELETE eder ve ortak girişe yönlendirir", async ({ page }) => {
  const deleteRequests = await openSessionsPage(page, "SYSTEM_ADMIN");

  await page.getByRole("button", { name: "Tüm oturumları kapat" }).click();
  await page.getByRole("button", { name: "Tümünü kapat", exact: true }).click();

  await expect.poll(() => deleteRequests).toEqual(["/me/sessions"]);
  await expect(page).toHaveURL(/\/login$/u);
});

async function openSessionsPage(page: Page, role: "SYSTEM_ADMIN" | "TENANT_ADMIN") {
  const deleteRequests: string[] = [];
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    const pathName = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    if (pathName === "/auth/refresh") {
      await fulfillData(route, createAuthResponse(role));
      return;
    }
    if (pathName === "/auth/logout") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    if (pathName === "/me/sessions" && request.method() === "GET") {
      await fulfillData(route, [currentSession(role)]);
      return;
    }
    if (pathName.startsWith("/me/sessions") && request.method() === "DELETE") {
      deleteRequests.push(pathName);
      await fulfillData(route, { revokedCount: 1 });
      return;
    }
    await fulfillData(route, []);
  });

  await page.goto("/hesap/oturumlar");
  await expect(page.getByRole("heading", { level: 1, name: "Oturumlar" })).toBeVisible();
  return deleteRequests;
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
