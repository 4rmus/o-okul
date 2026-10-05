import { expect, test, type Page } from "@playwright/test";

const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-origin": webOrigin,
};

type Persona = "STAFF" | "TEACHER" | "GUARDIAN";

// KV-3b: a staff member who is also a parent keeps one account; GUARDIAN is a third persona next to STAFF/TEACHER.
for (const target of [
  { persona: "TEACHER" as const, button: "Öğretmen alanına geç", url: /\/ogretmen$/u, roleLabel: "Öğretmen" },
  { persona: "GUARDIAN" as const, button: "Veli alanına geç", url: /\/veli$/u, roleLabel: "Veli" },
]) test(`çok personalı çalışan staff ve ${target.persona} çalışma alanları arasında ayrı session ile geçer`, async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  let activeSession = false;
  let persona: Persona = "STAFF";
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
      persona = (request.postDataJSON() as { activePersona: Persona }).activePersona;
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
        availablePersonas: ["STAFF", "TEACHER", "GUARDIAN"],
        capabilities: [],
        roles: persona === "STAFF" ? ["TENANT_ADMIN"] : [persona],
        ...subjectFor(persona),
      });
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
    if (path === "/me/teacher/today") {
      await json(route, { date: "2026-08-01", generatedAt: "2026-08-01T10:00:00.000Z", latestReport: null, pendingHomework: [], pendingHomeworkCount: 0, teacherName: "Ada Yılmaz", todayLessons: [] });
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
  await expect(topBar.getByRole("button", { name: "Öğretmen alanına geç" })).toBeVisible();
  await expect(topBar.getByRole("button", { name: "Veli alanına geç" })).toBeVisible();
  await topBar.getByRole("button", { name: target.button }).click();
  await expect(page).toHaveURL(target.url);
  expect(switchRequest).toEqual({
    body: { activePersona: target.persona },
    authorization: "Bearer staff-access-token",
    csrf: "csrf-a",
  });
  await expect(topBar.getByText(target.roleLabel, { exact: true })).toBeVisible();
  await expect(topBar.getByRole("button", { name: "Kurum alanına geç" })).toBeVisible();
  await expect(topBar.getByRole("button", { name: target.button })).toHaveCount(0);
});

function subjectFor(persona: Persona) {
  if (persona === "TEACHER") return { subjectType: "TEACHER", subjectId: "teacher-a" };
  if (persona === "GUARDIAN") return { subjectType: "GUARDIAN", subjectId: "guardian-a" };
  return {};
}

async function json(route: Parameters<Parameters<Page["route"]>[1]>[0], data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 200,
  });
}

function authResponse(activePersona: Persona) {
  return {
    accessToken: `${activePersona.toLowerCase()}-access-token`,
    session: {
      id: `session-${activePersona.toLowerCase()}`,
      membershipId: "membership-a",
      activePersona,
      membershipVersion: 3,
      roles: activePersona === "STAFF" ? ["TENANT_ADMIN"] : [activePersona],
      status: "ACTIVE",
      tenantId: "tenant-a",
      userId: "dual-user-a",
      ...subjectFor(activePersona),
    },
  };
}
