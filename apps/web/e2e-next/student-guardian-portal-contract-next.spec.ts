import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const smsEnabled = process.env.NEXT_PUBLIC_SMS_ENABLED === "true";
const rawPiiValues = ["12345678901", "+905551234567", "ada.kaya@example.test", "bora.yilmaz@example.test"];
const rawInternalValues = ["student-a", "student-b", "teacher-math", "course-math", "term-2026"];

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token,x-role-preview-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("Öğrenci veli portalı sözleşmesi", () => {
  for (const viewport of [
    { height: 812, width: 320 },
    { height: 812, width: 375 },
    { height: 896, width: 414 },
    { height: 1024, width: 768 },
  ]) {
    test(`öğrenci portalı ${viewport.width}px görünümde kapsamı ve PII güvenliğini korur`, async ({ page }) => {
      const requestedPaths: string[] = [];
      await openStudentPortal(page, viewport, { requestedPaths });

      await expect(page.getByRole("heading", { level: 1, name: "Öğrenci Portalı" })).toBeVisible();
      const portalSummary = page.getByRole("region", { exact: true, name: "Portal özeti" });
      await expectPortalSummaryMetrics(
        portalSummary,
        ["Toplam devamsızlık", "Geç kalma", "Not", "Ödev", "Başarı", "Net", "Soru", "Gelişim"],
        rawPiiValues,
      );
      await expect(portalSummary).toContainText("Başarı % ana metrik");
      await expect(portalSummary).toContainText("Soru sayısı bağlamıyla okunur");
      const focus = page.getByRole("region", { exact: true, name: "Seçili öğrenci özeti" });
      await expect(focus).toContainText("Seçili Öğrenci");
      await expect(focus).toContainText("Öğrenci hesabı");
      await expectStudentFocusMetrics(focus, 8);
      await expect(focus).toContainText("Başarı %");
      await expect(focus).toContainText("%81,7");
      await expect(focus).toContainText("Soru");
      await expect(focus).toContainText("30");
      await expect(focus).toContainText("Net");
      await expect(focus).toContainText("24,5");
      const studentDailyScope = page.getByRole("region", { exact: true, name: "Günlük durum" }).getByLabel("Günlük durum için seçilen kişi veya sınıf");
      await expect(studentDailyScope).toContainText("Öğrenci");
      await expect(studentDailyScope).toContainText("Ada Kaya");
      await expect(studentDailyScope).toContainText("Öğrenci hesabı");
      await expectNoPortalActionPiiLeak(studentDailyScope, rawPiiValues);
      const studentActions = page.getByRole("region", { name: "Öğrenci günlük aksiyonları" });
      await expect(studentActions).toContainText("Bugün yapılacaklar");
      await expect(studentActions).toContainText("Öncelikli işler");
      await expect(studentActions).toContainText("6 iş");
      await expect(studentActions).toContainText("2 öncelikli");
      await expect(studentActions.getByRole("link", { name: /Duyuruları oku: 1 okunmamış/ })).toHaveAttribute("href", "/ogrenci/duyurular");
      await expect(studentActions.getByRole("link", { name: /Ödevi aç: 1 atama/ })).toHaveAttribute("href", "/ogrenci/odevler");
      await expect(studentActions.getByRole("link", { name: /Son sınavı incele: %81,7/ })).toHaveAttribute("href", "/ogrenci/raporlar");
      await expect(studentActions.getByRole("link", { name: /Devamsızlığı kontrol et: 30 kayıt/ })).toHaveAttribute("href", "/ogrenci/devamsizlik");
      await expect(studentActions.getByRole("link", { name: /Destek talebini takip et: 1 açık/ })).toHaveAttribute("href", "/ogrenci/destek");
      await expect(studentActions.getByRole("link", { name: /Önizleme durumu: Canlı hesap/ })).toHaveAttribute("href", "/ogrenci/profil");
      await expect(studentActions.getByRole("link")).toHaveCount(6);
      await expectPortalActionHrefs(studentActions, [
        "/ogrenci/duyurular",
        "/ogrenci/odevler",
        "/ogrenci/raporlar",
        "/ogrenci/devamsizlik",
        "/ogrenci/destek",
        "/ogrenci/profil",
      ]);
      await expectNoPortalActionPiiLeak(studentActions, rawPiiValues);
      await expectAnchorsAttached(page, [
        "#portal-announcements",
        "#portal-homework",
        "#portal-attendance",
        "#portal-support",
        "#portal-report",
        "#portal-focus",
      ]);
      await expect(page.getByRole("region", { exact: true, name: "Öğrenci portal çalışma alanı" })).toBeVisible();
      await expectStudentProfileAndHistoryPanels(page);
      await expectGuardianRelationsPanel(page);
      await expectPortalActivityPanels(page);
      await expect(page.getByRole("region", { name: "Portal rapor özeti" })).toContainText("Başarı %");
      await expectHomeworkAssignmentsPanel(page);
      await expectPortalAnnouncementsTable(page, { readOnly: false });
      await expectPortalSupportPanel(page, { formVisible: true });

      for (const value of rawPiiValues) {
        await expect(page.locator("body")).not.toContainText(value);
      }
      expect(requestedPaths.filter((path) => path === "/students" || path.startsWith("/students/"))).toEqual([]);
      await expectNoHorizontalOverflow(page, `student-portal-${viewport.width}`);
      await expectNoUnlabeledControls(page, `student-portal-${viewport.width}`);
      await expectNoClippedVisibleText(page, `student-portal-${viewport.width}`);
    });
  }

  test("öğrenci rol önizlemesinde işlem yapılamaz", async ({ page }) => {
    const mutationRequests: string[] = [];
    await openStudentPortal(page, { height: 844, width: 390 }, { mode: "role-preview", mutationRequests });

    await expect(page).toHaveURL(/\/ogrenci\?rolePreview=1$/);
    expect(page.url()).not.toContain("preview-token");
      await expect(page.getByLabel("Rol önizleme bilgisi")).toContainText("Yalnızca Görüntüleme");
      await expect(page.getByRole("region", { exact: true, name: "Seçili öğrenci özeti" })).toContainText("Yalnızca görüntüleme");
      await expect(page.getByLabel("Günlük durum için seçilen kişi veya sınıf")).toContainText("Yalnızca görüntüleme");
      const studentPreviewActions = page.getByRole("region", { name: "Öğrenci günlük aksiyonları" });
    await expect(studentPreviewActions).toContainText("Önizleme durumu");
    await expect(studentPreviewActions).toContainText("Yalnızca görüntüleme");
    await expect(studentPreviewActions.getByRole("link", { name: /Önizleme durumu: Yalnızca görüntüleme/ })).toHaveAttribute("href", "/ogrenci?rolePreview=1");
    await expect(studentPreviewActions.getByRole("link", { name: /Duyuruları oku/ })).toHaveAttribute("href", "/ogrenci/duyurular?rolePreview=1");
    await expectPortalActionHrefs(studentPreviewActions, [
      "/ogrenci?rolePreview=1",
      "/ogrenci/duyurular?rolePreview=1",
      "/ogrenci/raporlar?rolePreview=1",
      "/ogrenci/odevler?rolePreview=1",
      "/ogrenci/devamsizlik?rolePreview=1",
      "/ogrenci/destek?rolePreview=1",
    ]);
    await expectStudentProfileAndHistoryPanels(page);
    await expectGuardianRelationsPanel(page);
    await expectPortalActivityPanels(page);
    await expectHomeworkAssignmentsPanel(page);
    await expectPortalAnnouncementsTable(page, { readOnly: true });
    await expect(page.getByLabel("Destek talepleri", { exact: true })).toContainText("Yalnızca görüntüleme sırasında destek talebi açılamaz.");
    await expectPortalSupportPanel(page, { formVisible: false });
    await expect(page.getByRole("button", { name: "Destek talebi aç" })).toHaveCount(0);
    await expect.poll(() => mutationRequests).toEqual([]);
  });

  test("öğrenci destek konuşmasına yalnız metin yanıtı ekler", async ({ page }) => {
    const mutationRequests: string[] = [];
    await openStudentPortal(page, { height: 844, width: 390 }, { mutationRequests, withReport: false });

    const conversation = page.getByRole("region", { name: "Destek konuşması" });
    await expect(conversation).toContainText("Kurum yanıtı");
    await conversation.getByLabel("Yanıtınız").fill("Teşekkür ederim.");
    await conversation.getByRole("button", { name: "Yanıt gönder" }).click();
    await expect(conversation).toContainText("Teşekkür ederim.");
    await expect.poll(() => mutationRequests).toContain("POST /me/student/support-tickets/ticket-a/comments");
    await expect(conversation.locator('input[type="file"]')).toHaveCount(0);
  });

  test("öğrenci ve veli portalları examId yokken demo rapor endpointine gitmez", async ({ page }) => {
    const studentPaths: string[] = [];
    await openStudentPortal(page, { height: 844, width: 390 }, { requestedPaths: studentPaths, withReport: false });
    expect(studentPaths.filter((path) => path.includes("/reports/"))).toEqual([]);
    await expect(page.getByRole("region", { name: "Portal rapor özeti" })).toContainText("Rapor bekleniyor");

    await page.unroute("**/api/v1/**");
    const guardianPaths: string[] = [];
    await openGuardianPortal(page, { height: 844, width: 390 }, { requestedPaths: guardianPaths, withReport: false });
    expect(guardianPaths.filter((path) => path.includes("/reports/"))).toEqual([]);
    await expect(page.getByRole("region", { name: "Portal rapor özeti" })).toContainText("Rapor bekleniyor");
  });

  test("öğrenci sidebar alt rotaları gerçek sayfaları açar", async ({ page }) => {
    await openStudentPortal(page, { height: 900, width: 1024 });

    const routeCases = [
      { context: "Sınav raporu", label: "Sınav Raporu", path: "/ogrenci/raporlar", panel: () => page.getByRole("region", { name: "Portal rapor özeti" }) },
      { context: "Ödevler", label: "Ödevler", path: "/ogrenci/odevler", panel: () => page.getByRole("region", { exact: true, name: "Ödevler" }) },
      { context: "Duyurular", label: "Duyurular", path: "/ogrenci/duyurular", panel: () => page.getByRole("region", { exact: true, name: "Duyurular" }) },
      { context: "Devamsızlık", label: "Devamsızlık", path: "/ogrenci/devamsizlik", panel: () => page.getByRole("region", { exact: true, name: "Devamsızlık" }) },
      { context: "Profil ve kayıt bilgileri", label: "Profil", path: "/ogrenci/profil", panel: () => page.getByRole("region", { exact: true, name: "Profil" }) },
      { context: "Destek talepleri", label: "Kurum Desteği", path: "/ogrenci/destek", panel: () => page.getByRole("region", { exact: true, name: "Destek talepleri" }) },
    ];

    for (const routeCase of routeCases) {
      await clickSidebarRoute(page, "Öğrenci Paneli", routeCase.label);
      await expect(page).toHaveURL(new RegExp(`${routeCase.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: "Öğrenci Portalı" })).toBeVisible();
      await expect(page.getByRole("region", { exact: true, name: "Portal görünümü" })).toContainText(routeCase.context);
      await expect(routeCase.panel()).toBeVisible();
      if (routeCase.label === "Sınav Raporu") await expect(page.getByRole("combobox", { name: "Sınav raporu" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { exact: true, name: "Özet" })).not.toHaveAttribute("aria-current", "page");
    }
  });

  for (const viewport of [
    { height: 812, width: 320 },
    { height: 812, width: 375 },
    { height: 896, width: 414 },
    { height: 1024, width: 768 },
  ]) {
    test(`veli portalı ${viewport.width}px görünümde öğrenci kapsamı ve finans iznini korur`, async ({ page }) => {
      const paymentPlanRequests: string[] = [];
      const requestedPaths: string[] = [];
      await openGuardianPortal(page, viewport, { financeVisibility: "false", paymentPlanRequests, requestedPaths });

      await expect(page.getByRole("heading", { level: 1, name: "Veli Portalı" })).toBeVisible();
      const portalSummary = page.getByRole("region", { exact: true, name: "Portal özeti" });
      await expectPortalSummaryMetrics(
        portalSummary,
        ["Devamsızlık", "Öğretmen notu", "Ödev", "Başarı", "Net", "Soru", "Ödeme planı", "Bekleyen ödeme"],
        rawPiiValues,
      );
      await expect(portalSummary).toContainText("Başarı % ana metrik");
      await expect(portalSummary).toContainText("Finans görünürlüğü izin kapsamına bağlıdır");
      await expect(portalSummary).toContainText("Kapalı");
      await expect(portalSummary).not.toContainText("500,00 TRY");
      const focus = page.getByRole("region", { exact: true, name: "Seçili öğrenci özeti" });
      await expect(focus).toContainText("Seçili Öğrenci");
      await expect(focus).toContainText("Veli görünümü");
      await expectStudentFocusMetrics(focus, 9);
      await expect(focus).toContainText("Ödemeler");
      await expect(focus).toContainText("Kapalı");
      const guardianDailyScope = page.getByRole("region", { exact: true, name: "Günlük durum" }).getByLabel("Günlük durum için seçilen kişi veya sınıf");
      await expect(guardianDailyScope).toContainText("Bağlı öğrenci");
      await expect(guardianDailyScope).toContainText("Ada Kaya");
      await expect(guardianDailyScope).toContainText("Finans görünürlüğü kapalı");
      await expect(guardianDailyScope).not.toContainText("500,00 TRY");
      await expectNoPortalActionPiiLeak(guardianDailyScope, rawPiiValues);
      const guardianActions = page.getByRole("region", { name: "Veli günlük aksiyonları" });
      await expect(guardianActions).toContainText("Bugün yapılacaklar");
      await expect(guardianActions).toContainText("Öncelikli işler");
      await expect(guardianActions).toContainText("7 iş");
      await expect(guardianActions).toContainText("1 öncelikli");
      await expect(guardianActions.getByRole("link", { name: /Duyuruları oku: 1 okunmamış/ })).toHaveAttribute("href", "/veli/duyurular");
      await expect(guardianActions.getByRole("link", { name: /Öğrenci seç: Ada Kaya/ })).toHaveAttribute("href", "/veli/ogrenci");
      await expect(
        guardianActions.getByRole("link", { name: /Ödeme durumunu gör: Ödeme izni kapalı.*Finans.*Kapalı.*Finans görünürlüğü kapalı/ }),
      ).toHaveAttribute("href", "/veli/odemeler");
      await expect(guardianActions.getByRole("link", { name: /Son sınavı incele: %81,7/ })).toHaveAttribute("href", "/veli/raporlar");
      await expect(guardianActions.getByRole("link", { name: /Ödevi kontrol et: 1 atama/ })).toHaveAttribute("href", "/veli/odevler");
      await expect(guardianActions.getByRole("link", { name: /Destek talebini takip et: Kapalı/ })).toHaveAttribute("href", "/veli/destek");
      await expect(guardianActions.getByRole("link", { name: /Önizleme durumu: Canlı hesap/ })).toHaveAttribute("href", "/veli/bildirimler");
      await expect(guardianActions).toContainText("Finans görünürlüğü kapalı");
      await expect(guardianActions.getByRole("link")).toHaveCount(7);
      await expectPortalActionHrefs(guardianActions, [
        "/veli/ogrenci",
        "/veli/odemeler",
        "/veli/raporlar",
        "/veli/duyurular",
        "/veli/odevler",
        "/veli/destek",
        "/veli/bildirimler",
      ]);
      await expectNoPortalActionPiiLeak(guardianActions, rawPiiValues);
      await expect(guardianActions).not.toContainText("500,00 TRY");
      await expectAnchorsAttached(page, [
        "#portal-student-picker",
        "#portal-announcements",
        "#portal-homework",
        "#portal-payments",
        "#portal-support",
        "#portal-report",
        "#portal-focus",
      ]);
      await expect(page.getByRole("region", { exact: true, name: "Veli portal çalışma alanı" })).toBeVisible();
      await expectStudentProfileAndHistoryPanels(page);
      await expectGuardianRelationshipSummary(page);
      await expectPortalActivityPanels(page);
      await expect(page.getByLabel("Destek talepleri", { exact: true })).toContainText("Veli destek talebi izni kapalı.");
      await expectHomeworkAssignmentsPanel(page);
      await expectPortalAnnouncementsTable(page, { readOnly: false });
      await expectPortalSupportPanel(page, { formVisible: false });
      await expect(page.getByRole("button", { name: "Destek talebi aç" })).toHaveCount(0);
      await expect(page.getByLabel("Ödeme planları")).toContainText("Ödeme görünümü kapalı.");
      await expect(page.getByText("500,00 TRY")).toHaveCount(0);
      await expect.poll(() => paymentPlanRequests).toEqual([]);

      await page.getByRole("button", { name: "Bora Yilmaz" }).click();
      await expect(page.getByRole("region", { exact: true, name: "Seçili öğrenci özeti" })).toContainText("Bora Yilmaz");
      await expect(page.getByRole("region", { name: "Veli günlük aksiyonları" })).toContainText("Bora Yilmaz");
      await expect(guardianDailyScope).toContainText("Bora Yilmaz");
      await expect(page.getByRole("table", { name: "Ödev ve materyal atamaları" })).toContainText("Bora tekrar");
      await expect(page.getByRole("table", { name: "Ödev ve materyal atamaları" })).not.toContainText("Ada tekrar");
      expect(requestedPaths).toContain("/me/guardian/students/student-a/homework/material-assignments");
      expect(requestedPaths).toContain("/me/guardian/students/student-b/homework/material-assignments");
      expect(requestedPaths.filter((path) => path === "/me/guardian/homework/material-assignments")).toEqual([]);
      await expectNoHorizontalOverflow(page, `guardian-portal-${viewport.width}`);
      await expectNoUnlabeledControls(page, `guardian-portal-${viewport.width}`);
      await expectNoClippedVisibleText(page, `guardian-portal-${viewport.width}`);
    });
  }

  test("veli rol önizlemesinde işlem yapılamaz", async ({ page }) => {
    const mutationRequests: string[] = [];
    await openGuardianPortal(page, { height: 844, width: 390 }, { mode: "role-preview", mutationRequests });

    await expect(page).toHaveURL(/\/veli\?rolePreview=1$/);
    expect(page.url()).not.toContain("preview-token");
    await expect(page.getByLabel("Rol önizleme bilgisi")).toContainText("Yalnızca Görüntüleme");
    await expect(page.getByRole("region", { exact: true, name: "Seçili öğrenci özeti" })).toContainText("Yalnızca görüntüleme");
    const guardianPreviewActions = page.getByRole("region", { name: "Veli günlük aksiyonları" });
    await expect(guardianPreviewActions).toContainText("Önizleme durumu");
    await expect(guardianPreviewActions).toContainText("Yalnızca görüntüleme");
    await expect(guardianPreviewActions.getByRole("link", { name: /Önizleme durumu: Yalnızca görüntüleme/ })).toHaveAttribute("href", "/veli?rolePreview=1");
    await expect(guardianPreviewActions.getByRole("link", { name: /Duyuruları oku/ })).toHaveAttribute("href", "/veli/duyurular?rolePreview=1");
    await expect(guardianPreviewActions.getByRole("link", { name: /Ödeme durumunu gör/ })).toHaveAttribute("href", "/veli/odemeler?rolePreview=1");
    await expectPortalActionHrefs(guardianPreviewActions, [
      "/veli?rolePreview=1",
      "/veli/destek?rolePreview=1",
      "/veli/ogrenci?rolePreview=1",
      "/veli/duyurular?rolePreview=1",
      "/veli/odevler?rolePreview=1",
      "/veli/odemeler?rolePreview=1",
      "/veli/raporlar?rolePreview=1",
    ]);
    const preferenceCheckboxes = page.getByLabel("Bildirim tercihleri").locator('input[type="checkbox"]');
    const preferenceCheckboxCount = smsEnabled ? 3 : 2;
    await expect(preferenceCheckboxes).toHaveCount(preferenceCheckboxCount);
    for (let index = 0; index < preferenceCheckboxCount; index += 1) {
      await expect(preferenceCheckboxes.nth(index)).toBeDisabled();
    }
    await expectStudentProfileAndHistoryPanels(page);
    await expectGuardianRelationshipSummary(page);
    await expectPortalActivityPanels(page);
    await expectHomeworkAssignmentsPanel(page);
    await expectPortalAnnouncementsTable(page, { readOnly: true });
    await expect(page.getByLabel("Destek talepleri", { exact: true })).toContainText("Yalnızca görüntüleme sırasında destek talebi açılamaz.");
    await expectPortalSupportPanel(page, { formVisible: false });
    await expect(page.getByRole("button", { name: "Destek talebi aç" })).toHaveCount(0);
    await expect.poll(() => mutationRequests).toEqual([]);
  });

  test("veli sidebar alt rotaları gerçek sayfaları açar", async ({ page }) => {
    await openGuardianPortal(page, { height: 900, width: 1024 });

    const routeCases = [
      { context: "Bağlı öğrenci", label: "Öğrenci", path: "/veli/ogrenci", panel: () => page.getByRole("region", { exact: true, name: "Seçili öğrenci özeti" }) },
      { context: "Sınav raporu", label: "Sınav Raporu", path: "/veli/raporlar", panel: () => page.getByRole("region", { name: "Portal rapor özeti" }) },
      { context: "Ödemeler", label: "Ödemeler", path: "/veli/odemeler", panel: () => page.getByRole("region", { exact: true, name: "Ödeme planları" }) },
      { context: "Ödevler", label: "Ödevler", path: "/veli/odevler", panel: () => page.getByRole("region", { exact: true, name: "Ödevler" }) },
      { context: "Duyurular", label: "Duyurular", path: "/veli/duyurular", panel: () => page.getByRole("region", { exact: true, name: "Duyurular" }) },
      { context: "Bildirim tercihleri", label: "Bildirimler", path: "/veli/bildirimler", panel: () => page.getByRole("region", { exact: true, name: "Bildirim tercihleri" }) },
      { context: "Destek talepleri", label: "Kurum Desteği", path: "/veli/destek", panel: () => page.getByRole("region", { exact: true, name: "Destek talepleri" }) },
    ];

    for (const routeCase of routeCases) {
      await clickSidebarRoute(page, "Veli Paneli", routeCase.label);
      await expect(page).toHaveURL(new RegExp(`${routeCase.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: "Veli Portalı" })).toBeVisible();
      await expect(page.getByRole("region", { exact: true, name: "Portal görünümü" })).toContainText(routeCase.context);
      await expect(routeCase.panel()).toBeVisible();
      if (routeCase.label === "Sınav Raporu") await expect(page.getByRole("combobox", { name: "Sınav raporu" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { exact: true, name: "Özet" })).not.toHaveAttribute("aria-current", "page");
    }
  });
});

async function expectStudentFocusMetrics(focus: Locator, itemCount: number) {
  const focusMetrics = focus.getByRole("region", { name: "Seçili öğrenci bilgileri" });
  await expect(focusMetrics).toHaveClass(/uh-info-grid/);
  await expect(focusMetrics.locator(".uh-info-item")).toHaveCount(itemCount);
}

async function expectStudentProfileAndHistoryPanels(page: Page) {
  const profile = page.getByRole("region", { exact: true, name: "Profil" });
  await expect(profile.getByRole("heading", { name: "Profil" })).toBeVisible();
  const profileInfo = profile.getByRole("region", { name: "Portal öğrenci profil özeti" });
  await expect(profileInfo).toHaveClass(/uh-info-grid/);
  await expect(profileInfo.locator(".uh-info-item")).toHaveCount(8);
  await expect(profile).toContainText("Ad soyad");
  await expect(profile).toContainText("Sınıf");
  await expect(profile).toContainText("Sorumlu öğretmen");
  await expect(profile).toContainText("12*******01");
  await expect(profile).toContainText("••• ••• ••67");

  const history = page.getByRole("region", { exact: true, name: "Sınıf ve kayıt geçmişi" });
  await expect(history.getByRole("heading", { name: "Sınıf ve Kayıt Geçmişi" })).toBeVisible();
  const historyTable = history.getByRole("table", { name: "Sınıf ve kayıt geçmişi" });
  await expect(historyTable).toBeVisible();
  await expect(historyTable.locator("thead th")).toHaveText(["Sınıf", "Organizasyon", "Dönem", "Başlangıç", "Durum", "Neden"]);
  await expect(history).toContainText("Sınıf bilgisi yok");
  await expect(history).toContainText("Dönem bilgisi yok");

  for (const value of ["class-8a", "class-missing", "term-2026", "term-missing"]) {
    await expect(history).not.toContainText(value);
  }
}

async function expectGuardianRelationsPanel(page: Page) {
  const relations = page.getByRole("region", { exact: true, name: "Veli ilişkileri" });
  await expect(relations.getByRole("heading", { name: "Veliler" })).toBeVisible();
  const table = relations.getByRole("table", { name: "Veli ilişkileri" });
  await expect(table).toBeVisible();
  await expect(table.locator("thead th")).toHaveText(["Veli", "İzinler"]);
  await expect(relations).toContainText("Ayşe Kaya");
  await expect(relations).toContainText("Bilinmeyen veli");
  await expect(relations).not.toContainText("guardian-a");
  await expect(relations).not.toContainText("guardian-missing");
}

async function expectGuardianRelationshipSummary(page: Page) {
  const relationship = page.getByRole("region", { exact: true, name: "Veli ilişki özeti" });
  const relationshipInfo = relationship.getByRole("region", { name: "Veli ilişki metrikleri" });
  await expect(relationshipInfo).toHaveClass(/uh-info-grid/);
  await expect(relationshipInfo.locator(".uh-info-item")).toHaveCount(3);
}

async function expectHomeworkAssignmentsPanel(page: Page) {
  const homework = page.getByRole("region", { exact: true, name: "Ödevler" });
  await expect(homework.getByRole("heading", { name: "Ödevler" })).toBeVisible();
  const table = homework.getByRole("table", { name: "Ödev ve materyal atamaları" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Materyal" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Bağlam" })).toBeVisible();
  for (const value of ["material-a", "course-math", "term-2026", "student-a", "student-b"]) {
    await expect(homework).not.toContainText(value);
  }
}

async function expectPortalActivityPanels(page: Page) {
  const notes = page.getByRole("region", { exact: true, name: "Öğretmen notları" });
  const notesTable = notes.getByRole("table", { name: "Öğretmen notları" });
  await expect(notesTable).toBeVisible();
  await expect(notesTable.locator("thead th")).toHaveText(["Bağlam", "Branş", "Dönem", "Not"]);
  await expect(notes).toContainText("Problem çözüm adımları takip edilecek.");
  await expect(notes).toContainText("Matematik");
  await expect(notes).toContainText("2026 Bahar");

  const attendance = page.getByRole("region", { exact: true, name: "Devamsızlık" });
  await expect(attendance.getByRole("table", { name: "Devamsızlık kayıtları" })).toBeVisible();

  for (const value of rawInternalValues) {
    await expect(notes).not.toContainText(value);
    await expect(attendance).not.toContainText(value);
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
    const conversation = support.getByRole("region", { name: "Destek konuşması" });
    await expect(conversation).toContainText("Siz");
    await expect(conversation).toContainText("Kurum");
    await expect(conversation.getByLabel("Yanıtınız")).toBeVisible();
  } else {
    await expect(support.getByLabel("Konu", { exact: true })).toHaveCount(0);
    await expect(support.getByLabel("Mesaj", { exact: true })).toHaveCount(0);
    await expect(support.getByRole("combobox", { name: /Öncelik/ })).toHaveCount(0);
  }
}

async function openStudentPortal(
  page: Page,
  viewport: { height: number; width: number },
  options: { mode?: "student" | "role-preview"; mutationRequests?: string[]; requestedPaths?: string[]; withReport?: boolean } = {},
) {
  await page.setViewportSize(viewport);
  await installStudentApiMocks(page, options);
  await page.addInitScript((mode) => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
    if (mode === "role-preview") {
      window.sessionStorage.setItem("o-okul.role-preview-token", "preview-token-student");
    }
  }, options.mode ?? "student");
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(options.mode === "role-preview" ? "/ogrenci?rolePreview=1" : options.withReport === false ? "/ogrenci" : "/ogrenci?examId=exam-demo-isem-lgs-1");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function openGuardianPortal(
  page: Page,
  viewport: { height: number; width: number },
  options: {
    financeVisibility?: "false" | "true";
    mode?: "guardian" | "role-preview";
    mutationRequests?: string[];
    paymentPlanRequests?: string[];
    requestedPaths?: string[];
    withReport?: boolean;
  } = {},
) {
  await page.setViewportSize(viewport);
  await installGuardianApiMocks(page, options);
  await page.addInitScript((mode) => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
    if (mode === "role-preview") {
      window.sessionStorage.setItem("o-okul.role-preview-token", "preview-token-guardian");
    }
  }, options.mode ?? "guardian");
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(options.mode === "role-preview" ? "/veli?rolePreview=1" : options.withReport === false ? "/veli" : "/veli?examId=exam-demo-isem-lgs-1");
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

async function installStudentApiMocks(
  page: Page,
  options: { mode?: "student" | "role-preview"; mutationRequests?: string[]; requestedPaths?: string[]; withReport?: boolean },
) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const method = route.request().method();
    const pathName = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    options.requestedPaths?.push(pathName);
    if (method !== "GET" && method !== "OPTIONS" && pathName !== "/auth/refresh") {
      options.mutationRequests?.push(`${method} ${pathName}`);
    }
    await fulfillData(route, studentApiResponse(pathName, options.mode ?? "student", options.withReport !== false, method));
  });
}

async function installGuardianApiMocks(
  page: Page,
  options: {
    financeVisibility?: "false" | "true";
    mode?: "guardian" | "role-preview";
    mutationRequests?: string[];
    paymentPlanRequests?: string[];
    requestedPaths?: string[];
    withReport?: boolean;
  },
) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const method = route.request().method();
    const pathName = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    options.requestedPaths?.push(pathName);
    if (pathName.includes("/payment-plans")) {
      options.paymentPlanRequests?.push(pathName);
    }
    if (method !== "GET" && method !== "OPTIONS" && pathName !== "/auth/refresh") {
      options.mutationRequests?.push(`${method} ${pathName}`);
    }
    await fulfillData(route, guardianApiResponse(pathName, options));
  });
}

function studentApiResponse(pathName: string, mode: "student" | "role-preview", withReport: boolean, method = "GET"): unknown {
  if (pathName === "/auth/refresh") return createStudentAuthResponse(mode);
  if (pathName === "/me/tenant") return createTenantResponse();
  if (pathName === "/me/notification-devices") return [];
  if (pathName === "/me/student/profile") return createStudentProfile("student-a");
  if (pathName === "/me/student/guardians") return createStudentGuardians();
  if (pathName === "/me/student/guardian-links") return createStudentGuardianLinks();
  if (pathName === "/me/student/enrollments") return createEnrollments("student-a");
  if (pathName === "/me/student/announcements") return createAnnouncements();
  if (pathName === "/me/student/homework/material-assignments") return createHomeworkAssignments("student-a");
  if (pathName === "/me/student/support-tickets") return createSupportTickets();
  if (pathName === "/me/student/support-tickets/ticket-a/comments") {
    if (method === "POST") {
      return {
        ticket: createSupportTickets()[0],
        comment: { author: "REQUESTER", body: "Teşekkür ederim.", createdAt: "2026-06-17T10:10:00.000Z", id: "comment-requester", ticketId: "ticket-a" },
      };
    }
    return [{ author: "INSTITUTION", body: "Kurum yanıtı", createdAt: "2026-06-17T10:00:00.000Z", id: "comment-institution", ticketId: "ticket-a" }];
  }
  if (pathName === "/me/student/attendance") return createAttendance("student-a");
  if (pathName === "/me/student/attendance/summary") return createAttendanceSummary("student-a");
  if (pathName === "/me/student/teacher-notes") return createTeacherNotes("student-a");
  if (pathName === "/me/student/development-assessments") return createDevelopmentAssessments("student-a");
  if (pathName === "/me/student/reports") return withReport ? createReportIndex() : [];
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/latest") return createStudentReport("student-a");
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/latest/error-booklet") return createErrorBooklet("student-a");
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/progress") return createProgress("student-a");
  if (pathName === "/courses") return createCourses();
  if (pathName === "/academic-terms") return createTerms();
  return [];
}

function guardianApiResponse(
  pathName: string,
  options: { financeVisibility?: "false" | "true"; mode?: "guardian" | "role-preview"; withReport?: boolean },
): unknown {
  if (pathName === "/auth/refresh") return createGuardianAuthResponse(options.mode ?? "guardian");
  if (pathName === "/me/tenant") return createTenantResponse();
  if (pathName === "/me/notification-devices") return [];
  if (pathName === "/me/guardian/students") return createGuardianStudents();
  for (const studentId of ["student-a", "student-b"] as const) {
    if (pathName === `/me/guardian/students/${studentId}/notification-preferences`) {
      return createGuardianPreferences(studentId, options.financeVisibility !== "false", options.mode === "role-preview");
    }
    if (pathName === `/me/guardian/students/${studentId}/profile`) return createStudentProfile(studentId);
    if (pathName === `/me/guardian/students/${studentId}/enrollments`) return createEnrollments(studentId);
    if (pathName === `/me/guardian/students/${studentId}/announcements`) return createAnnouncements();
    if (pathName === `/me/guardian/students/${studentId}/support-tickets`) return createSupportTickets();
    if (pathName === `/me/guardian/students/${studentId}/homework/material-assignments`) return createHomeworkAssignments(studentId);
    if (pathName === `/me/guardian/students/${studentId}/attendance`) return createAttendance(studentId);
    if (pathName === `/me/guardian/students/${studentId}/attendance/summary`) return createAttendanceSummary(studentId);
    if (pathName === `/me/guardian/students/${studentId}/teacher-notes`) return createTeacherNotes(studentId);
    if (pathName === `/me/guardian/students/${studentId}/development-assessments`) return createDevelopmentAssessments(studentId);
    if (pathName === `/me/guardian/students/${studentId}/payment-plans`) return createPaymentPlans();
    if (pathName === `/me/guardian/students/${studentId}/reports`) return options.withReport === false ? [] : createReportIndex();
    if (pathName === `/me/guardian/students/${studentId}/reports/exam-demo-isem-lgs-1/latest`) return createStudentReport(studentId);
    if (pathName === `/me/guardian/students/${studentId}/reports/exam-demo-isem-lgs-1/latest/error-booklet`) return createErrorBooklet(studentId);
    if (pathName === `/me/guardian/students/${studentId}/reports/exam-demo-isem-lgs-1/progress`) return createProgress(studentId);
  }
  if (pathName === "/me/guardian/homework/material-assignments") return [];
  if (pathName === "/courses") return createCourses();
  if (pathName === "/academic-terms") return createTerms();
  return [];
}

function createReportIndex() {
  return [{
    examId: "exam-demo-isem-lgs-1",
    latestGeneratedAt: "2026-06-17T10:00:00.000Z",
    latestReadySnapshotId: "snapshot-ready",
    startsAt: "2026-06-17T09:00:00.000Z",
    title: "İSEM - LGS - 1",
  }];
}

function createStudentAuthResponse(mode: "student" | "role-preview") {
  return {
    accessToken: "student-portal-contract-token",
    session: {
      id: "session-student-contract",
      membershipVersion: 1,
      roles: mode === "role-preview" ? ["TENANT_ADMIN"] : ["STUDENT"],
      status: "ACTIVE",
      subjectId: mode === "role-preview" ? undefined : "student-a",
      subjectType: mode === "role-preview" ? undefined : "STUDENT",
      tenantId: "tenant-portal-contract",
      userId: mode === "role-preview" ? "admin-a" : "student-a",
    },
  };
}

function createGuardianAuthResponse(mode: "guardian" | "role-preview") {
  return {
    accessToken: "guardian-portal-contract-token",
    session: {
      id: "session-guardian-contract",
      membershipVersion: 1,
      roles: mode === "role-preview" ? ["TENANT_ADMIN"] : ["GUARDIAN"],
      status: "ACTIVE",
      subjectId: mode === "role-preview" ? undefined : "guardian-a",
      subjectType: mode === "role-preview" ? undefined : "GUARDIAN",
      tenantId: "tenant-portal-contract",
      userId: mode === "role-preview" ? "admin-a" : "guardian-a",
    },
  };
}

function createTenantResponse() {
  return { contactEmail: "bilgi@portal-contract.example", id: "tenant-portal-contract", institutionType: "Dershane", name: "Portal Sözleşme Akademi" };
}

function createGuardianStudents() {
  return [
    { classId: "class-8a", firstName: "Ada", id: "student-a", lastName: "Kaya", status: "ACTIVE", studentNo: "8001", tenantId: "tenant-portal-contract" },
    { classId: "class-8a", firstName: "Bora", id: "student-b", lastName: "Yilmaz", status: "ACTIVE", studentNo: "8002", tenantId: "tenant-portal-contract" },
  ];
}

function createStudentProfile(studentId: "student-a" | "student-b") {
  const isAda = studentId === "student-a";
  return {
    campusName: "Ana Kampüs",
    classId: "class-8a",
    className: "8-A",
    email: isAda ? "ada.kaya@example.test" : "bora.yilmaz@example.test",
    firstName: isAda ? "Ada" : "Bora",
    gradeLevelName: "8. Sınıf",
    id: studentId,
    lastName: isAda ? "Kaya" : "Yilmaz",
    nationalId: "12345678901",
    nationalIdMasked: "12*******01",
    phone: "+905551234567",
    responsibleTeacherName: "Zeynep Arslan",
    section: "A",
    status: "ACTIVE",
    studentNo: isAda ? "8001" : "8002",
    tenantId: "tenant-portal-contract",
  };
}

function createStudentGuardians() {
  return [{ firstName: "Ayşe", id: "guardian-a", lastName: "Kaya", tenantId: "tenant-portal-contract" }];
}

function createStudentGuardianLinks() {
  return [
    {
      canOpenSupportTickets: true,
      canReceiveAnnouncements: true,
      canReceiveSms: true,
      canViewFinance: false,
      guardianId: "guardian-a",
      id: "guardian-link-a",
      studentId: "student-a",
      tenantId: "tenant-portal-contract",
    },
    {
      canOpenSupportTickets: false,
      canReceiveAnnouncements: true,
      canReceiveSms: false,
      canViewFinance: false,
      guardianId: "guardian-missing",
      id: "guardian-link-missing",
      studentId: "student-a",
      tenantId: "tenant-portal-contract",
    },
  ];
}

function createGuardianPreferences(studentId: "student-a" | "student-b", canViewFinance: boolean, rolePreview = false) {
  return {
    canOpenSupportTickets: rolePreview ? true : false,
    canReceiveAnnouncements: true,
    canReceiveSms: true,
    canViewFinance,
    guardianId: "guardian-a",
    id: `guardian-link-${studentId}`,
    studentId,
    tenantId: "tenant-portal-contract",
  };
}

function createCourses() {
  return [{ id: "course-math", name: "Matematik", tenantId: "tenant-portal-contract" }];
}

function createTerms() {
  return [{ id: "term-2026", name: "2026 Bahar", tenantId: "tenant-portal-contract" }];
}

function createAnnouncements() {
  return [{ audience: "STUDENTS", body: "Haftalık çalışma planı yayınlandı.", id: "announcement-a", readAt: null, tenantId: "tenant-portal-contract", title: "Haftalık plan" }];
}

function createHomeworkAssignments(studentId: "student-a" | "student-b") {
  return [
    {
      courseId: "course-math",
      dueAt: "2026-06-21T12:00:00.000Z",
      id: `assignment-${studentId}`,
      materialId: "material-a",
      materialTitle: studentId === "student-a" ? "Ada tekrar föyü" : "Bora tekrar föyü",
      note: studentId === "student-a" ? "Ada tekrar" : "Bora tekrar",
      studentId,
      tenantId: "tenant-portal-contract",
      termId: "term-2026",
    },
  ];
}

function createSupportTickets() {
  return [{ createdAt: "2026-06-17T09:00:00.000Z", id: "ticket-a", message: "İlk destek mesajı", priority: "NORMAL", status: "OPEN", subject: "Portal destek talebi", tenantId: "tenant-portal-contract" }];
}

function createAttendance(studentId: string) {
  return [{ courseId: "course-math", date: "2026-06-17", id: `attendance-${studentId}`, status: "PRESENT", studentId, tenantId: "tenant-portal-contract", termId: "term-2026" }];
}

function createAttendanceSummary(studentId: string) {
  return { absent: 0, excused: 0, late: 0, present: 30, studentId, total: 30 };
}

function createTeacherNotes(studentId: string) {
  return [{ body: "Problem çözüm adımları takip edilecek.", courseId: "course-math", id: `note-${studentId}`, studentId, teacherId: "teacher-math", tenantId: "tenant-portal-contract", termId: "term-2026", visibility: "GUARDIAN_STUDENT" }];
}

function createDevelopmentAssessments(studentId: string) {
  return [{ createdAt: "2026-06-10T09:00:00.000Z", id: `development-${studentId}`, mentorNote: "Çalışma disiplini güçleniyor.", periodLabel: "Haziran", scores: [], studentId, tenantId: "tenant-portal-contract" }];
}

function createEnrollments(studentId: string) {
  return [
    { classId: "class-8a", className: "8-A", id: `enrollment-${studentId}`, startsAt: "2026-09-01T00:00:00.000Z", status: "ACTIVE", studentId, tenantId: "tenant-portal-contract", termId: "term-2026" },
    { classId: "class-missing", id: `enrollment-missing-${studentId}`, startsAt: "2026-01-01T00:00:00.000Z", status: "ACTIVE", studentId, tenantId: "tenant-portal-contract", termId: "term-missing" },
  ];
}

function createStudentReport(studentId: "student-a" | "student-b") {
  const isAda = studentId === "student-a";
  return {
    branches: [
      { blank: 1, branch: "Matematik", classNetAverage: 10.5, correct: isAda ? 12 : 9, generalNetAverage: 9.8, net: isAda ? 11 : 8.5, questionCount: 15, schoolNetAverage: 10.8, successRate: isAda ? 73.3 : 60, wrong: isAda ? 2 : 5 },
      { blank: 0, branch: "Turkce", classNetAverage: 11.2, correct: isAda ? 13 : 11, generalNetAverage: 10.1, net: isAda ? 13 : 10.5, questionCount: 15, schoolNetAverage: 11.9, successRate: isAda ? 86.7 : 66.7, wrong: 2 },
    ],
    classId: "class-8a",
    className: "8-A",
    courseId: "course-math",
    examId: "exam-demo-isem-lgs-1",
    examStartsAt: "2026-06-10T09:00:00.000Z",
    examTitle: "LGS Hazırlık Denemesi",
    generatedAt: "2026-06-10T12:00:00.000Z",
    institutionName: "Portal Sözleşme Akademi",
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
    tenantId: "tenant-portal-contract",
    termId: "term-2026",
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
  return { examId: "exam-demo-isem-lgs-1", generatedAt: "2026-06-10T12:00:00.000Z", items: createQuestionSummaries().filter((question) => question.status !== "CORRECT"), snapshotId: "snapshot-ready", studentId, tenantId: "tenant-portal-contract" };
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
    tenantId: "tenant-portal-contract",
  };
}

function createPaymentPlans() {
  return [
    {
      currency: "TRY",
      id: "payment-plan-a",
      installments: [{ amount: 50_000, dueDate: "2026-06-30", id: "installment-a", installmentNo: 1, status: "PENDING" }],
      studentId: "student-a",
      tenantId: "tenant-portal-contract",
      title: "LGS ödeme planı",
      totalAmount: 50_000,
    },
  ];
}

async function expectAnchorsAttached(page: Page, hrefs: string[]) {
  for (const href of hrefs) {
    await expect(page.locator(href), `missing portal anchor ${href}`).toBeAttached();
  }
}

async function clickAllPortalActionLinks(actionStrip: Locator) {
  for (const link of await actionStrip.getByRole("link").all()) {
    await link.click();
  }
}

async function expectNoPortalActionPiiLeak(actionStrip: Locator, values: readonly string[]) {
  const leakedLabels = await actionStrip.getByRole("link").evaluateAll((links, rawValues) =>
    links
      .map((link) => link.getAttribute("aria-label") ?? "")
      .filter((label) => rawValues.some((value) => label.includes(value))),
    values,
  );
  expect(leakedLabels, "PortalActionStrip aria-label PII leak").toEqual([]);
  for (const value of values) {
    await expect(actionStrip).not.toContainText(value);
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
      .filter((element) => element.textContent?.trim())
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
