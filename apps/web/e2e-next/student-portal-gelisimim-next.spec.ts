import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

// S1: öğrenci Özet'i Gelişimim serilerini, tek Ödevlerim akışını ve panel bazlı yükleme hatalarını gösterir.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
// Çarşamba 2026-06-17 11:00 İstanbul: "Bu hafta" pazar 2026-06-21'e kadar sürer.
const fixedNow = new Date("2026-06-17T08:00:00.000Z");
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token,x-role-preview-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};
const rawInternalValues = ["student-a", "homework-overdue", "assignment-week", "material-a", "course-math", "term-2026", "snapshot-1", "assessment-a"];

type Failures = Set<string>;

test.describe("Öğrenci Gelişimim ve Ödevlerim (S1)", () => {
  test("Özet bugün teslimi iki kaynaktan sayar, Gelişimim serilerini ayrı ölçekle gösterir", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentPortal(page, "/ogrenci", { requestedPaths });

    const brief = page.getByRole("region", { exact: true, name: "Günlük durum" });
    const dueToday = brief.getByRole("group", { exact: true, name: "Günlük durum özeti" });
    // Bugün: teslim edilmemiş sınıf ödevi + materyal ataması; teslim edilmiş sınıf ödevi sayılmaz.
    await expect(dueToday).toContainText("2 ödev");
    await expect(dueToday).toContainText("6 atama içinde");
    const actions = page.getByRole("region", { name: "Öğrenci günlük aksiyonları" });
    await expect(actions.getByRole("link", { name: /Ödevi aç: 6 atama/ })).toHaveAttribute("href", "/ogrenci/odevler");

    const feed = page.getByRole("region", { exact: true, name: "Ödevlerim" });
    await expect(feed.getByRole("table", { name: "Gecikmiş" })).toContainText("Denklemler");
    const todayTable = feed.getByRole("table", { name: "Bugün" });
    await expect(todayTable).toContainText("Kesirler");
    await expect(todayTable).toContainText("Sayfa 42");
    await expect(todayTable).toContainText("Problemler föyü");
    await expect(todayTable).toContainText("Matematik / 2026 Bahar");
    await expect(feed.getByRole("table", { name: "Bu hafta" })).toHaveCount(0);
    await expect(feed.getByRole("table", { name: "Teslim edilenler" })).toHaveCount(0);
    await expect(feed.getByRole("link", { name: "Tümünü aç (6)" })).toHaveAttribute("href", "/ogrenci/odevler");
    await expect(feed).not.toContainText("Teslim edilen tekrar");

    const gelisimim = page.getByRole("region", { exact: true, name: "Gelişimim" });
    await expect(gelisimim.getByRole("heading", { name: "Gelişimim" })).toBeVisible();
    const examTable = gelisimim.getByRole("table", { name: "Deneme sınavları: Başarı %" });
    await expect(examTable).toContainText("%72,5");
    await expect(examTable).toContainText("%81,7");
    await expect(examTable).toContainText("24,5 / 30");
    // L8: the row is dated by the exam (5 May), not by the report generation (20 May), and carries the exam title.
    // tr-TR short date is d.MM.y, so 5 May renders as "5.05.2026" (no leading zero on the day).
    await expect(examTable).toContainText(/(?<!\d)5\.05\.2026/);
    await expect(examTable).toContainText("LGS Deneme 1");
    await expect(examTable).not.toContainText("20.05.2026");
    await expect(examTable).toContainText("17.06.2026");
    const gradeTable = gelisimim.getByRole("table", { name: "Okul notları: puan / tam puan" });
    await expect(gradeTable).toContainText("42 / 50");
    await expect(gradeTable).toContainText("Girmedi");
    await expect(gradeTable).toContainText("Matematik");
    // KV-4: okul notu Başarı % ölçeğine çevrilmez.
    await expect(gradeTable).not.toContainText("%84");

    for (const value of rawInternalValues) {
      await expect(page.getByRole("main")).not.toContainText(value);
    }
    expect(requestedPaths).toContain("/me/student/overview");
    expect(requestedPaths).toContain("/me/student/homework");
    expect(requestedPaths.filter((path) => path === "/students" || path.startsWith("/students/") || path.startsWith("/me/guardian"))).toEqual([]);
    await expectNoHorizontalOverflow(page, "student-gelisimim-overview");
  });

  test("Ödevler sayfası açık işleri Gecikmiş / Bugün / Bu hafta / Sonra gruplarında, teslim edilenleri ayrı gösterir", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentPortal(page, "/ogrenci/odevler", { requestedPaths });

    const feed = page.getByRole("region", { exact: true, name: "Ödevlerim" });
    await expect(feed.getByRole("table")).toHaveCount(5);
    await expect(feed.getByRole("table", { name: "Gecikmiş" })).toContainText("Denklemler");
    await expect(feed.getByRole("table", { name: "Bugün" })).toContainText("Kesirler");
    await expect(feed.getByRole("table", { name: "Bu hafta" })).toContainText("Hafta sonu tekrarı");
    const later = feed.getByRole("table", { name: "Sonra" });
    await expect(later).toContainText("Ay sonu deneme föyü");
    await expect(later).toContainText("Tarihsiz okuma");
    await expect(feed.getByRole("table", { name: "Teslim edilenler" })).toContainText("Teslim edilen tekrar");
    await expect(feed.getByRole("button", { name: "Teslim ettim" })).toHaveCount(2);
    await expect(feed.getByRole("link", { name: /Tümünü aç/ })).toHaveCount(0);
    expect(requestedPaths).not.toContain("/me/student/overview");
  });

  test("bir GET düşerse yalnız o panel hata ve Tekrar dene gösterir, sayfa boşalmaz", async ({ page }) => {
    const failures: Failures = new Set(["/me/student/overview", "/me/student/homework"]);
    const requestedPaths: string[] = [];
    await openStudentPortal(page, "/ogrenci", { failures, requestedPaths });

    await expect(page.getByRole("heading", { level: 1, name: "Öğrenci Portalı" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Günlük durum" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Duyurular" })).toBeVisible();

    const feed = page.getByRole("region", { exact: true, name: "Ödevlerim" });
    await expect(feed.getByRole("alert")).toContainText("Sınıf ödevleri şu an alınamadı");
    await expect(feed).toContainText("Problemler föyü");
    await expect(feed).not.toContainText("Denklemler");

    const gelisimim = page.getByRole("region", { exact: true, name: "Gelişimim" });
    await expect(gelisimim.getByRole("alert")).toContainText("Özet şu an alınamadı");
    failures.clear();
    const homeworkRequestsBefore = requestedPaths.filter((path) => path === "/me/student/homework").length;
    await gelisimim.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(gelisimim.getByRole("alert")).toHaveCount(0);
    await expect(gelisimim.getByRole("table", { name: "Okul notları: puan / tam puan" })).toContainText("42 / 50");
    // Gelişimim'in Tekrar dene'si yalnız kendi isteğini yeniler; Ödevlerim hatası kendi düğmesine kadar kalır.
    await expect(feed.getByRole("alert")).toContainText("Sınıf ödevleri şu an alınamadı");
    expect(requestedPaths.filter((path) => path === "/me/student/homework")).toHaveLength(homeworkRequestsBefore);
    await feed.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(feed.getByRole("alert")).toHaveCount(0);
    await expect(feed).toContainText("Denklemler");
  });

  test("Devamsızlık ve Profil görünümleri ana sütunu kullanır", async ({ page }) => {
    await openStudentPortal(page, "/ogrenci/devamsizlik");
    const main = page.locator(".next-portal-workspace__main");
    await expect(main.getByRole("region", { exact: true, name: "Devamsızlık" })).toBeVisible();
    await expect(main.getByRole("region", { exact: true, name: "Devamsızlık" })).toContainText("Toplam: 1 yok");

    await page.goto("/ogrenci/profil");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(main.getByRole("region", { exact: true, name: "Profil" })).toBeVisible();
    await expect(main.getByRole("region", { exact: true, name: "Sınıf ve kayıt geçmişi" })).toBeVisible();
  });
});

async function openStudentPortal(page: Page, path: string, options: { failures?: Failures; requestedPaths?: string[] } = {}) {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.clock.setFixedTime(fixedNow);
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    const pathName = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    options.requestedPaths?.push(pathName);
    if (options.failures?.has(pathName)) {
      await route.fulfill({ body: JSON.stringify({ code: "INTERNAL_ERROR" }), headers: { ...corsHeaders, "content-type": "application/json" }, status: 500 });
      return;
    }
    await fulfillData(route, studentApiResponse(pathName));
  });
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

function studentApiResponse(pathName: string): unknown {
  if (pathName === "/auth/refresh") {
    return {
      accessToken: "student-gelisimim-token",
      session: {
        id: "session-student-gelisimim",
        membershipVersion: 1,
        roles: ["STUDENT"],
        status: "ACTIVE",
        subjectId: "student-a",
        subjectType: "STUDENT",
        tenantId: "tenant-gelisimim",
        userId: "student-a",
      },
    };
  }
  if (pathName === "/me/tenant") return { id: "tenant-gelisimim", institutionType: "Okul", name: "Gelişimim Koleji" };
  if (pathName === "/me/notification-devices") return [];
  if (pathName === "/me/student/profile") {
    return { className: "8-A", firstName: "Ada", gradeLevelName: "8. Sınıf", id: "student-a", lastName: "Kaya", section: "A", status: "ACTIVE", tenantId: "tenant-gelisimim" };
  }
  if (pathName === "/me/student/overview") {
    return {
      attendance: { absent: 1, excused: 0, late: 0, present: 19, total: 20 },
      examSeries: [
        { examId: "exam-1", examStartsAt: "2026-05-05T07:00:00.000Z", examTitle: "LGS Deneme 1", generatedAt: "2026-05-20T10:00:00.000Z", net: 20, questionCount: 30, snapshotId: "snapshot-1", successRate: 72.5 },
        // A legacy report that did not store the exam date falls back to the generation date and has no title.
        { generatedAt: "2026-06-17T10:00:00.000Z", net: 24.5, questionCount: 30, snapshotId: "snapshot-2", successRate: 81.7 },
      ],
      homework: { materialAssignmentCount: 4, openClassHomeworkCount: 2 },
      schoolGrades: [
        { absent: false, assessmentId: "assessment-a", courseId: "course-math", courseName: "Matematik", heldOn: "2026-06-10", kind: "WRITTEN", maxScore: 50, score: 42, title: "1. Yazılı", version: 2 },
        { absent: true, assessmentId: "assessment-b", courseId: "course-math", courseName: "Matematik", heldOn: "2026-06-12", kind: "PERFORMANCE", maxScore: 100, score: null, title: "Performans", version: 1 },
      ],
    };
  }
  if (pathName === "/me/student/homework") {
    return [
      classHomework("homework-overdue", "Denklemler", "2026-06-15T12:00:00.000Z", "NOT_SUBMITTED", "Sayfa 30"),
      classHomework("homework-today", "Kesirler", "2026-06-17T12:00:00.000Z", "NOT_SUBMITTED", "Sayfa 42"),
      classHomework("homework-done", "Teslim edilen tekrar", "2026-06-17T09:00:00.000Z", "SUBMITTED", "Sayfa 10"),
    ];
  }
  if (pathName === "/me/student/homework/material-assignments") {
    return [
      materialAssignment("assignment-today", "Problemler föyü", "2026-06-17T15:00:00.000Z"),
      materialAssignment("assignment-week", "Hafta sonu tekrarı", "2026-06-20T12:00:00.000Z"),
      materialAssignment("assignment-later", "Ay sonu deneme föyü", "2026-06-30T12:00:00.000Z"),
      materialAssignment("assignment-undated", "Tarihsiz okuma", undefined),
    ];
  }
  if (pathName === "/me/student/attendance") return [{ date: "2026-06-16", id: "attendance-a", status: "ABSENT", studentId: "student-a", tenantId: "tenant-gelisimim" }];
  if (pathName === "/me/student/attendance/summary") return { absent: 1, excused: 0, late: 0, present: 19, studentId: "student-a", total: 20 };
  if (pathName === "/courses") return [{ id: "course-math", name: "Matematik", tenantId: "tenant-gelisimim" }];
  if (pathName === "/academic-terms") return [{ id: "term-2026", name: "2026 Bahar", tenantId: "tenant-gelisimim" }];
  return [];
}

function classHomework(id: string, title: string, dueAt: string, status: "NOT_SUBMITTED" | "SUBMITTED", description: string) {
  return { classId: "class-8a", description, dueAt, id, submission: { homeworkId: id, status, studentId: "student-a" }, title };
}

function materialAssignment(id: string, materialTitle: string, dueAt: string | undefined) {
  return {
    courseId: "course-math",
    createdAt: "2026-06-10T09:00:00.000Z",
    ...(dueAt ? { dueAt } : {}),
    id,
    materialId: "material-a",
    materialTitle,
    note: `${materialTitle} notu`,
    studentId: "student-a",
    tenantId: "tenant-gelisimim",
    termId: "term-2026",
  };
}

async function fulfillData(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    headers: { ...corsHeaders, "content-type": "application/json" },
    status: 200,
  });
}

