import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

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
  "/me/teacher/homework",
  "/me/teacher/homework/materials",
  "/me/teacher/homework/materials/material-a/assignments",
  "/me/teacher/teacher-notes",
  "/me/teacher/support-tickets",
  "/me/teacher/lookups",
  "/me/teacher/students/student-a/class-history",
  "/me/teacher/students/student-a/enrollments",
  "/me/teacher/students/student-b/class-history",
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
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("Öğretmen portalı sözleşmesi", () => {
  for (const viewport of [
    { height: 844, width: 390 },
    { height: 1024, width: 768 },
  ]) {
    test(`öğretmen çalışma alanı ${viewport.width}px görünümde taşmaz`, async ({ page }) => {
      const requestedPaths: string[] = [];
      await openTeacherPortal(page, viewport, { requestedPaths });

      await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
      const portalSummary = page.getByRole("region", { exact: true, name: "Portal özeti" });
      await expectPortalSummaryMetrics(
        portalSummary,
        ["Ders", "Öğrenci", "Yoklama", "Ödev", "Başarı", "Net", "Soru", "Destek"],
        rawInternalValues,
      );
      await expect(portalSummary).toContainText("Başarı % ana metrik");
      await expect(portalSummary).toContainText("Soru sayısı bağlamıyla okunur");
      const workspace = page.getByRole("region", { name: "Öğrenci çalışma alanı" });
      await expect(workspace).toContainText("Öğrenci Takibi");
      await expect(workspace).toContainText("Ada Kaya / 8-A");

      const focus = workspace.getByRole("region", { exact: true, name: "Öğretmen operasyon bağlamı" });
      await expect(focus).toContainText("Öğrenci Odağı");
      await expect(focus).toContainText("İşlem açık");
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

      await expectTeacherDisplayPanels(page);
      await expectTeacherActivityPanels(page);

      const dailyBrief = page.getByRole("region", { exact: true, name: "Günlük ders akışı" });
      const dailyScope = dailyBrief.getByLabel("Günlük ders akışı görev kapsamı");
      await expect(dailyScope).toContainText("Seçili öğrenci");
      await expect(dailyScope).toContainText("Ada Kaya / 8-A");
      await expect(dailyScope).toContainText("Matematik / 2026 Bahar");
      for (const value of rawInternalValues) {
        await expect(dailyScope).not.toContainText(value);
      }

      const actionStrip = page.getByRole("region", { name: "Öğretmen günlük aksiyonları" });
      await expect(actionStrip).toBeVisible();
      await expect(actionStrip).toContainText("Günlük iş kuyruğu");
      await expect(actionStrip.getByRole("heading", { name: "Öncelikli aksiyonlar" })).toBeVisible();
      await expect(actionStrip).toContainText("8 aksiyon");
      await expect(actionStrip.getByRole("link", { name: /Öğrenci seç: Ada Kaya \/ 8-A/ })).toHaveAttribute(
        "href",
        "/ogretmen/ogrenci-takibi",
      );
      await expect(actionStrip.getByRole("link", { name: /Yoklama kaydet: 2 kayıt.*Yoklama.*Kaydet.*Bugün.*2026-06-17 için yoklama/ })).toHaveAttribute(
        "href",
        "/ogretmen/ogrenci-takibi",
      );
      await expect(actionStrip.getByRole("link", { name: /Not ekle: 2 not/ })).toHaveAttribute("href", "/ogretmen/ogrenci-takibi");
      await expect(actionStrip.getByRole("link", { name: /Materyal ata: 1 materyal/ })).toHaveAttribute(
        "href",
        "/ogretmen/ogrenci-takibi",
      );
      await expect(actionStrip.getByRole("link", { name: /Ödev kontrol et: 1 bekliyor/ })).toHaveAttribute(
        "href",
        "/ogretmen/odevler",
      );
      await expect(
        actionStrip.getByRole("link", { name: /Raporu incele: %81,7.*Rapor.*İncele.*Başarı %.*24,5 net \/ 30 soru/ }),
      ).toHaveAttribute("href", "/ogretmen/raporlar");
      await expect(actionStrip.getByRole("link", { name: /Destek talebini takip et: 1 açık/ })).toHaveAttribute(
        "href",
        "/ogretmen/destek",
      );
      await expect(actionStrip.getByRole("link", { name: /Önizleme durumu: İşlem açık/ })).toHaveAttribute(
        "href",
        "/ogretmen/ogrenci-takibi",
      );
      await expect(actionStrip.getByRole("link")).toHaveCount(8);
      const studentScope = page.getByRole("region", { exact: true, name: "Öğretmen öğrenci kapsamı" });
      await expect(studentScope.getByRole("heading", { name: "Öğrenciler" })).toBeVisible();
      await expect(studentScope.getByRole("button", { name: "Ada Kaya / 8-A" })).toHaveAttribute("aria-pressed", "true");
      const dailyActions = page.getByRole("region", { name: "Öğretmen günlük işlemleri" });
      await expect(dailyActions).toBeVisible();
      await expect(dailyActions.locator(".uh-field")).toHaveCount(17);
      await expect(dailyActions.locator(".uh-select")).toHaveCount(12);
      await expect(dailyActions.locator(".uh-textarea")).toHaveCount(2);
      await expect(dailyActions.getByRole("textbox", { name: /^Not / })).toBeVisible();
      await expect(dailyActions.getByRole("textbox", { name: /^Atama notu / })).toBeVisible();
      await expect(page.getByRole("button", { name: "Yoklama kaydet" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Not ekle" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Materyal ata" })).toBeVisible();
      await expectTeacherHomeworkPanels(page, { readOnly: false });
      await expect(page.getByRole("table", { name: "Bugünkü dersler" })).toBeVisible();
      const schedule = page.getByRole("region", { exact: true, name: "Ders programı" });
      await expect(schedule.getByRole("heading", { name: "Program" })).toBeVisible();
      await expect(schedule.getByRole("table", { name: "Ders programı" })).toBeVisible();
      await expect(page.getByRole("table", { name: "Öğretmen sınıf raporları" })).toBeVisible();
      await expectPortalAnnouncementsTable(page, { readOnly: false });
      await expectPortalSupportPanel(page, { formVisible: true });

      const reportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
      await expect(reportSummary).toContainText("Başarı %");
      await expect(reportSummary.getByRole("button", { name: "Karne detayını göster" })).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("region", { name: "Sınav raporu özet sayfası" })).toHaveCount(0);
      const branchTable = page.getByRole("table", { name: "Portal branş başarıları" });
      await expect(branchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
      await expect(branchTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
      await expect(branchTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();

      await workspace.getByRole("button", { name: "Bora Yilmaz / 8-A" }).click();
      await expect(focus).toContainText("Bora Yilmaz");
      await expect(focus).toContainText("%63,3");
      await expect(page.getByRole("region", { name: "Öğretmen günlük aksiyonları" })).toContainText("Bora Yilmaz / 8-A");
      await expect(dailyScope).toContainText("Bora Yilmaz / 8-A");

      await expectNoHorizontalOverflow(page, `teacher-portal-${viewport.width}`);
      await expectNoUnlabeledControls(page, `teacher-portal-${viewport.width}`);
      await expectNoClippedVisibleText(page, `teacher-portal-${viewport.width}`);
      expect(requestedPaths.filter((path) => forbiddenTeacherPortalReadPaths.includes(path) || path.startsWith("/students/"))).toEqual([]);
      for (const path of expectedTeacherScopedReadPaths) {
        expect(requestedPaths).toContain(path);
      }
    });
  }

  test("öğretmen rol önizlemesi salt-okuma kalır", async ({ page }) => {
    const mutationRequests: string[] = [];
    await openTeacherPortal(page, { height: 844, width: 390 }, { mode: "role-preview", mutationRequests });

    await expect(page).toHaveURL(/\/ogretmen\?rolePreview=1$/);
    expect(page.url()).not.toContain("preview-token");
    await expect(page.getByLabel("Rol önizleme modu")).toContainText("Salt-okuma Önizleme");
    const previewActions = page.getByRole("region", { name: "Öğretmen günlük aksiyonları" });
    await expect(previewActions).toBeVisible();
    await expect(previewActions).toContainText("Salt-okuma");
    await expect(previewActions).toContainText("Yoklama, not ve materyal kapalı");
    await expect(previewActions.getByRole("link", { name: /Yoklama kaydet: Salt-okuma/ })).toHaveAttribute(
      "href",
      "/ogretmen?rolePreview=1",
    );
    await expect(previewActions.getByRole("link", { name: /Not ekle: Salt-okuma/ })).toHaveAttribute("href", "/ogretmen?rolePreview=1");
    await expect(previewActions.getByRole("link", { name: /Materyal ata: Salt-okuma/ })).toHaveAttribute(
      "href",
      "/ogretmen?rolePreview=1",
    );
    await expect(previewActions.getByRole("link", { name: /Raporu incele/ })).toHaveAttribute("href", "/ogretmen/raporlar?rolePreview=1");
    await expect(page.getByRole("region", { name: "Öğretmen günlük işlemleri" })).toHaveCount(0);
    await expect(page.getByRole("region", { exact: true, name: "Öğretmen operasyon bağlamı" })).toContainText("Salt-okuma");
    await expectTeacherDisplayPanels(page);
    await expectTeacherActivityPanels(page);
    await expectPortalAnnouncementsTable(page, { readOnly: true });
    await expect(page.getByLabel("Destek talepleri")).toContainText("Salt-okuma önizlemede destek talebi açılamaz.");
    await expectPortalSupportPanel(page, { formVisible: false });
    await expectTeacherHomeworkPanels(page, { readOnly: true });
    await expectNoHorizontalOverflow(page, "teacher-portal-role-preview");
    await expectNoUnlabeledControls(page, "teacher-portal-role-preview");
    await expectNoClippedVisibleText(page, "teacher-portal-role-preview");
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
      { context: "Destek talepleri", label: "Destek", path: "/ogretmen/destek", panel: () => page.getByRole("region", { name: "Destek talepleri" }) },
    ];

    for (const routeCase of routeCases) {
      await clickSidebarRoute(page, "Öğretmen Paneli", routeCase.label);
      await expect(page).toHaveURL(new RegExp(`${routeCase.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
      await expect(page.getByRole("region", { exact: true, name: "Portal görev bağlamı" })).toContainText(routeCase.context);
      await expect(routeCase.panel()).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { exact: true, name: "Özet" })).not.toHaveAttribute("aria-current", "page");
    }
  });

  test("öğretmen işlem hatasını alert olarak duyurur", async ({ page }) => {
    const mutationRequests: string[] = [];
    await openTeacherPortal(page, { height: 844, width: 390 }, { failMutationPath: "/attendance", mutationRequests });

    await page.getByRole("button", { name: "Yoklama kaydet" }).click();

    const alert = page.getByRole("region", { name: "Öğretmen günlük işlemleri" }).getByRole("alert");
    await expect(alert).toContainText("İşlem kaydedilemedi");
    await expect(alert).toContainText("Yoklama kaydı eklenemedi.");
    await expect.poll(() => mutationRequests).toEqual(expect.arrayContaining(["POST /attendance"]));
  });
});

async function expectTeacherFocusMetrics(focus: Locator) {
  const focusMetrics = focus.getByRole("region", { name: "Öğretmen operasyon bağlam metrikleri" });
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
    "LGS puanı",
    "Standart puan",
  ]);
  await expect(reportsTable).toContainText("Başarı % ana karşılaştırma metriğidir");

  for (const panel of [today, profile, reports]) {
    for (const value of rawInternalValues) {
      await expect(panel).not.toContainText(value);
    }
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
  await expect(homeworkTable.locator("thead th")).toHaveText(["Ödev", "Materyal", "Teslim", "Durum", "İşlem"]);
  if (options.readOnly) {
    await expect(homework.getByRole("button", { name: "Kontrol et" })).toHaveCount(0);
    await expect(homework).toContainText("Salt-okuma");
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
  const announcements = page.getByRole("region", { name: "Duyurular" });
  const table = page.getByRole("table", { name: "Portal duyuruları" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Başlık" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Hedef" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Okunma" })).toBeVisible();
  if (options.readOnly) {
    await expect(announcements.getByRole("button", { name: "Okundu işaretle" })).toHaveCount(0);
    await expect(announcements).toContainText("Salt-okuma");
  } else {
    await expect(announcements.getByRole("button", { name: "Okundu işaretle" })).toBeVisible();
  }
}

async function expectPortalSupportPanel(page: Page, options: { formVisible: boolean }) {
  const support = page.getByRole("region", { name: "Destek talepleri" });
  const table = page.getByRole("table", { name: "Destek talepleri" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Konu" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Öncelik" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Durum" })).toBeVisible();
  await expect(support.locator(".uh-status-badge", { hasText: "Normal" })).toBeVisible();
  await expect(support.locator(".uh-status-badge", { hasText: "Açık" })).toBeVisible();
  if (options.formVisible) {
    await expect(support.getByLabel("Konu")).toBeVisible();
    await expect(support.getByLabel("Mesaj")).toBeVisible();
    await expect(support.getByLabel("Öncelik")).toBeVisible();
  } else {
    await expect(support.getByLabel("Konu")).toHaveCount(0);
    await expect(support.getByLabel("Mesaj")).toHaveCount(0);
    await expect(support.getByLabel("Öncelik")).toHaveCount(0);
  }
}

async function openTeacherPortal(
  page: Page,
  viewport: { height: number; width: number },
  options: { failMutationPath?: string; mode?: "teacher" | "role-preview"; mutationRequests?: string[]; requestedPaths?: string[] } = {},
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
  await page.goto(options.mode === "role-preview" ? "/ogretmen?rolePreview=1" : "/ogretmen");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function clickSidebarRoute(page: Page, groupName: string, linkName: string) {
  const navigation = page.getByRole("navigation", { name: "Ana menü" });
  const groupButton = navigation.getByRole("button", { exact: true, name: groupName });
  if ((await groupButton.getAttribute("aria-expanded")) !== "true") {
    await groupButton.click();
  }
  await navigation.getByRole("link", { exact: true, name: linkName }).click();
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installTeacherApiMocks(
  page: Page,
  options: { failMutationPath?: string; mode?: "teacher" | "role-preview"; mutationRequests?: string[]; requestedPaths?: string[] },
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

    const response = teacherApiResponse(pathName, options.mode ?? "teacher");
    await fulfillData(route, response);
  });
}

function teacherApiResponse(pathName: string, mode: "teacher" | "role-preview"): unknown {
  if (pathName === "/auth/refresh") return createAuthResponse(mode);
  if (pathName === "/me/tenant") return createTenantResponse();
  if (pathName === "/me/notification-devices") return [];
  if (pathName === "/me/teacher") return createTeacher();
  if (pathName === "/me/teacher/announcements") return createAnnouncements();
  if (pathName === "/me/teacher/schedule") return createScheduleLessons();
  if (pathName === "/me/teacher/students") return createStudents();
  if (pathName === "/me/teacher/attendance") return createAttendance();
  if (pathName === "/me/teacher/homework") return createHomework();
  if (pathName === "/me/teacher/homework/materials") return createMaterials();
  if (pathName === "/me/teacher/homework/materials/material-a/assignments") return createMaterialAssignments();
  if (pathName === "/me/teacher/teacher-notes") return createTeacherNotes();
  if (pathName === "/me/teacher/support-tickets") return createSupportTickets();
  if (pathName === "/me/teacher/lookups") return createTeacherLookups();
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots") return createReportSnapshots();
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-a") return createStudentReport("student-a");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-b") return createStudentReport("student-b");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-a/error-booklet") return createErrorBooklet("student-a");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-ready/students/student-b/error-booklet") return createErrorBooklet("student-b");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/students/student-a/progress") return createProgress("student-a");
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/students/student-b/progress") return createProgress("student-b");
  if (pathName === "/me/teacher/students/student-a/class-history" || pathName === "/me/teacher/students/student-b/class-history") return createClassHistory();
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
    campuses: createCampuses(),
    classes: createClasses(),
    courses: createCourses(),
    gradeLevels: createGradeLevels(),
    terms: createTerms(),
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

function createClassHistory() {
  return [{ classId: "class-8a", className: "8-A", id: "history-a", startsAt: "2026-09-01T00:00:00.000Z", studentId: "student-a", tenantId: "tenant-teacher", termId: "term-2026" }];
}

function createEnrollments() {
  return [{ classId: "class-8a", className: "8-A", id: "enrollment-a", startsAt: "2026-09-01T00:00:00.000Z", status: "ACTIVE", studentId: "student-a", tenantId: "tenant-teacher", termId: "term-2026" }];
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    return documentElement.scrollWidth - documentElement.clientWidth;
  });
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(2);
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
