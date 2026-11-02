import { expect, test, type Page, type Route } from "@playwright/test";

// S3: DataTable satır seçimi, sabit başlık satırı ve öğrenci listesinde seçime bağlı toplu işlemler.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

interface CapturedBulkRequests {
  bulkRenew: Array<{ classId?: string; startsAt?: string; studentIds?: string[] }>;
  guardianInvitations: Array<{ idempotencyKey: string | undefined; studentIds?: string[] }>;
  studentLists: URLSearchParams[];
}

const students = [
  createStudent("student-a", "Ada", "Kaya", "1101"),
  createStudent("student-b", "Bora", "Demir", "1102"),
  createStudent("student-c", "Cem", "Yıldız", "1103"),
];

test.describe("Öğrenci listesi toplu seçim", () => {
  test("başlık kutusu sayfadaki satırları seçer, toplu işlemler yalnız seçili öğrencileri gönderir", async ({ page }) => {
    const captured = createCaptured();
    await page.setViewportSize({ height: 900, width: 1280 });
    await openStudents(page, captured, ["TENANT_ADMIN"]);

    const table = page.getByRole("table", { name: "Öğrenci listesi" });
    const selectAll = table.getByRole("checkbox", { name: "Bu sayfadaki tüm öğrencileri seç" });
    const bulkBar = page.getByRole("region", { name: "Toplu işlem çubuğu" });
    await expect(table.getByRole("checkbox", { name: "Ada Kaya seç" })).toBeVisible();
    await expect(selectAll).not.toBeChecked();
    await expect(bulkBar).toHaveCount(0);

    await table.getByRole("checkbox", { name: "Bora Demir seç" }).check();
    await expect(bulkBar).toContainText("1 öğrenci seçildi");
    await expect(selectAll).not.toBeChecked();
    expect(await selectAll.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(true);
    await expect(table.getByRole("row").filter({ hasText: "Bora Demir" })).toHaveAttribute("data-selected", "true");

    await selectAll.check();
    await expect(bulkBar).toContainText("3 öğrenci seçildi");
    expect(await selectAll.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(false);
    await selectAll.uncheck();
    await expect(bulkBar).toHaveCount(0);

    await table.getByRole("checkbox", { name: "Ada Kaya seç" }).check();
    await table.getByRole("checkbox", { name: "Cem Yıldız seç" }).check();
    await expect(bulkBar).toContainText("2 öğrenci seçildi");
    // Kapalı Toplu işlemler panelindeki ayarlar görünmeden geçiş başlamaz: ilk tıklama paneli açıp tarihe odaklanır.
    const renewDialog = page.getByRole("dialog", { name: "Toplu dönem geçişini onayla" });
    const bulkTransition = page.getByLabel("Toplu dönem geçişi");
    await expect(bulkTransition.getByLabel("Geçiş tarihi")).toBeHidden();
    await bulkBar.getByRole("button", { name: "Dönem geçişi" }).click();
    await expect(renewDialog).toHaveCount(0);
    await expect(bulkTransition.getByLabel("Geçiş tarihi")).toBeFocused();
    await expect(bulkTransition.getByLabel("Hedef sınıf")).toBeVisible();
    expect(captured.bulkRenew).toHaveLength(0);
    await bulkBar.getByRole("button", { name: "Dönem geçişi" }).click();
    await expect(renewDialog).toContainText(/2 seçili öğrenci \d{4}-\d{2}-\d{2} tarihinden itibaren sınıfsız hedefe geçirilsin mi\?/);
    await expect(renewDialog).toContainText("Bu işlem yalnız seçili öğrencilerin kayıt dönemini günceller.");
    await renewDialog.getByRole("button", { name: "Geçir" }).click();
    await expect.poll(() => captured.bulkRenew.length).toBe(1);
    expect(captured.bulkRenew[0]?.studentIds).toEqual(["student-a", "student-c"]);
    expect(captured.bulkRenew[0]?.classId).toBe("");
    await expect(bulkBar).toHaveCount(0);
    await expect(table.getByRole("checkbox", { name: "Ada Kaya seç" })).not.toBeChecked();

    await table.getByRole("checkbox", { name: "Bora Demir seç" }).check();
    await bulkBar.getByRole("button", { name: "Veli daveti" }).click();
    const inviteDialog = page.getByRole("dialog", { name: "Toplu veli davetini onayla" });
    await expect(inviteDialog).toContainText("1 seçili öğrencinin velisi davet edilsin mi?");
    await inviteDialog.getByRole("button", { name: "Davet et" }).click();
    await expect.poll(() => captured.guardianInvitations.length).toBe(1);
    expect(captured.guardianInvitations[0]).toEqual({ idempotencyKey: expect.any(String), studentIds: ["student-b"] });
    await expect(bulkBar.getByRole("status")).toHaveText("Davet gönderildi: 1 · Zaten var: 0 · Atlandı: 0");
    await expect(bulkBar).not.toContainText("öğrenci seçildi");
    await bulkBar.getByRole("button", { name: "Sonucu kapat" }).click();
    await expect(bulkBar).toHaveCount(0);
  });

  test("Seçimi temizle ve liste sorgusu değişimi seçimi sıfırlar", async ({ page }) => {
    const captured = createCaptured();
    await page.setViewportSize({ height: 900, width: 1280 });
    await openStudents(page, captured, ["TENANT_ADMIN"]);

    const table = page.getByRole("table", { name: "Öğrenci listesi" });
    const bulkBar = page.getByRole("region", { name: "Toplu işlem çubuğu" });
    await table.getByRole("checkbox", { name: "Bu sayfadaki tüm öğrencileri seç" }).check();
    await expect(bulkBar).toContainText("3 öğrenci seçildi");
    await bulkBar.getByRole("button", { name: "Seçimi temizle" }).click();
    await expect(bulkBar).toHaveCount(0);
    await expect(table.getByRole("checkbox", { name: "Ada Kaya seç" })).not.toBeChecked();

    await table.getByRole("checkbox", { name: "Ada Kaya seç" }).check();
    await expect(bulkBar).toContainText("1 öğrenci seçildi");
    await page.getByLabel("Öğrenci yönetimi").getByLabel("Ara").fill("ada");
    await expect.poll(() => captured.studentLists.at(-1)?.get("q")).toBe("ada");
    await expect(bulkBar).toHaveCount(0);
    await expect(table.getByRole("checkbox", { name: "Ada Kaya seç" })).not.toBeChecked();
  });

  test("Toplu işlemler paneli seçili sayıyı gösterir, seçim yokken eylemler kapalıdır", async ({ page }) => {
    const captured = createCaptured();
    await page.setViewportSize({ height: 900, width: 1280 });
    await openStudents(page, captured, ["TENANT_ADMIN"]);

    await page.getByText("Toplu işlemler", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Seçilenleri geçir (0)" })).toBeDisabled();
    await expect(page.getByLabel("Toplu veli daveti").getByRole("button", { name: "Velileri davet et (0)" })).toBeDisabled();
    await page.getByRole("table", { name: "Öğrenci listesi" }).getByRole("checkbox", { name: "Bora Demir seç" }).check();
    await expect(page.getByRole("button", { name: "Seçilenleri geçir (1)" })).toBeEnabled();
    await expect(page.getByLabel("Toplu veli daveti").getByRole("button", { name: "Velileri davet et (1)" })).toBeEnabled();
  });

  test("geçiş tarihi boşken dönem geçişi başlamaz, çubuk tarihe odaklanır", async ({ page }) => {
    const captured = createCaptured();
    await page.setViewportSize({ height: 900, width: 1280 });
    await openStudents(page, captured, ["TENANT_ADMIN"]);

    const table = page.getByRole("table", { name: "Öğrenci listesi" });
    const bulkBar = page.getByRole("region", { name: "Toplu işlem çubuğu" });
    const bulkTransition = page.getByLabel("Toplu dönem geçişi");
    await page.getByText("Toplu işlemler", { exact: true }).click();
    await bulkTransition.getByLabel("Geçiş tarihi").fill("");
    await table.getByRole("checkbox", { name: "Ada Kaya seç" }).check();
    await expect(page.getByRole("button", { name: "Seçilenleri geçir (1)" })).toBeDisabled();
    await bulkBar.getByRole("button", { name: "Dönem geçişi" }).click();
    await expect(page.getByRole("dialog", { name: "Toplu dönem geçişini onayla" })).toHaveCount(0);
    await expect(bulkTransition.getByLabel("Geçiş tarihi")).toBeFocused();

    await bulkTransition.getByLabel("Geçiş tarihi").fill("2026-09-14");
    await expect(page.getByRole("button", { name: "Seçilenleri geçir (1)" })).toBeEnabled();
    await bulkBar.getByRole("button", { name: "Dönem geçişi" }).click();
    const renewDialog = page.getByRole("dialog", { name: "Toplu dönem geçişini onayla" });
    await expect(renewDialog).toContainText("1 seçili öğrenci 2026-09-14 tarihinden itibaren sınıfsız hedefe geçirilsin mi?");
    await renewDialog.getByRole("button", { name: "Geçir" }).click();
    await expect.poll(() => captured.bulkRenew.length).toBe(1);
    expect(captured.bulkRenew[0]).toEqual({ classId: "", startsAt: "2026-09-14", studentIds: ["student-a"] });
  });

  test("veli daveti yetkisi olmayan operasyon çalışanı seçip yalnız dönem geçişi yapar", async ({ page }) => {
    const captured = createCaptured();
    await page.setViewportSize({ height: 900, width: 1280 });
    await openStudents(page, captured, ["OPERATIONS_STAFF"]);

    const table = page.getByRole("table", { name: "Öğrenci listesi" });
    const bulkBar = page.getByRole("region", { name: "Toplu işlem çubuğu" });
    await table.getByRole("checkbox", { name: "Ada Kaya seç" }).check();
    await expect(bulkBar).toContainText("1 öğrenci seçildi");
    await expect(bulkBar.getByRole("button", { name: "Dönem geçişi" })).toBeVisible();
    await expect(bulkBar.getByRole("button", { name: "Veli daveti" })).toHaveCount(0);
    await page.getByText("Toplu işlemler", { exact: true }).click();
    await expect(page.getByLabel("Toplu veli daveti")).toHaveCount(0);
  });

  test("geniş ekranda başlık satırı kaydırma alanında sabit kalır", async ({ page }) => {
    const captured = createCaptured();
    await page.setViewportSize({ height: 900, width: 1440 });
    await openStudents(page, captured, ["TENANT_ADMIN"]);

    const scrollRegion = page.getByRole("region", { name: "Öğrenci listesi kaydırma alanı" });
    await expect(scrollRegion).toHaveAttribute("data-sticky-header", "true");
    const header = page.getByRole("table", { name: "Öğrenci listesi" }).getByRole("columnheader", { exact: true, name: "Durum" });
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
    await expect.poll(() => scrollRegion.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");

    // Baskıda yükseklik sınırı kalkar (liste kesilmez); seçim sütunu ve toplu işlem çubuğu kâğıda çıkmaz.
    await page.getByRole("table", { name: "Öğrenci listesi" }).getByRole("checkbox", { name: "Ada Kaya seç" }).check();
    await expect(page.getByRole("region", { name: "Toplu işlem çubuğu" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect.poll(() => scrollRegion.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.maxHeight} ${style.overflowY}`;
    })).toBe("none visible");
    expect(await header.evaluate((element) => getComputedStyle(element).position)).not.toBe("sticky");
    expect(await page.locator(".uh-data-table__select-cell").evaluateAll((cells) => cells.filter((cell) => getComputedStyle(cell).display !== "none").length)).toBe(0);
    await expect(page.locator(".next-bulk-selection")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
  });

  for (const width of [320, 375, 768, 1024]) {
    test(`${width}px seçim ve işlem çubuğu taşmadan çalışır`, async ({ page }) => {
      const captured = createCaptured();
      await page.setViewportSize({ height: 844, width });
      await openStudents(page, captured, ["TENANT_ADMIN"]);

      const table = page.getByRole("table", { name: "Öğrenci listesi" });
      const bulkBar = page.getByRole("region", { name: "Toplu işlem çubuğu" });
      await table.getByRole("checkbox", { name: "Ada Kaya seç" }).check();
      await expect(bulkBar).toContainText("1 öğrenci seçildi");
      await expect(bulkBar.getByRole("button", { name: "Seçimi temizle" })).toBeVisible();
      const target = await table.getByRole("checkbox", { name: "Ada Kaya seç" }).evaluate((input) => {
        const rect = input.closest("label")?.getBoundingClientRect();
        return { height: rect?.height ?? 0, width: rect?.width ?? 0 };
      });
      // Dokunmatik genişliklerde (<= 1023 px) 44 px, masaüstünde diğer onay kutularıyla aynı 28 px hedef.
      const minTarget = width < 1024 ? 44 : 28;
      expect(target.height).toBeGreaterThanOrEqual(minTarget);
      expect(target.width).toBeGreaterThanOrEqual(minTarget);
      const overflow = await page.evaluate(() => Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
      ));
      expect(overflow, `${width}px yatay taşma`).toBeLessThanOrEqual(1);
      if (width < 761) {
        const header = table.getByRole("columnheader", { exact: true, name: "Durum" });
        expect(await header.evaluate((element) => getComputedStyle(element).position)).not.toBe("sticky");
      }
    });
  }
});

function createCaptured(): CapturedBulkRequests {
  return { bulkRenew: [], guardianInvitations: [], studentLists: [] };
}

async function openStudents(page: Page, captured: CapturedBulkRequests, roles: string[]) {
  await installMocks(page, captured, roles);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/kurum/ogrenciler");
  await expect(page.getByRole("heading", { level: 1, name: "Öğrenciler" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Öğrenci listesi" }).getByText("Ada Kaya")).toBeVisible();
}

async function installMocks(page: Page, captured: CapturedBulkRequests, roles: string[]) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(request.url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");

    if (pathName === "/auth/refresh") {
      await fulfillData(route, {
        accessToken: "bulk-selection-access-token",
        session: {
          id: "session-bulk-selection",
          membershipVersion: 1,
          roles,
          status: "ACTIVE",
          tenantId: "tenant-bulk-selection",
          userId: "user-bulk-selection",
        },
      });
      return;
    }
    if (pathName === "/me/tenant") {
      await fulfillData(route, { contactEmail: "bilgi@secim-akademi.example", id: "tenant-bulk-selection", institutionType: "Dershane", name: "Seçim Akademi" });
      return;
    }
    if (pathName === "/students" && request.method() === "GET") {
      if (url.searchParams.has("limit")) {
        captured.studentLists.push(new URLSearchParams(url.search));
        const query = url.searchParams.get("q")?.toLocaleLowerCase("tr-TR") ?? "";
        const rows = query ? students.filter((student) => `${student.firstName} ${student.lastName}`.toLocaleLowerCase("tr-TR").includes(query)) : students;
        await fulfillData(route, rows, { limit: Number(url.searchParams.get("limit") ?? "50"), total: rows.length });
        return;
      }
      await fulfillData(route, students);
      return;
    }
    if (pathName === "/students/enrollments/bulk-renew" && request.method() === "POST") {
      const body = request.postDataJSON() as { classId?: string; startsAt?: string; studentIds?: string[] };
      captured.bulkRenew.push({ classId: body.classId, startsAt: body.startsAt, studentIds: body.studentIds });
      await fulfillData(route, { enrollments: [], updatedCount: body.studentIds?.length ?? 0 });
      return;
    }
    if (pathName === "/students/guardian-invitations" && request.method() === "POST") {
      const body = request.postDataJSON() as { studentIds?: string[] };
      captured.guardianInvitations.push({ idempotencyKey: request.headers()["idempotency-key"], studentIds: body.studentIds });
      await fulfillData(route, {
        alreadyExistsCount: 0,
        createdCount: 1,
        results: [{ contactId: "contact-b", guardianId: "guardian-b", invitationId: "invitation-b", status: "CREATED", studentId: "student-b" }],
        skippedCount: 0,
      });
      return;
    }

    await fulfillData(route, []);
  });
}

function createStudent(id: string, firstName: string, lastName: string, studentNo: string) {
  return {
    classId: null,
    firstName,
    gradeLevelId: null,
    id,
    lastName,
    responsibleTeacherId: null,
    status: "ACTIVE",
    studentNo,
    tenantId: "tenant-bulk-selection",
  };
}

async function fulfillData(route: Route, data: unknown, meta?: Record<string, unknown>) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
    headers: { ...corsHeadersFor(route), "content-type": "application/json" },
    status: 200,
  });
}

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}
