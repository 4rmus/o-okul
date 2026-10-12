import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { ClassRecord, CourseRecord, GradeLevelCourseRecord, GradeLevelRecord, TeacherRecord } from "@o-okul/shared-types";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

// UAT F-10 (assignment errors visible in the teacher dialog) and F-11 (link a course to a level from Seviyeler).
const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "GET,PATCH,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-origin": webOrigin,
};
const viewports = [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 720 }];

interface MockState {
  assignmentError?: { code: string; status: number };
  assignmentPosts: Array<Record<string, unknown>>;
  links: GradeLevelCourseRecord[];
  puts: string[];
  roles: string[];
}

function mockState(overrides: Partial<MockState> = {}): MockState {
  return { assignmentPosts: [], links: [link("level-5", course("course-mat", "Matematik"))], puts: [], roles: ["TENANT_ADMIN"], ...overrides };
}

for (const viewport of viewports) {
  test(`F-10 seviye uyuşmazlığı atama penceresinde Seviyeler bağlantısıyla görünür (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const state = mockState({ assignmentError: { code: "TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH", status: 400 } });
    const dialog = await openAssignmentDialog(page, state);
    await dialog.getByLabel("Atama sınıfı").selectOption("class-5a");
    await dialog.getByLabel("Atama branşı").selectOption("course-fen");
    await dialog.getByRole("button", { name: "Atama ekle" }).click();

    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("Bu ders bu sınıfın seviyesine bağlı değil. Seviyeler ekranından dersi seviyeye bağlayın.");
    await expect(alert.getByRole("link", { name: "Seviyeler ekranına git" })).toHaveAttribute("href", "/kurum/seviyeler");
    expect(state.assignmentPosts).toEqual([{ role: "CLASS_TEACHER", classId: "class-5a", courseId: "course-fen" }]);
    await expectNoHorizontalOverflow(page, `assignment error ${viewport.width}`);
  });
}

for (const [code, status, message] of [
  ["TEACHER_ASSIGNMENT_TARGET_REQUIRED", 400, "Atama için sınıf veya öğrenci seçilmelidir."],
  ["CLASS_NOT_FOUND", 404, "Seçilen sınıf bulunamadı. Sayfayı yenileyip yeniden seçin."],
  ["COURSE_NOT_FOUND", 404, "Seçilen ders bulunamadı. Sayfayı yenileyip yeniden seçin."],
  ["TEACHER_ASSIGNMENT_ENDS_AT_INVALID", 400, "Bitiş tarihi geçersiz."],
  ["UNEXPECTED_FAILURE", 500, "Atama kaydedilemedi. Bilgileri kontrol edip tekrar deneyin."],
] as const) {
  test(`F-10 atama hatası ${code} pencerede kısa Türkçe mesaja çevrilir`, async ({ page }) => {
    const state = mockState({ assignmentError: { code, status } });
    const dialog = await openAssignmentDialog(page, state);
    await dialog.getByLabel("Atama sınıfı").selectOption("class-5a");
    await dialog.getByRole("button", { name: "Atama ekle" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(message);
    await expect(dialog.getByRole("link", { name: "Seviyeler ekranına git" })).toHaveCount(0);
  });
}

test("F-10 istemci doğrulaması da pencerede görünür ve istek gönderilmez", async ({ page }) => {
  const state = mockState();
  const dialog = await openAssignmentDialog(page, state);
  await dialog.getByRole("button", { name: "Atama ekle" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Atama için sınıf veya öğrenci seçilmelidir.");
  expect(state.assignmentPosts).toHaveLength(0);
});

for (const viewport of viewports) {
  test(`F-11 Seviyeler ekranından mevcut ders seviyeye bağlanır (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const state = mockState();
    await openGradeLevels(page, state);
    await page.getByRole("button", { name: "5. Sınıf derslerini yönet" }).click();

    const dialog = page.getByRole("dialog", { name: "5. Sınıf dersleri" });
    const linked = dialog.getByRole("region", { name: "Bağlı dersler" });
    await expect(linked.getByRole("listitem")).toHaveText(["Matematik"]);
    const select = dialog.getByLabel("Bağlanacak ders");
    await expect(select.locator("option")).toHaveText(["Ders seçin", "Fen Bilimleri"]);
    await expectNoHorizontalOverflow(page, `grade level courses ${viewport.width}`);
    if (viewport.width === 1280) expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);

    await select.selectOption("course-fen");
    await dialog.getByRole("button", { name: "Dersi bağla" }).click();
    await expect.poll(() => state.puts).toEqual(["level-5/course-fen"]);
    await expect(linked.getByRole("listitem")).toHaveText(["Matematik", "Fen Bilimleri"]);
    await expect(select.locator("option")).toHaveText(["Ders seçin"]);
  });
}

test("F-11 bağlama hatası pencerede görünür", async ({ page }) => {
  const state = mockState();
  await openGradeLevels(page, state, { failPut: true });
  await page.getByRole("button", { name: "5. Sınıf derslerini yönet" }).click();
  const dialog = page.getByRole("dialog", { name: "5. Sınıf dersleri" });
  await dialog.getByLabel("Bağlanacak ders").selectOption("course-fen");
  await dialog.getByRole("button", { name: "Dersi bağla" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Ders seviyeye bağlanamadı. Tekrar deneyin.");
});

test("F-11 akademik yönetim yetkisi olmayan rol ders bağlama denetimini görmez", async ({ page }) => {
  const state = mockState({ roles: ["TEACHER"] });
  await openGradeLevels(page, state);
  await expect(page).not.toHaveURL(/\/kurum\/seviyeler/u);
  await expect(page.getByRole("button", { name: /derslerini yönet/u })).toHaveCount(0);
  expect(state.puts).toHaveLength(0);
});

async function openAssignmentDialog(page: Page, state: MockState) {
  await installRoutes(page, state);
  await page.goto("/kurum/ogretmenler");
  await page.getByRole("button", { name: "Ayşe düzenle" }).click();
  const dialog = page.getByRole("dialog", { name: "Öğretmen düzenle" });
  await expect(dialog.getByLabel("Atama sınıfı").locator("option")).toHaveCount(2);
  return dialog;
}

async function openGradeLevels(page: Page, state: MockState, options: { failPut?: boolean } = {}) {
  await installRoutes(page, state, options);
  await page.goto("/kurum/seviyeler");
}

async function installRoutes(page: Page, state: MockState, options: { failPut?: boolean } = {}) {
  const courses = [course("course-mat", "Matematik"), course("course-fen", "Fen Bilimleri")];
  const gradeLevels: GradeLevelRecord[] = [{ id: "level-5", tenantId: "tenant-a", name: "5. Sınıf", code: "5" }];
  const classes = [{ id: "class-5a", tenantId: "tenant-a", name: "5-A", gradeLevelId: "level-5" } as ClassRecord];
  const teachers: TeacherRecord[] = [{ id: "teacher-a", tenantId: "tenant-a", firstName: "Ayşe", lastName: "Demir", branch: "Fen", hasAccount: false }];

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    await route.continue();
  });
  await page.route("**/auth/refresh", async (route) => {
    await json(route, {
      accessToken: "next-access-token",
      session: { id: "session-a", membershipVersion: 1, roles: state.roles, status: "ACTIVE", tenantId: "tenant-a", userId: "user-admin-a" },
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }
    if (path === "/teachers" && method === "GET") return json(route, teachers, { limit: 20, page: 1, total: 1, totalPages: 1 });
    if (path === "/teachers/teacher-a/assignments" && method === "POST") {
      state.assignmentPosts.push(request.postDataJSON() as Record<string, unknown>);
      const failure = state.assignmentError;
      if (failure) {
        await route.fulfill({ body: JSON.stringify({ error: { code: failure.code } }), contentType: "application/json", headers: corsHeaders, status: failure.status });
        return;
      }
      return json(route, {});
    }
    if (path === "/classes") return json(route, classes);
    if (path === "/courses") return json(route, courses);
    if (path === "/grade-levels" && method === "GET") return json(route, gradeLevels, { limit: 20, page: 1, total: 1, totalPages: 1 });
    const levelCourses = /^\/grade-levels\/([^/]+)\/courses$/u.exec(path);
    if (levelCourses && method === "GET") return json(route, state.links.filter((record) => record.gradeLevelId === levelCourses[1]));
    const levelCourse = /^\/grade-levels\/([^/]+)\/courses\/([^/]+)$/u.exec(path);
    if (levelCourse && method === "PUT") {
      state.puts.push(`${levelCourse[1]}/${levelCourse[2]}`);
      if (options.failPut) {
        await route.fulfill({ body: JSON.stringify({ error: { code: "COURSE_NOT_FOUND" } }), contentType: "application/json", headers: corsHeaders, status: 404 });
        return;
      }
      const linkedCourse = courses.find((candidate) => candidate.id === levelCourse[2])!;
      state.links = [...state.links, link(levelCourse[1]!, linkedCourse)];
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    if (path === "/me/tenant") return json(route, { id: "tenant-a", name: "DNA Eğitim", plan: "TRIAL", slug: "dna-egitim", status: "ACTIVE" });
    return json(route, []);
  });

  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: webOrigin, value: "csrf-token" }]);
}

async function json(route: Route, data: unknown, meta?: Record<string, unknown>) {
  await route.fulfill({
    body: JSON.stringify({ data, ...(meta ? { meta } : {}) }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 200,
  });
}

function course(id: string, name: string): CourseRecord {
  return { id, tenantId: "tenant-a", name } as CourseRecord;
}

function link(gradeLevelId: string, linkedCourse: CourseRecord): GradeLevelCourseRecord {
  return {
    id: `${gradeLevelId}-${linkedCourse.id}`,
    tenantId: "tenant-a",
    gradeLevelId,
    courseId: linkedCourse.id,
    isDefault: true,
    sortOrder: 0,
    courseName: linkedCourse.name,
  };
}
