import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": "http://localhost:3001",
};

interface AxeViolationSummary {
  help: string;
  id: string;
  impact?: string | null;
  nodes: Array<{ target: string[] }>;
}

test.describe("Next erişilebilirlik smoke", () => {
  test("public landing ve login sayfalarında kritik axe ihlali yok", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Uzman Hocam" })).toBeVisible();
    await expectNoCriticalA11yViolations(page, "landing");

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Giriş" })).toBeVisible();
    await expectNoCriticalA11yViolations(page, "login");
  });

  test("kurum dashboard shell'inde kritik axe ihlali yok", async ({ page }) => {
    await openInstitutionDashboard(page);
    await expectNoCriticalA11yViolations(page, "kurum-dashboard");
  });

  test("kurum dashboard shell'i tablet viewport'ta taşmadan açılır", async ({ page }) => {
    await page.setViewportSize({ height: 1024, width: 768 });
    await openInstitutionDashboard(page);
    await expectNoHorizontalOverflow(page, "kurum-dashboard-tablet");
    await expectNoCriticalA11yViolations(page, "kurum-dashboard-tablet");
  });
});

async function expectNoCriticalA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const criticalViolations = (results.violations as AxeViolationSummary[]).filter((violation) => violation.impact === "critical");

  expect(criticalViolations, formatViolations(label, criticalViolations)).toEqual([]);
}

function formatViolations(label: string, violations: AxeViolationSummary[]) {
  if (violations.length === 0) return `${label}: kritik axe ihlali yok`;

  return [
    `${label}: ${violations.length} kritik axe ihlali bulundu`,
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

async function openInstitutionDashboard(page: Page) {
  await installInstitutionApiMocks(page);
  await page.context().addCookies([{ name: "csrfToken", url: "http://localhost:3001", value: "csrf-token" }]);

  await page.goto("/kurum");
  await expect(page.getByRole("heading", { level: 1, name: "A11y Akademi" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Ana menü" })).toBeVisible();
}

async function installInstitutionApiMocks(page: Page) {
  await page.route("http://localhost:3100/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
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
      ...corsHeaders,
      "content-type": "application/json",
    },
    status: 200,
  });
}
