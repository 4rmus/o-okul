import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const artifactDir = path.join(repoRoot, "artifacts/ui-smoke");

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

type UiMockAuthProfile = "admin" | "guardian" | "student" | "systemAdmin" | "teacher";

interface UiMockOptions {
  authProfile?: UiMockAuthProfile;
  onApiRequest?(pathName: string): void;
}

interface RolePortalActionStripCase {
  authProfile: Extract<UiMockAuthProfile, "guardian" | "student" | "teacher">;
  count: number;
  hrefs: Array<{ href: string; name: RegExp }>;
  key: string;
  path: string;
  regionName: string;
}

test.describe("Faz 9 UI görsel smoke", () => {
  test("kurum dashboard 360/768/1024/1440 görünümde özet, karar ve rapor sözleşmesini korur", async ({ page }) => {
    test.setTimeout(90_000);
    const consoleErrors = collectConsoleErrors(page);

    for (const viewport of [
      { height: 780, width: 360 },
      { height: 1024, width: 768 },
      { height: 900, width: 1024 },
      { height: 960, width: 1440 },
    ]) {
      await openWithUiMocks(page, "/kurum", viewport);

      await expect(page.getByRole("heading", { level: 1, name: "Faz 9 Akademi" })).toBeVisible();
      const overviewRegion = page.getByRole("region", { exact: true, name: "Kurum özeti" });
      await expect(overviewRegion).toHaveClass(/uh-metric-grid/);
      await expect(overviewRegion.locator(".uh-metric-card")).toHaveCount(4);
      await expect(overviewRegion.locator("article")).toHaveCount(4);
      await expect(overviewRegion).toContainText("Öğrenci");
      await expect(overviewRegion).toContainText("2");
      const dashboardSummary = page.getByRole("region", { exact: true, name: "Kurum dashboard operasyon özeti" });
      const dashboardSummaryMetrics = dashboardSummary.getByRole("group", { name: "Kurum dashboard operasyon özeti metrikleri" });
      await expect(dashboardSummaryMetrics).toHaveClass(/uh-metric-grid/);
      await expect(dashboardSummaryMetrics.locator(".uh-metric-card")).toHaveCount(4);
      await expect(dashboardSummary).toContainText("Başarı %");
      await expect(dashboardSummary).toContainText("READY rapor");
      await expect(dashboardSummary).toContainText("Tenant scope doğrulandı");
      const attentionRegion = page.getByRole("region", { exact: true, name: "Bugün dikkat gerektirenler" });
      await expect(attentionRegion).toContainText("Bugün dikkat gerektirenler");
      await expect(attentionRegion.locator(".next-attention-item.uh-action-card")).toHaveCount(4);
      await expect(attentionRegion.locator(".next-attention-item:not(.uh-action-card)")).toHaveCount(0);
      await expect(attentionRegion.getByRole("link", { name: /Bekleyen destek 1/ })).toHaveAttribute("href", "/kurum/destek");
      await expect(attentionRegion.getByRole("link", { name: /Geciken ödeme 1/ })).toHaveAttribute("href", "/kurum/finans");
      await expect(attentionRegion.getByRole("link", { name: /Devamsızlık 1/ })).toHaveAttribute("href", "/kurum/devamsizlik");
      await expect(attentionRegion.getByRole("link", { name: /Optik kontrol 1/ })).toHaveAttribute("href", "/kurum/optik");
      const operationsRegion = page.getByRole("region", { exact: true, name: "Operasyon özeti" });
      await expect(operationsRegion).toContainText("Son sınav / rapor");
      await expect(operationsRegion).toContainText("Rapor hazır");
      await expect(operationsRegion).toContainText("Son duyuru");
      const operationsTable = page.getByRole("table", { name: "Operasyon özeti" });
      await expect(operationsTable.getByRole("columnheader", { name: "Başlık" })).toBeVisible();
      await expect(operationsTable.getByRole("columnheader", { name: "Durum" })).toBeVisible();
      await expect(operationsTable.locator(".next-dashboard-link-cell.uh-action-card")).toHaveCount(2);
      const decisionsRegion = page.getByRole("region", { exact: true, name: "Karar sinyalleri" });
      const decisionsTable = page.getByRole("table", { name: "Karar sinyalleri" });
      await expect(decisionsTable.locator(".next-dashboard-link-cell.uh-action-card")).toHaveCount(4);
      await expect(decisionsRegion.getByRole("link", { name: /Bekleyen destek 1/ })).toHaveAttribute("href", "/kurum/destek");
      await expect(decisionsRegion.getByRole("link", { name: /Geciken ödeme 1/ })).toHaveAttribute("href", "/kurum/finans");
      await expect(decisionsRegion.getByRole("link", { name: /Devamsızlık 1/ })).toHaveAttribute("href", "/kurum/devamsizlik");
      await expect(decisionsRegion.getByRole("link", { name: /Optik kontrol 1/ })).toHaveAttribute("href", "/kurum/optik");
      await expect(page.locator(".next-decision-card, .next-dashboard-summary-card")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Sınav Sonuç Özeti" })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("tenant-faz9");
      await expect(page.locator("body")).not.toContainText("user-faz9-admin");
      await expectUiStable(page, `faz9-dashboard-${viewport.width}`, consoleErrors);

      if (viewport.width === 360 || viewport.width === 1440) {
        await saveScreenshot(page, `faz9-dashboard-${viewport.width}.png`);
      }
    }
  });

  test("komut paleti link semantiğiyle modül geçişini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum", { height: 900, width: 1280 });

    await page.getByRole("button", { name: "Komut paleti" }).click();
    const commandDialog = page.getByRole("dialog", { name: "Komut paleti" });
    await expect(commandDialog).toBeVisible();
    await commandDialog.getByLabel("Komut ara").fill("finans");
    const paymentsResult = commandDialog.getByRole("link", { name: /Ödemeler/ });
    await expect(paymentsResult).toBeVisible();
    await expect(commandDialog.getByRole("button", { name: /Ödemeler/ })).toHaveCount(0);
    await expectUiStable(page, "faz9-command-palette", consoleErrors);
    await paymentsResult.click();
    await expect(page).toHaveURL(/\/kurum\/finans$/);
    await expect(page.getByRole("heading", { level: 1, name: "Finans" })).toBeVisible();
  });

  test("sistem dashboard ortak metrik grid sözleşmesini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/sistem", { height: 900, width: 1280 }, { authProfile: "systemAdmin" });

    await expect(page.getByRole("heading", { level: 1, name: "Sistem Paneli" })).toBeVisible();
    const systemSummary = page.getByRole("region", { name: "Sistem özeti" });
    await expect(systemSummary).toHaveClass(/uh-metric-grid/);
    await expect(systemSummary.locator(".uh-metric-card")).toHaveCount(3);
    await expect(systemSummary).toContainText("Kurum");
    await expect(systemSummary).toContainText("Aktif");
    await expect(systemSummary).toContainText("Deneme");
    await expectUiStable(page, "faz9-system-dashboard-desktop", consoleErrors);
  });

  test("sistem kurum yönetimi DataTable ve detay rozetlerini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/sistem/kurumlar", { height: 900, width: 1280 }, { authProfile: "systemAdmin" });

    await expect(page.getByRole("heading", { level: 1, name: "Kurumlar" })).toBeVisible();
    const tenantSummary = page.getByRole("region", { name: "Sistem kurum operasyon özeti" });
    await expect(tenantSummary).toContainText("Kurum toplamı");
    await expect(tenantSummary).toContainText("Lisans riski");
    await expect(tenantSummary).toContainText("SYSTEM_ADMIN kapsamı");
    const tenantsTable = page.getByRole("table", { name: "Kurum operasyon listesi" });
    await expect(tenantsTable.getByRole("columnheader", { name: "Kurum" })).toBeVisible();
    await expect(tenantsTable.getByRole("columnheader", { name: "Plan" })).toBeVisible();
    await expect(tenantsTable.getByRole("columnheader", { name: "Durum" })).toBeVisible();
    await expect(tenantsTable).toContainText("Enterprise");
    await expect(tenantsTable).toContainText("Aktif");
    await expect(tenantsTable.getByRole("link", { name: "Faz 9 Akademi detay" })).toHaveAttribute(
      "href",
      "/sistem/kurumlar/tenant-faz9",
    );
    await expectUiStable(page, "faz9-system-tenants-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-system-tenants-desktop.png");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/sistem/kurumlar");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("table", { name: "Kurum operasyon listesi" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Lisans bitişi" })).toHaveCount(0);
    await expectUiStable(page, "faz9-system-tenants-mobile", consoleErrors);

    await page.setViewportSize({ height: 900, width: 1280 });
    await page.goto("/sistem/kurumlar/tenant-faz9");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1, name: "Faz 9 Akademi" })).toBeVisible();
    const tenantDetail = page.getByRole("region", { name: "Kurum detayı" });
    await expect(tenantDetail).toHaveClass(/uh-metric-grid/);
    await expect(tenantDetail.locator(".uh-metric-card")).toHaveCount(5);
    await expect(tenantDetail).toContainText("Enterprise");
    await expect(tenantDetail).toContainText("Aktif");
    const tenantCapacity = page.getByRole("region", { name: "Lisans ve kapasite" });
    await expect(tenantCapacity.locator(".next-tenant-capacity-grid")).toHaveClass(/uh-info-grid/);
    await expect(tenantCapacity.locator(".uh-info-item")).toHaveCount(4);
    await expect(tenantCapacity).toContainText("Lisans penceresi");
    await expect(tenantCapacity).toContainText("Koltuk kullanımı");
    await expect(tenantCapacity).toContainText("Operasyon normal");
    await page.getByRole("button", { name: "Düzenle" }).click();
    const editDialog = page.getByRole("dialog", { name: "Kurum düzenle" });
    await expect(editDialog.getByLabel("Plan")).toBeVisible();
    await expect(editDialog.getByLabel("Durum")).toBeVisible();
    await expectUiStable(page, "faz9-system-tenant-detail", consoleErrors);
  });

  test("rol önizleme bayrağı token olmadan portal verisi açmaz", async ({ page }) => {
    let studentPortalRequestCount = 0;
    await openWithUiMocks(
      page,
      "/ogrenci?rolePreview=1",
      { height: 900, width: 1280 },
      {
        onApiRequest: (pathName) => {
          if (pathName.startsWith("/me/student")) studentPortalRequestCount += 1;
        },
      },
    );

    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("heading", { level: 1, name: "Faz 9 Akademi" })).toBeVisible();
    expect(studentPortalRequestCount).toBe(0);
  });

  test("legacy rol önizleme token query ile portal verisi açmaz", async ({ page }) => {
    let studentPortalRequestCount = 0;
    await openWithUiMocks(
      page,
      "/ogrenci?rolePreviewToken=legacy-token",
      { height: 900, width: 1280 },
      {
        onApiRequest: (pathName) => {
          if (pathName.startsWith("/me/student")) studentPortalRequestCount += 1;
        },
      },
    );

    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("heading", { level: 1, name: "Faz 9 Akademi" })).toBeVisible();
    expect(studentPortalRequestCount).toBe(0);
  });

  test("öğrenci listesi mobilde URL state ile taşmadan kalır", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(
      page,
      "/kurum/ogrenciler?page=1&limit=10&q=ada&sort=lastName&classId=class-8a&density=compact&columns=name,class,status,actions",
      { height: 844, width: 390 },
    );

    const studentsRegion = page.getByLabel("Öğrenci yönetimi");
    await expect(studentsRegion.getByRole("heading", { name: "Öğrenciler" })).toBeVisible();
    await expect(studentsRegion.getByLabel("Ara")).toHaveValue("ada");
    await expect(studentsRegion).toHaveClass(/next-students-page--compact/);
    await expectUiStable(page, "faz9-students-mobile", consoleErrors);

    await saveScreenshot(page, "faz9-students-mobile.png");
  });

  test("veli listesi iletişim PII'sini maskeli gösterir", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/veliler", { height: 900, width: 1280 });

    const guardiansRegion = page.getByLabel("Veli yönetimi");
    await expect(guardiansRegion.getByRole("heading", { name: "Veliler" })).toBeVisible();
    await expect(guardiansRegion).toContainText("Ayse Yilmaz");
    await expect(guardiansRegion).toContainText("••• ••• ••01");
    await expect(guardiansRegion.getByText("+905551110001")).toHaveCount(0);
    await expectUiStable(page, "faz9-guardians-desktop", consoleErrors);

    await saveScreenshot(page, "faz9-guardians-desktop.png");
  });

  test("veli detay desktop ve mobil izin ilişkilerini güvenli gösterir", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/veliler/guardian-mother", { height: 900, width: 1280 });

    await expect(page.getByRole("heading", { level: 1, name: "Ayse Yilmaz" })).toBeVisible();
    const guardianDetail = page.getByLabel("Veli detayı");
    const guardianSummary = guardianDetail.getByRole("region", { exact: true, name: "Veli detay operasyon özeti" });
    await expect(guardianSummary).toContainText("Telefon");
    await expect(guardianSummary).toContainText("••• ••• ••01");
    await expect(guardianSummary).toContainText("Finans görünürlüğü");
    await expect(guardianSummary).toContainText("PII maskeli");
    await expect(guardianSummary.getByLabel("Veli detay operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const guardianProfile = guardianDetail.getByLabel("Veli profili");
    await expect(guardianProfile).toContainText("••• ••• ••01");
    const guardianProfileInfo = guardianProfile.getByRole("region", { name: "Veli profil özeti" });
    await expect(guardianProfileInfo).toHaveClass(/uh-info-grid/);
    await expect(guardianProfileInfo.locator(".uh-info-item")).toHaveCount(6);
    const guardianTable = guardianDetail.getByRole("table", { name: "Veli öğrenci bağlantıları" });
    await expect(guardianTable.getByRole("columnheader", { name: "Öğrenci" })).toBeVisible();
    await expect(guardianTable.getByRole("columnheader", { name: "İlişki" })).toBeVisible();
    await expect(guardianTable.getByRole("columnheader", { name: "İzinler" })).toBeVisible();
    await expect(guardianTable).toContainText("Ada Kaya");
    await expect(guardianTable).toContainText("Anne");
    await expect(guardianTable).toContainText("Finans açık");
    await expect(guardianTable).toContainText("SMS açık");
    await expect(guardianDetail.getByRole("link", { name: "Portal daveti gönder" })).toHaveAttribute(
      "href",
      "/kurum/kullanicilar?invite=guardian&subjectId=guardian-mother",
    );
    await expectGuardianDetailNoRawIds(page, "guardian-detail-desktop");
    await expectUiStable(page, "faz9-guardian-detail-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-guardian-detail-desktop.png");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/kurum/veliler/guardian-mother");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1, name: "Ayse Yilmaz" })).toBeVisible();
    const mobileGuardianTable = page.getByRole("table", { name: "Veli öğrenci bağlantıları" });
    await expect(mobileGuardianTable.getByRole("columnheader", { name: "Öğrenci" })).toBeVisible();
    await expect(mobileGuardianTable.getByRole("columnheader", { name: "İzinler" })).toBeVisible();
    await expect(mobileGuardianTable.getByRole("columnheader", { name: "Sınıf" })).toHaveCount(0);
    await expect(mobileGuardianTable.getByRole("columnheader", { name: "Portal" })).toHaveCount(0);
    await expectGuardianDetailNoRawIds(page, "guardian-detail-mobile");
    await expectUiStable(page, "faz9-guardian-detail-mobile", consoleErrors);
    await saveScreenshot(page, "faz9-guardian-detail-mobile.png");
  });

  test("öğretmen detay desktop ve mobil görev ilişkilerini güvenli gösterir", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/ogretmenler/teacher-math", { height: 900, width: 1280 });

    await expect(page.getByRole("heading", { level: 1, name: "Zeynep Arslan" })).toBeVisible();
    const teacherDetail = page.getByLabel("Öğretmen detayı");
    const teacherSummary = teacherDetail.getByRole("region", { exact: true, name: "Öğretmen detay operasyon özeti" });
    await expect(teacherSummary).toContainText("Atama toplamı");
    await expect(teacherSummary).toContainText("Portal bağlı");
    await expect(teacherSummary).toContainText("eşleşme kontrolü");
    await expect(teacherSummary.getByLabel("Öğretmen detay operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const teacherProfile = teacherDetail.getByLabel("Öğretmen profil kartı");
    await expect(teacherProfile).toContainText("Matematik");
    const teacherProfileInfo = teacherProfile.getByRole("region", { name: "Öğretmen profil özeti" });
    await expect(teacherProfileInfo).toHaveClass(/uh-info-grid/);
    await expect(teacherProfileInfo.locator(".uh-info-item")).toHaveCount(3);
    const assignmentsTable = teacherDetail.getByRole("table", { name: "Öğretmen atama ilişkileri" });
    await expect(assignmentsTable).toContainText("Branş öğretmeni");
    await expect(assignmentsTable).toContainText("8-A / Ada Kaya");
    await expect(assignmentsTable).toContainText("Ders eşleşmedi");
    await expect(teacherDetail.getByRole("link", { name: "Portal daveti gönder" })).toHaveAttribute(
      "href",
      "/kurum/kullanicilar?invite=teacher&subjectId=teacher-math",
    );
    await expectTeacherDetailNoRawIds(page, "teacher-detail-desktop");
    await expectUiStable(page, "faz9-teacher-detail-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-teacher-detail-desktop.png");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/kurum/ogretmenler/teacher-math");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1, name: "Zeynep Arslan" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Öğretmen atama ilişkileri" }).getByRole("columnheader", { name: "Dönem" })).toHaveCount(0);
    await expectTeacherDetailNoRawIds(page, "teacher-detail-mobile");
    await expectUiStable(page, "faz9-teacher-detail-mobile", consoleErrors);
    await saveScreenshot(page, "faz9-teacher-detail-mobile.png");
  });

  test("sınıf detay desktop ve mobil rapor bağlamını güvenli gösterir", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/siniflar/class-8a", { height: 900, width: 1280 });

    await expect(page.getByRole("heading", { level: 1, name: "8-A" })).toBeVisible();
    const classDetail = page.getByLabel("Sınıf detayı");
    const classSummary = classDetail.getByRole("region", { exact: true, name: "Sınıf detay operasyon özeti" });
    await expect(classSummary).toContainText("Öğrenci toplamı");
    await expect(classSummary).toContainText("Rapor hazır");
    await expect(classSummary.getByLabel("Sınıf detay operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const reportContext = classDetail.getByLabel("Sınıf rapor bağlamı");
    const classReportContext = reportContext.getByRole("region", { name: "Sınıf rapor bağlam özeti" });
    await expect(classReportContext).toHaveClass(/uh-info-grid/);
    await expect(classReportContext.locator(".uh-info-item")).toHaveCount(4);
    await expect(reportContext).toContainText("LGS Hazirlik Denemesi");
    await expect(reportContext).toContainText("10.06.2026");
    await expect(reportContext).toContainText("%76,7");
    const studentsTable = classDetail.getByRole("table", { name: "Sınıf öğrenci listesi" });
    await expect(studentsTable).toContainText("Ada Kaya");
    await expect(studentsTable).toContainText("Aktif");
    const resultsTable = classDetail.getByRole("table", { name: "Sınıf sınav sonucu karşılaştırması" });
    await expect(resultsTable).toContainText("Başarı %");
    await expect(resultsTable).toContainText("%81,7");
    await expect(resultsTable).toContainText("Öğrenci eşleşmedi");
    const outcomesTable = classDetail.getByRole("table", { name: "Sınıf kazanım kırılımı" });
    await expect(outcomesTable).toContainText("Matematik / M.8.1");
    await expect(outcomesTable).toContainText("%80,7");
    await expectClassDetailNoRawIds(page, "class-detail-desktop");
    await expectUiStable(page, "faz9-class-detail-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-class-detail-desktop.png");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/kurum/siniflar/class-8a");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1, name: "8-A" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Sınıf sınav sonucu karşılaştırması" }).getByRole("columnheader", { name: "LGS" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Sınıf sınav sonucu karşılaştırması" }).getByRole("columnheader", { name: "Standart" })).toHaveCount(0);
    await expectClassDetailNoRawIds(page, "class-detail-mobile");
    await expectUiStable(page, "faz9-class-detail-mobile", consoleErrors);
    await saveScreenshot(page, "faz9-class-detail-mobile.png");
  });

  test("sınav yönetimi DataTable ve mobil düzen sözleşmesini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/sinavlar", { height: 900, width: 1280 });

    await expect(page.getByRole("heading", { level: 1, name: "Sınavlar" })).toBeVisible();
    const examTable = page.getByRole("table", { name: "Sınav yönetimi" });
    await expect(examTable.getByRole("columnheader", { name: "Sınav" })).toBeVisible();
    await expect(examTable.getByRole("columnheader", { name: "Durum" })).toBeVisible();
    await expect(examTable.getByRole("columnheader", { name: "Başlangıç" })).toBeVisible();
    await expect(examTable.getByRole("columnheader", { name: "İşlem" })).toBeVisible();
    await expect(examTable).toContainText("Yayında");

    const participantsTable = page.getByRole("table", { name: "LGS Hazirlik Denemesi katılımcıları" });
    await expect(participantsTable.getByRole("columnheader", { exact: true, name: "Öğrenci" })).toBeVisible();
    await expect(participantsTable.getByRole("columnheader", { exact: true, name: "Öğrenci no" })).toBeVisible();
    await expect(participantsTable.getByRole("columnheader", { name: "Durum" })).toBeVisible();
    await expect(participantsTable).toContainText("Katıldı");
    await expectUiStable(page, "faz9-exams-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-exams-desktop.png");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/kurum/sinavlar");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1, name: "Sınavlar" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Sınav yönetimi" })).toBeVisible();
    await expect(page.getByRole("table", { name: "LGS Hazirlik Denemesi katılımcıları" })).toBeVisible();
    await expect(page.getByRole("columnheader", { exact: true, name: "Öğrenci no" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Kitapçık" })).toHaveCount(0);
    await expectUiStable(page, "faz9-exams-mobile", consoleErrors);
  });

  test("öğrenci detay desktop ve mobil kanıtları ilişki haritası fallback'iyle temizdir", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/ogrenciler/student-a", { height: 900, width: 1280 });

    await expect(page.getByRole("heading", { level: 1, name: "Ada Kaya" })).toBeVisible();
    await expect(page.getByText("+905551112233")).toHaveCount(0);
    await expect(page.getByText("ada@example.test")).toHaveCount(0);
    await expect(page.getByText("+905551110001")).toHaveCount(0);
    await expect(page.getByText("+905551110002")).toHaveCount(0);
    const studentDashboard = page.getByLabel("Öğrenci dashboard");
    const studentSummary = studentDashboard.getByRole("region", { exact: true, name: "Öğrenci detay operasyon özeti" });
    await expect(studentSummary).toContainText("Kayıt durumu");
    await expect(studentSummary).toContainText("Başarı %");
    await expect(studentSummary).toContainText("%81,7");
    await expect(studentSummary).toContainText("Net 24,5 / Soru 30");
    await expect(studentSummary).toContainText("PII maskeli");
    await expect(studentSummary.getByLabel("Öğrenci detay operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const studentProfile = studentDashboard.getByLabel("Öğrenci profil kartı");
    await expect(studentProfile).toContainText("Aktif");
    const studentProfileInfo = studentProfile.getByRole("region", { name: "Öğrenci profil özeti" });
    await expect(studentProfileInfo).toHaveClass(/uh-info-grid/);
    await expect(studentProfileInfo.locator(".uh-info-item")).toHaveCount(4);
    const studentDecisionCards = studentDashboard.getByLabel("Öğrenci karar kartları");
    await expect(studentDecisionCards.locator(".next-student-decision-card.uh-action-card")).toHaveCount(4);
    await expect(studentDecisionCards.locator(".next-dashboard-summary-card")).toHaveCount(0);
    await expect(studentDecisionCards).toContainText("Sınav performansı");
    await expect(studentDashboard.getByRole("link", { name: "Sınav detayları" })).toHaveAttribute("href", "/kurum/ogrenciler/student-a/sinavlar");
    await expectStudentDetailNoRawIds(page, "student-dashboard-desktop");
    await expectUiStable(page, "faz9-student-dashboard-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-student-dashboard-desktop.png");
    await saveScreenshot(page, "faz9-student-detail-desktop.png");

    await studentDashboard.getByRole("link", { name: "Sınav detayları" }).click();
    await expect(page).toHaveURL(/\/kurum\/ogrenciler\/student-a\/sinavlar$/);
    const studentExamDetails = page.getByLabel("Öğrenci sınav detayları");
    const studentExamSummary = studentExamDetails.getByRole("region", { exact: true, name: "Öğrenci sınav operasyon özeti" });
    await expect(studentExamSummary).toContainText("Başarı %");
    await expect(studentExamSummary).toContainText("%81,7");
    await expect(studentExamSummary).toContainText("Net 24,5 / Soru 30");
    await expect(studentExamSummary.getByLabel("Öğrenci sınav operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const examReportContext = studentExamDetails.getByLabel("Öğrenci sınav rapor bağlamı");
    await expect(examReportContext.locator(".uh-select")).toHaveCount(2);
    const studentReportContext = examReportContext.getByRole("region", { name: "Öğrenci rapor bağlam özeti" });
    await expect(studentReportContext).toHaveClass(/uh-info-grid/);
    await expect(studentReportContext.locator(".uh-info-item")).toHaveCount(7);
    await expect(examReportContext).toContainText("LGS puanı");
    await expect(examReportContext).toContainText("Standart puan");
    await expect(studentExamDetails.getByRole("region", { name: "Hata kitapçığı" })).toContainText("Yanıt");
    await expectStudentDetailNoRawIds(page, "student-exam-detail-desktop");
    await expectUiStable(page, "faz9-student-exam-detail-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-student-exam-detail-desktop.png");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/kurum/ogrenciler/student-a");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("region", { exact: true, name: "Öğrenci detay operasyon özeti" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "İlişki haritası" })).toBeVisible();
    await expect(page.locator(".next-student-relationship-flow-shell")).toBeHidden();
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toBeVisible();
    await expectStudentDetailNoRawIds(page, "student-dashboard-mobile");
    await expectUiStable(page, "faz9-student-detail-mobile", consoleErrors);
    await saveScreenshot(page, "faz9-student-dashboard-mobile.png");
    await saveScreenshot(page, "faz9-student-detail-mobile.png");
  });

  test("öğrenci sınav detay doğrudan route rapor sözleşmesini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/ogrenciler/student-a/sinavlar", { height: 900, width: 1280 });

    await expect(page).toHaveURL(/\/kurum\/ogrenciler\/student-a\/sinavlar$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ada Kaya" })).toBeVisible();
    const studentExamDetails = page.getByLabel("Öğrenci sınav detayları");
    const studentExamSummary = studentExamDetails.getByRole("region", { exact: true, name: "Öğrenci sınav operasyon özeti" });
    await expect(studentExamSummary).toContainText("Başarı %");
    await expect(studentExamSummary).toContainText("%81,7");
    await expect(studentExamSummary).toContainText("Net 24,5 / Soru 30");
    await expect(studentExamSummary).toContainText("Rapor hazır");
    await expect(studentExamSummary).toContainText("2 soru");
    await expect(studentExamSummary.getByLabel("Öğrenci sınav operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const reportContext = studentExamDetails.getByLabel("Öğrenci sınav rapor bağlamı");
    await expect(reportContext.locator(".uh-select")).toHaveCount(2);
    await expect(reportContext.getByRole("region", { name: "Öğrenci rapor bağlam özeti" })).toHaveClass(/uh-info-grid/);
    await expect(reportContext).toContainText("LGS puanı");
    await expect(reportContext).toContainText("Standart puan");
    await expect(studentExamDetails.getByRole("region", { name: "Hata kitapçığı" })).toContainText("Yanıt");
    await expect(studentExamDetails.getByRole("region", { name: "Hata kitapçığı" })).toContainText("Boş");
    await expectStudentDetailNoRawIds(page, "student-exam-detail-direct");
    await expectUiStable(page, "faz9-student-exam-detail-direct", consoleErrors);
    await saveScreenshot(page, "faz9-student-exam-detail-direct.png");
  });

  test("öğrenci portalı DataTable ve mobil düzen sözleşmesini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/ogrenci", { height: 900, width: 1280 }, { authProfile: "student" });

    await expect(page.getByRole("heading", { level: 1, name: "Öğrenci Portalı" })).toBeVisible();
    const studentFocusMetrics = page
      .getByRole("region", { exact: true, name: "Öğrenci operasyon bağlamı" })
      .getByRole("region", { name: "Öğrenci operasyon bağlam metrikleri" });
    await expect(studentFocusMetrics).toHaveClass(/uh-info-grid/);
    await expect(studentFocusMetrics.locator(".uh-info-item")).toHaveCount(8);
    await expectPortalDailyBrief(page.getByRole("region", { name: "Günlük durum" }), 6);
    const studentActionStrip = page.getByRole("region", { name: "Öğrenci günlük aksiyonları" });
    await expectRolePortalActionStrip(studentActionStrip, 6, [
      { href: "#portal-announcements", name: /Duyuruları oku: 1 okunmamış/ },
      { href: "#portal-attendance", name: /Devamsızlığı kontrol et: 30 kayıt/ },
      { href: "#portal-report", name: /Son sınavı incele: %81,7/ },
    ]);
    const homeworkTable = page.getByRole("table", { name: "Ödev ve materyal atamaları" });
    await expect(homeworkTable.getByRole("columnheader", { name: "Materyal" })).toBeVisible();
    await expect(homeworkTable.getByRole("columnheader", { name: "Bağlam" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Veli ilişkileri" }).getByRole("columnheader", { name: "İzinler" })).toBeVisible();
    const studentReportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
    await expect(studentReportSummary).toContainText("Başarı %");
    await expect(studentReportSummary).toContainText("%81,7");
    const studentBranchTable = page.getByRole("table", { name: "Portal branş başarıları" });
    await expect(studentBranchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(studentBranchTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(studentBranchTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
    const studentKarneDetailToggle = studentReportSummary.getByRole("button", { name: "Karne detayını göster" });
    await expect(studentKarneDetailToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: "Sınav raporu özet sayfası" })).toHaveCount(0);
    await expect(page.getByText("+905551112233")).toHaveCount(0);
    await expectUiStable(page, "faz9-student-portal-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-student-portal-desktop.png");
    await studentKarneDetailToggle.click();
    await expect(studentReportSummary.getByRole("button", { name: "Karne detayını gizle" })).toHaveAttribute("aria-expanded", "true");
    const karneSummary = page.getByRole("region", { name: "Sınav raporu özet sayfası" });
    await expect(karneSummary).toBeVisible();
    await expect(karneSummary.getByRole("table", { name: "Branş psikometri tablosu" }).getByRole("columnheader", { name: "Başarı %" })).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/ogrenci");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { level: 1, name: "Öğrenci Portalı" })).toBeVisible();
    await expectRolePortalActionStrip(page.getByRole("region", { name: "Öğrenci günlük aksiyonları" }), 6, [
      { href: "#portal-homework", name: /Ödevi aç: 1 atama/ },
      { href: "#portal-support", name: /Destek talebini takip et: 1 açık/ },
    ]);
    const mobileStudentReportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
    await expect(mobileStudentReportSummary).toContainText("Başarı %");
    await expect(page.getByRole("region", { name: "Sınav raporu özet sayfası" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Ödev ve materyal atamaları" })).toBeVisible();
    await mobileStudentReportSummary.getByRole("button", { name: "Karne detayını göster" }).click();
    const mobileKarneSummary = page.getByRole("region", { name: "Sınav raporu özet sayfası" });
    await expect(mobileKarneSummary).toBeVisible();
    const mobileBranchTable = mobileKarneSummary.getByRole("table", { name: "Branş psikometri tablosu" });
    await expect(mobileBranchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("columnheader", { exact: true, name: "Net" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("columnheader", { exact: true, name: "Soru sayısı" })).toBeVisible();
    await expectUiStable(page, "faz9-student-portal-mobile", consoleErrors);
    await saveScreenshot(page, "faz9-student-portal-karne-mobile-expanded.png");
  });

  test("veli portalı finans izni açıkken DataTable sözleşmesini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/veli", { height: 900, width: 1280 }, { authProfile: "guardian" });

    await expect(page.getByRole("heading", { level: 1, name: "Veli Portalı" })).toBeVisible();
    const guardianFocusMetrics = page
      .getByRole("region", { exact: true, name: "Öğrenci operasyon bağlamı" })
      .getByRole("region", { name: "Öğrenci operasyon bağlam metrikleri" });
    await expect(guardianFocusMetrics).toHaveClass(/uh-info-grid/);
    await expect(guardianFocusMetrics.locator(".uh-info-item")).toHaveCount(9);
    await expectPortalDailyBrief(page.getByRole("region", { name: "Günlük durum" }), 6);
    await expectRolePortalActionStrip(page.getByRole("region", { name: "Veli günlük aksiyonları" }), 7, [
      { href: "#portal-student-picker", name: /Öğrenci seç: Ada Kaya/ },
      { href: "#portal-payments", name: /Ödeme durumunu gör: 1\.200,00 TRY/ },
      { href: "#portal-report", name: /Son sınavı incele: %81,7/ },
    ]);
    const paymentTable = page.getByRole("table", { name: "Ödeme planları" });
    await expect(paymentTable.getByRole("columnheader", { name: "Bekleyen" })).toBeVisible();
    await expect(paymentTable).toContainText("1.200,00 TRY");
    const guardianReportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
    await expect(guardianReportSummary).toContainText("Başarı %");
    await expect(guardianReportSummary).toContainText("%81,7");
    await expect(guardianReportSummary.getByRole("button", { name: "Karne detayını göster" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("table", { name: "Portal branş başarıları" }).getByRole("columnheader", { name: "Soru" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Destek talepleri" }).getByRole("columnheader", { name: "Durum" })).toBeVisible();
    await expectUiStable(page, "faz9-guardian-portal-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-guardian-portal-desktop.png");
  });

  test("öğretmen portalı rapor tablolarında Başarı Net Soru bağlamını korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/ogretmen", { height: 960, width: 1440 }, { authProfile: "teacher" });

    await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
    const teacherFocusMetrics = page
      .getByRole("region", { exact: true, name: "Öğretmen operasyon bağlamı" })
      .getByRole("region", { name: "Öğretmen operasyon bağlam metrikleri" });
    await expect(teacherFocusMetrics).toHaveClass(/uh-info-grid/);
    await expect(teacherFocusMetrics.locator(".uh-info-item")).toHaveCount(8);
    await expectPortalDailyBrief(page.getByRole("region", { name: "Günlük ders akışı" }), 6);
    await expectRolePortalActionStrip(page.getByRole("region", { name: "Öğretmen günlük aksiyonları" }), 8, [
      { href: "#portal-teacher-attendance", name: /Yoklama kaydet: 2 kayıt/ },
      { href: "#portal-teacher-material", name: /Materyal ata: 1 materyal/ },
      { href: "#portal-teacher-report", name: /Raporu incele: %81,7/ },
    ]);
    const classReportsTable = page.getByRole("table", { name: "Öğretmen sınıf raporları" });
    await expect(classReportsTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(classReportsTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(classReportsTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
    const teacherReportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
    await expect(teacherReportSummary).toContainText("Başarı %");
    await expect(teacherReportSummary).toContainText("%81,7");
    await expect(teacherReportSummary.getByRole("button", { name: "Karne detayını göster" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("table", { name: "Portal branş başarıları" }).getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Ders programı" }).getByRole("columnheader", { name: "Başlangıç" })).toBeVisible();
    await expectUiStable(page, "faz9-teacher-portal-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-teacher-portal-desktop.png");
  });

  test("rol portal aksiyon şeritleri 360/768/1024/1440 görünümde taşmadan kalır", async ({ page }) => {
    test.setTimeout(90_000);
    const consoleErrors = collectConsoleErrors(page);
    const cases: RolePortalActionStripCase[] = [
      {
        authProfile: "student",
        count: 6,
        hrefs: [
          { href: "#portal-announcements", name: /Duyuruları oku: 1 okunmamış/ },
          { href: "#portal-report", name: /Son sınavı incele: %81,7/ },
        ],
        key: "student",
        path: "/ogrenci",
        regionName: "Öğrenci günlük aksiyonları",
      },
      {
        authProfile: "guardian",
        count: 7,
        hrefs: [
          { href: "#portal-student-picker", name: /Öğrenci seç: Ada Kaya/ },
          { href: "#portal-payments", name: /Ödeme durumunu gör: 1\.200,00 TRY/ },
        ],
        key: "guardian",
        path: "/veli",
        regionName: "Veli günlük aksiyonları",
      },
      {
        authProfile: "teacher",
        count: 8,
        hrefs: [
          { href: "#portal-teacher-attendance", name: /Yoklama kaydet: 2 kayıt/ },
          { href: "#portal-teacher-report", name: /Raporu incele: %81,7/ },
        ],
        key: "teacher",
        path: "/ogretmen",
        regionName: "Öğretmen günlük aksiyonları",
      },
    ];

    for (const viewport of [
      { height: 780, width: 360 },
      { height: 1024, width: 768 },
      { height: 900, width: 1024 },
      { height: 960, width: 1440 },
    ]) {
      for (const portalCase of cases) {
        await openWithUiMocks(page, portalCase.path, viewport, { authProfile: portalCase.authProfile });
        const actionStrip = page.getByRole("region", { name: portalCase.regionName });
        await expectRolePortalActionStrip(actionStrip, portalCase.count, portalCase.hrefs);
        await expect(actionStrip.getByRole("heading", { name: "Öncelikli aksiyonlar" })).toBeVisible();
        await expectUiStable(page, `faz9-${portalCase.key}-action-strip-${viewport.width}`, consoleErrors);
        if (viewport.width === 360 || viewport.width === 1440) {
          await saveScreenshot(page, `faz9-${portalCase.key}-action-strip-${viewport.width}.png`);
        }
      }
    }
  });

  test("rapor desktop kanıtı dolu metrik ve hata kitapçığı ile temizdir", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    await expect(page.getByRole("heading", { level: 1, name: "Sınav Raporu" })).toBeVisible();
    await page.getByRole("button", { name: "Raporu getir" }).click();
    await expect(page.getByRole("tab", { name: "Kurum Analitiği" })).toHaveAttribute("aria-selected", "true");
    const analyticsPanel = page.getByRole("tabpanel", { name: "Kurum Analitiği" });
    await expect(analyticsPanel.getByRole("region", { name: "Kurum analitiği" })).toContainText("Başarı %");
    await expect(analyticsPanel).toContainText("Hazır");
    await page.getByRole("tab", { name: "Öğrenci Sonuçları" }).click();
    await expect(page.getByRole("heading", { name: "Öğrenci sıralamaları" })).toBeVisible();
    const studentsPanel = page.getByRole("tabpanel", { name: "Öğrenci Sonuçları" });
    const studentResultsTable = studentsPanel.getByRole("table", { name: "Öğrenci sıralamaları" });
    await expect(studentResultsTable.getByRole("columnheader", { name: "Öğrenci" })).toBeVisible();
    await expect(studentResultsTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(studentResultsTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(studentResultsTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
    await expect(studentResultsTable).toContainText("Ada Kaya");
    await expect(studentResultsTable).toContainText("%81,7");
    await expect(studentResultsTable.getByRole("button", { name: "Ada Kaya karnesini aç" })).toBeEnabled();
    await page.getByRole("tab", { name: "Karne Önizleme" }).click();
    const reportErrorBooklet = page.getByRole("region", { name: "Hata kitapçığı" });
    await expect(reportErrorBooklet).toContainText("Yanıt");
    await expect(reportErrorBooklet).toContainText("Doğru");
    await expect(reportErrorBooklet).toContainText("Boş");
    await page.getByRole("tab", { name: "Çıktılar" }).click();
    const exportsRegion = page.getByRole("region", { name: "Rapor çıktıları" });
    await expect(exportsRegion.getByRole("button", { name: "Excel indir" })).toBeEnabled();
    await expect(exportsRegion.getByRole("button", { name: "PDF indir" })).toBeEnabled();
    await expectUiStable(page, "faz9-reports-desktop", consoleErrors);

    await saveScreenshot(page, "faz9-reports-desktop.png");
  });

  test("rapor çalışma alanı 360/768/1024/1440 görünümde bağlam ve karne taşmadan kalır", async ({ page }) => {
    test.setTimeout(90_000);
    const consoleErrors = collectConsoleErrors(page);

    for (const viewport of [
      { height: 780, width: 360 },
      { height: 1024, width: 768 },
      { height: 900, width: 1024 },
      { height: 960, width: 1440 },
    ]) {
      await openWithUiMocks(page, "/kurum/raporlar", viewport);
      await page.getByRole("button", { name: "Raporu getir" }).click();
      await expect(page.getByRole("tab", { name: "Kurum Analitiği" })).toHaveAttribute("aria-selected", "true");
      const contextStrip = page.locator(".next-report-context-strip");
      await expect(contextStrip).toContainText("Hazır");
      await expect(contextStrip).toContainText("10.06.2026");
      await expect(contextStrip).toContainText("Matematik");
      await expect(contextStrip).toContainText("Excel/PDF hazır");

      await page.getByRole("tab", { name: "Öğrenci Sonuçları" }).click();
      const studentResultsTable = page.getByRole("table", { name: "Öğrenci sıralamaları" });
      await expect(studentResultsTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
      await expect(studentResultsTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
      await expect(studentResultsTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
      await expect(studentResultsTable).toContainText("%81,7");

      await page.getByRole("tab", { name: "Karne Önizleme" }).click();
      const karnePanel = page.getByRole("tabpanel", { name: "Karne Önizleme" });
      const karneContext = karnePanel.getByRole("region", { exact: true, name: "Karne rapor bağlamı" }).first();
      await expect(karneContext.getByRole("group", { name: "Karne rapor bağlam metrikleri" })).toHaveClass(/uh-info-grid/);
      await expect(karneContext).toContainText("READY snapshot");
      await expect(karneContext).toContainText("Soru");
      const karneBranchTable = karnePanel.getByRole("table", { name: "Öğrenci branş karne tablosu" });
      await expect(karneBranchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
      await expect(karneBranchTable.getByRole("columnheader", { exact: true, name: "Net" })).toBeVisible();
      await expect(karneBranchTable.getByRole("columnheader", { exact: true, name: "Soru sayısı" })).toBeVisible();

      await page.getByRole("tab", { name: "Çıktılar" }).click();
      const exportsRegion = page.getByRole("region", { name: "Rapor çıktıları" });
      await expect(exportsRegion).toContainText("Hazır");
      await expect(exportsRegion.getByRole("button", { name: "Excel indir" })).toBeEnabled();
      await expect(exportsRegion.getByRole("button", { name: "PDF indir" })).toBeEnabled();

      await expectUiStable(page, `faz9-report-workspace-${viewport.width}`, consoleErrors);
      if (viewport.width === 360 || viewport.width === 1440) {
        await saveScreenshot(page, `faz9-report-workspace-${viewport.width}.png`);
      }
    }
  });

  test("optik workflow desktop kanıtı tab semantiği ve yoğun form düzenini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/optik", { height: 960, width: 1440 });

    await expect(page.getByRole("heading", { level: 1, name: "Optik İşlemleri" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "1. Format" })).toHaveAttribute("aria-selected", "true");
    const selectedFormSummary = page.getByLabel("Seçili form özeti");
    await expect(selectedFormSummary).toHaveClass(/uh-info-grid/);
    await expect(selectedFormSummary.locator(".uh-info-item")).toHaveCount(4);
    await expect(selectedFormSummary).toContainText("90 soru");
    await page.getByRole("tab", { name: "4. Eşleşmeyen satırlar" }).click();
    await expect(page.getByRole("tabpanel", { name: "4. Eşleşmeyen satırlar" })).toContainText("Rapor üretimi");
    await expect(page.getByRole("tabpanel", { name: "4. Eşleşmeyen satırlar" })).toContainText("Hazır rapor yok");
    await page.getByRole("button", { name: "Raporları getir" }).click();
    const readyReportsTable = page.getByRole("table", { name: "Hazır optik raporlar" });
    await expect(readyReportsTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(readyReportsTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(readyReportsTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
    await expect(readyReportsTable).toContainText("%76,7");
    await expect(readyReportsTable).toContainText("23");
    await expect(readyReportsTable).toContainText("30");
    await expectUiStable(page, "faz9-optik-desktop", consoleErrors);

    await saveScreenshot(page, "faz9-optik-desktop.png");
  });
});

async function openWithUiMocks(
  page: Page,
  pathName: string,
  viewport: { height: number; width: number },
  options: UiMockOptions = {},
) {
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date("2026-06-17T08:00:00.000Z"));
  await installUiApiMocks(page, options);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(pathName);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installUiApiMocks(page: Page, options: UiMockOptions = {}) {
  await page.route("**/health/ready", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ dependencies: { postgres: "ok", redis: "ok" }, status: "ready" }),
      headers: { ...corsHeadersFor(route), "content-type": "application/json" },
      status: 200,
    });
  });
  await page.route("**/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ status: "ok" }),
      headers: { ...corsHeadersFor(route), "content-type": "application/json" },
      status: 200,
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    options.onApiRequest?.(pathName);
    const response = mockUiApiResponse(pathName, url.searchParams, options.authProfile ?? "admin");
    await fulfillData(route, response.data, response.meta);
  });
}

function mockUiApiResponse(pathName: string, searchParams: URLSearchParams, authProfile: UiMockAuthProfile): { data: unknown; meta?: ListMeta } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse(authProfile) };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/tenants") return createListResponse(createSystemTenants(), searchParams);
  if (pathName === "/tenants/tenant-faz9") return { data: createSystemTenants()[0] };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/me/student/profile") return { data: createStudentProfile() };
  if (pathName === "/me/student/guardians") return { data: createGuardians() };
  if (pathName === "/me/student/guardian-links") return { data: createGuardianLinks() };
  if (pathName === "/me/student/class-history" || pathName === "/me/guardian/students/student-a/class-history") return { data: createClassHistory() };
  if (pathName === "/me/student/enrollments" || pathName === "/me/guardian/students/student-a/enrollments") return { data: createEnrollments() };
  if (pathName === "/me/student/announcements") return { data: createPortalAnnouncements("STUDENTS") };
  if (pathName === "/me/student/homework/material-assignments" || pathName === "/me/guardian/homework/material-assignments") return { data: createPortalHomeworkAssignments() };
  if (pathName === "/me/student/support-tickets" || pathName === "/me/teacher/support-tickets" || pathName === "/me/guardian/students/student-a/support-tickets") return { data: createPortalSupportTickets() };
  if (pathName === "/me/student/attendance" || pathName === "/me/guardian/students/student-a/attendance") return { data: createAttendanceRecords() };
  if (pathName === "/me/student/attendance/summary" || pathName === "/me/guardian/students/student-a/attendance/summary") return { data: { absent: 1, excused: 0, late: 1, present: 28, studentId: "student-a", total: 30 } };
  if (pathName === "/me/student/teacher-notes" || pathName === "/me/guardian/students/student-a/teacher-notes") return { data: createPortalTeacherNotes() };
  if (pathName === "/me/student/development-assessments" || pathName === "/me/guardian/students/student-a/development-assessments") return { data: createDevelopmentAssessments() };
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/latest" || pathName === "/me/guardian/students/student-a/reports/exam-demo-isem-lgs-1/latest") return { data: createStudentReport("exam-demo-isem-lgs-1") };
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/latest/error-booklet" || pathName === "/me/guardian/students/student-a/reports/exam-demo-isem-lgs-1/latest/error-booklet") return { data: createErrorBooklet("exam-demo-isem-lgs-1") };
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/progress" || pathName === "/me/guardian/students/student-a/reports/exam-demo-isem-lgs-1/progress") return { data: createProgress("exam-demo-isem-lgs-1") };
  if (pathName === "/me/guardian/students") return { data: createStudents().slice(0, 1) };
  if (pathName === "/me/guardian/students/student-a/notification-preferences") return { data: createGuardianLinks()[0] };
  if (pathName === "/me/guardian/students/student-a/profile") return { data: createStudentProfile() };
  if (pathName === "/me/guardian/students/student-a/announcements") return { data: createPortalAnnouncements("GUARDIANS") };
  if (pathName === "/me/guardian/students/student-a/payment-plans") return { data: createPaymentPlans() };
  if (pathName === "/me/teacher") return { data: createTeachers()[1] };
  if (pathName === "/me/teacher/announcements") return { data: createPortalAnnouncements("TEACHERS") };
  if (pathName === "/me/teacher/schedule") return { data: createScheduleLessons() };
  if (pathName === "/me/teacher/students") return { data: createStudents() };
  if (pathName === "/me/teacher/attendance") return { data: createAttendanceRecords() };
  if (pathName === "/me/teacher/homework") return { data: createHomeworkRecords() };
  if (pathName === "/me/teacher/homework/materials") return { data: createHomeworkMaterials() };
  if (pathName === "/me/teacher/homework/materials/material-a/assignments") return { data: createPortalHomeworkAssignments() };
  if (pathName === "/me/teacher/teacher-notes") return { data: createPortalTeacherNotes() };
  if (pathName === "/me/teacher/lookups") {
    return { data: { campuses: createCampuses(), classes: createClasses(), courses: createCourses(), gradeLevels: createGradeLevels(), terms: createAcademicTerms() } };
  }
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots") return { data: createReportSnapshots("exam-demo-isem-lgs-1") };
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-a/students/student-a") return { data: createStudentReport("exam-demo-isem-lgs-1") };
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/snapshots/snapshot-a/students/student-a/error-booklet") return { data: createErrorBooklet("exam-demo-isem-lgs-1") };
  if (pathName === "/me/teacher/reports/exam-demo-isem-lgs-1/students/student-a/progress") return { data: createProgress("exam-demo-isem-lgs-1") };
  if (pathName === "/homework") return { data: createHomeworkRecords() };
  if (pathName.startsWith("/homework/materials/") && pathName.endsWith("/assignments")) return { data: createPortalHomeworkAssignments() };
  if (pathName === "/classes/class-8a") return { data: createClasses()[0] };
  if (pathName === "/classes") return { data: createClasses() };
  if (pathName === "/teachers/teacher-math") return { data: createTeacherDetailTeacher() };
  if (pathName === "/teachers/teacher-math/assignments") return { data: createTeacherDetailAssignments() };
  if (pathName === "/teachers") return { data: createTeachers() };
  if (pathName === "/students") {
    return searchParams.has("page")
      ? createListResponse(createStudents(), searchParams)
      : { data: createStudents() };
  }
  if (pathName === "/guardians") return createListResponse(createGuardians(), searchParams);
  if (pathName === "/campuses") return createListResponse(createCampuses(), searchParams);
  if (pathName === "/courses") return createListResponse(createCourses(), searchParams);
  if (pathName === "/grade-levels") return createListResponse(createGradeLevels(), searchParams);
  if (pathName === "/academic-terms") return createListResponse(createAcademicTerms(), searchParams);
  if (pathName === "/support-tickets") return { data: createSupportTickets() };
  if (pathName === "/payment-plans") return { data: createPaymentPlans() };
  if (pathName === "/attendance") return { data: createAttendanceRecords() };
  if (pathName === "/attendance/summary") return { data: { absent: 1, excused: 0, late: 1, present: 28, studentId: "student-a", total: 30 } };
  if (pathName === "/import-quarantines/summary") return { data: { openCount: 1 } };
  if (pathName === "/announcements") return createListResponse(createAnnouncements(), searchParams);
  if (pathName === "/exams") return { data: createExams() };
  if (pathName === "/students/student-a/profile") return { data: createStudentProfile() };
  if (pathName === "/students/student-a/guardian-links") return { data: createGuardianLinks() };
  if (pathName === "/students/student-a/guardians") return { data: createGuardians() };
  if (pathName === "/students/student-a/class-history") return { data: createClassHistory() };
  if (pathName === "/students/student-a/enrollments") return { data: createEnrollments() };
  if (pathName === "/students/student-a/teacher-assignments") return { data: createTeacherAssignments() };
  if (pathName === "/guardians/guardian-mother") return { data: createGuardians()[0] };
  if (pathName === "/guardians/guardian-mother/student-details") return { data: createGuardianStudentDetails("guardian-mother") };
  if (pathName === "/audit-logs/student-summary") {
    return { data: [{ action: "student.profile_updated", actionLabel: "Profil güncellendi", createdAt: "2026-06-18T08:00:00.000Z", id: "audit-student-summary" }] };
  }
  if (pathName === "/audit-logs") return { data: [] };
  if (pathName === "/homework/materials") return { data: createHomeworkMaterials() };
  if (pathName === "/teacher-notes") return { data: [{ body: "Problem çözüm adımları takip edilecek.", id: "note-a", studentId: "student-a", tenantId: "tenant-faz9" }] };
  if (pathName === "/exams/exam-demo/reports/snapshots" && searchParams.get("classId") === "class-8a") return { data: createClassDetailReportSnapshots("exam-demo") };
  if (pathName === "/exams/exam-demo/reports/snapshots") return { data: createReportSnapshots("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/snapshots") return { data: createReportSnapshots("exam-demo-isem-lgs-1") };
  if (pathName === "/exams/exam-demo/reports/students/student-a/snapshots") return { data: createReportSnapshots("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/students/student-a/snapshots") return { data: createReportSnapshots("exam-demo-isem-lgs-1") };
  if (pathName === "/exams/exam-demo/participants" || pathName === "/exams/exam-demo-isem-lgs-1/participants") return { data: createExamParticipants() };
  if (pathName === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-a") return { data: createStudentReport("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-a/students/student-a") return { data: createStudentReport("exam-demo-isem-lgs-1") };
  if (pathName === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-a/error-booklet") return { data: createErrorBooklet("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-a/students/student-a/error-booklet") return { data: createErrorBooklet("exam-demo-isem-lgs-1") };
  if (pathName === "/exams/exam-demo/reports/students/student-a/progress") return { data: createProgress("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/students/student-a/progress") return { data: createProgress("exam-demo-isem-lgs-1") };
  if (pathName.includes("/reports/")) return { data: [] };

  return { data: [] };
}

function createAuthResponse(profile: UiMockAuthProfile = "admin") {
  const profileByRole: Record<UiMockAuthProfile, { roles: string[]; subjectId?: string; subjectType?: "GUARDIAN" | "STUDENT" | "TEACHER"; userId: string }> = {
    admin: { roles: ["TENANT_ADMIN"], userId: "user-faz9-admin" },
    guardian: { roles: ["GUARDIAN"], subjectId: "guardian-mother", subjectType: "GUARDIAN", userId: "guardian-mother" },
    student: { roles: ["STUDENT"], subjectId: "student-a", subjectType: "STUDENT", userId: "student-a" },
    systemAdmin: { roles: ["SYSTEM_ADMIN"], userId: "user-system-admin" },
    teacher: { roles: ["TEACHER"], subjectId: "teacher-math", subjectType: "TEACHER", userId: "teacher-math" },
  };
  const authProfile = profileByRole[profile];

  return {
    accessToken: "faz9-access-token",
    session: {
      id: "session-faz9",
      membershipVersion: 1,
      roles: authProfile.roles,
      status: "ACTIVE",
      subjectId: authProfile.subjectId,
      subjectType: authProfile.subjectType,
      ...(profile === "systemAdmin" ? {} : { tenantId: "tenant-faz9" }),
      userId: authProfile.userId,
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@faz9-akademi.example",
    id: "tenant-faz9",
    institutionType: "Dershane",
    name: "Faz 9 Akademi",
  };
}

function createSystemTenants() {
  return [
    {
      activeSeatCount: 42,
      id: "tenant-faz9",
      licenseEndsAt: "2027-06-17T00:00:00.000Z",
      licenseStartsAt: "2026-06-17T00:00:00.000Z",
      name: "Faz 9 Akademi",
      plan: "ENTERPRISE",
      seatLimit: 120,
      slug: "faz9-akademi",
      status: "ACTIVE",
    },
    {
      activeSeatCount: 8,
      id: "tenant-deneme",
      licenseEndsAt: "2026-09-01T00:00:00.000Z",
      licenseStartsAt: "2026-06-01T00:00:00.000Z",
      name: "Deneme Koleji",
      plan: "TRIAL",
      seatLimit: 25,
      slug: "deneme-koleji",
      status: "TRIAL",
    },
  ];
}

function createClasses() {
  return [
    { campusId: "campus-main", gradeLevelId: "grade-8", id: "class-8a", level: "8", name: "8-A", section: "A", tenantId: "tenant-faz9" },
    { campusId: "campus-main", gradeLevelId: "grade-8", id: "class-8b", level: "8", name: "8-B", section: "B", tenantId: "tenant-faz9" },
  ];
}

function createTeachers() {
  return [
    { branch: "Sınıf", firstName: "Mehmet", id: "teacher-class", lastName: "Demir", tenantId: "tenant-faz9" },
    { branch: "Matematik", firstName: "Zeynep", id: "teacher-math", lastName: "Arslan", tenantId: "tenant-faz9" },
  ];
}

function createTeacherDetailTeacher() {
  return { ...createTeachers()[1], userId: "user-teacher-math" };
}

function createTeacherDetailAssignments() {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      id: "teacher-assignment-math",
      role: "BRANCH_TEACHER",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      teacherId: "teacher-math",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
    {
      classId: "class-orphan",
      courseId: "course-orphan",
      id: "teacher-assignment-orphan",
      role: "RESPONSIBLE_TEACHER",
      studentId: "student-orphan",
      teacherId: "teacher-math",
      tenantId: "tenant-faz9",
      termId: "term-orphan",
    },
  ];
}

function createStudents() {
  return [
    { classId: "class-8a", firstName: "Ada", id: "student-a", lastName: "Kaya", responsibleTeacherId: "teacher-class", status: "ACTIVE", studentNo: "8001", tenantId: "tenant-faz9" },
    { classId: "class-8a", firstName: "Bora", id: "student-b", lastName: "Yilmaz", responsibleTeacherId: "teacher-math", status: "ACTIVE", studentNo: "8002", tenantId: "tenant-faz9" },
  ];
}

function createStudentProfile() {
  return {
    birthDate: "2012-05-12",
    classId: "class-8a",
    email: "ada@example.test",
    firstName: "Ada",
    id: "student-a",
    lastName: "Kaya",
    phone: "+905551112233",
    status: "ACTIVE",
    studentNo: "8001",
    tenantId: "tenant-faz9",
  };
}

function createGuardians() {
  return [
    { firstName: "Ayse", id: "guardian-mother", lastName: "Yilmaz", phone: "+905551110001", tenantId: "tenant-faz9" },
    { firstName: "Kemal", id: "guardian-father", lastName: "Kaya", phone: "+905551110002", tenantId: "tenant-faz9" },
  ];
}

function createGuardianLinks() {
  return [
    {
      canOpenSupportTickets: true,
      canReceiveAnnouncements: true,
      canReceiveSms: true,
      canViewFinance: true,
      guardianId: "guardian-mother",
      id: "guardian-link-mother",
      isPrimary: true,
      relationshipType: "MOTHER",
      studentId: "student-a",
      tenantId: "tenant-faz9",
    },
    {
      canOpenSupportTickets: false,
      canReceiveAnnouncements: true,
      canReceiveSms: true,
      canViewFinance: false,
      guardianId: "guardian-father",
      id: "guardian-link-father",
      isPrimary: false,
      relationshipType: "FATHER",
      studentId: "student-a",
      tenantId: "tenant-faz9",
    },
  ];
}

function createGuardianStudentDetails(guardianId: string) {
  const links = createGuardianLinks().filter((link) => link.guardianId === guardianId);
  const linkedStudentIds = new Set(links.map((link) => link.studentId));
  const students = createStudents();
  return {
    availableStudents: students.filter((student) => !linkedStudentIds.has(student.id)).map(createGuardianStudentDetail),
    linkedStudents: students.filter((student) => linkedStudentIds.has(student.id)).map(createGuardianStudentDetail),
    links,
  };
}

function createGuardianStudentDetail(student: ReturnType<typeof createStudents>[number]) {
  const studentClass = createClasses().find((record) => record.id === student.classId);
  return {
    classId: student.classId,
    className: studentClass?.name,
    firstName: student.firstName,
    hasPortalUser: false,
    id: student.id,
    lastName: student.lastName,
    status: student.status,
    studentNo: student.studentNo,
  };
}

function createClassHistory() {
  return [
    {
      classId: "class-8a",
      className: "8-A",
      id: "class-history-a",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
  ];
}

function createEnrollments() {
  return [
    {
      classId: "class-8a",
      className: "8-A",
      id: "enrollment-a",
      reason: "CREATED",
      startsAt: "2026-09-01T00:00:00.000Z",
      status: "ACTIVE",
      studentId: "student-a",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
  ];
}

function createTeacherAssignments() {
  return [
    {
      classId: "class-8a",
      id: "teacher-assignment-class",
      role: "CLASS_TEACHER",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      teacherId: "teacher-class",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
    {
      classId: "class-8a",
      courseId: "course-math",
      id: "teacher-assignment-math",
      role: "BRANCH_TEACHER",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      teacherId: "teacher-math",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
  ];
}

function createCampuses() {
  return [{ id: "campus-main", name: "Ana Kampus", tenantId: "tenant-faz9" }];
}

function createCourses() {
  return [
    { code: "MAT", id: "course-math", name: "Matematik", tenantId: "tenant-faz9" },
    { code: "TUR", id: "course-turkish", name: "Turkce", tenantId: "tenant-faz9" },
  ];
}

function createGradeLevels() {
  return [{ id: "grade-8", level: "8", name: "8. Sinif", tenantId: "tenant-faz9" }];
}

function createAcademicTerms() {
  return [
    {
      academicYearId: "year-2026",
      endsAt: "2027-01-15T00:00:00.000Z",
      id: "term-2026-fall",
      isActive: true,
      name: "2026 Guz",
      startsAt: "2026-09-01T00:00:00.000Z",
      tenantId: "tenant-faz9",
    },
  ];
}

function createSupportTickets() {
  return [{ id: "ticket-a", status: "OPEN", subject: "Veli talebi", tenantId: "tenant-faz9" }];
}

function createPortalSupportTickets() {
  return [{ id: "ticket-a", priority: "NORMAL", status: "OPEN", subject: "Portal destek talebi", tenantId: "tenant-faz9" }];
}

function createPaymentPlans() {
  return [
    {
      currency: "TRY",
      id: "payment-plan-a",
      installments: [
        { amount: 120000, currency: "TRY", dueDate: "2026-01-10", id: "installment-a", installmentNo: 1, status: "OVERDUE" },
      ],
      studentId: "student-a",
      tenantId: "tenant-faz9",
      title: "LGS Hazırlık Paketi",
      totalAmount: 120000,
    },
  ];
}

function createAttendanceRecords() {
  return [
    { classId: "class-8a", date: "2026-06-17", id: "attendance-a", status: "ABSENT", studentId: "student-a", tenantId: "tenant-faz9" },
    { classId: "class-8a", date: "2026-06-17", id: "attendance-b", status: "PRESENT", studentId: "student-b", tenantId: "tenant-faz9" },
  ];
}

function createAnnouncements() {
  return [
    {
      body: "Haftalik deneme programi yayinlandi.",
      createdAt: "2026-06-15T09:00:00.000Z",
      id: "announcement-a",
      publishedAt: "2026-06-16T09:00:00.000Z",
      status: "PUBLISHED",
      tenantId: "tenant-faz9",
      title: "Haftalik deneme programi",
      updatedAt: "2026-06-16T09:00:00.000Z",
    },
  ];
}

function createPortalAnnouncements(audience: "GUARDIANS" | "STUDENTS" | "TEACHERS") {
  return [
    {
      audience,
      body: "Portal kullanıcısı için haftalık bilgilendirme yayınlandı.",
      createdAt: "2026-06-15T09:00:00.000Z",
      id: `announcement-${audience.toLowerCase()}`,
      publishedAt: "2026-06-16T09:00:00.000Z",
      status: "PUBLISHED",
      tenantId: "tenant-faz9",
      title: "Haftalık portal bilgilendirmesi",
      updatedAt: "2026-06-16T09:00:00.000Z",
    },
  ];
}

function createPortalHomeworkAssignments() {
  return [
    {
      assignedById: "teacher-math",
      courseId: "course-math",
      createdAt: "2026-06-08T09:20:00.000Z",
      dueAt: "2026-06-20T12:00:00.000Z",
      id: "material-assignment-a",
      materialId: "material-a",
      materialTitle: "Kesirler çalışma kağıdı",
      note: "Bireysel tekrar",
      studentId: "student-a",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
  ];
}

function createHomeworkMaterials() {
  return [
    {
      courseId: "course-math",
      createdAt: "2026-06-08T09:00:00.000Z",
      description: "LGS tekrar föyü ve kısa çözüm planı.",
      fileUrl: null,
      gradeLevelId: "grade-8",
      id: "material-a",
      status: "PUBLISHED",
      tenantId: "tenant-faz9",
      title: "Kesirler çalışma kağıdı",
      type: "PDF",
      updatedAt: "2026-06-08T09:00:00.000Z",
    },
  ];
}

function createPortalTeacherNotes() {
  return [
    {
      body: "Problem çözüm adımları düzenli takip edilecek.",
      courseId: "course-math",
      createdAt: "2026-06-04T10:00:00.000Z",
      developmentStatus: "IMPROVING",
      id: "teacher-note-portal-a",
      studentId: "student-a",
      teacherId: "teacher-math",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
      visibility: "GUARDIAN_STUDENT",
    },
  ];
}

function createDevelopmentAssessments() {
  return [
    {
      createdAt: "2026-06-10T09:00:00.000Z",
      id: "development-a",
      mentorNote: "Çalışma disiplini güçleniyor.",
      periodLabel: "Haziran değerlendirmesi",
      scores: [
        { criterionId: "focus", criterionName: "Odak", scaleMax: 5, scaleMin: 1, score: 4 },
        { criterionId: "routine", criterionName: "Rutin", scaleMax: 5, scaleMin: 1, score: 5 },
      ],
      studentId: "student-a",
      tenantId: "tenant-faz9",
    },
  ];
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
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
      title: "Matematik problem çözümü",
    },
  ];
}

function createHomeworkRecords() {
  return [
    {
      classId: "class-8a",
      createdAt: "2026-06-08T09:20:00.000Z",
      dueAt: "2026-06-20T12:00:00.000Z",
      id: "homework-a",
      sourceMaterialTitle: "Kesirler çalışma kağıdı",
      studentId: "student-a",
      tenantId: "tenant-faz9",
      title: "Kesirler tekrar",
    },
  ];
}

function createExams() {
  return [
    {
      createdAt: "2026-06-01T09:00:00.000Z",
      id: "exam-demo",
      startsAt: "2026-06-10T09:00:00.000Z",
      status: "PUBLISHED",
      tenantId: "tenant-faz9",
      title: "LGS Hazirlik Denemesi",
      updatedAt: "2026-06-10T09:00:00.000Z",
    },
  ];
}

function createExamParticipants() {
  return [
    { createdAt: "2026-06-01T09:00:00.000Z", examId: "exam-demo", id: "participant-a", participantNo: "176", bookletType: "A", status: "ATTENDED", studentId: "student-a", tenantId: "tenant-faz9", updatedAt: "2026-06-01T09:00:00.000Z" },
    { createdAt: "2026-06-01T09:00:00.000Z", examId: "exam-demo", id: "participant-b", participantNo: "177", bookletType: "B", status: "ATTENDED", studentId: "student-b", tenantId: "tenant-faz9", updatedAt: "2026-06-01T09:00:00.000Z" },
  ];
}

function createClassDetailReportSnapshots(examId: string) {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      createdAt: "2026-06-10T12:00:00.000Z",
      examId,
      generatedAt: "2026-06-10T12:00:00.000Z",
      gradeLevelId: "grade-8",
      id: "snapshot-class-detail",
      inputRefs: {},
      reportType: "EXAM_SUMMARY",
      snapshotData: {
        averages: {
          blank: 2,
          correct: 24,
          estimatedRawScore: 430,
          net: 23,
          questionCount: 30,
          standardScore: 430,
          successRate: 76.7,
          wrong: 4,
        },
        classes: [
          {
            averages: { blank: 2, correct: 24, estimatedRawScore: 430, net: 23, questionCount: 30, standardScore: 430, successRate: 76.7, wrong: 4 },
            classId: "class-8a",
            className: "8-A",
            resultCount: 3,
          },
        ],
        generatedAt: "2026-06-10T12:00:00.000Z",
        resultCount: 3,
        students: [
          {
            classId: "class-8a",
            className: "8-A",
            outcomes: [
              { blank: 0, branch: "Matematik", correct: 9, net: 8.5, outcomeCode: "M.8.1", questionCount: 10, successRate: 92, wrong: 1 },
              { blank: 1, branch: "Turkce", correct: 8, net: 7.5, outcomeCode: "T.8.2", questionCount: 10, successRate: 75, wrong: 1 },
            ],
            resultKey: "student-a",
            studentId: "student-a",
            total: { blank: 1, correct: 25, estimatedRawScore: 440, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
          },
          {
            classId: "class-8a",
            className: "8-A",
            outcomes: [
              { blank: 0, branch: "Matematik", correct: 8, net: 7.5, outcomeCode: "M.8.1", questionCount: 10, successRate: 80, wrong: 2 },
              { blank: 1, branch: "Turkce", correct: 7, net: 6.5, outcomeCode: "T.8.2", questionCount: 10, successRate: 65, wrong: 2 },
            ],
            resultKey: "student-b",
            studentId: "student-b",
            total: { blank: 2, correct: 20, estimatedRawScore: 395, net: 19, questionCount: 30, standardScore: 395, successRate: 63.3, wrong: 8 },
          },
          {
            classId: "class-8a",
            className: "8-A",
            outcomes: [
              { blank: 0, branch: "Matematik", correct: 7, net: 6.5, outcomeCode: "M.8.1", questionCount: 10, successRate: 70, wrong: 3 },
              { blank: 1, branch: "Turkce", correct: 6, net: 5.5, outcomeCode: "T.8.2", questionCount: 10, successRate: 55, wrong: 3 },
            ],
            resultKey: "student-orphan",
            studentId: "student-orphan",
            total: { blank: 3, correct: 18, estimatedRawScore: 360, net: 17, questionCount: 30, standardScore: 360, successRate: 56.7, wrong: 9 },
          },
        ],
      },
      status: "READY",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
      updatedAt: "2026-06-10T12:00:00.000Z",
    },
  ];
}

function createReportSnapshots(examId: string) {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      createdAt: "2026-06-10T12:00:00.000Z",
      examId,
      generatedAt: "2026-06-10T12:00:00.000Z",
      gradeLevelId: "grade-8",
      id: "snapshot-a",
      inputRefs: {},
      reportType: "EXAM_SUMMARY",
      snapshotData: {
        averages: {
          blank: 2,
          correct: 24,
          estimatedRawScore: 430,
          net: 23,
          questionCount: 30,
          standardScore: 430,
          successRate: 76.7,
          wrong: 4,
        },
        branches: [
          { blank: 1, branch: "Matematik", correct: 12, net: 11, questionCount: 15, resultCount: 2, successRate: 73.3, wrong: 2 },
          { blank: 1, branch: "Turkce", correct: 12, net: 12, questionCount: 15, resultCount: 2, successRate: 80, wrong: 2 },
        ],
        classes: [
          {
            averages: { blank: 1, correct: 24, net: 23, questionCount: 30, standardScore: 430, successRate: 76.7, wrong: 5 },
            classId: "class-8a",
            className: "8-A",
            resultCount: 2,
          },
          {
            averages: { blank: 2, correct: 20, net: 19, questionCount: 30, standardScore: 395, successRate: 63.3, wrong: 8 },
            classId: "class-8b",
            className: "8-B",
            resultCount: 1,
          },
        ],
        generatedAt: "2026-06-10T12:00:00.000Z",
        outcomes: [
          { blank: 0, branch: "Matematik", correct: 8, net: 7.5, outcomeCode: "M.8.1", questionCount: 10, resultCount: 2, successRate: 75, wrong: 2 },
          { blank: 1, branch: "Turkce", correct: 9, net: 8.5, outcomeCode: "T.8.2", questionCount: 10, resultCount: 2, successRate: 85, wrong: 0 },
        ],
        resultCount: 2,
        students: [
          {
            classId: "class-8a",
            className: "8-A",
            resultKey: "student-a",
            studentId: "student-a",
            total: { blank: 1, correct: 25, estimatedRawScore: 440, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
          },
          {
            classId: "class-8a",
            className: "8-A",
            resultKey: "student-b",
            studentId: "student-b",
            total: { blank: 2, correct: 20, estimatedRawScore: 395, net: 19, questionCount: 30, standardScore: 395, successRate: 63.3, wrong: 8 },
          },
        ],
      },
      status: "READY",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
      updatedAt: "2026-06-10T12:00:00.000Z",
    },
  ];
}

function createStudentReport(examId: string) {
  return {
    branches: [
      { blank: 1, branch: "Matematik", classNetAverage: 10.5, correct: 12, generalNetAverage: 9.8, net: 11, questionCount: 15, schoolNetAverage: 10.8, successRate: 73.3, wrong: 2 },
      { blank: 0, branch: "Turkce", classNetAverage: 11.2, correct: 13, generalNetAverage: 10.1, net: 13, questionCount: 15, schoolNetAverage: 11.9, successRate: 86.7, wrong: 2 },
    ],
    classId: "class-8a",
    className: "8-A",
    examId,
    examStartsAt: "2026-06-10T09:00:00.000Z",
    examTitle: "LGS Hazirlik Denemesi",
    generatedAt: "2026-06-10T12:00:00.000Z",
    institutionName: "Faz 9 Akademi",
    outcomes: [
      { branch: "Matematik", correct: 8, net: 7.5, outcomeCode: "M.8.1", questionCount: 10, successRate: 75, wrong: 2 },
      { branch: "Turkce", correct: 9, net: 8.5, outcomeCode: "T.8.2", questionCount: 10, successRate: 85, wrong: 1 },
    ],
    participantNo: "176",
    questions: createQuestionSummaries(),
    resultKey: "student-a",
    snapshotId: "snapshot-a",
    statistics: {
      branches: [],
      class: { outOf: 2, percentile: 100, rank: 1 },
      general: { outOf: 2, percentile: 100, rank: 1 },
      standardScore: 440,
    },
    studentId: "student-a",
    studentName: "Ada Kaya",
    tenantId: "tenant-faz9",
    total: { blank: 1, correct: 25, estimatedRawScore: 440, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
  };
}

function createQuestionSummaries() {
  return [
    { answer: "A", branch: "Matematik", correctAnswer: "A", outcomeCode: "M.8.1", questionNo: 1, status: "CORRECT" },
    { answer: "B", branch: "Matematik", correctAnswer: "C", outcomeCode: "M.8.1", questionNo: 2, status: "WRONG" },
    { answer: "", branch: "Turkce", correctAnswer: "D", outcomeCode: "T.8.2", questionNo: 3, status: "BLANK" },
  ];
}

function createErrorBooklet(examId: string) {
  return {
    examId,
    generatedAt: "2026-06-10T12:00:00.000Z",
    items: createQuestionSummaries().filter((question) => question.status !== "CORRECT"),
    snapshotId: "snapshot-a",
    studentId: "student-a",
    tenantId: "tenant-faz9",
  };
}

function createProgress(examId: string) {
  return {
    examId,
    netDelta: 3.5,
    points: [
      {
        examTitle: "Mayis Denemesi",
        generatedAt: "2026-05-10T12:00:00.000Z",
        snapshotId: "snapshot-prev",
        total: { blank: 2, correct: 20, net: 21, questionCount: 30, standardScore: 405, successRate: 70, wrong: 8 },
      },
      {
        examTitle: "LGS Hazirlik Denemesi",
        generatedAt: "2026-06-10T12:00:00.000Z",
        snapshotId: "snapshot-a",
        total: { blank: 1, correct: 25, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
      },
    ],
    standardScoreDelta: 35,
    studentId: "student-a",
    tenantId: "tenant-faz9",
  };
}

interface ListMeta {
  limit: number;
  page: number;
  total: number;
  totalPages: number;
}

function createListResponse(data: unknown[], searchParams: URLSearchParams): { data: unknown[]; meta: ListMeta } {
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? String(Math.max(data.length, 1)));
  return {
    data,
    meta: {
      limit,
      page,
      total: data.length,
      totalPages: data.length === 0 ? 0 : Math.ceil(data.length / limit),
    },
  };
}

async function fulfillData(route: Route, data: unknown, meta?: ListMeta) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
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
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function expectUiStable(page: Page, label: string, consoleErrors: string[]) {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await expect(page.locator(".uh-chart-loading")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, label);
  await expectNoBlankCanvas(page, label);
  await expectNoUnlabeledControls(page, label);
  await expectNoClippedVisibleText(page, label);
  expect(consoleErrors, `${label}: konsol hatası`).toEqual([]);
}

async function expectTeacherDetailNoRawIds(page: Page, label: string) {
  const body = page.locator("body");
  for (const value of [
    "teacher-math",
    "teacher-assignment-math",
    "teacher-assignment-orphan",
    "class-8a",
    "student-a",
    "course-math",
    "term-2026-fall",
    "class-orphan",
    "student-orphan",
    "course-orphan",
    "term-orphan",
    "tenant-faz9",
  ]) {
    await expect(body, `${label}: ${value} görünür metinde yer almamalı`).not.toContainText(value);
  }
}

async function expectClassDetailNoRawIds(page: Page, label: string) {
  const body = page.locator("body");
  for (const value of [
    "class-8a",
    "student-a",
    "student-b",
    "student-orphan",
    "exam-demo",
    "snapshot-class-detail",
    "campus-main",
    "grade-8",
    "course-math",
    "term-2026-fall",
    "tenant-faz9",
  ]) {
    await expect(body, `${label}: ${value} görünür metinde yer almamalı`).not.toContainText(value);
  }
}

async function expectStudentDetailNoRawIds(page: Page, label: string) {
  const body = page.locator("body");
  for (const value of [
    "student-a",
    "student-b",
    "guardian-mother",
    "guardian-father",
    "guardian-link-mother",
    "guardian-link-father",
    "teacher-class",
    "teacher-math",
    "teacher-assignment-class",
    "teacher-assignment-math",
    "class-8a",
    "course-math",
    "term-2026-fall",
    "tenant-faz9",
    "audit-student-summary",
    "note-a",
    "exam-demo",
    "snapshot-a",
    "participant-a",
    "+905551112233",
    "ada@example.test",
    "+905551110001",
    "+905551110002",
    "student.profile_updated",
    "guardian_student.updated",
    "entityId",
    "actorUserId",
    "diff",
  ]) {
    await expect(body, `${label}: ${value} görünür metinde yer almamalı`).not.toContainText(value);
  }
}

async function expectGuardianDetailNoRawIds(page: Page, label: string) {
  const body = page.locator("body");
  for (const value of [
    "guardian-mother",
    "guardian-father",
    "guardian-link-mother",
    "guardian-link-father",
    "student-a",
    "class-8a",
    "tenant-faz9",
    "+905551110001",
    "+905551110002",
  ]) {
    await expect(body, `${label}: ${value} görünür metinde yer almamalı`).not.toContainText(value);
  }
}

async function expectRolePortalActionStrip(
  actionStrip: Locator,
  expectedCount: number,
  expectedLinks: Array<{ href: string; name: RegExp }>,
) {
  await expect(actionStrip).toBeVisible();
  await expect(actionStrip.locator(".next-portal-action-strip__item")).toHaveCount(expectedCount);
  for (const expectedLink of expectedLinks) {
    await expect(actionStrip.getByRole("link", { name: expectedLink.name })).toHaveAttribute("href", expectedLink.href);
  }
}

async function expectPortalDailyBrief(brief: Locator, expectedCount: number) {
  await expect(brief).toBeVisible();
  const metrics = brief.getByRole("group", { name: /metrikleri/ });
  await expect(metrics).toHaveClass(/uh-metric-grid/);
  await expect(metrics.locator(".next-portal-brief__item.uh-metric-card")).toHaveCount(expectedCount);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflowResult = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const viewportWidth = documentElement.clientWidth;
    const overflow = Math.max(documentElement.scrollWidth - viewportWidth, body.scrollWidth - body.clientWidth);
    const offenders = Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        const style = window.getComputedStyle(htmlElement);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.position !== "fixed";
        const elementOverflow = Math.max(
          Math.ceil(htmlElement.scrollWidth - htmlElement.clientWidth),
          Math.ceil(rect.right - viewportWidth),
          Math.ceil(0 - rect.left),
        );
        const className =
          typeof htmlElement.className === "string" ? htmlElement.className.trim().replace(/\s+/g, ".") : "";
        return {
          selector: `${htmlElement.tagName.toLowerCase()}${htmlElement.id ? `#${htmlElement.id}` : ""}${
            className ? `.${className}` : ""
          }`,
          overflow: elementOverflow,
          visible,
        };
      })
      .filter((item) => item.visible && item.overflow > 1)
      .sort((left, right) => right.overflow - left.overflow)
      .slice(0, 5);
    return { offenders, overflow };
  });
  const offenderText = overflowResult.offenders
    .map((item) => `${item.selector} +${item.overflow}px`)
    .join(", ");

  expect(
    overflowResult.overflow,
    `${label}: yatay taşma ${overflowResult.overflow}px${offenderText ? `; adaylar: ${offenderText}` : ""}`,
  ).toBeLessThanOrEqual(1);
}

async function expectNoBlankCanvas(page: Page, label: string) {
  const blankCanvasCount = await page.evaluate(() =>
    Array.from(document.querySelectorAll("canvas")).filter((canvas) => canvas.width <= 0 || canvas.height <= 0).length,
  );

  expect(blankCanvasCount, `${label}: boş canvas sayısı`).toBe(0);
}

async function expectNoUnlabeledControls(page: Page, label: string) {
  const unlabeledControls = await page.evaluate(() => {
    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    function hasName(element: Element) {
      const htmlElement = element as HTMLElement;
      const input = element as HTMLInputElement;
      return Boolean(
        htmlElement.closest("label") ||
          element.getAttribute("aria-label")?.trim() ||
          element.getAttribute("aria-labelledby")?.trim() ||
          element.getAttribute("title")?.trim() ||
          input.placeholder?.trim() ||
          htmlElement.textContent?.trim(),
      );
    }

    return Array.from(document.querySelectorAll("button, input, select, textarea"))
      .filter((element) => isVisible(element) && !(element as HTMLInputElement).disabled && !hasName(element))
      .map((element) => element.outerHTML.slice(0, 160));
  });

  expect(unlabeledControls, `${label}: etiketsiz kontrol`).toEqual([]);
}

async function expectNoClippedVisibleText(page: Page, label: string) {
  const clippedTexts = await page.evaluate(() => {
    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    return Array.from(document.querySelectorAll(
      [
        "a",
        "label",
        "button",
        ".uh-status-badge",
        ".next-dashboard-link-cell.uh-action-card",
        ".next-student-decision-card",
        ".next-attention-item.uh-action-card",
        ".next-tenant-profile",
        ".next-portal-summary-card",
        ".next-portal-action-strip__item",
        ".next-report-context-strip > .uh-info-item",
        ".next-report-export-grid > div",
        ".next-karne-context-strip .uh-info-item",
        ".next-karne-summary-strip .uh-metric-card",
      ].join(", "),
    ))
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

async function saveScreenshot(page: Page, fileName: string) {
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ fullPage: true, path: path.join(artifactDir, fileName) });
}
