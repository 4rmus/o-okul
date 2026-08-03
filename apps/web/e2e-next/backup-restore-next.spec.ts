import { expect, test, type Page } from "@playwright/test";

const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": webOrigin,
  "access-control-expose-headers": "content-disposition",
};

async function expandSidebarGroup(page: Page, name: string) {
  const groupButton = page.getByRole("button", { name, exact: true });
  if ((await groupButton.getAttribute("aria-expanded")) !== "true") {
    await groupButton.click();
  }
}

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
  await expandSidebarGroup(page, "Yönetim ve Kanıt");
  const backupLink = page.getByRole("link", { name: "Yedekleme" });
  await expect(backupLink).toHaveAttribute("href", "/kurum/yedek-restore");
  await backupLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/kurum\/yedek-restore$/);
  await expect(page.getByRole("heading", { name: "Yedek / Restore" })).toBeVisible();
  await expect(page.getByLabel("Yedek restore güven durumu").getByText("Yedek Kanıt Gücü")).toBeVisible();
  await expect(page.getByLabel("Yedek restore güven durumu").getByText("Maskeli")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kurum Veri Yedeği" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Kurum verisini indir" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("o-okul-tenant-a-2026-06-14.json");
  expect(tenantExportGetCount).toBe(1);
  await expect(page.getByLabel("Panel restore drill işi").getByText("Panel İş Tetikleme")).toBeVisible();

  await page.getByLabel("Panel restore drill işi").getByLabel("İş tipi").selectOption("BACKUP");
  await page.getByLabel("Panel restore drill işi").getByLabel("Yedek hedefi").fill("offsite-backup");
  await page.getByLabel("Panel restore drill işi").getByLabel("Onay metni").fill("YEDEK AL");
  await page.getByLabel("Panel restore drill işi").getByRole("button", { name: "Yedek alma işi başlat" }).click();
  await expect(page.getByText("Yedek hedefi s3://bucket/prefix veya kalıcı file:// dizin olmalı.")).toBeVisible();
  expect(backupRestorePostCount).toBe(0);

  await page.getByLabel("Panel restore drill işi").getByLabel("Yedek hedefi").fill("file:///mnt/backups/tenant-a");
  await page.getByLabel("Panel restore drill işi").getByLabel("Onay metni").fill("YEDEK AL");
  await page.getByLabel("Panel restore drill işi").getByRole("button", { name: "Yedek alma işi başlat" }).click();
  await expect(page.getByLabel("Yedek restore işleri").getByRole("heading", { name: "Yedek alma" })).toBeVisible();
  await expect(page.getByLabel("Yedek restore işleri").getByText("file://<redacted>")).toBeVisible();
  await expect(page.getByLabel("Yedek restore işleri").getByText("file:///mnt/backups/tenant-a")).toHaveCount(0);
  await expect(page.getByLabel("Yedek restore işleri").getByText("backup-restore-job-created_backup")).toHaveCount(0);
  await expect(page.getByLabel("Yedek restore işleri").getByText("İş referansı maskeli")).toBeVisible();
  expect(backupRestorePostCount).toBe(1);

  await page.getByLabel("Panel restore drill işi").getByLabel("İş tipi").selectOption("RESTORE_DRILL");
  await page.getByLabel("Panel restore drill işi").getByLabel("Restore kanıt dosyası").fill("s3://o-okul-prod-backups/restore-drill.json");
  await page.getByLabel("Panel restore drill işi").getByLabel("Onay metni").fill("RESTORE DRILL");
  await page.getByLabel("Panel restore drill işi").getByRole("button", { name: "Restore drill işi başlat" }).click();
  await expect(page.getByText("Restore kanıt dosyası file:// artifact yolu olmalı.")).toBeVisible();
  expect(backupRestorePostCount).toBe(1);

  await page.getByLabel("Panel restore drill işi").getByLabel("Restore kanıt dosyası").fill("file:///mnt/restore-drills/restore-drill.json");
  await page.getByLabel("Panel restore drill işi").getByLabel("Onay metni").fill("RESTORE DRILL");
  await page.getByLabel("Panel restore drill işi").getByRole("button", { name: "Restore drill işi başlat" }).click();
  await expect(page.getByLabel("Yedek restore işleri").getByRole("heading", { name: "Restore drill" })).toBeVisible();
  await expect(page.getByLabel("Yedek restore işleri").getByText("file:///mnt/restore-drills/restore-drill.json")).toHaveCount(0);
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
