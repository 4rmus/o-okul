import { expect, test, type Page } from "@playwright/test";

const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-origin": webOrigin,
};

test("çift personalı çalışan staff ve teacher çalışma alanları arasında ayrı session ile geçer", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  let activeSession = false;
  let persona: "STAFF" | "TEACHER" = "STAFF";
  let switchRequest: { body?: unknown; authorization?: string; csrf?: string } = {};
  await page.context().addCookies([{ name: "csrfToken", value: "csrf-a", url: webOrigin }]);

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
    await json(route, authResponse(persona));
  });
  await page.route("**/auth/login", async (route) => {
    activeSession = true;
    await json(route, authResponse("STAFF"));
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/auth/persona/switch" && request.method() === "POST") {
      switchRequest = {
        body: request.postDataJSON(),
        authorization: request.headers().authorization,
        csrf: request.headers()["x-csrf-token"],
      };
      persona = "TEACHER";
      await json(route, authResponse(persona));
      return;
    }
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }
    if (path === "/me/profile") {
      await json(route, {
        userId: "dual-user-a",
        tenantId: "tenant-a",
        membershipId: "membership-a",
        membership: { id: "membership-a", version: 3 },
        activePersona: persona,
        availablePersonas: ["STAFF", "TEACHER"],
        capabilities: [],
        roles: persona === "STAFF" ? ["TENANT_ADMIN"] : ["TEACHER"],
        ...(persona === "TEACHER" ? { subjectType: "TEACHER", subjectId: "teacher-a" } : {}),
      });
      return;
    }
    if (path === "/me/tenant") {
      await json(route, { id: "tenant-a", name: "DNA Eğitim", plan: "TRIAL", slug: "dna-egitim", status: "ACTIVE" });
      return;
    }
    if (path === "/me/feature-rollouts") {
      await json(route, { enabledFeatureKeys: [] });
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
    if (path === "/me/teacher") {
      await json(route, {
        id: "teacher-a",
        tenantId: "tenant-a",
        firstName: "Ada",
        lastName: "Yılmaz",
        branch: "Matematik",
        userId: "dual-user-a",
      });
      return;
    }
    if (path === "/me/teacher/lookups") {
      await json(route, { attendanceClassIds: [], campuses: [], classes: [], courses: [], gradeLevels: [], terms: [] });
      return;
    }
    await json(route, []);
  });

  await page.goto("/login");
  await page.locator('input[name="tenantSlug"]').fill("dna-egitim");
  await page.locator('input[name="loginName"]').fill("dual-persona");
  await page.locator('input[name="password"]').fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/kurum$/u);
  const topBar = page.locator('header[aria-label="Üst gezinme"]');
  await expect(topBar).toBeVisible({ timeout: 5_000 });
  expect(pageErrors).toEqual([]);
  await topBar.getByRole("button", { name: "Öğretmen alanına geç" }).click();
  await expect(page).toHaveURL(/\/ogretmen$/u);
  expect(switchRequest).toEqual({
    body: { activePersona: "TEACHER" },
    authorization: "Bearer staff-access-token",
    csrf: "csrf-a",
  });
  await expect(topBar.getByText("Öğretmen", { exact: true })).toBeVisible();
  await expect(topBar.getByRole("button", { name: "Kurum alanına geç" })).toBeVisible();
});

async function json(route: Parameters<Parameters<Page["route"]>[1]>[0], data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 200,
  });
}

function authResponse(activePersona: "STAFF" | "TEACHER") {
  return {
    accessToken: activePersona === "STAFF" ? "staff-access-token" : "teacher-access-token",
    session: {
      id: activePersona === "STAFF" ? "session-staff" : "session-teacher",
      membershipId: "membership-a",
      activePersona,
      membershipVersion: 3,
      roles: activePersona === "STAFF" ? ["TENANT_ADMIN"] : ["TEACHER"],
      status: "ACTIVE",
      tenantId: "tenant-a",
      userId: "dual-user-a",
      ...(activePersona === "TEACHER" ? { subjectType: "TEACHER", subjectId: "teacher-a" } : {}),
    },
  };
}
