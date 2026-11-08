import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

const origin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "authorization,content-type,x-csrf-token", "access-control-allow-methods": "GET,POST,OPTIONS" };

test("mobil çalışma alanı geçişi hatası açık çekmecede görünür, kapatınca ana içerikte kalır", async ({ page }) => {
  await open(page, "TENANT_ADMIN", "/kurum", {
    "/me/profile": { activePersona: "STAFF", availablePersonas: ["STAFF", "TEACHER"] },
  });
  await page.route("**/api/v1/auth/persona/switch", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 503, headers, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Unavailable" } }) });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Ana menüyü aç" }).click();
  const drawer = page.locator("#next-sidebar");
  await drawer.getByRole("button", { name: "Öğretmen alanına geç" }).click();
  const message = "Çalışma alanı değiştirilemedi. Tekrar deneyin.";
  await expect(drawer.getByRole("alert").filter({ hasText: message })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: message })).toHaveCount(1);
  await expect(page).toHaveURL(/\/kurum$/);
  await drawer.getByRole("button", { name: "Ana menüyü kapat" }).click();
  await expect(page.getByRole("main").getByRole("alert").filter({ hasText: message })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: message })).toHaveCount(1);
});

test("mobil portal Daha fazla menüsü kapanınca odağı kendi düğmesine döndürür", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "STUDENT", "/ogrenci/duyurular");
  await page.setViewportSize({ width: 375, height: 812 });
  const more = page.getByRole("button", { name: "Daha fazla" });
  await more.click();
  await expect(page.getByRole("button", { name: "Ana menüyü kapat" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("button", { name: "Ana menüyü kapat" }).click();
  await expect(more).toBeFocused();
  expect(errors).toEqual([]);
});

test("Kampüs üst menüsü mevcut hub bağlantılarını, klavyeyi ve odak dönüşünü korur", async ({ page }) => {
  await open(page, "TENANT_ADMIN", "/kurum");
  const nav = page.locator(".next-campus-nav");
  const academic = nav.getByRole("button", { name: "Akademik" });
  await academic.focus();
  await academic.press("Enter");
  await expect(academic).toHaveAttribute("aria-expanded", "true");
  await academic.press("Tab");
  await expect(nav.getByRole("link", { name: "Sınıf yapısı", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(academic).toBeFocused();
  await expect(academic).toHaveAttribute("aria-expanded", "false");
  const displayed = await nav.locator("a").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href"), label: link.textContent })));
  const drawer = await page.locator(".next-sidebar-group-list a").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href"), label: link.textContent })));
  expect(displayed.filter((link) => link.href?.startsWith("/kurum"))).toEqual(drawer);
  await page.getByRole("button", { name: "Ana menüyü aç" }).click();
  await expect(page.getByRole("button", { name: "Ana menüyü kapat" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Ana menüyü aç" })).toBeFocused();
  await page.getByLabel("Genel arama").focus();
  await expect(page.getByRole("dialog", { name: "Komut paleti" })).toBeVisible();
});

for (const role of ["TENANT_OWNER", "TENANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF", "TEACHER", "STUDENT", "GUARDIAN"] as const) {
  test(`Kampüs ${role} menüsü yetkili görev alanından üretilir`, async ({ page }) => {
    const path = role === "TEACHER" ? "/ogretmen/duyurular" : role === "STUDENT" ? "/ogrenci/duyurular" : role === "GUARDIAN" ? "/veli/duyurular" : role === "FINANCE_STAFF" ? "/kurum/finans" : "/kurum";
    await open(page, role, path);
    const nav = page.locator(".next-campus-nav");
    await expect(nav).toBeVisible();
    await expect(nav.locator('a[href^="/sistem"]')).toHaveCount(0);
    if (role === "FINANCE_STAFF") {
      await expect(nav.getByRole("link", { name: "Ödeme planları", exact: true })).toBeVisible();
      await expect(nav.getByRole("button", { name: "Akademik" })).toHaveCount(0);
      await expect(nav.locator('a[href="/kurum/ogrenciler"]')).toHaveCount(0);
    }
    if (role === "OPERATIONS_STAFF") await expect(nav.locator('a[href="/kurum/finans"]')).toHaveCount(0);
    if (["TEACHER", "STUDENT", "GUARDIAN"].includes(role)) await expect(nav.locator('a[href^="/kurum"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page, `campus-${role}`);
  });
}

test("Kampüs açık ve koyu tema tüm hedef genişliklerde taşmaz ve erişilebilirdir", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, "TENANT_ADMIN", "/kurum");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [320, 375, 414, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectNoHorizontalOverflow(page, `campus-${theme}-${width}`);
      if (width < 1024) {
        await expect(page.locator(".next-campus-header")).toBeHidden();
        await page.getByRole("button", { name: "Ana menüyü aç" }).click();
        await expect(page.getByRole("button", { name: "Ana menüyü kapat" })).toBeFocused();
        await page.keyboard.press("Escape");
      } else await expect(page.locator(".next-campus-nav")).toBeVisible();
    }
    const result = await new AxeBuilder({ page }).include(".next-campus-header").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  }
});

test("Kampüs karma rollü öğretmen personasında öğretmen üst menüsünü korur", async ({ page }) => {
  const session = { id: "mixed-teacher-session", userId: "mixed-user", tenantId: "campus-test", roles: ["TENANT_ADMIN", "TEACHER"], activePersona: "TEACHER", subjectType: "TEACHER", subjectId: "teacher-a", status: "ACTIVE", membershipVersion: 1 };
  await open(page, "TEACHER", "/ogretmen/duyurular", {
    "/auth/refresh": { accessToken: "mixed-teacher-token", session },
    "/me/profile": { ...session, capabilities: [], availablePersonas: ["TEACHER"] },
  });
  const nav = page.locator(".next-campus-nav");
  await expect(nav.locator('a[href="/ogretmen"]')).toBeVisible();
  await expect(nav.locator('a[href="/ogretmen/duyurular"]')).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('a[href^="/kurum"]')).toHaveCount(0);
});

test("Kampüs fontu ve renkleri public, auth, sistem, karne ve baskıya taşınmaz", async ({ page }) => {
  await open(page, "TENANT_ADMIN", "/kurum");
  const fonts = await page.locator(".next-campus-shell").evaluate((shell) => {
    const style = getComputedStyle(shell);
    const report = document.createElement("section");
    report.className = "next-karne-sheet";
    shell.append(report);
    const paper = getComputedStyle(report);
    const result = { body: style.fontFamily, manrope: style.getPropertyValue("--font-manrope").split(",")[0]!.trim().replaceAll('"', ""), ibm: style.getPropertyValue("--font-ibm-plex-sans").split(",")[0]!.trim().replaceAll('"', ""), report: paper.fontFamily, accent: style.getPropertyValue("--color-accent").trim(), reportAccent: paper.getPropertyValue("--color-accent").trim() };
    report.remove();
    return result;
  });
  expect(fonts.manrope).not.toBe(fonts.ibm);
  expect(fonts.body).toContain(fonts.manrope);
  expect(fonts.report).toContain(fonts.ibm);
  expect(fonts.accent).not.toBe(fonts.reportAccent);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".next-campus-header")).toBeHidden();
  expect(await page.locator(".next-campus-shell").evaluate((element) => getComputedStyle(element).fontFamily)).toContain(fonts.ibm);
  await page.emulateMedia({ media: "screen" });
  for (const path of ["/", "/login"]) {
    await page.goto(path);
    await expect(page.locator(".next-campus-shell")).toHaveCount(0);
    expect(await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily)).toContain(fonts.ibm);
  }
  await open(page, "SYSTEM_ADMIN", "/sistem");
  await expect(page.locator(".next-campus-shell")).toHaveCount(0);
  await expect(page.locator(".next-sidebar")).toBeVisible();
});

test("Kampüs grup bağlantısında vazgeçilen gezinme odağı görünür tetikleyiciye döndürür", async ({ page }) => {
  const assessment = { id: "ga-campus", tenantId: "campus-test", classId: "class-a", courseId: "course-math", termId: "term-a", title: "1. Yazılı", kind: "WRITTEN", maxScore: 100, heldOn: "2026-11-07", createdById: "user-TENANT_ADMIN", createdAt: "2026-11-07T09:00:00Z" };
  await open(page, "TENANT_ADMIN", "/kurum/not-defteri", {
    "/grade-assessments": [assessment],
    "/grade-assessments/ga-campus": { assessment, entries: [] },
    "/classes": [{ id: "class-a", tenantId: "campus-test", name: "8-A", campusId: "campus-a", gradeLevelId: "grade-a" }],
    "/courses": [{ id: "course-math", tenantId: "campus-test", name: "Matematik", code: "MAT" }],
    "/academic-terms": [{ id: "term-a", tenantId: "campus-test", academicYearId: "year-a", name: "1. Dönem", startsAt: "2026-09-01", endsAt: "2027-01-31", isActive: true }],
    "/students": [{ id: "student-a", tenantId: "campus-test", firstName: "Ada", lastName: "Acar", classId: "class-a", status: "ACTIVE" }],
  });
  await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
  await page.getByLabel("Ada Acar notu", { exact: true }).fill("70");
  const people = page.locator(".next-campus-nav").getByRole("button", { name: "Kişiler" });
  await people.click();
  await page.locator(".next-campus-nav").getByRole("link", { name: "Öğrenciler", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Notlara dön" }).click();
  await expect(people).toBeFocused();
  await expect(people).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Ada Acar notu", { exact: true })).toHaveValue("70");
  await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
});

async function open(page: Page, role: string, path: string, extraResponses: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.unroute("**/api/v1/**");
  await page.route("**/api/v1/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const endpoint = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const subject = ["TEACHER", "STUDENT", "GUARDIAN"].includes(role) ? { subjectType: role, subjectId: `subject-${role}` } : {};
    const session = { id: `session-${role}`, userId: `user-${role}`, tenantId: "campus-test", roles: [role], status: "ACTIVE", membershipVersion: 1, activePersona: subject.subjectType ?? "STAFF", ...subject };
    const responses: Record<string, unknown> = {
      "/auth/refresh": { accessToken: "campus-test-token", session },
      "/me/profile": { ...session, capabilities: [], availablePersonas: [session.activePersona] },
      "/me/tenant": { id: "campus-test", name: "Kampüs Test Okulu", slug: "campus-test" },
      "/me/institution-dashboard": { activeStudentCount: 0, attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 }, generatedAt: "2026-11-07T09:00:00Z", institution: { name: "Kampüs Test Okulu" } },
      ...extraResponses,
    };
    return route.fulfill({ status: 200, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ data: responses[endpoint] ?? [] }) });
  });
  await page.context().addCookies([{ name: "csrfToken", value: "campus-csrf", url: origin }]);
  await page.goto(path);
  await expect(page.locator(".next-app-shell")).toBeVisible();
}
