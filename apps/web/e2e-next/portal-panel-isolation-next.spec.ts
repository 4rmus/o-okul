import { expect, test, type Page, type Route } from "@playwright/test";

// Portal sayfaları panel başına yüklenir: bir panelin GET'i düşerse sayfanın geri kalanı çizilir ve
// o panelin "Tekrar dene"si yalnız kendi isteğini yeniler; diğer paneller yeniden istenmez.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const fixedNow = new Date("2026-06-17T08:00:00.000Z");
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token,x-role-preview-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

type SubjectType = "GUARDIAN" | "STUDENT" | "TEACHER";

interface PortalMock {
  failures: Set<string>;
  requests: string[];
}

test.describe("Portal panel yalıtımı", () => {
  test("öğrenci: düşen duyuru paneli tek başına hata verir, Tekrar dene yalnız onu ister", async ({ page }) => {
    const mock = await openPortal(page, "STUDENT", "/ogrenci", studentResponse, ["/me/student/announcements"]);

    await expect(page.getByRole("heading", { level: 1, name: "Öğrenci Portalı" })).toBeVisible();
    const brief = page.getByRole("region", { exact: true, name: "Günlük durum" });
    await expect(brief).toContainText("1 ödev");
    await expect(page.getByRole("region", { name: "Öğrenci günlük aksiyonları" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Ödevlerim" })).toContainText("Kesirler");

    const announcements = page.getByRole("region", { exact: true, name: "Duyurular" });
    await expect(announcements.getByRole("alert")).toContainText("Duyurular şu an alınamadı");
    const before = countRequests(mock);

    mock.failures.clear();
    await announcements.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(announcements.getByRole("alert")).toHaveCount(0);
    await expect(announcements).toContainText("Veli toplantısı");
    await expect.poll(() => countRequests(mock)["/me/student/announcements"]).toBe((before["/me/student/announcements"] ?? 0) + 1);
    const after = countRequests(mock);
    for (const path of ["/me/student/homework", "/me/student/homework/material-assignments", "/me/student/overview", "/me/student/reports", "/me/student/profile"]) {
      expect(after[path], `${path} yeniden istenmemeli`).toBe(before[path]);
    }
  });

  test("veli: düşen ödev paneli tek başına hata verir, özet ve diğer paneller yerinde kalır", async ({ page }) => {
    // DEC-20261103-01: ödev paneli iki kaynaktan okur; ikisi de düşünce tek hata paneli görünür.
    const homeworkPath = "/me/guardian/students/student-a/homework/material-assignments";
    const classHomeworkPath = "/me/guardian/students/student-a/homework";
    const mock = await openPortal(page, "GUARDIAN", "/veli", guardianResponse, [homeworkPath, classHomeworkPath]);

    await expect(page.getByRole("heading", { level: 1, name: "Veli Portalı" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Günlük durum" })).toContainText("Ada Kaya");
    await expect(page.getByRole("region", { name: "Veli günlük aksiyonları" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Duyurular" })).toContainText("Veli toplantısı");

    const homework = page.getByRole("region", { exact: true, name: "Ödevler" });
    await expect(homework.getByRole("alert")).toContainText("Ödevler şu an alınamadı");
    const before = countRequests(mock);

    mock.failures.clear();
    await homework.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(homework.getByRole("alert")).toHaveCount(0);
    await expect(homework).toContainText("Problemler föyü");
    await expect(homework).toContainText("Kesirler sınıf ödevi");
    await expect.poll(() => countRequests(mock)[homeworkPath]).toBe((before[homeworkPath] ?? 0) + 1);
    await expect.poll(() => countRequests(mock)[classHomeworkPath]).toBe((before[classHomeworkPath] ?? 0) + 1);
    const after = countRequests(mock);
    for (const path of [
      "/me/guardian/students",
      "/me/guardian/students/student-a/announcements",
      "/me/guardian/students/student-a/notification-preferences",
      "/me/guardian/students/student-a/profile",
      "/me/guardian/students/student-a/reports",
    ]) {
      expect(after[path], `${path} yeniden istenmemeli`).toBe(before[path]);
    }
    // Finans izni kapalıyken ödeme planı hiç istenmez.
    expect(after["/me/guardian/students/student-a/payment-plans"]).toBeUndefined();
  });

  test("veli: yalnız sınıf ödevi düşerse materyal atamaları görünür, eksik kaynak yazılır", async ({ page }) => {
    const classHomeworkPath = "/me/guardian/students/student-a/homework";
    const mock = await openPortal(page, "GUARDIAN", "/veli/odevler", guardianResponse, [classHomeworkPath]);

    const homework = page.getByRole("region", { exact: true, name: "Ödevler" });
    await expect(homework.getByRole("alert")).toContainText("Sınıf ödevleri şu an alınamadı; liste eksik olabilir.");
    await expect(homework).toContainText("Problemler föyü");
    const before = countRequests(mock);

    mock.failures.clear();
    await homework.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(homework.getByRole("alert")).toHaveCount(0);
    await expect(homework).toContainText("Kesirler sınıf ödevi");
    await expect.poll(() => countRequests(mock)[classHomeworkPath]).toBe((before[classHomeworkPath] ?? 0) + 1);
    expect(countRequests(mock)["/me/guardian/students/student-a/homework/material-assignments"]).toBe(before["/me/guardian/students/student-a/homework/material-assignments"]);
  });

  test("veli: bir ödev kaynağı düşünce özet sayaçları kesin ve başarılı sayı göstermez", async ({ page }) => {
    const classHomeworkPath = "/me/guardian/students/student-a/homework";
    await openPortal(page, "GUARDIAN", "/veli", guardianResponse, [classHomeworkPath]);

    // Only the material assignment (1) arrived: the count is a lower bound in a warning tone, never "Tamam".
    const actions = page.getByRole("region", { name: "Veli günlük aksiyonları" });
    const homeworkAction = actions.getByRole("link", { name: /Ödevi kontrol et: en az 1 açık ödev/ });
    await expect(homeworkAction).toHaveAttribute("aria-label", /Eksik/);
    await expect(homeworkAction).not.toHaveAttribute("aria-label", /Tamam/);
    await expect(page.getByRole("region", { exact: true, name: "Günlük durum" })).toContainText("en az 1 açık ödev");
    const metric = page.getByRole("region", { exact: true, name: "Portal özeti" }).locator(".uh-metric-card").filter({ hasText: "Açık ödev" });
    await expect(metric).toContainText("en az 1");
    await expect(metric).toHaveClass(/uh-metric-card--warning/);
    await expect(metric).not.toHaveClass(/uh-metric-card--success/);
  });

  test("öğretmen: düşen program bölümü tek başına hata verir, Tekrar dene yalnız programı ister", async ({ page }) => {
    const mock = await openPortal(page, "TEACHER", "/ogretmen/ders-akisi", teacherResponse, ["/me/teacher/schedule"]);

    await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Öğretmen profil özeti" })).toContainText("Zeynep Arslan");
    const today = page.getByRole("region", { exact: true, name: "Bugünkü dersler" });
    const schedule = page.getByRole("region", { exact: true, name: "Ders programı" });
    for (const region of [today, schedule]) {
      await expect(region.getByRole("alert")).toContainText("Bu bölüm yüklenemedi");
    }
    const before = countRequests(mock);

    mock.failures.clear();
    await today.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByText("Bu bölüm yüklenemedi")).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Ders programı" })).toContainText("Matematik dersi");
    await expect.poll(() => countRequests(mock)["/me/teacher/schedule"]).toBe((before["/me/teacher/schedule"] ?? 0) + 1);
    const after = countRequests(mock);
    for (const path of ["/me/teacher", "/me/teacher/students", "/me/teacher/lookups"]) {
      expect(after[path], `${path} yeniden istenmemeli`).toBe(before[path]);
    }
  });
});

function countRequests(mock: PortalMock): Record<string, number> {
  return mock.requests.reduce<Record<string, number>>((counts, path) => ({ ...counts, [path]: (counts[path] ?? 0) + 1 }), {});
}

async function openPortal(
  page: Page,
  subjectType: SubjectType,
  path: string,
  respond: (pathName: string) => unknown,
  failures: string[],
): Promise<PortalMock> {
  const mock: PortalMock = { failures: new Set(failures), requests: [] };
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.clock.setFixedTime(fixedNow);
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    const pathName = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    if (route.request().method() === "GET") mock.requests.push(pathName);
    if (mock.failures.has(pathName)) {
      await route.fulfill({ body: JSON.stringify({ code: "INTERNAL_ERROR" }), headers: { ...corsHeaders, "content-type": "application/json" }, status: 500 });
      return;
    }
    const data = pathName === "/auth/refresh" ? authResponse(subjectType) : pathName === "/me/tenant" ? tenantResponse() : respond(pathName);
    await fulfillData(route, data);
  });
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  return mock;
}

function authResponse(subjectType: SubjectType) {
  const subjectId = subjectType === "STUDENT" ? "student-a" : subjectType === "GUARDIAN" ? "guardian-a" : "teacher-math";
  return {
    accessToken: `panel-isolation-${subjectType.toLowerCase()}-token`,
    session: {
      id: `session-${subjectId}`,
      membershipVersion: 1,
      roles: [subjectType],
      status: "ACTIVE",
      subjectId,
      subjectType,
      tenantId: "tenant-panel",
      userId: subjectId,
    },
  };
}

function tenantResponse() {
  return { id: "tenant-panel", institutionType: "Okul", name: "Panel Koleji" };
}

const announcement = {
  audience: "ALL",
  body: "Cuma 17.00",
  id: "announcement-a",
  publishedAt: "2026-06-16T09:00:00.000Z",
  tenantId: "tenant-panel",
  title: "Veli toplantısı",
};

const profile = { className: "8-A", firstName: "Ada", gradeLevelName: "8. Sınıf", id: "student-a", lastName: "Kaya", section: "A", status: "ACTIVE", tenantId: "tenant-panel" };

function studentResponse(pathName: string): unknown {
  if (pathName === "/me/student/profile") return profile;
  if (pathName === "/me/student/announcements") return [announcement];
  if (pathName === "/me/student/homework") {
    return [{ classId: "class-8a", description: "Sayfa 42", dueAt: "2026-06-17T12:00:00.000Z", id: "homework-today", submission: { homeworkId: "homework-today", status: "NOT_SUBMITTED", studentId: "student-a" }, title: "Kesirler" }];
  }
  if (pathName === "/me/student/overview") return { examSeries: [], schoolGrades: [] };
  return [];
}

function guardianResponse(pathName: string): unknown {
  if (pathName === "/me/guardian/students") return [{ firstName: "Ada", id: "student-a", lastName: "Kaya", status: "ACTIVE", tenantId: "tenant-panel" }];
  const prefix = "/me/guardian/students/student-a";
  if (pathName === `${prefix}/notification-preferences`) {
    return {
      canOpenSupportTickets: true,
      canReceiveAnnouncements: true,
      canReceiveAutoNotifications: true,
      canReceiveSms: true,
      canViewFinance: false,
      guardianId: "guardian-a",
      id: "guardian-link-a",
      studentId: "student-a",
      tenantId: "tenant-panel",
    };
  }
  if (pathName === `${prefix}/profile`) return profile;
  if (pathName === `${prefix}/announcements`) return [announcement];
  if (pathName === `${prefix}/homework/material-assignments`) {
    return [{ createdAt: "2026-06-10T09:00:00.000Z", id: "assignment-a", materialId: "material-a", materialTitle: "Problemler föyü", studentId: "student-a", tenantId: "tenant-panel" }];
  }
  if (pathName === `${prefix}/homework`) {
    return [{ classId: "class-8a", dueAt: "2026-06-20T12:00:00.000Z", id: "homework-class-a", submission: { homeworkId: "homework-class-a", status: "NOT_SUBMITTED", studentId: "student-a" }, title: "Kesirler sınıf ödevi" }];
  }
  if (pathName === `${prefix}/attendance/summary`) return { absent: 0, excused: 0, late: 0, present: 10, studentId: "student-a", total: 10 };
  if (pathName === `${prefix}/overview`) return { examSeries: [], schoolGrades: [] };
  return [];
}

function teacherResponse(pathName: string): unknown {
  if (pathName === "/me/teacher") return { branch: "Matematik", firstName: "Zeynep", id: "teacher-math", lastName: "Arslan", tenantId: "tenant-panel" };
  if (pathName === "/me/teacher/schedule") {
    return [{ classId: "class-8a", endsAt: "2026-06-17T09:40:00.000Z", id: "lesson-a", startsAt: "2026-06-17T09:00:00.000Z", teacherId: "teacher-math", tenantId: "tenant-panel", title: "Matematik dersi" }];
  }
  if (pathName === "/me/teacher/lookups") {
    return {
      attendanceClassIds: ["class-8a"],
      campuses: [],
      classes: [{ id: "class-8a", name: "8-A", tenantId: "tenant-panel" }],
      courses: [],
      gradeLevels: [],
      terms: [],
    };
  }
  if (pathName === "/attendance/daily") return { records: [], students: [] };
  return [];
}

async function fulfillData(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    headers: { ...corsHeaders, "content-type": "application/json" },
    status: 200,
  });
}
