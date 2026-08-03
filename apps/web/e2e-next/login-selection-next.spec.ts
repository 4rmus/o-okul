import { expect, test } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test("genel login kurum kodu ve kullanıcı adı taşır; eski seçim cevabını güvenle işler", async ({ page }) => {
  let loginBody: Record<string, unknown> | undefined;
  let selectionBody: Record<string, unknown> | undefined;

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }
    if (path === "/me/tenant") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ id: "tenant-b", name: "Demo Kurum B", slug: "demo-kurum-b", plan: "TRIAL", status: "ACTIVE" })),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope([])),
    });
  });

  await page.route("**/api/v1/auth/login", async (route) => {
    loginBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope({
        status: "TENANT_SELECTION_REQUIRED",
        selectionToken: "selection-token",
        expiresAt: "2026-06-29T00:05:00.000Z",
        tenants: [
          { tenantId: "tenant-a", name: "DNA Egitim", slug: "dna-egitim" },
          { tenantId: "tenant-b", name: "Demo Kurum B", slug: "demo-kurum-b" },
        ],
      })),
    });
  });

  await page.route("**/api/v1/auth/login/select", async (route) => {
    selectionBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      headers: {
        ...corsHeaders,
        "set-cookie": "csrfToken=csrf-token; Path=/; SameSite=Strict",
      },
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse())),
    });
  });

  await page.route("**/health", async (route) => {
    await route.fulfill({ contentType: "application/json", headers: corsHeaders, status: 200, body: JSON.stringify({ status: "ok" }) });
  });
  await page.route("**/health/ready", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify({ status: "ready", dependencies: { postgres: "ok", redis: "ok" } }),
    });
  });

  await page.goto("/login");
  await page.getByLabel("Kurum Kodu").fill("dna-egitim");
  await page.getByLabel("Kullanıcı Adı").fill("admin-a@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();

  const tenantSelection = page.getByRole("combobox", { name: "Kurum", exact: true });
  await expect(tenantSelection).toBeVisible();
  await tenantSelection.selectOption("tenant-b");
  await page.getByRole("button", { name: "Devam et" }).click();

  await expect(page).toHaveURL(/\/kurum$/, { timeout: 15_000 });
  expect(loginBody).toEqual({ tenantSlug: "dna-egitim", loginName: "admin-a@example.test", password: "password" });
  expect(selectionBody).toEqual({ selectionToken: "selection-token", tenantId: "tenant-b" });
});

function envelope<T>(data: T) {
  return { data };
}

function createAuthResponse() {
  return {
    accessToken: "access-token",
    session: {
      id: "session-b",
      userId: "user-b",
      tenantId: "tenant-b",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
      status: "ACTIVE",
    },
  };
}
