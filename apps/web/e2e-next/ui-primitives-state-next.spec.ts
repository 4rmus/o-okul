import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("UI primitive durum sözleşmesi", () => {
  test("gerçek kazanım route'u modal focus, loading, hata ve kapanış kilidini korur", async ({ page }) => {
    let createRequestCount = 0;
    await installApiMocks(page, {
      async createLearningOutcome(route) {
        createRequestCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 900));
        await route.fulfill({
          body: JSON.stringify({ error: { code: "TEST_FAILURE", message: "Kayıt tamamlanamadı" } }),
          headers: { ...corsHeadersFor(route), "content-type": "application/json" },
          status: 500,
        });
      },
    });
    await setSessionCookie(page);
    await page.goto("/kurum/kazanimlar");

    const table = page.getByRole("table", { name: "Kazanım katalog listesi" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Kazanım" })).toBeVisible();

    const openButton = page.getByRole("button", { name: "Kazanım ekle" }).first();
    await expect(openButton).toHaveCSS("min-height", "44px");
    await openButton.click();

    const dialog = page.getByRole("dialog", { name: "Kazanım ekle" });
    const codeInput = dialog.getByLabel("Kazanım kodu");
    const submitButton = dialog.getByRole("button", { name: "Ekle" });
    await expect(dialog).toBeVisible();
    await expect(codeInput).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expect(codeInput).toHaveAttribute("id", /.+/);
    await expect(dialog.locator(".uh-field__message")).toHaveCount(4);

    await codeInput.press("Shift+Tab");
    await expect(submitButton).toBeFocused();
    await submitButton.press("Tab");
    await expect(codeInput).toBeFocused();

    await codeInput.fill("MAT.8.1.1");
    await dialog.getByLabel("Branş").fill("Matematik");
    await dialog.getByLabel("Kazanım adı").fill("Çarpanları çözümler");
    await submitButton.click();

    const loadingButton = dialog.getByRole("button", { name: "İşleniyor" });
    await expect(loadingButton).toBeDisabled();
    await expect(loadingButton).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByRole("button", { name: "Vazgeç" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await codeInput.press("Enter");
    expect(createRequestCount).toBe(1);

    await expect(dialog.getByRole("alert")).toContainText("Kazanım kaydedilemedi.");
    await expect(submitButton).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(openButton).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  });

  test("gerçek sınıf route'u tab klavyesi ve yoğun tablo semantiğini korur", async ({ page }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await installApiMocks(page);
    await setSessionCookie(page);
    await page.goto("/kurum/siniflar/class-8a");

    const generalTab = page.getByRole("tab", { name: "Genel" });
    await expect(generalTab).toHaveAttribute("aria-selected", "true");
    await expect(generalTab).toHaveCSS("min-height", "44px");
    await generalTab.focus();
    await generalTab.press("ArrowRight");

    const studentsTab = page.getByRole("tab", { name: "Öğrenciler" });
    await expect(studentsTab).toBeFocused();
    await expect(studentsTab).toHaveAttribute("aria-selected", "true");
    const studentsTable = page.getByRole("table", { name: "Sınıf öğrenci listesi" });
    await expect(studentsTable).toBeVisible();
    await expect(studentsTable).not.toHaveAttribute("aria-busy", "true");
    await expect(studentsTable.getByRole("columnheader", { name: "Öğrenci" })).toBeVisible();
    await expect(studentsTable).toContainText("Ada Kaya");

    const rootOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(rootOverflow).toBe(0);
  });

  test("gerçek materyal route'u tooltip gecikmesi ve klavye odağını korur", async ({ page }) => {
    await installApiMocks(page);
    await setSessionCookie(page);
    await page.goto("/kurum/materyaller");

    const trigger = page.getByRole("button", { name: "calisma.pdf indir" });
    const tooltip = page.getByRole("tooltip", { name: "calisma.pdf indir" });
    const tooltipId = await tooltip.getAttribute("id");
    expect(tooltipId).toBeTruthy();
    await expect(trigger).toHaveAttribute("aria-describedby", tooltipId!);

    await trigger.hover();
    await page.waitForTimeout(800);
    await expect(tooltip).toHaveCSS("opacity", "0");
    await page.waitForTimeout(150);
    await expect(tooltip).toHaveCSS("opacity", "1");

    await page.mouse.move(0, 0);
    await expect(tooltip).toHaveCSS("opacity", "0");
    await trigger.hover();
    await page.waitForTimeout(300);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(650);
    await expect(tooltip).toHaveCSS("opacity", "0");

    await trigger.focus();
    await expect(tooltip).toHaveCSS("opacity", "1");
  });
});

async function setSessionCookie(page: Page) {
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
}

async function installApiMocks(
  page: Page,
  options: { createLearningOutcome?(route: Route): Promise<void> } = {},
) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    if (path === "/auth/refresh") {
      await fulfillData(route, {
        accessToken: "primitive-contract-token",
        session: {
          id: "session-primitives",
          membershipVersion: 1,
          roles: ["TENANT_ADMIN"],
          status: "ACTIVE",
          tenantId: "tenant-primitives",
          userId: "user-primitives",
        },
      });
      return;
    }
    if (path === "/me/tenant") {
      await fulfillData(route, {
        contactEmail: "bilgi@ornek-okul.test",
        id: "tenant-primitives",
        institutionType: "Dershane",
        name: "Örnek Okul",
      });
      return;
    }
    if (path === "/learning-outcomes" && route.request().method() === "POST" && options.createLearningOutcome) {
      await options.createLearningOutcome(route);
      return;
    }
    if (path === "/learning-outcomes") {
      await fulfillData(
        route,
        [{ branch: "Matematik", code: "MAT.8.1.1", id: "outcome-a", level: "8", tenantId: "tenant-primitives", title: "Çarpanlar" }],
        { limit: 20, page: 1, total: 1, totalPages: 1 },
      );
      return;
    }
    if (path === "/homework") {
      await fulfillData(route, [], { limit: 20, page: 1, total: 0, totalPages: 1 });
      return;
    }
    if (path === "/homework/materials") {
      await fulfillData(
        route,
        [{ description: "Denklem çalışma dosyası", id: "material-a", tenantId: "tenant-primitives", title: "Denklem Çalışması" }],
        { limit: 20, page: 1, total: 1, totalPages: 1 },
      );
      return;
    }
    if (path === "/homework/materials/material-a/files") {
      await fulfillData(route, [
        {
          byteSize: 1024,
          contentType: "application/pdf",
          createdAt: "2026-07-30T08:00:00.000Z",
          fileName: "calisma.pdf",
          id: "file-a",
          materialId: "material-a",
          sha256: "abc123",
          tenantId: "tenant-primitives",
        },
      ]);
      return;
    }
    if (path === "/homework/materials/material-a/assignments") {
      await fulfillData(route, []);
      return;
    }
    if (path === "/classes/class-8a") {
      await fulfillData(route, {
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        id: "class-8a",
        name: "8-A",
        section: "A",
        tenantId: "tenant-primitives",
      });
      return;
    }
    if (path === "/campuses") {
      await fulfillData(route, [{ id: "campus-main", name: "Ana Kampüs", tenantId: "tenant-primitives" }]);
      return;
    }
    if (path === "/grade-levels") {
      await fulfillData(route, [{ code: "8", id: "grade-8", name: "8. Sınıf", tenantId: "tenant-primitives" }]);
      return;
    }
    if (path === "/students") {
      await fulfillData(route, [
        {
          classId: "class-8a",
          firstName: "Ada",
          id: "student-a",
          lastName: "Kaya",
          status: "ACTIVE",
          studentNo: "8001",
          tenantId: "tenant-primitives",
        },
      ]);
      return;
    }

    await fulfillData(route, []);
  });
}

async function fulfillData(
  route: Route,
  data: unknown,
  meta?: { limit: number; page: number; total: number; totalPages: number },
) {
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
