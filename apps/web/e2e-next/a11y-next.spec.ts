import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

interface AxeViolationSummary {
  help: string;
  id: string;
  impact?: string | null;
  nodes: Array<{ target: string[] }>;
}

test.describe("Next erişilebilirlik smoke", () => {
  test("public landing ve login sayfalarında yüksek etkili axe ihlali yok", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "o-okul" })).toBeVisible();
    await expectNoHighImpactA11yViolations(page, "landing");

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Giriş" })).toBeVisible();
    const loginForm = page.getByRole("form", { name: "Giriş formu" });
    await expect(loginForm.getByLabel("Kurum kodu")).toBeVisible();
    await expect(loginForm.getByLabel("TC kimlik no")).toBeVisible();
    await expect(loginForm.getByLabel("Telefon", { exact: true })).toBeVisible();
    await expect(loginForm.getByRole("textbox", { name: /E-posta/ })).toHaveCount(0);
    await expect(loginForm.getByRole("button", { name: "Giriş yap" })).toBeVisible();
    await expectNoHighImpactA11yViolations(page, "login");

    await page.goto("/k/dna-egitim/giris");
    const tenantLoginForm = page.getByRole("form", { name: "Giriş formu" });
    await expect(tenantLoginForm.getByLabel("Kurum kodu")).toHaveCount(0);
    await expect(tenantLoginForm.getByLabel("TC kimlik no")).toBeVisible();
    await expectNoHighImpactA11yViolations(page, "tenant-login");

    await page.goto("/sistem/giris");
    const systemLoginForm = page.getByRole("form", { name: "Giriş formu" });
    await expect(systemLoginForm.getByLabel("Kurum kodu")).toHaveCount(0);
    await expect(systemLoginForm.getByLabel("TC kimlik no")).toBeVisible();
    await expectNoHighImpactA11yViolations(page, "system-login");
  });

  test("kurum dashboard shell'inde yüksek etkili axe ihlali yok", async ({ page }) => {
    await openInstitutionDashboard(page);
    await expectFirstFocusableElement(page, "İçeriğe geç");
    const skipLink = page.getByRole("link", { name: "İçeriğe geç" });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#next-content")).toBeFocused();
    await expectNoHighImpactA11yViolations(page, "kurum-dashboard");
  });

  test("kurum dashboard shell'i tablet viewport'ta taşmadan açılır", async ({ page }) => {
    await page.setViewportSize({ height: 1024, width: 768 });
    await openInstitutionDashboard(page);
    await expectNoHorizontalOverflow(page, "kurum-dashboard-tablet");
    await expectNoHighImpactA11yViolations(page, "kurum-dashboard-tablet");
  });

  test("kurum dashboard gövdesi mobil viewport'ta taşmadan açılır", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openInstitutionDashboard(page, { expectNavigationVisible: false });
    const overviewRegion = page.getByRole("region", { exact: true, name: "Kurum özeti" });
    await expect(overviewRegion).toBeVisible();
    await expect(overviewRegion).toHaveClass(/uh-metric-grid/);
    await expect(overviewRegion.locator(".uh-metric-card")).toHaveCount(4);
    const dashboardSummary = page.getByRole("region", { exact: true, name: "Kurum dashboard operasyon özeti" });
    await expect(dashboardSummary).toBeVisible();
    const dashboardSummaryMetrics = dashboardSummary.getByRole("group", { name: "Kurum dashboard operasyon özeti metrikleri" });
    await expect(dashboardSummaryMetrics).toHaveClass(/uh-metric-grid/);
    await expect(dashboardSummaryMetrics.locator(".uh-metric-card")).toHaveCount(4);
    await expect(page.getByRole("region", { exact: true, name: "Operasyon özeti" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Karar sinyalleri" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "kurum-dashboard-mobile-body");
    await expectNoHighImpactA11yViolations(page, "kurum-dashboard-mobile-body");
  });

  test("shell komut paleti yüksek etkili axe ihlali olmadan klavye akışını korur", async ({ page }) => {
    await openInstitutionDashboard(page);

    const commandTrigger = page.getByRole("button", { name: "Komut paleti" }).first();
    await commandTrigger.click();
    const commandDialog = page.getByRole("dialog", { name: "Komut paleti" });
    await expect(commandDialog).toBeVisible();
    await expect(commandDialog.getByLabel("Komut ara")).toBeFocused();
    await expectNoHighImpactA11yViolations(page, "kurum-command-palette");
    await page.keyboard.press("Escape");
    await expect(commandDialog).toHaveCount(0);
  });

  test("mobil ana menü yüksek etkili axe ihlali olmadan açılıp kapanır", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openInstitutionDashboard(page, { expectNavigationVisible: false });
    await page.getByRole("button", { name: "Ana menüyü aç" }).click();
    await expect(page.getByRole("navigation", { name: "Ana menü" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ana menüyü kapat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menü arka planını kapat" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "kurum-mobile-menu");
    await expectNoHighImpactA11yViolations(page, "kurum-mobile-menu");
    await page.getByRole("button", { name: "Ana menüyü kapat" }).click();
    await expect(page.getByRole("button", { name: "Ana menüyü aç" })).toHaveAttribute("aria-expanded", "false");
  });
});

const blockedA11yImpacts = new Set(["critical", "serious"]);

async function expectNoHighImpactA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const highImpactViolations = (results.violations as AxeViolationSummary[]).filter(
    (violation) => violation.impact != null && blockedA11yImpacts.has(violation.impact),
  );

  expect(highImpactViolations, formatViolations(label, highImpactViolations)).toEqual([]);
}

function formatViolations(label: string, violations: AxeViolationSummary[]) {
  if (violations.length === 0) return `${label}: yüksek etkili axe ihlali yok`;

  return [
    `${label}: ${violations.length} yüksek etkili axe ihlali bulundu`,
    ...violations.map((violation) => `- ${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`),
  ].join("\n");
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return Math.max(documentElement.scrollWidth - documentElement.clientWidth, body.scrollWidth - body.clientWidth);
  });

  expect(overflow, `${label}: yatay taşma ${overflow}px`).toBeLessThanOrEqual(1);
}

async function expectFirstFocusableElement(page: Page, expectedText: string) {
  const firstFocusableText = await page.evaluate(() => {
    const focusableElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden");

    return focusableElements[0]?.textContent?.trim() ?? "";
  });

  expect(firstFocusableText).toBe(expectedText);
}

async function openInstitutionDashboard(page: Page, options: { expectNavigationVisible?: boolean } = {}) {
  await installInstitutionApiMocks(page);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);

  await page.goto("/kurum");
  await expect(page.getByRole("heading", { level: 1, name: "A11y Akademi" })).toBeVisible();
  if (options.expectNavigationVisible !== false) {
    await expect(page.getByRole("navigation", { name: "Ana menü" })).toBeVisible();
  }
}

async function installInstitutionApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");

    if (path === "/auth/refresh") {
      await fulfillData(route, createAuthResponse());
      return;
    }

    const response = mockApiResponse(path);
    await fulfillData(route, response.data, response.meta);
  });
}

function createAuthResponse() {
  return {
    accessToken: "a11y-access-token",
    session: {
      id: "session-a11y",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-a11y",
      userId: "user-a11y-admin",
    },
  };
}

function mockApiResponse(path: string): { data: unknown; meta?: { limit: number; page: number; total: number; totalPages: number } } {
  if (path === "/me/tenant") {
    return {
      data: {
        contactEmail: "bilgi@a11y-akademi.example",
        id: "tenant-a11y",
        institutionType: "Dershane",
        name: "A11y Akademi",
      },
    };
  }

  if (path === "/me/notification-devices") return { data: [] };
  if (path === "/classes") return { data: [] };
  if (path === "/teachers") return { data: [] };
  if (path === "/students") return { data: [] };
  if (path === "/support-tickets") return { data: [] };
  if (path === "/payment-plans") return { data: [] };
  if (path === "/attendance") return { data: [] };
  if (path === "/import-quarantines/summary") return { data: { openCount: 0 } };
  if (path === "/exams") return { data: [] };

  if (path === "/guardians" || path === "/announcements") {
    return {
      data: [],
      meta: { limit: 5, page: 1, total: 0, totalPages: 0 },
    };
  }

  return { data: [] };
}

async function fulfillData(route: Route, data: unknown, meta?: { limit: number; page: number; total: number; totalPages: number }) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
    headers: {
      ...corsHeadersFor(route),
      "content-type": "application/json",
    },
    status: 200,
  });
}

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}
