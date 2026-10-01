import { expect, test, type Page } from "@playwright/test";

const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": webOrigin,
  "access-control-expose-headers": "content-disposition",
};

interface BackupRestoreJobFixture {
  checkedTables: string[];
  createdAt: string;
  errorCode?: string;
  id: string;
  jobId: string;
  operationType: "BACKUP" | "RESTORE_DRILL";
  queueName: "backup-restore";
  reason?: string;
  requestedByUserId: string;
  result?: "PASS";
  status: "queued";
  targetReference: string;
  tenantId: string;
  updatedAt: string;
}

test("yedek restore paneli hedef sözleşmesini API çağrısından önce doğrular", async ({ page }) => {
  let activeEmail = "";
  let backupRestorePostCount = 0;
  let tenantExportGetCount = 0;
  let deviceDownloads = 0, devicePreviews = 0;
  const backupRestoreJobs: BackupRestoreJobFixture[] = [];

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.continue();
  });

  await page.route("**/auth/refresh", async (route) => {
    if (!activeEmail) {
      await route.fulfill({ headers: corsHeaders, status: 401 });
      return;
    }
    await route.fulfill({
      body: JSON.stringify(envelope(createAuthResponse(activeEmail))),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
  });

  await page.route("**/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { loginName?: string };
    activeEmail = body.loginName ? "admin-a@example.test" : "";
    await route.fulfill({
      body: JSON.stringify(envelope(createAuthResponse(activeEmail))),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }

    expect(request.headers().authorization).toBe("Bearer next-access-token");

    if (path === "/device-backups/status") {
      await route.fulfill({ headers: corsHeaders, contentType: "application/json", body: JSON.stringify(envelope({ available: true, maxFileBytes: 33558528 })) }); return;
    }
    if (path === "/device-backups/download") {
      expect(request.postDataJSON()).toEqual({ password: "uzun-yedek-parolasi" }); deviceDownloads++;
      await route.fulfill({ headers: { ...corsHeaders, "content-disposition": 'attachment; filename="fixture.ookulbackup"' }, contentType: "application/octet-stream", body: Buffer.from("encrypted-fixture") }); return;
    }
    if (path === "/device-backups/preview") {
      devicePreviews++; expect(request.headers()["content-type"]).toContain("multipart/form-data");
      expect(request.postDataBuffer()?.toString()).toContain('name="password"');
      if (devicePreviews === 2) { expect(request.postDataBuffer()?.toString()).toContain('name="planToken"'); expect(request.postDataBuffer()?.toString()).toContain("fixture-plan-ticket"); }
      await route.fulfill({ headers: corsHeaders, contentType: "application/json", body: JSON.stringify(envelope({ backupId: "a".repeat(32), plan: {token:"fixture-plan-ticket",createdAt:"2026-09-08T00:00:00Z",expiresAt:"2026-09-08T00:05:00Z",scope:"DATABASE_PREVIEW_ONLY",canApply:false}, tenantId: "tenant-a", createdAt: "2026-09-08T00:00:00Z", schemaCompatible: true, impact: { domainLinks: {checkedLinks:4,conflicts:[{source:"IdentityInvitation",target:"Student",links:1}],pendingDeliveries:2,unverified:[]}, references: { checkedLinks: 3, conflicts: [{table:"PaymentPlan",references:"Student",links:1}], unverified: [] }, additions: 2, changes: 1, removals: 0, tables: {}, activeStudents: 2, activeStudentLimit: 1, preserved: ["FINANCE","CONSENT","IDENTITY"], blockers: ["DEVICE_RESTORE_STUDENT_LIMIT_EXCEEDED","DEVICE_RESTORE_FINANCE_DIFFERENCE","DEVICE_RESTORE_DOMAIN_LINK_CONFLICT","DEVICE_RESTORE_DELIVERIES_UNRESOLVED"], canApply: false }, tableCounts: { Student: 2 }, fileCount: 1, fileBytes: 7, integrityVerified: true, restoreVerified: false, canRestore: false, blockers: ["DEVICE_BACKUP_RESTORE_NOT_VERIFIED"] })) }); return;
    }

    if (path === "/me/tenant" && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(envelope({ id: "tenant-a", name: "DNA Eğitim", plan: "TRIAL", slug: "dna-egitim", status: "ACTIVE" })),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/me/institution-dashboard" && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(envelope({
          activeStudentCount: 0,
          attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
          generatedAt: "2026-06-14T10:00:00.000Z",
          institution: { name: "DNA Eğitim" },
        })),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/me/notification-devices" && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(envelope([])),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/backup-restore-jobs" && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(envelope(backupRestoreJobs)),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/backup-restore-jobs/tenant-export" && request.method() === "GET") {
      tenantExportGetCount += 1;
      await route.fulfill({
        body: JSON.stringify({
          formatVersion: "tenant-export-v1",
          tenantId: "tenant-a",
          generatedByUserId: "user-tenant-a",
          exportedAt: "2026-06-14T10:00:00.000Z",
          scope: "tenant-user-entered-data",
          rowLimitPerTable: 5000,
          tables: { students: [], classes: [], guardians: [], paymentPlans: [] },
          warnings: [],
        }),
        contentType: "application/json",
        headers: {
          ...corsHeaders,
          "content-disposition": 'attachment; filename="o-okul-tenant-a-2026-06-14.json"',
        },
        status: 200,
      });
      return;
    }

    if (path === "/backup-restore-jobs" && request.method() === "POST") {
      backupRestorePostCount += 1;
      const body = request.postDataJSON() as {
        confirmationText: string;
        operationType: "BACKUP" | "RESTORE_DRILL";
        reason?: string;
        targetReference: string;
      };
      expect(body.confirmationText).toBe(body.operationType === "BACKUP" ? "YEDEK AL" : "RESTORE DRILL");
      const suffix = body.operationType === "BACKUP" ? "backup" : "restore-drill";
      const created: BackupRestoreJobFixture = {
        checkedTables: [],
        createdAt: "2026-06-14T10:00:00.000Z",
        id: `backup-restore-job-created-${suffix}`,
        jobId: `backup-restore-job-created_${suffix}`,
        operationType: body.operationType,
        queueName: "backup-restore",
        reason: body.reason,
        requestedByUserId: "user-tenant-a",
        status: "queued",
        targetReference: body.targetReference,
        tenantId: "tenant-a",
        updatedAt: "2026-06-14T10:00:00.000Z",
      };
      backupRestoreJobs.unshift(created);
      await route.fulfill({
        body: JSON.stringify(envelope(created)),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify(envelope([])),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
  });

  await loginAsTenantAdmin(page);
  const managementGroup = page.getByRole("button", { name: "Ayarlar", exact: true });
  if ((await managementGroup.getAttribute("aria-expanded")) !== "true") {
    await managementGroup.click();
  }
  await page.getByRole("link", { name: "Operasyon ve kanıt" }).click();
  await expect(page).toHaveURL(/\/kurum\/operasyon-ve-kanit$/);
  // Hub sekmeleri de "Yedekleme" bağlantısı taşır (Berrak G5); araç kartını hedefle.
  const backupLink = page.getByLabel("Operasyon ve kanıt araçları").getByRole("link", { name: "Yedekleme" });
  await expect(backupLink).toHaveAttribute("href", "/kurum/yedek-restore");
  await backupLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/kurum\/yedek-restore$/);
  await expect(page.getByRole("heading", { name: "Yedekleme ve Geri Yükleme" })).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme güven durumu").getByText("Yedekleme Güvence Durumu")).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme güven durumu").getByText("Maskeli")).toBeVisible();
  await expect(page.getByRole("heading", { name: "JSON Veri Dışa Aktarımı" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Kurum verisini indir" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("o-okul-tenant-a-2026-06-14.json");
  expect(tenantExportGetCount).toBe(1);
  await page.getByLabel("Yeni yedek parolası", { exact: true }).fill("uzun-yedek-parolasi");
  await page.getByLabel("Yedek parolasını tekrar yaz").fill("farkli-yedek-parolasi");
  await page.getByRole("button", { name: "Şifreli yedeği indir", exact: true }).click();
  await expect(page.getByLabel("Cihazda şifreli kurum yedeği").getByRole("alert")).toHaveText("Yedek parolaları eşleşmiyor."); expect(deviceDownloads).toBe(0);
  await page.getByLabel("Yedek parolasını tekrar yaz").fill("uzun-yedek-parolasi");
  const encryptedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Şifreli yedeği indir", exact: true }).click();
  expect((await encryptedDownload).suggestedFilename()).toMatch(/\.ookulbackup$/); expect(deviceDownloads).toBe(1);
  await expect(page.getByLabel("Yeni yedek parolası", { exact: true })).toHaveValue("");
  await page.getByLabel("Cihazımdaki yedek dosyası").setInputFiles({ name: "fixture.ookulbackup", mimeType: "application/octet-stream", buffer: Buffer.from("fixture") });
  await page.getByLabel("Dosyanın yedek parolası").fill("uzun-yedek-parolasi");
  await page.getByRole("button", { name: "Yedeği yükle ve doğrula", exact: true }).click();
  await expect(page.getByText("2 kayıt ve 1 dosya.")).toBeVisible();
  await expect(page.getByText(/Kurum verilerine uygulama kapalı/)).toBeVisible(); expect(devicePreviews).toBe(1);
  await expect(page.getByLabel("Dosyanın yedek parolası")).toHaveValue("");
  await expect(page.getByLabel("Geri yükleme etki önizlemesi")).toContainText("2 eklenecek, 1 değişecek, 0 kaldırılacak");
  await expect(page.getByLabel("Geri yükleme etki önizlemesi")).toContainText("3 ilişki kontrol edildi; 1 ilişki çatışması");
  await expect(page.getByLabel("Geri yükleme etki önizlemesi")).toContainText("4 kontrol, 1 çatışma; görülen 2 sonuçlandırılmamış gönderim");
  await expect(page.getByText("Bekleyen veya sonucu belirsiz gönderimler sonuçlandırılmalı.")).toBeVisible();
  await expect(page.getByText("Yedekteki aktif öğrenci sayısı mevcut sınırı aşıyor.")).toBeVisible();
  await expect(page.getByText("Finans geçmişi farklı; mevcut finans kayıtları korunacak.")).toBeVisible();
  await expect(page.getByText(/Bu bir geri yükleme onayı değildir/)).toBeVisible();
  await page.getByLabel("Dosyanın yedek parolası").fill("uzun-yedek-parolasi");
  await page.getByRole("button",{name:"Planı yeniden doğrula",exact:true}).click();
  await expect(page.getByRole("button",{name:"Planı yeniden doğrula",exact:true})).toBeVisible();expect(devicePreviews).toBe(2);
  await page.getByLabel("Cihazda şifreli kurum yedeği").screenshot({ path: test.info().outputPath("device-backup-panel.png") });

  await page.getByText("Teknik operasyonlar", { exact: true }).click();
  await expect(page.getByLabel("Panel geri yükleme tatbikatı işi").getByText("Korumalı İş Başlatma")).toBeVisible();

  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("İş tipi").selectOption("BACKUP");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Yedek hedefi").fill("offsite-backup");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Onay metni").fill("YEDEK AL");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByRole("button", { name: "Yedek al" }).click();
  await expect(page.getByText("Yedek hedefi s3://bucket/prefix veya kalıcı file:// dizin olmalı.")).toBeVisible();
  expect(backupRestorePostCount).toBe(0);

  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Yedek hedefi").fill("file:///mnt/backups/tenant-a");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Onay metni").fill("YEDEK AL");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByRole("button", { name: "Yedek al" }).click();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByRole("heading", { name: "Yedekleme" })).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("file://<redacted>")).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("file:///mnt/backups/tenant-a")).toHaveCount(0);
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("backup-restore-job-created_backup")).toHaveCount(0);
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("İş referansı maskeli")).toBeVisible();
  expect(backupRestorePostCount).toBe(1);

  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("İş tipi").selectOption("RESTORE_DRILL");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Geri yükleme kanıt dosyası").fill("s3://o-okul-prod-backups/restore-drill.json");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Onay metni").fill("GERİ YÜKLEME TATBİKATI");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByRole("button", { name: "Geri yüklemeyi dene" }).click();
  await expect(page.getByText("Geri yükleme kanıt dosyası kalıcı file:// yolunda olmalı.")).toBeVisible();
  expect(backupRestorePostCount).toBe(1);

  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Geri yükleme kanıt dosyası").fill("file:///mnt/restore-drills/restore-drill.json");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Onay metni").fill("GERİ YÜKLEME TATBİKATI");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByRole("button", { name: "Geri yüklemeyi dene" }).click();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByRole("heading", { name: "Geri yükleme tatbikatı" })).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("file:///mnt/restore-drills/restore-drill.json")).toHaveCount(0);
  expect(backupRestorePostCount).toBe(2);
});

async function loginAsTenantAdmin(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="tenantSlug"]').fill("dna-egitim");
  await page.locator('input[name="loginName"]').fill("admin-a@example.test");
  await page.locator('input[name="password"]').fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/kurum$/);
}

function envelope<T>(data: T) {
  return { data };
}

function createAuthResponse(email: string) {
  return {
    accessToken: "next-access-token",
    session: {
      id: "session-a",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-a",
      userId: email === "admin-a@example.test" ? "user-tenant-a" : "user-other",
    },
  };
}
