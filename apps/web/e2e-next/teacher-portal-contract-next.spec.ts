import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const forbiddenTeacherPortalReadPaths = [
  "/students",
  "/attendance",
  "/homework",
  "/homework/materials",
  "/teacher-notes",
  "/campuses",
  "/classes",
  "/courses",
  "/grade-levels",
  "/academic-terms",
  "/exams/exam-demo-isem-lgs-1/reports/snapshots",
  "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-ready/students/student-a",
  "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-ready/students/student-b",
  "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-ready/students/student-a/error-booklet",
  "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-ready/students/student-b/error-booklet",
  "/exams/exam-demo-isem-lgs-1/reports/students/student-a/progress",
  "/exams/exam-demo-isem-lgs-1/reports/students/student-b/progress",
];
const expectedTeacherScopedReadPaths = [
  "/me/teacher",
  "/me/teacher/schedule",
  "/me/teacher/students",
  "/me/teacher/attendance",
  "/attendance/daily",
  "/me/teacher/homework",
  "/me/teacher/homework/materials",
  "/me/teacher/homework/material-assignments",
  "/me/teacher/teacher-notes",
  "/me/teacher/support-tickets",
  "/me/teacher/lookups",
  "/me/teacher/reports",
  "/me/teacher/students/student-a/enrollments",
  "/me/teacher/students/student-b/enrollments",
  "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots",
  "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-a",
  "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-b",
  "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-a/error-booklet",
  "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-b/error-booklet",
  "/me/teacher/reports/exam-demo-isem-lgs-1/students/student-a/progress",
  "/me/teacher/reports/exam-demo-isem-lgs-1/students/student-b/progress",
];
const rawInternalValues = [
  "teacher-math",
  "student-a",
  "student-b",
  "student-missing",
  "tenant-teacher",
  "class-8a",
  "course-math",
  "course-missing",
  "material-a",
  "material-missing",
  "term-2026",
  "term-missing",
  "snapshot-ready",
];

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token,x-role-preview-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("Öğretmen portalı sözleşmesi", () => {
  for (const viewport of [
    { height: 812, width: 320 },
    { height: 812, width: 375 },
    { height: 896, width: 414 },
    { height: 1024, width: 768 },
  ]) {
    test(`öğretmen çalışma alanı ${viewport.width}px görünümde taşmaz`, async ({ page }) => {
      const requestedPaths: string[] = [];
      await openTeacherPortal(page, viewport, { requestedPaths });

      // Berrak §5: /ogretmen günlük özet → 1–3 aksiyon → detay; yazma formları ders bağlamındadır.
      await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
      await expectTeacherTodaySummary(page, { rolePreview: false });
      await expect(page.getByRole("region", { name: "Öğretmen günlük işlemleri" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Öğrenci çalışma alanı" })).toHaveCount(0);
      await expectTeacherPageClean(page, `teacher-today-${viewport.width}`);

      // Gate T1: Ders akışı yalnız program ve yoklamadır; öğrenci çalışma alanı Öğrenci takibindedir.
      await page.goto("/ogretmen/ders-akisi");
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
      await expect(page.getByRole("region", { exact: true, name: "Portal özeti" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Öğrenci çalışma alanı" })).toHaveCount(0);
      await expect(page.getByRole("region", { exact: true, name: "Öğretmen öğrenci kapsamı" })).toHaveCount(0);
      await expectTeacherDisplayPanels(page);
      const rollCall = page.getByRole("region", { name: "Öğretmen günlük işlemleri" });
      await expect(rollCall).toBeVisible();
      await expect(rollCall.locator(".uh-field")).toHaveCount(2);
      await expect(rollCall.locator(".uh-select")).toHaveCount(1);
      await expect(rollCall.getByLabel("Yoklama sınıfı").locator("option")).toHaveText(["Sınıf seçiniz", "8-A"]);
      await expect(rollCall.getByRole("button", { name: "Not ekle" })).toHaveCount(0);
      await expect(rollCall.getByRole("button", { name: "Materyal ata" })).toHaveCount(0);
      await expectOneTapRollCall(rollCall);
      await expect(page.getByRole("table", { name: "Bugünkü dersler" })).toBeVisible();
      const schedule = page.getByRole("region", { exact: true, name: "Ders programı" });
      await expect(schedule.getByRole("heading", { name: "Program" })).toBeVisible();
      await expect(schedule.getByRole("table", { name: "Ders programı" })).toBeVisible();
      await expectTeacherPageClean(page, `teacher-lesson-flow-${viewport.width}`);

      await page.goto("/ogretmen/ogrenci-takibi");
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      const workspace = page.getByRole("region", { name: "Öğrenci çalışma alanı" });
      await expect(workspace).toContainText("Öğrenci Takibi");
      await expect(workspace).toContainText("Ada Kaya / 8-A");
      await expect(page.getByRole("region", { exact: true, name: "Ders programı" })).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Öğretmen günlük yoklama listesi" })).toHaveCount(0);

      const focus = workspace.getByRole("region", { exact: true, name: "Seçili sınıf ve öğrenci özeti" });
      await expect(focus).toContainText("Seçili Öğrenci");
      await expect(focus).toContainText("İşlem yapılabilir");
      await expect(focus).toContainText("Ana Kampüs");
      await expect(focus).toContainText("Matematik");
      await expect(focus).toContainText("2026 Bahar");
      await expectTeacherFocusMetrics(focus);
      await expect(focus).toContainText("Başarı %");
      await expect(focus).toContainText("%81,7");
      await expect(focus).toContainText("Soru");
      await expect(focus).toContainText("30");
      await expect(focus).toContainText("Net");
      await expect(focus).toContainText("24,5");

      await expectTeacherActivityPanels(page);

      const studentScope = page.getByRole("region", { exact: true, name: "Öğretmen öğrenci kapsamı" });
      await expect(studentScope.getByRole("heading", { name: "Öğrenciler" })).toBeVisible();
      await expect(studentScope.getByRole("searchbox", { name: "Öğrenci ara" })).toBeVisible();
      await expect(studentScope.getByRole("button", { name: "Ada Kaya / 8-A" })).toHaveAttribute("aria-pressed", "true");
      const dailyActions = page.getByRole("region", { name: "Öğretmen günlük işlemleri" });
      await expect(dailyActions).toBeVisible();
      await expect(dailyActions.locator(".uh-field")).toHaveCount(12);
      await expect(dailyActions.locator(".uh-select")).toHaveCount(8);
      await expect(dailyActions.getByLabel("Yoklama sınıfı")).toHaveCount(0);
      await expect(dailyActions.locator(".uh-textarea")).toHaveCount(2);
      await expect(dailyActions.getByRole("textbox", { name: /^Not / })).toBeVisible();
      await expect(dailyActions.getByRole("textbox", { name: /^Atama notu / })).toBeVisible();
      await expect(page.getByRole("button", { name: "Yoklamayı kaydet" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Not ekle" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Materyal ata" })).toBeVisible();

      await workspace.getByRole("button", { name: "Bora Yilmaz / 8-A" }).click();
      await expect(focus).toContainText("Bora Yilmaz");
      await expect(focus).toContainText("%63,3");
      await expectTeacherPageClean(page, `teacher-portal-${viewport.width}`);

      await page.goto("/ogretmen/odevler");
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await expectTeacherHomeworkPanels(page, { readOnly: false });
      await expectTeacherPageClean(page, `teacher-homework-${viewport.width}`);

      await page.goto("/ogretmen/raporlar");
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await expectTeacherClassReportsPanel(page);
      const reportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
      await expect(reportSummary).toContainText("Başarı %");
      await expect(reportSummary.getByRole("button", { name: "Karne detayını göster" })).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("region", { name: "Sınav raporu özet sayfası" })).toHaveCount(0);
      const branchTable = page.getByRole("table", { name: "Portal branş başarıları" });
      await expect(branchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
      await expect(branchTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
      await expect(branchTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
      await expectTeacherPageClean(page, `teacher-reports-${viewport.width}`);

      await page.goto("/ogretmen/duyurular");
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await expectPortalAnnouncementsTable(page, { readOnly: false });
      await page.goto("/ogretmen/destek");
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await expectPortalSupportPanel(page, { formVisible: true });
      await expectTeacherPageClean(page, `teacher-support-${viewport.width}`);

      expect(requestedPaths.filter((path) => forbiddenTeacherPortalReadPaths.includes(path) || path.startsWith("/students/"))).toEqual([]);
      for (const path of expectedTeacherScopedReadPaths) {
        expect(requestedPaths).toContain(path);
      }
      expect(requestedPaths.filter((path) => /^\/me\/teacher\/homework\/materials\/[^/]+\/assignments$/.test(path))).toEqual([]);
      // Öğrenci takibi ve Ödev kontrolü sayfaları atamaları sayfa başına tek istekle okur; Ders akışı okumaz.
      expect(requestedPaths.filter((path) => path === "/me/teacher/homework/material-assignments")).toHaveLength(2);
      expect(requestedPaths.filter((path) => path === "/me/teacher/today")).toHaveLength(1);
    });
  }

  test("öğretmen rol önizlemesinde işlem yapılamaz", async ({ page }) => {
    const mutationRequests: string[] = [];
    await openTeacherPortal(page, { height: 844, width: 390 }, { mode: "role-preview", mutationRequests });

    await expect(page).toHaveURL(/\/ogretmen\?rolePreview=1$/);
    expect(page.url()).not.toContain("preview-token");
    await expect(page.getByLabel("Rol önizleme bilgisi")).toContainText("Yalnızca Görüntüleme");
    await expectTeacherTodaySummary(page, { rolePreview: true });
    await expectTeacherPageClean(page, "teacher-today-role-preview");

    await page.goto("/ogretmen/ders-akisi?rolePreview=1");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByLabel("Rol önizleme bilgisi")).toContainText("Yalnızca Görüntüleme");
    await expect(page.getByRole("region", { name: "Öğretmen günlük işlemleri" })).toHaveCount(0);
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
    await expectTeacherDisplayPanels(page);
    await expectTeacherPageClean(page, "teacher-lesson-flow-role-preview");

    await page.goto("/ogretmen/ogrenci-takibi?rolePreview=1");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("region", { name: "Öğretmen günlük işlemleri" })).toHaveCount(0);
    await expect(page.getByRole("region", { exact: true, name: "Seçili sınıf ve öğrenci özeti" })).toContainText("Yalnızca görüntüleme");
    await expectTeacherActivityPanels(page);
    await expectTeacherPageClean(page, "teacher-portal-role-preview");

    await page.goto("/ogretmen/duyurular?rolePreview=1");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expectPortalAnnouncementsTable(page, { readOnly: true });
    await page.goto("/ogretmen/destek?rolePreview=1");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByLabel("Destek talepleri", { exact: true })).toContainText("Yalnızca görüntüleme sırasında destek talebi açılamaz.");
    await expectPortalSupportPanel(page, { formVisible: false });
    await page.goto("/ogretmen/odevler?rolePreview=1");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expectTeacherHomeworkPanels(page, { readOnly: true });
    await expectTeacherPageClean(page, "teacher-homework-role-preview");
    await expect.poll(() => mutationRequests).toEqual([]);
  });

  test("öğretmen sidebar alt rotaları gerçek sayfaları açar", async ({ page }) => {
    await openTeacherPortal(page, { height: 900, width: 1024 });

    const routeCases = [
      { context: "Ders akışı", label: "Ders Akışı", path: "/ogretmen/ders-akisi", panel: () => page.getByRole("region", { exact: true, name: "Bugünkü dersler" }) },
      { context: "Öğrenci takibi", label: "Öğrenci Takibi", path: "/ogretmen/ogrenci-takibi", panel: () => page.getByRole("region", { name: "Öğrenci çalışma alanı" }) },
      { context: "Ödev kontrolü", label: "Ödev Kontrolü", path: "/ogretmen/odevler", panel: () => page.getByRole("region", { exact: true, name: "Öğretmen ödev kontrolü" }) },
      { context: "Sınav raporu", label: "Sınav Raporu", path: "/ogretmen/raporlar", panel: () => page.getByRole("region", { name: "Portal rapor özeti" }) },
      { context: "Duyurular", label: "Duyurular", path: "/ogretmen/duyurular", panel: () => page.getByRole("region", { exact: true, name: "Duyurular" }) },
      { context: "Destek talepleri", label: "Kurum içi destek", path: "/ogretmen/destek", panel: () => page.getByRole("region", { exact: true, name: "Destek talepleri" }) },
    ];

    for (const routeCase of routeCases) {
      await clickSidebarRoute(page, "Öğretmen Paneli", routeCase.label, routeCase.path);
      await expect(page).toHaveURL(new RegExp(`${routeCase.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
      await expect(page.getByRole("region", { exact: true, name: "Portal görünümü" })).toContainText(routeCase.context);
      await expect(routeCase.panel()).toBeVisible();
      if (routeCase.label === "Sınav Raporu") await expect(page.getByRole("combobox", { name: "Sınav raporu" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { exact: true, name: "Özet" })).not.toHaveAttribute("aria-current", "page");
    }
  });

  test("öğretmen teslim edenleri toplu kontrol eder (DEC-20261004-10)", async ({ page }) => {
    await openTeacherPortal(page, { height: 900, width: 1024 }, { path: "/ogretmen/odevler" });
    const checks: unknown[] = [];
    let checked = false;
    await page.route("**/api/v1/homework/homework-a/submissions**", async (route) => {
      const method = route.request().method();
      if (method === "OPTIONS") return route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      if (method === "POST") {
        checks.push(route.request().postDataJSON());
        checked = true;
        return fulfillData(route, [{ homeworkId: "homework-a", studentId: "student-a", status: "CHECKED", submittedAt: "2026-06-17T07:00:00.000Z", checkedAt: "2026-06-17T08:00:00.000Z" }]);
      }
      return fulfillData(route, [
        { homeworkId: "homework-a", studentId: "student-a", status: checked ? "CHECKED" : "SUBMITTED", submittedAt: "2026-06-17T07:00:00.000Z" },
        { homeworkId: "homework-a", studentId: "student-b", status: "NOT_SUBMITTED" },
      ]);
    });
    await page.reload();

    const panel = page.getByRole("region", { exact: true, name: "Ödev teslim durumu" });
    await expect(panel).toContainText("Ada Kaya");
    await expect(panel).toContainText("Teslim edildi");
    await expect(panel).toContainText("Teslim edilmedi");
    await expect(panel.getByRole("row").filter({ hasText: "Teslim edilmedi" }).getByRole("button", { name: "Kontrol et" })).toBeDisabled();
    await expect(panel.getByRole("row").filter({ hasText: "Teslim edildi" }).getByRole("button", { name: "Kontrol et" })).toBeEnabled();
    await panel.getByRole("button", { name: "Teslim edenlerin hepsini kontrol et (1)" }).click();
    await expect(panel).toContainText("Kontrol edildi");
    expect(checks).toEqual([{ studentIds: ["student-a"] }]);
    for (const value of rawInternalValues) {
      await expect(panel).not.toContainText(value);
    }
  });

  // DEC-20261012-01: only classes from the teacher's class/branch scopes are offered; the API enforces the rest.
  for (const viewport of [{ height: 900, width: 1280 }, { height: 844, width: 390 }, { height: 812, width: 320 }]) {
    test(`öğretmen ${viewport.width}px görünümde atandığı sınıfa ödev oluşturur`, async ({ page }) => {
      const created: unknown[] = [];
      await openTeacherPortal(page, viewport, { path: "/ogretmen/odevler" });
      await page.route("**/api/v1/grade-assessments/teacher-scopes", async (route) => {
        if (route.request().method() === "OPTIONS") return route.fulfill({ headers: corsHeadersFor(route), status: 204 });
        return fulfillData(route, [{ classId: "class-8a", courseId: "course-math" }]);
      });
      await page.route("**/api/v1/homework", async (route) => {
        if (route.request().method() === "OPTIONS") return route.fulfill({ headers: corsHeadersFor(route), status: 204 });
        created.push(route.request().postDataJSON());
        return fulfillData(route, { id: "homework-new", tenantId: "tenant-teacher", classId: "class-8a", title: "Kesirler" });
      });
      await page.reload();

      const panel = page.getByRole("region", { exact: true, name: "Ödev oluştur" });
      await expect(panel.getByRole("combobox", { name: /^Sınıf/ }).locator("option")).toHaveText(["Seçin", "8-A"]);
      await panel.getByRole("button", { name: "Ödev oluştur" }).click();
      await expect(panel.getByRole("alert")).toHaveText("Sınıf ve ödev başlığı zorunludur.");
      await panel.getByRole("combobox", { name: /^Sınıf/ }).selectOption("class-8a");
      await panel.getByLabel("Ödev başlığı").fill("Kesirler");
      await panel.getByLabel("Teslim tarihi").fill("2026-06-20");
      await expectNoHorizontalOverflow(page, `öğretmen ödev oluştur ${viewport.width}px`);
      await panel.getByRole("button", { name: "Ödev oluştur" }).click();
      await expect(panel.getByRole("status")).toHaveText("“Kesirler” ödevi oluşturuldu.");
      expect(created).toEqual([{ classId: "class-8a", title: "Kesirler", dueAt: "2026-06-20T20:59:00.000Z" }]);
      await expectNoHorizontalOverflow(page, `öğretmen ödev oluştur ${viewport.width}px`);
    });
  }

  test("öğretmen işlem hatasını alert olarak duyurur", async ({ page }) => {
    const mutationRequests: string[] = [];
    await openTeacherPortal(page, { height: 844, width: 390 }, { failMutationPath: "/attendance/daily", mutationRequests, path: "/ogretmen/ders-akisi" });

    const attendanceRequest = page.waitForRequest(
      (request) => request.method() === "PUT" && new URL(request.url()).pathname === "/api/v1/attendance/daily",
    );
    await page.getByRole("button", { name: "Tümünü Var" }).click();
    await page.getByRole("button", { name: "Yoklamayı kaydet" }).click();
    expect(JSON.parse((await attendanceRequest).postData() ?? "{}")).toEqual({
      classId: "class-8a",
      date: expect.any(String),
      entries: [
        { status: "PRESENT", studentId: "student-a" },
        { status: "PRESENT", studentId: "student-b" },
      ],
    });

    const alert = page.getByRole("region", { name: "Öğretmen günlük işlemleri" }).getByRole("alert");
    await expect(alert).toContainText("İşlem kaydedilemedi");
    await expect(alert).toContainText("Yoklama kaydedilemedi.");
    await expect.poll(() => mutationRequests).toEqual(expect.arrayContaining(["PUT /attendance/daily"]));
    expect(mutationRequests).not.toContain("POST /attendance");
  });

  // Gate T1: tek dokunuşla yoklama; durum başına iki etkileşim yerine bir dokunuş, kaydet yanında yapışkan özet.
  for (const viewport of [{ height: 812, width: 320 }, { height: 1024, width: 768 }, { height: 900, width: 1440 }]) {
    test(`öğretmen ${viewport.width}px görünümde yoklamayı tek dokunuşla alır`, async ({ page }) => {
      await openTeacherPortal(page, viewport, { path: "/ogretmen/ders-akisi" });
      const rollCall = page.getByRole("region", { name: "Öğretmen günlük işlemleri" });
      await expectOneTapRollCall(rollCall);
      const attendanceRequest = page.waitForRequest(
        (request) => request.method() === "PUT" && new URL(request.url()).pathname === "/api/v1/attendance/daily",
      );
      await rollCall.getByRole("radiogroup", { name: "Ada Kaya yoklama durumu" }).getByRole("radio", { name: "Yok" }).check();
      await expect(rollCall.locator(".next-attendance-roster__bar")).toHaveText(/0 Var · 1 Yok · 1 Geç · 0 seçilmedi/);
      await rollCall.getByRole("button", { name: "Yoklamayı kaydet" }).click();
      expect(JSON.parse((await attendanceRequest).postData() ?? "{}")).toEqual({
        classId: "class-8a",
        date: "2026-06-17",
        entries: [
          { status: "ABSENT", studentId: "student-a" },
          { status: "LATE", studentId: "student-b" },
        ],
      });
      await expect(rollCall.getByRole("status").filter({ hasText: "8-A yoklaması kaydedildi (17 Haz 2026)." })).toBeVisible();
      await expectTeacherPageClean(page, `teacher-roll-call-${viewport.width}`);
    });
  }

  test("öğretmen öğrenci takibinde listeyi arar ve sınıfa göre süzer", async ({ page }) => {
    await openTeacherPortal(page, { height: 812, width: 375 }, { path: "/ogretmen/ogrenci-takibi" });
    await page.route("**/api/v1/me/teacher/students", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return fulfillData(route, [
        ...createStudents(),
        { classId: "class-visible", firstName: "Cem", id: "student-c", lastName: "Demir", responsibleTeacherId: "teacher-math", status: "ACTIVE", studentNo: "8101", tenantId: "tenant-teacher" },
      ]);
    });
    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const scope = page.getByRole("region", { exact: true, name: "Öğretmen öğrenci kapsamı" });
    const picker = scope.getByRole("group", { name: "Öğrenci seçimi" });
    const count = scope.locator(".next-teacher-roster__count");
    const search = scope.getByRole("searchbox", { name: "Öğrenci ara" });
    await expect(picker.getByRole("button")).toHaveCount(3);
    await expect(count).toHaveText("3 öğrenci");
    await search.fill("BORA");
    await expect(picker.getByRole("button")).toHaveText(["Bora Yilmaz / 8-A"]);
    await expect(count).toHaveText("1 / 3 öğrenci");
    await search.fill("8101");
    await expect(picker.getByRole("button")).toHaveText(["Cem Demir / 8-B"]);
    await search.fill("");
    await scope.getByRole("combobox", { name: "Sınıf" }).selectOption("class-visible");
    await expect(picker.getByRole("button")).toHaveText(["Cem Demir / 8-B"]);
    await picker.getByRole("button", { name: "Cem Demir / 8-B" }).click();
    await expect(picker.getByRole("button", { name: "Cem Demir / 8-B" })).toHaveAttribute("aria-pressed", "true");
    const workspace = page.getByRole("region", { name: "Öğrenci çalışma alanı" });
    await expect(workspace.locator(".next-teacher-workspace__header")).toContainText("Cem Demir / 8-B");
    // Arama seçimi düşürmez; seçili öğrenci listede görünmese de çalışma alanı onu gösterir.
    await search.fill("zzz");
    await expect(scope).toContainText("Aramaya uyan öğrenci yok.");
    await expect(workspace.locator(".next-teacher-workspace__header")).toContainText("Cem Demir / 8-B");
    await expect(page.getByRole("form", { name: "Not ekle" }).getByRole("combobox", { name: "Öğrenci" })).toHaveValue("student-c");
    await expectTeacherPageClean(page, "teacher-roster-search-375");
  });

  test("öğretmen ödev tablosu sınıfı gösterir ve satırdan teslim durumunu açar", async ({ page }) => {
    await openTeacherPortal(page, { height: 844, width: 390 }, { path: "/ogretmen/odevler" });
    await page.route("**/api/v1/me/teacher/homework", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return fulfillData(route, [
        { checkedAt: "2026-06-16T10:00:00.000Z", classId: "class-visible", dueAt: "2026-06-16T12:00:00.000Z", id: "homework-b", tenantId: "tenant-teacher", title: "Oranlar" },
        ...createHomework(),
      ]);
    });
    await page.route("**/api/v1/homework/*/submissions", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      const isB = route.request().url().includes("/homework/homework-b/");
      return fulfillData(route, isB
        ? [{ checkedAt: "2026-06-16T10:00:00.000Z", homeworkId: "homework-b", status: "CHECKED", studentId: "student-b", submittedAt: "2026-06-16T09:00:00.000Z" }]
        : [{ homeworkId: "homework-a", status: "SUBMITTED", studentId: "student-a", submittedAt: "2026-06-17T07:00:00.000Z" }]);
    });
    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const homework = page.getByRole("region", { exact: true, name: "Öğretmen ödev kontrolü" });
    const table = homework.getByRole("table", { name: "Öğretmen ödev kontrol kayıtları" });
    await expect(table.getByRole("row").filter({ hasText: "Oranlar" })).toContainText("8-B");
    await expect(table.getByRole("row").filter({ hasText: "Kesirler tekrar" })).toContainText("8-A");
    const submissions = page.getByRole("region", { exact: true, name: "Ödev teslim durumu" });
    const select = submissions.getByRole("combobox", { name: "Ödev" });
    await expect(select.locator("option")).toHaveText(["Oranlar · 8-B", "Kesirler tekrar · 8-A"]);
    // Varsayılan seçim kontrol bekleyen ilk ödevdir.
    await expect(select).toHaveValue("homework-a");
    await expect(table.getByRole("button", { name: "Kesirler tekrar" })).toHaveAttribute("aria-pressed", "true");
    await expect(submissions).toContainText("Ada Kaya");
    await table.getByRole("button", { name: "Oranlar" }).click();
    await expect(table.getByRole("button", { name: "Oranlar" })).toHaveAttribute("aria-pressed", "true");
    await expect(table.getByRole("button", { name: "Kesirler tekrar" })).toHaveAttribute("aria-pressed", "false");
    await expect(select).toHaveValue("homework-b");
    await expect(submissions).toContainText("Bora Yilmaz");
    await expect(submissions).toContainText("Kontrol edildi");
    await select.selectOption("homework-a");
    await expect(table.getByRole("button", { name: "Kesirler tekrar" })).toHaveAttribute("aria-pressed", "true");
    for (const value of rawInternalValues) {
      await expect(homework).not.toContainText(value);
      await expect(submissions).not.toContainText(value);
    }
    await expectTeacherPageClean(page, "teacher-homework-select-390");
  });

  test("teslim tarihi geçen ödev 'Süresi geçti' görünür, teslim listesi ada göre sıralanır (UAT U19)", async ({ page }) => {
    await openTeacherPortal(page, { height: 900, width: 1024 }, { path: "/ogretmen/odevler" });
    await page.route("**/api/v1/me/teacher/homework", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return fulfillData(route, [
        { classId: "class-8a", dueAt: "2026-06-15T12:00:00.000Z", id: "homework-overdue", tenantId: "tenant-teacher", title: "Geçmiş ödev" },
        ...createHomework(),
      ]);
    });
    await page.route("**/api/v1/homework/*/submissions", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      // API sırası ada göre değil; ekran Türkçe ad sırasına dizer.
      return fulfillData(route, [
        { homeworkId: "homework-overdue", status: "NOT_SUBMITTED", studentId: "student-c" },
        { homeworkId: "homework-overdue", status: "NOT_SUBMITTED", studentId: "student-b" },
        { homeworkId: "homework-overdue", status: "SUBMITTED", studentId: "student-a", submittedAt: "2026-06-14T09:00:00.000Z" },
      ]);
    });
    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const table = page.getByRole("region", { exact: true, name: "Öğretmen ödev kontrolü" }).getByRole("table", { name: "Öğretmen ödev kontrol kayıtları" });
    await expect(table.getByRole("row").filter({ hasText: "Geçmiş ödev" })).toContainText("Süresi geçti");
    await expect(table.getByRole("row").filter({ hasText: "Geçmiş ödev" })).not.toContainText("Bekliyor");
    await expect(table.getByRole("row").filter({ hasText: "Kesirler tekrar" })).toContainText("Bekliyor");

    const submissions = page.getByRole("region", { exact: true, name: "Ödev teslim durumu" });
    await expect(submissions.getByRole("combobox", { name: "Ödev" })).toHaveValue("homework-overdue");
    const rows = submissions.getByRole("table", { name: "Öğrenci teslim durumları" }).locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Ada Kaya");
    await expect(rows.nth(0)).toContainText("Teslim edildi");
    await expect(rows.nth(1)).toContainText("Bora Yilmaz");
    await expect(rows.nth(1)).toContainText("Teslim edilmedi · süresi geçti");
    // Adı listede olmayan öğrenci sona düşer.
    await expect(rows.nth(2)).toContainText("Bilinmeyen öğrenci");
    await expectTeacherPageClean(page, "teacher-homework-overdue-1024");
  });

  test("öğretmen portalında düşen istek yalnız kendi bölümünü işaretler", async ({ page }) => {
    const failReadPaths = new Set(["/me/teacher/teacher-notes", "/me/teacher/attendance"]);
    await openTeacherPortal(page, { height: 844, width: 390 }, { failReadPaths, path: "/ogretmen/ogrenci-takibi" });

    await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
    const notes = page.getByRole("region", { exact: true, name: "Öğretmen notları" });
    const attendance = page.getByRole("region", { exact: true, name: "Öğretmen yoklama kayıtları" });
    for (const region of [notes, attendance]) {
      await expect(region.getByRole("alert")).toContainText("Bu bölüm yüklenemedi");
      await expect(region.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
    }
    await expect(page.getByRole("table", { name: "Öğretmen notları" })).toHaveCount(0);
    // Diğer bölümler çalışmaya devam eder.
    await expect(page.getByRole("region", { exact: true, name: "Öğretmen öğrenci kapsamı" }).getByRole("button", { name: "Ada Kaya / 8-A" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Seçili sınıf ve öğrenci özeti" })).toContainText("%81,7");
    await expect(page.getByRole("button", { name: "Not ekle" })).toBeVisible();
    await expectTeacherPageClean(page, "teacher-section-error-390");

    failReadPaths.clear();
    await notes.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByRole("table", { name: "Öğretmen notları" })).toBeVisible();
    // Her bölümün Tekrar dene'si yalnız kendi isteğini yeniler.
    await expect(attendance.getByRole("alert")).toContainText("Bu bölüm yüklenemedi");
    await attendance.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByRole("table", { name: "Öğretmen yoklama kayıtları" })).toBeVisible();
    await expect(page.getByText("Bu bölüm yüklenemedi")).toHaveCount(0);

    failReadPaths.add("/me/teacher/schedule");
    await page.goto("/ogretmen/ders-akisi");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    for (const name of ["Bugünkü dersler", "Ders programı"]) {
      await expect(page.getByRole("region", { exact: true, name }).getByRole("alert")).toContainText("Bu bölüm yüklenemedi");
    }
    // Yoklama programdan bağımsızdır; sınıf listesi gelir ve kaydedilebilir.
    await expect(page.getByRole("region", { exact: true, name: "Öğretmen profil özeti" })).toContainText("Zeynep Arslan");
    await expect(page.getByRole("radiogroup", { name: "Ada Kaya yoklama durumu" })).toBeVisible();
  });

  test("tüm portal istekleri düşünce sayfa tek hata durumu gösterir", async ({ page }) => {
    const failReadPaths = new Set([
      "/me/teacher",
      "/me/teacher/schedule",
      "/me/teacher/students",
      "/me/teacher/lookups",
    ]);
    await openTeacherPortal(page, { height: 844, width: 390 }, { failReadPaths, path: "/ogretmen/ders-akisi" });
    const pageError = page.getByRole("alert").filter({ hasText: "Öğretmen portal verisi alınamadı" });
    await expect(pageError).toBeVisible();
    await expect(pageError.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
  });
});

async function expectOneTapRollCall(rollCall: Locator) {
  const roster = rollCall.getByRole("list", { name: "Öğretmen günlük yoklama listesi" });
  await expect(roster.getByRole("listitem")).toHaveCount(2);
  // "Tümünü Var" listeden önce gelir.
  await expect(rollCall.locator(".next-attendance-roster > *").first().getByRole("button", { name: "Tümünü Var" })).toBeVisible();
  const ada = roster.getByRole("radiogroup", { name: "Ada Kaya yoklama durumu" });
  const bora = roster.getByRole("radiogroup", { name: "Bora Yilmaz yoklama durumu" });
  for (const group of [ada, bora]) {
    await expect(group.getByRole("radio")).toHaveCount(4);
    for (const label of ["Var", "Yok", "Geç", "İzinli"]) {
      await expect(group.getByRole("radio", { exact: true, name: label })).toBeVisible();
    }
  }
  // Kayıtlı durum radio olarak gelir; kayıtsız öğrenci seçilmemiş kalır ve kaydet kapalıdır.
  await expect(ada.getByRole("radio", { exact: true, name: "Var" })).toBeChecked();
  await expect(bora.getByRole("radio", { checked: true })).toHaveCount(0);
  const bar = rollCall.locator(".next-attendance-roster__bar");
  await expect(bar).toHaveText(/1 Var · 0 Yok · 0 Geç · 1 seçilmedi/);
  await expect(bar).toHaveCSS("position", "sticky");
  const save = bar.getByRole("button", { name: "Yoklamayı kaydet" });
  await expect(save).toBeDisabled();
  await bora.getByRole("radio", { exact: true, name: "Geç" }).check();
  await expect(bar).toHaveText(/1 Var · 0 Yok · 1 Geç · 0 seçilmedi/);
  await expect(save).toBeEnabled();
  // Dokunma hedefi en az 44px.
  const optionBox = await ada.locator("label").first().boundingBox();
  expect(optionBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(optionBox?.width ?? 0).toBeGreaterThanOrEqual(44);
}

async function expectTeacherTodaySummary(page: Page, options: { rolePreview: boolean }) {
  const suffix = options.rolePreview ? "?rolePreview=1" : "";
  // Saat 08:00'e sabit; 09:30 dersi sıradaki derstir, yoklama bağlantısı dersin sınıfını ve gününü taşır.
  const attendanceHref = `/ogretmen/ders-akisi?classId=class-8a&date=2026-06-17${options.rolePreview ? "&rolePreview=1" : ""}#portal-teacher-attendance`;
  const brief = page.getByRole("region", { exact: true, name: "Bugün" });
  await expectPortalSummaryMetrics(
    brief.getByRole("group", { exact: true, name: "Bugün özeti" }),
    ["Bugünkü ders", "Yoklama", "Bekleyen iş"],
    rawInternalValues,
  );
  // T3: Şimdi/Sıradaki kartı dersin saatini, sınıf adını ve yoklama durumunu taşır.
  await expect(brief).toContainText("Sıradaki ders");
  await expect(brief).toContainText("Matematik problem çözümü");
  await expect(brief).toContainText("12:30–13:30 · 8-A · Yoklama bekliyor");
  await expect(brief).toContainText("1 ders bekliyor");
  await expect(brief).toContainText("5 iş");
  await expect(brief).toContainText("1 yoklama · 2 teslim · 1 taslak · 1 duyuru · 1 ödev");

  const actionStrip = page.getByRole("region", { name: "Öğretmen günlük aksiyonları" });
  await expect(actionStrip).toBeVisible();
  await expect(actionStrip.getByRole("heading", { name: "Bekleyen işler" })).toBeVisible();
  await expect(actionStrip).toContainText("Bugün yapılacaklar");
  // UAT U18: başlık yalnız bekleyen kartları sayar ve "Bekleyen iş" kartıyla aynı sayıyı gösterir; rapor kartı iş sayılmaz.
  await expect(actionStrip).toContainText("5 iş");
  await expect(actionStrip.getByRole("link", { name: /Yoklama al: 1 ders/ })).toHaveAttribute("href", attendanceHref);
  await expect(actionStrip.getByRole("link", { name: /Teslim kontrolü: 2 teslim/ })).toHaveAttribute("href", `/ogretmen/odevler${suffix}`);
  await expect(actionStrip.getByRole("link", { name: /Not taslakları: 1 değerlendirme/ })).toHaveAttribute("href", `/ogretmen/not-defteri${suffix}`);
  await expect(actionStrip.getByRole("link", { name: /Okunmamış duyurular: 1 duyuru/ })).toHaveAttribute("href", `/ogretmen/duyurular${suffix}`);
  await expect(actionStrip.getByRole("link", { name: /Ödev kontrolü: 1 ödev/ })).toHaveAttribute("href", `/ogretmen/odevler${suffix}`);
  await expect(actionStrip.getByRole("link", { name: /Son sınav raporu/ })).toHaveAttribute(
    "href",
    `/ogretmen/raporlar?examId=exam-demo-isem-lgs-1${options.rolePreview ? "&rolePreview=1" : ""}`,
  );
  await expectPortalActionHrefs(actionStrip, [
    attendanceHref,
    `/ogretmen/odevler${suffix}`,
    `/ogretmen/not-defteri${suffix}`,
    `/ogretmen/duyurular${suffix}`,
    `/ogretmen/odevler${suffix}`,
    `/ogretmen/raporlar?examId=exam-demo-isem-lgs-1${options.rolePreview ? "&rolePreview=1" : ""}`,
  ]);
  if (options.rolePreview) await expect(actionStrip).toContainText("Yalnızca görüntüleme");

  const lessons = page.getByRole("region", { exact: true, name: "Bugünkü dersler" });
  const lessonTable = lessons.getByRole("table", { name: "Bugünkü dersler" });
  await expect(lessonTable).toBeVisible();
  await expect(lessons).toContainText("Matematik problem çözümü");
  await expect(lessons).toContainText("17 Haz 2026 tarihli dersler.");
  await expect(lessonTable.locator('td[data-column-key="class"]')).toHaveText(["8-A"]);
  await expect(lessonTable.locator('td[data-column-key="attendance"] .uh-status-badge')).toHaveText(["Bekliyor"]);
  // Yoklama ve ödev bağlantıları telefonda detay satırında görünür kalır.
  const shownAttendanceLink = lessons.getByRole("link", { name: "Yoklama al" }).filter({ visible: true });
  await expect(shownAttendanceLink).toHaveCount(1);
  await expect(shownAttendanceLink).toHaveAttribute("href", attendanceHref);
  await expect(lessons.getByRole("link", { name: "Ödev ver" }).filter({ visible: true })).toHaveCount(1);
  // Eski üç ayrı detay paneli kalktı; aynı bilgiler Bekleyen işler kutusundadır.
  await expect(page.getByRole("region", { exact: true, name: "Kontrol bekleyen ödevler" })).toHaveCount(0);
  await expect(page.getByRole("region", { exact: true, name: "Son sınav raporu" })).toHaveCount(0);
  for (const region of [brief, actionStrip, lessons]) {
    for (const value of rawInternalValues) {
      await expect(region).not.toContainText(value);
    }
  }
}

async function expectTeacherPageClean(page: Page, label: string) {
  await expectNoHorizontalOverflow(page, label);
  await expectNoUnlabeledControls(page, label);
  await expectNoClippedVisibleText(page, label);
}

async function expectTeacherFocusMetrics(focus: Locator) {
  const focusMetrics = focus.getByRole("region", { name: "Seçili sınıf ve öğrenci bilgileri" });
  await expect(focusMetrics).toHaveClass(/uh-info-grid/);
  await expect(focusMetrics.locator(".uh-info-item")).toHaveCount(8);
}

async function expectTeacherDisplayPanels(page: Page) {
  const today = page.getByRole("region", { exact: true, name: "Bugünkü dersler" });
  await expect(today.getByRole("heading", { name: "Bugünkü Dersler" })).toBeVisible();
  await expect(today.getByRole("table", { name: "Bugünkü dersler" })).toBeVisible();

  const profile = page.getByRole("region", { exact: true, name: "Öğretmen profil özeti" });
  await expect(profile.getByRole("heading", { name: "Profil Özeti" })).toBeVisible();
  const profileInfo = profile.getByRole("region", { name: "Öğretmen portal profil metrikleri" });
  await expect(profileInfo).toHaveClass(/uh-info-grid/);
  await expect(profileInfo.locator(".uh-info-item")).toHaveCount(8);
  await expect(profile).toContainText("Ad soyad");
  await expect(profile).toContainText("Branş");
  await expect(profile).toContainText("Dersler");
  await expect(profile).toContainText("Dönemler");
  await expect(profile).toContainText("Sınıf kapsamı");
  await expect(profile).toContainText("Organizasyon");
  await expect(profile).toContainText("Zeynep Arslan");
  await expect(profile).toContainText("Matematik");
  await expect(profile).toContainText("8-A");
  await expect(profile).toContainText("Ana Kampüs / 8. Sınıf / A şube");
  await expect(profile).toContainText("2 öğrenci");
  await expect(profile).toContainText("1 ders");

  for (const panel of [today, profile]) {
    for (const value of rawInternalValues) {
      await expect(panel).not.toContainText(value);
    }
  }
}

// Sınıf raporları Sınav raporu sayfasındadır (Berrak §5 rota ayrımı).
async function expectTeacherClassReportsPanel(page: Page) {
  const reports = page.getByRole("region", { exact: true, name: "Öğretmen sınıf raporları" });
  await expect(reports.getByRole("heading", { name: "Sınıf Raporları" })).toBeVisible();
  const reportsTable = reports.getByRole("table", { name: "Öğretmen sınıf raporları" });
  await expect(reportsTable).toBeVisible();
  await expect(reportsTable.locator("thead th")).toHaveText([
    "Sınıf",
    "Bağlam",
    "Sonuç",
    "Başarı %",
    "Net",
    "Soru",
  ]);
  await expect(reportsTable).toContainText("Soru sayıları farklı raporları Başarı % ile karşılaştırın");

  for (const value of rawInternalValues) {
    await expect(reports).not.toContainText(value);
  }
}

async function expectTeacherActivityPanels(page: Page) {
  const attendance = page.getByRole("region", { exact: true, name: "Öğretmen yoklama kayıtları" });
  const attendanceTable = attendance.getByRole("table", { name: "Öğretmen yoklama kayıtları" });
  await expect(attendanceTable).toBeVisible();
  await expect(attendanceTable.locator("thead th")).toHaveText(["Öğrenci", "Branş", "Dönem", "Tarih", "Durum"]);
  await expect(attendance).toContainText("Ada Kaya");
  await expect(attendance).toContainText("Matematik");
  await expect(attendance).toContainText("2026 Bahar");
  await expect(attendance).toContainText("Bilinmeyen öğrenci");
  await expect(attendance).toContainText("Ders bilgisi yok");
  await expect(attendance).toContainText("Dönem bilgisi yok");

  const notes = page.getByRole("region", { exact: true, name: "Öğretmen notları" });
  const notesTable = notes.getByRole("table", { name: "Öğretmen notları" });
  await expect(notesTable).toBeVisible();
  await expect(notesTable.locator("thead th")).toHaveText(["Öğrenci", "Branş", "Dönem", "Not"]);
  await expect(notes).toContainText("Problem çözüm adımları takip edilecek.");
  await expect(notes).toContainText("Matematik");
  await expect(notes).toContainText("2026 Bahar");
  await expect(notes).toContainText("Bilinmeyen öğrenci");
  await expect(notes).toContainText("Ders bilgisi yok");
  await expect(notes).toContainText("Dönem bilgisi yok");

  for (const panel of [attendance, notes]) {
    for (const value of rawInternalValues) {
      await expect(panel).not.toContainText(value);
    }
  }
}

async function expectTeacherHomeworkPanels(page: Page, options: { readOnly: boolean }) {
  const homework = page.getByRole("region", { exact: true, name: "Öğretmen ödev kontrolü" });
  await expect(homework.getByRole("heading", { name: "Ödev Kontrolü" })).toBeVisible();
  const homeworkTable = homework.getByRole("table", { name: "Öğretmen ödev kontrol kayıtları" });
  await expect(homeworkTable).toBeVisible();
  await expect(homeworkTable.locator("thead th")).toHaveText(["Ödev", "Sınıf", "Materyal", "Teslim", "Durum", "İşlem"]);
  await expect(homeworkTable.getByRole("row").filter({ hasText: "Kesirler tekrar" })).toContainText("8-A");
  if (options.readOnly) {
    await expect(homework.getByRole("button", { name: "Kontrol et" })).toHaveCount(0);
    await expect(homework).toContainText("Yalnızca görüntüleme");
  } else {
    await expect(homework.getByRole("button", { name: "Kontrol et" })).toBeVisible();
  }

  const assignments = page.getByRole("region", { exact: true, name: "Öğretmen materyal atamaları" });
  await expect(assignments.getByRole("heading", { name: "Materyal Atamaları" })).toBeVisible();
  const assignmentsTable = assignments.getByRole("table", { name: "Öğretmen materyal atamaları" });
  await expect(assignmentsTable).toBeVisible();
  await expect(assignmentsTable.locator("thead th")).toHaveText(["Öğrenci", "Materyal", "Branş", "Dönem", "Not", "Teslim"]);
  await expect(assignments).toContainText("Bilinmeyen materyal");
  await expect(assignments).toContainText("Ders bilgisi yok");
  await expect(assignments).toContainText("Dönem bilgisi yok");

  for (const panel of [homework, assignments]) {
    for (const value of rawInternalValues) {
      await expect(panel).not.toContainText(value);
    }
  }
}

async function expectPortalAnnouncementsTable(page: Page, options: { readOnly: boolean }) {
  const announcements = page.getByRole("region", { exact: true, name: "Duyurular" });
  const table = page.getByRole("table", { name: "Portal duyuruları" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Başlık" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Hedef" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Okunma" })).toBeVisible();
  if (options.readOnly) {
    await expect(announcements.getByRole("button", { name: "Okundu işaretle" })).toHaveCount(0);
    await expect(announcements).toContainText("Yalnızca görüntüleme");
  } else {
    await expect(announcements.getByRole("button", { name: "Okundu işaretle" })).toBeVisible();
  }
}

async function expectPortalSupportPanel(page: Page, options: { formVisible: boolean }) {
  const support = page.getByRole("region", { exact: true, name: "Destek talepleri" });
  const table = page.getByRole("table", { name: "Destek talepleri" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Konu" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Öncelik" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Durum" })).toBeVisible();
  await expect(support.locator(".uh-status-badge", { hasText: "Normal" })).toBeVisible();
  await expect(support.locator(".uh-status-badge", { hasText: "Açık" })).toBeVisible();
  if (options.formVisible) {
    await expect(support.getByLabel("Konu", { exact: true })).toBeVisible();
    await expect(support.getByLabel("Mesaj", { exact: true })).toBeVisible();
    await expect(support.getByRole("combobox", { name: /Öncelik/ })).toBeVisible();
  } else {
    await expect(support.getByLabel("Konu", { exact: true })).toHaveCount(0);
    await expect(support.getByLabel("Mesaj", { exact: true })).toHaveCount(0);
    await expect(support.getByRole("combobox", { name: /Öncelik/ })).toHaveCount(0);
  }
}

async function openTeacherPortal(
  page: Page,
  viewport: { height: number; width: number },
  options: {
    failMutationPath?: string;
    failReadPaths?: Set<string>;
    mode?: "teacher" | "role-preview";
    mutationRequests?: string[];
    path?: string;
    requestedPaths?: string[];
  } = {},
) {
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date("2026-06-17T08:00:00.000Z"));
  await installTeacherApiMocks(page, options);
  await page.addInitScript((mode) => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
    if (mode === "role-preview") {
      window.sessionStorage.setItem("o-okul.role-preview-token", "preview-token-teacher");
    }
  }, options.mode ?? "teacher");
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  const path = options.path ?? "/ogretmen";
  await page.goto(options.mode === "role-preview" ? `${path}?rolePreview=1` : path);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function clickSidebarRoute(page: Page, groupName: string, linkName: string, expectedPath: string) {
  const navigation = page.getByRole("navigation", { name: "Ana menü" });
  const groupButton = navigation.getByRole("button", { exact: true, name: groupName });
  if ((await groupButton.getAttribute("aria-expanded")) !== "true") {
    await groupButton.click();
  }
  const link = navigation.getByRole("link", { exact: true, name: linkName });
  await expect(link).toHaveAttribute("href", expectedPath);
  await Promise.all([page.waitForURL(new RegExp(`${expectedPath}$`), { timeout: 15_000 }), link.click()]);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installTeacherApiMocks(
  page: Page,
  options: { failMutationPath?: string; failReadPaths?: Set<string>; mode?: "teacher" | "role-preview"; mutationRequests?: string[]; requestedPaths?: string[] },
) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const method = route.request().method();
    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    options.requestedPaths?.push(pathName);
    if (method !== "GET" && method !== "OPTIONS" && pathName !== "/auth/refresh") {
      options.mutationRequests?.push(`${method} ${pathName}`);
      if (pathName === options.failMutationPath) {
        await route.fulfill({
          body: JSON.stringify({ error: { code: "TEST_MUTATION_FAILURE" } }),
          headers: {
            ...corsHeadersFor(route),
            "content-type": "application/json",
          },
          status: 500,
        });
        return;
      }
    }
    if (method === "GET" && options.failReadPaths?.has(pathName)) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "TEST_READ_FAILURE" } }),
        headers: {
          ...corsHeadersFor(route),
          "content-type": "application/json",
        },
        status: 500,
      });
      return;
    }
    if (method === "GET" && forbiddenTeacherPortalReadPaths.includes(pathName)) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "BROAD_TEACHER_PORTAL_READ_FORBIDDEN" } }),
        headers: {
          ...corsHeadersFor(route),
          "content-type": "application/json",
        },
        status: 500,
      });
      return;
    }
    if (method === "GET" && pathName === "/attendance/daily") {
      await fulfillData(route, createDailyAttendance(url));
      return;
    }

    const response = teacherApiResponse(pathName, options.mode ?? "teacher");
    await fulfillData(route, response);
  });
}

function teacherApiResponse(pathName: string, mode: "teacher" | "role-preview"): unknown {
  if (pathName === "/auth/refresh") return createAuthResponse(mode);
  if (pathName === "/me/tenant") return createTenantResponse();
  if (pathName === "/me/notification-devices") return [];
  if (pathName === "/me/teacher") return createTeacher();
  if (pathName === "/me/teacher/today") return createTeacherToday();
  if (pathName === "/me/teacher/announcements") return createAnnouncements();
  if (pathName === "/me/teacher/schedule") return createScheduleLessons();
  if (pathName === "/me/teacher/students") return createStudents();
  if (pathName === "/me/teacher/attendance") return createAttendance();
  if (pathName === "/me/teacher/homework") return createHomework();
  if (pathName === "/me/teacher/homework/materials") return createMaterials();
  if (pathName === "/me/teacher/homework/material-assignments") return createMaterialAssignments();
  if (pathName === "/attendance/daily") return { records: createAttendance().slice(0, 1), summary: { absent: 0, excused: 0, late: 0, present: 1, total: 1 } };
  if (pathName === "/me/teacher/teacher-notes") return createTeacherNotes();
  if (pathName === "/me/teacher/support-tickets") return createSupportTickets();
  if (pathName === "/me/teacher/lookups") return createTeacherLookups();
  if (pathName === "/me/teacher/reports") return [{ examId: "exam-demo-isem-lgs-1", latestGeneratedAt: "2026-06-17T10:00:00.000Z", latestReadySnapshotId: "snapshot-ready", title: "İSEM - LGS - 1" }];
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots") return createReportSnapshots();
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-a") return createStudentReport("student-a");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-b") return createStudentReport("student-b");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-a/error-booklet") return createErrorBooklet("student-a");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-b/error-booklet") return createErrorBooklet("student-b");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/students/student-a/progress") return createProgress("student-a");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/students/student-b/progress") return createProgress("student-b");
  if (pathName === "/me/teacher/students/student-a/enrollments" || pathName === "/me/teacher/students/student-b/enrollments") return createEnrollments();
  return [];
}

function createAuthResponse(mode: "teacher" | "role-preview") {
  return {
    accessToken: "teacher-portal-access-token",
    session: {
      id: "session-teacher",
      membershipVersion: 1,
      roles: mode === "role-preview" ? ["TENANT_ADMIN"] : ["TEACHER"],
      status: "ACTIVE",
      subjectId: mode === "role-preview" ? undefined : "teacher-math",
      subjectType: mode === "role-preview" ? undefined : "TEACHER",
      tenantId: "tenant-teacher",
      userId: mode === "role-preview" ? "admin-a" : "teacher-math",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@ogretmen-akademi.example",
    id: "tenant-teacher",
    institutionType: "Dershane",
    name: "Öğretmen Akademi",
  };
}

function createTeacher() {
  return { branch: "Matematik", firstName: "Zeynep", id: "teacher-math", lastName: "Arslan", tenantId: "tenant-teacher" };
}

function createStudents() {
  return [
    { classId: "class-8a", firstName: "Ada", id: "student-a", lastName: "Kaya", responsibleTeacherId: "teacher-math", status: "ACTIVE", studentNo: "8001", tenantId: "tenant-teacher" },
    { classId: "class-8a", firstName: "Bora", id: "student-b", lastName: "Yilmaz", responsibleTeacherId: "teacher-math", status: "ACTIVE", studentNo: "8002", tenantId: "tenant-teacher" },
  ];
}

function createCampuses() {
  return [{ id: "campus-main", name: "Ana Kampüs", tenantId: "tenant-teacher" }];
}

function createClasses() {
  return [{ campusId: "campus-main", gradeLevelId: "grade-8", id: "class-8a", name: "8-A", section: "A", tenantId: "tenant-teacher" }];
}

function createCourses() {
  return [{ id: "course-math", name: "Matematik", tenantId: "tenant-teacher" }];
}

function createGradeLevels() {
  return [{ id: "grade-8", name: "8. Sınıf", tenantId: "tenant-teacher" }];
}

function createTerms() {
  return [{ id: "term-2026", name: "2026 Bahar", tenantId: "tenant-teacher" }];
}

function createTeacherLookups() {
  return {
    attendanceClassIds: ["class-8a"],
    campuses: createCampuses(),
    classes: [...createClasses(), { id: "class-visible", name: "8-B", tenantId: "tenant-teacher" }],
    courses: createCourses(),
    gradeLevels: createGradeLevels(),
    terms: createTerms(),
  };
}

function createTeacherToday() {
  return {
    date: "2026-06-17",
    generatedAt: "2026-06-17T08:00:00.000Z",
    latestReport: { examId: "exam-demo-isem-lgs-1", latestGeneratedAt: "2026-06-16T12:00:00.000Z", title: "İSEM LGS-1" },
    pendingHomework: [{ classId: "class-8a", dueAt: "2026-06-18T00:00:00.000Z", id: "homework-a", title: "Kesirler tekrar" }],
    pendingHomeworkCount: 1,
    pendingSubmissionCount: 2,
    teacherName: "Ayşe Öğretmen",
    todayLessons: [{ attendanceTaken: false, classId: "class-8a", className: "8-A", courseId: "course-math", endsAt: "2026-06-17T10:30:00.000Z", id: "schedule-a", startsAt: "2026-06-17T09:30:00.000Z", title: "Matematik problem çözümü" }],
    unpublishedGradeDraftCount: 1,
    unreadAnnouncementCount: 1,
  };
}

function createScheduleLessons() {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      endsAt: "2026-06-17T10:30:00.000Z",
      id: "schedule-a",
      startsAt: "2026-06-17T09:30:00.000Z",
      teacherId: "teacher-math",
      tenantId: "tenant-teacher",
      termId: "term-2026",
      title: "Matematik problem çözümü",
    },
  ];
}

function createAnnouncements() {
  return [{ audience: "TEACHERS", body: "Haftalık plan yayınlandı.", id: "announcement-a", tenantId: "tenant-teacher", title: "Haftalık plan" }];
}

function createAttendance() {
  return [
    { courseId: "course-math", date: "2026-06-17", id: "attendance-a", status: "PRESENT", studentId: "student-a", tenantId: "tenant-teacher", termId: "term-2026" },
    { courseId: "course-missing", date: "2026-06-17", id: "attendance-missing", status: "ABSENT", studentId: "student-missing", tenantId: "tenant-teacher", termId: "term-missing" },
  ];
}

function createDailyAttendance(url: URL) {
  const classId = url.searchParams.get("classId") ?? "class-8a";
  const date = url.searchParams.get("date") ?? "2026-06-17";
  const students = createStudents().filter((student) => student.classId === classId);
  const records = createAttendance().filter((record) => record.date === date && students.some((student) => student.id === record.studentId));
  return {
    classId,
    date,
    students,
    records,
    summary: { absent: 0, excused: 0, late: 0, present: records.length, total: records.length, unmarked: students.length - records.length },
  };
}

function createHomework() {
  return [{ classId: "class-8a", dueAt: "2026-06-20T12:00:00.000Z", id: "homework-a", sourceMaterialTitle: "Kesirler çalışma kağıdı", studentId: "student-a", tenantId: "tenant-teacher", title: "Kesirler tekrar" }];
}

function createMaterials() {
  return [{ id: "material-a", tenantId: "tenant-teacher", title: "LGS tekrar föyü" }];
}

function createMaterialAssignments() {
  return [
    { courseId: "course-math", dueAt: "2026-06-21T12:00:00.000Z", id: "assignment-a", materialId: "material-a", note: "1. bölüm", studentId: "student-a", tenantId: "tenant-teacher", termId: "term-2026" },
    { courseId: "course-missing", dueAt: "2026-06-22T12:00:00.000Z", id: "assignment-missing-lookup", materialId: "material-missing", note: "Eksik lookup", studentId: "student-a", tenantId: "tenant-teacher", termId: "term-missing" },
  ];
}

function createTeacherNotes() {
  return [
    { body: "Problem çözüm adımları takip edilecek.", courseId: "course-math", id: "note-a", studentId: "student-a", teacherId: "teacher-math", tenantId: "tenant-teacher", termId: "term-2026", visibility: "GUARDIAN_STUDENT" },
    { body: "Eksik lookup notu.", courseId: "course-missing", id: "note-missing", studentId: "student-missing", teacherId: "teacher-math", tenantId: "tenant-teacher", termId: "term-missing", visibility: "GUARDIAN_STUDENT" },
  ];
}

function createSupportTickets() {
  return [{ id: "ticket-a", priority: "NORMAL", status: "OPEN", subject: "Portal destek talebi", tenantId: "tenant-teacher" }];
}

function createReportSnapshots() {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      createdAt: "2026-06-17T12:00:00.000Z",
      examId: "exam-demo-isem-lgs-1",
      generatedAt: "2026-06-17T12:00:00.000Z",
      id: "snapshot-ready",
      reportType: "EXAM_RESULT_SUMMARY",
      snapshotData: {
        classes: [
          {
            averages: { blank: 1, correct: 25, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
            classId: "class-8a",
            className: "8-A",
            resultCount: 2,
          },
        ],
        generatedAt: "2026-06-17T12:00:00.000Z",
        resultCount: 2,
      },
      status: "READY",
      tenantId: "tenant-teacher",
      termId: "term-2026",
    },
  ];
}

function createStudentReport(studentId: "student-a" | "student-b") {
  const isAda = studentId === "student-a";
  return {
    branches: [
      { blank: 1, branch: "Matematik", classNetAverage: 10.5, correct: isAda ? 12 : 9, generalNetAverage: 9.8, net: isAda ? 11 : 8.5, questionCount: 15, schoolNetAverage: 10.8, successRate: isAda ? 73.3 : 60, wrong: isAda ? 2 : 5 },
      { blank: isAda ? 0 : 1, branch: "Turkce", classNetAverage: 11.2, correct: isAda ? 13 : 11, generalNetAverage: 10.1, net: isAda ? 13 : 10.5, questionCount: 15, schoolNetAverage: 11.9, successRate: isAda ? 86.7 : 66.7, wrong: isAda ? 2 : 3 },
    ],
    classId: "class-8a",
    className: "8-A",
    examId: "exam-demo-isem-lgs-1",
    examStartsAt: "2026-06-10T09:00:00.000Z",
    examTitle: "LGS Hazırlık Denemesi",
    generatedAt: "2026-06-10T12:00:00.000Z",
    institutionName: "Öğretmen Akademi",
    outcomes: [{ branch: "Matematik", correct: isAda ? 8 : 6, net: isAda ? 7.5 : 5.5, outcomeCode: "M.8.1", questionCount: 10, successRate: isAda ? 75 : 60, wrong: isAda ? 2 : 4 }],
    participantNo: isAda ? "176" : "177",
    questions: createQuestionSummaries(),
    resultKey: studentId,
    snapshotId: "snapshot-ready",
    statistics: {
      branches: [],
      class: { outOf: 2, percentile: isAda ? 100 : 50, rank: isAda ? 1 : 2 },
      general: { outOf: 2, percentile: isAda ? 100 : 50, rank: isAda ? 1 : 2 },
      standardScore: isAda ? 440 : 395,
    },
    studentId,
    studentName: isAda ? "Ada Kaya" : "Bora Yilmaz",
    tenantId: "tenant-teacher",
    total: { blank: isAda ? 1 : 2, correct: isAda ? 25 : 20, estimatedRawScore: isAda ? 440 : 395, net: isAda ? 24.5 : 19, questionCount: 30, standardScore: isAda ? 440 : 395, successRate: isAda ? 81.7 : 63.3, wrong: isAda ? 4 : 8 },
  };
}

function createQuestionSummaries() {
  return [
    { answer: "A", branch: "Matematik", correctAnswer: "A", outcomeCode: "M.8.1", questionNo: 1, status: "CORRECT" },
    { answer: "B", branch: "Matematik", correctAnswer: "C", outcomeCode: "M.8.1", questionNo: 2, status: "WRONG" },
  ];
}

function createErrorBooklet(studentId: string) {
  return {
    examId: "exam-demo-isem-lgs-1",
    generatedAt: "2026-06-10T12:00:00.000Z",
    items: createQuestionSummaries().filter((question) => question.status !== "CORRECT"),
    snapshotId: "snapshot-ready",
    studentId,
    tenantId: "tenant-teacher",
  };
}

function createProgress(studentId: string) {
  const current = createStudentReport(studentId as "student-a" | "student-b").total;
  const previous = studentId === "student-a"
    ? { blank: 2, correct: 20, net: 21, questionCount: 30, standardScore: 405, successRate: 70, wrong: 8 }
    : { blank: 2, correct: 16, net: 15.5, questionCount: 30, standardScore: 360, successRate: 51.6, wrong: 12 };
  return {
    examId: "exam-demo-isem-lgs-1",
    netDelta: 3.5,
    points: [
      { examTitle: "Mayıs Denemesi", generatedAt: "2026-05-10T12:00:00.000Z", snapshotId: "snapshot-prev", total: previous },
      { examTitle: "LGS Hazırlık Denemesi", generatedAt: "2026-06-10T12:00:00.000Z", snapshotId: "snapshot-ready", total: current },
    ],
    standardScoreDelta: 35,
    successRateDelta: 11.7,
    studentId,
    tenantId: "tenant-teacher",
  };
}

function createEnrollments() {
  return [{ classId: "class-8a", className: "8-A", id: "enrollment-a", startsAt: "2026-09-01T00:00:00.000Z", status: "ACTIVE", studentId: "student-a", tenantId: "tenant-teacher", termId: "term-2026" }];
}

async function expectPortalActionFocus(page: Page, actionStrip: Locator, linkName: RegExp, target: Locator, href: string) {
  const action = actionStrip.getByRole("link", { name: linkName });
  await action.click();
  await expect(target).toHaveAttribute("tabindex", "-1");
  await expect(target).toHaveClass(/next-portal-focus-target/);
  await expect(target).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${href}$`));

  await action.focus();
  await action.press("Enter");
  await expect(target).toHaveAttribute("tabindex", "-1");
  await expect(target).toHaveClass(/next-portal-focus-target/);
  await expect(target).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
}

async function clickAllPortalActionLinks(actionStrip: Locator) {
  for (const link of await actionStrip.getByRole("link").all()) {
    await link.click();
  }
}

async function expectPortalSummaryMetrics(summary: Locator, labels: string[], rawValues: readonly string[]) {
  await expect(summary).toHaveClass(/uh-metric-grid/);
  await expect(summary.locator("article")).toHaveCount(labels.length);
  await expect(summary.locator(".uh-metric-card")).toHaveCount(labels.length);
  await expect(summary.locator(".uh-metric-card__label")).toHaveText(labels);
  await expect(summary.locator("a, button, input, select, textarea")).toHaveCount(0);
  for (const value of rawValues) {
    await expect(summary).not.toContainText(value);
  }
}

async function expectNoUnlabeledControls(page: Page, label: string) {
  const unlabeledControls = await page.evaluate(() => {
    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    return Array.from(document.querySelectorAll("button, input, select, textarea"))
      .filter((element) => element.getAttribute("aria-hidden") !== "true")
      .filter((element) => isVisible(element))
      .filter((element) => {
        const htmlElement = element as HTMLElement;
        const text = htmlElement.textContent?.trim();
        const ariaLabel = htmlElement.getAttribute("aria-label")?.trim();
        const labelledBy = htmlElement.getAttribute("aria-labelledby")?.trim();
        const id = htmlElement.getAttribute("id");
        const labelElement = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrappingLabel = htmlElement.closest("label");
        return !text && !ariaLabel && !labelledBy && !labelElement && !wrappingLabel;
      })
      .map((element) => element.outerHTML.slice(0, 120));
  });
  expect(unlabeledControls, `${label}: unlabeled controls`).toEqual([]);
}

async function expectNoClippedVisibleText(page: Page, label: string) {
  const clippedTexts = await page.evaluate(() => {
    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    return Array.from(document.querySelectorAll("a, label, button, .uh-status-badge, .next-portal-summary-card, .next-portal-action-strip__item"))
      .filter((element) => isVisible(element))
      .filter((element) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        if (style.overflow === "visible" && style.overflowX === "visible" && style.overflowY === "visible") return false;
        return htmlElement.scrollWidth - htmlElement.clientWidth > 1 || htmlElement.scrollHeight - htmlElement.clientHeight > 1;
      })
      .map((element) => element.textContent?.trim().replace(/\s+/g, " ").slice(0, 120))
      .filter(Boolean);
  });

  expect(clippedTexts, `${label}: kırpılmış görünen metin`).toEqual([]);
}

async function expectPortalActionHrefs(actionStrip: Locator, expectedHrefs: readonly string[]) {
  const links = actionStrip.getByRole("link");
  await expect(links).toHaveCount(expectedHrefs.length);
  await expect.poll(() => links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))))
    .toEqual(expectedHrefs);
  for (const link of await links.all()) {
    await expect(link).toBeVisible();
    await expect(link).not.toHaveAccessibleName("");
  }
}

async function fulfillData(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
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
    "access-control-allow-origin": new URL(route.request().url()).origin === appOrigin ? appOrigin : corsHeaders["access-control-allow-origin"],
  };
}
