import { expect, test, type Page, type Route } from "@playwright/test";

// UAT U18 (2026-11-03): öğretmen Bugün ekranında "Bekleyen iş" kartı ile "Bekleyen işler" başlığı aynı tanımdan
// sayılır; ders yokken "Yoklama al" iş olarak listelenmez.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const fixedNow = new Date("2026-06-17T08:00:00.000Z");
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token,x-role-preview-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

const baseToday = {
  date: "2026-06-17",
  generatedAt: "2026-06-17T08:00:00.000Z",
  latestReport: { examId: "exam-a", latestGeneratedAt: "2026-06-16T09:00:00.000Z", title: "LGS Denemesi" },
  pendingHomework: [],
  pendingHomeworkCount: 0,
  pendingSubmissionCount: 0,
  teacherName: "Zeynep Arslan",
  todayLessons: [],
  unpublishedGradeDraftCount: 0,
  unreadAnnouncementCount: 0,
};

test.describe("Öğretmen Bugün iş sayacı", () => {
  test("odak kartı mevcut dersi açarken eski eksik yoklama ayrı iş olarak kalır", async ({ page }) => {
    await openTeacherToday(page, { ...baseToday, todayLessons: [
      { id: "past-lesson", classId: "class-past", className: "8-A", title: "Önceki ders", startsAt: "2026-06-17T06:00:00Z", endsAt: "2026-06-17T07:00:00Z", attendanceTaken: false },
      { id: "current-lesson", classId: "class-current", className: "8-B", title: "Şimdiki ders", startsAt: "2026-06-17T07:40:00Z", endsAt: "2026-06-17T08:20:00Z", attendanceTaken: true },
    ] });
    const brief = page.getByRole("region", { exact: true, name: "Bugün" });
    await expect(brief).toContainText("Şimdiki ders");
    await expect(brief.getByRole("link", { name: "Yoklamayı gör", exact: true })).toHaveAttribute("href", "/ogretmen/ders-akisi?classId=class-current&date=2026-06-17#portal-teacher-attendance");
    await expect(page.getByRole("region", { name: "Öğretmen günlük aksiyonları" }).getByRole("link", { name: /^Yoklama al:/ })).toHaveAttribute("href", "/ogretmen/ders-akisi?classId=class-past&date=2026-06-17#portal-teacher-attendance");
  });
  test("ders yokken yoklama iş sayılmaz; kart ve başlık aynı sayıyı gösterir", async ({ page }) => {
    await openTeacherToday(page, { ...baseToday, pendingSubmissionCount: 2 });

    const brief = page.getByRole("region", { exact: true, name: "Bugün" });
    const pendingCard = brief.locator(".uh-metric-card").filter({ hasText: "Bekleyen iş" });
    await expect(pendingCard).toContainText("1 iş");
    await expect(pendingCard).toContainText("2 teslim");

    const actionStrip = page.getByRole("region", { name: "Öğretmen günlük aksiyonları" });
    await expect(actionStrip.locator(".next-portal-action-strip__summary")).toHaveAttribute("aria-label", "1 iş, 1 öncelikli");
    await expect(actionStrip.getByRole("link", { name: /^Yoklama al/ })).toHaveCount(0);
    await expect(actionStrip.getByRole("link", { name: /^Ders akışı: 0 ders/ })).toHaveAttribute("href", "/ogretmen/ders-akisi");
  });

  test("bekleyen yoklama, taslak ve ödev hem kartta hem başlıkta aynı sayılır", async ({ page }) => {
    await openTeacherToday(page, {
      ...baseToday,
      pendingHomework: [{ classId: "class-8a", dueAt: "2026-06-18T12:00:00.000Z", id: "homework-a", title: "Kesirler" }],
      pendingHomeworkCount: 1,
      todayLessons: [{
        attendanceTaken: false,
        classId: "class-8a",
        className: "8-A",
        endsAt: "2026-06-17T10:30:00.000Z",
        id: "lesson-a",
        startsAt: "2026-06-17T09:40:00.000Z",
        title: "Matematik",
      }],
      unpublishedGradeDraftCount: 1,
    });

    const brief = page.getByRole("region", { exact: true, name: "Bugün" });
    const pendingCard = brief.locator(".uh-metric-card").filter({ hasText: "Bekleyen iş" });
    await expect(pendingCard).toContainText("3 iş");
    await expect(pendingCard).toContainText("1 yoklama · 1 taslak · 1 ödev");

    const actionStrip = page.getByRole("region", { name: "Öğretmen günlük aksiyonları" });
    // Hazır rapor ve tamamlanmış kartlar bekleyen iş sayılmaz.
    await expect(actionStrip.locator(".next-portal-action-strip__summary")).toHaveAttribute("aria-label", "3 iş, 2 öncelikli");
    await expect(actionStrip.getByRole("link", { name: /^Yoklama al: 1 ders/ })).toBeVisible();
  });

  test("bekleyen iş yokken başlık ve kart Tamam der", async ({ page }) => {
    await openTeacherToday(page, {
      ...baseToday,
      todayLessons: [{
        attendanceTaken: true,
        classId: "class-8a",
        className: "8-A",
        endsAt: "2026-06-17T10:30:00.000Z",
        id: "lesson-a",
        startsAt: "2026-06-17T09:40:00.000Z",
        title: "Matematik",
      }],
    });

    const brief = page.getByRole("region", { exact: true, name: "Bugün" });
    await expect(brief.locator(".uh-metric-card").filter({ hasText: "Bekleyen iş" })).toContainText("Bekleyen iş yok");
    const actionStrip = page.getByRole("region", { name: "Öğretmen günlük aksiyonları" });
    await expect(actionStrip.locator(".next-portal-action-strip__summary")).toHaveAttribute("aria-label", "Bekleyen iş yok, 0 öncelikli");
  });
});

async function openTeacherToday(page: Page, today: unknown) {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.clock.setFixedTime(fixedNow);
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    const pathName = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    if (pathName === "/auth/refresh") return fulfillData(route, authResponse());
    if (pathName === "/me/tenant") return fulfillData(route, { id: "tenant-today", institutionType: "Okul", name: "Bugün Koleji" });
    if (pathName === "/me/teacher/today") return fulfillData(route, today);
    if (pathName === "/me/teacher") return fulfillData(route, { branch: "Matematik", firstName: "Zeynep", id: "teacher-math", lastName: "Arslan", tenantId: "tenant-today" });
    return fulfillData(route, []);
  });
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/ogretmen");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
}

function authResponse() {
  return {
    accessToken: "teacher-today-counts-token",
    session: {
      id: "session-teacher-math",
      membershipVersion: 1,
      roles: ["TEACHER"],
      status: "ACTIVE",
      subjectId: "teacher-math",
      subjectType: "TEACHER",
      tenantId: "tenant-today",
      userId: "teacher-math",
    },
  };
}

async function fulfillData(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    headers: { ...corsHeaders, "content-type": "application/json" },
    status: 200,
  });
}
