import { expect, test, type Page } from "@playwright/test";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": "http://localhost:3001",
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
    const body = route.request().postDataJSON() as { email?: string };
    activeEmail = body.email ?? "";
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
  await expandSidebarGroup(page, "Yönetim");
  await page.getByRole("link", { name: "Yedekleme" }).click();
  await expect(page).toHaveURL(/\/kurum\/yedek-restore$/);
  await expect(page.getByRole("heading", { name: "Yedek / Restore" })).toBeVisible();
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
  expect(backupRestorePostCount).toBe(1);

  await page.getByLabel("Panel restore drill işi").getByLabel("İş tipi").selectOption("RESTORE_DRILL");
  await page.getByLabel("Panel restore drill işi").getByLabel("Restore kanıt dosyası").fill("s3://uzman-hocam-prod-backups/restore-drill.json");
  await page.getByLabel("Panel restore drill işi").getByLabel("Onay metni").fill("RESTORE DRILL");
  await page.getByLabel("Panel restore drill işi").getByRole("button", { name: "Restore drill işi başlat" }).click();
  await expect(page.getByText("Restore kanıt dosyası file:// artifact yolu olmalı.")).toBeVisible();
  expect(backupRestorePostCount).toBe(1);

  await page.getByLabel("Panel restore drill işi").getByLabel("Restore kanıt dosyası").fill("file:///mnt/restore-drills/restore-drill.json");
  await page.getByLabel("Panel restore drill işi").getByLabel("Onay metni").fill("RESTORE DRILL");
  await page.getByLabel("Panel restore drill işi").getByRole("button", { name: "Restore drill işi başlat" }).click();
  await expect(page.getByLabel("Yedek restore işleri").getByRole("heading", { name: "Restore drill" })).toBeVisible();
  expect(backupRestorePostCount).toBe(2);
});

async function loginAsTenantAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill("admin-a@example.test");
  await page.getByLabel("Şifre").fill("password");
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
