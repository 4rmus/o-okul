import { expect, test, type Page } from "@playwright/test";

const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": webOrigin,
};

test("KVKK PII temizleme onay olmadan POST etmez", async ({ page }) => {
  let activeEmail = "";
  let purgePostCount = 0;
  const requestedPaths: string[] = [];
  let inventory = [
    {
      id: "student-a",
      kind: "student",
      displayRef: "Öğrenci kaydı 1",
      piiCategories: ["Ad", "soyad", "telefon"],
      purgeAvailable: true,
    },
  ];
  const rawPiiValues = ["Ada A", "5554443322", "ada.kaya@example.test", "1001"];

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
    requestedPaths.push(path);
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }

    expect(request.headers().authorization).toBe("Bearer next-access-token");

    if (path === "/me/notification-devices") {
      await route.fulfill({
        body: JSON.stringify(envelope([])),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/me/tenant") {
      await route.fulfill({
        body: JSON.stringify(envelope(createTenantResponse())),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/privacy/inventory" && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(envelope(inventory)),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if ((path === "/students" || path === "/teachers" || path === "/guardians") && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(envelope({ error: "BROAD_PII_ENDPOINT_FORBIDDEN" })),
        contentType: "application/json",
        headers: corsHeaders,
        status: 500,
      });
      return;
    }

    if (path === "/students/student-a/purge-pii" && request.method() === "POST") {
      purgePostCount += 1;
      inventory = inventory.map((item) =>
        item.id === "student-a" ? { ...item, piiCategories: [], purgeAvailable: false } : item,
      );
      await route.fulfill({
        body: JSON.stringify(envelope({ id: "student-a", firstName: "Anonim", lastName: "Ogrenci" })),
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

  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: webOrigin, value: "csrf-token" }]);
  activeEmail = "admin-a@example.test";
  await page.goto("/kurum/kvkk");
  await expect(page).toHaveURL(/\/kurum\/kvkk$/);
  await expect(page.getByRole("region", { exact: true, name: "KVKK operasyon özeti" })).toContainText("Purge onayı");
  await expect(page.getByLabel("KVKK güven durumu").getByText("PII İşlem Güvencesi")).toBeVisible();
  const kvkkTable = page.getByLabel("KVKK yönetimi").getByRole("table", { name: "KVKK PII temizleme kayıtları" });
  await expect(kvkkTable.getByRole("cell", { exact: true, name: "Öğrenci kaydı 1" })).toBeVisible();
  await expect(kvkkTable.getByRole("cell", { name: "Ad, soyad, telefon" })).toBeVisible();
  for (const value of rawPiiValues) {
    await expect(page.locator("body")).not.toContainText(value);
  }
  expect(requestedPaths.filter((path) => ["/students", "/teachers", "/guardians"].includes(path))).toEqual([]);
  await expectNoHorizontalOverflow(page, "kvkk-inventory");
  await expectNoUnlabeledControls(page, "kvkk-inventory");
  await expectNoClippedVisibleText(page, "kvkk-inventory");

  await page.getByLabel("Öğrenci kaydı 1 PII temizle").click();
  await expect(page.getByRole("dialog", { name: "PII temizlemeyi onayla" })).toBeVisible();
  await expectNoUnlabeledControls(page, "kvkk-confirmation");
  await expectNoClippedVisibleText(page, "kvkk-confirmation");
  expect(purgePostCount).toBe(0);
  await page.getByRole("button", { name: "Vazgeç" }).click();
  expect(purgePostCount).toBe(0);

  await page.getByLabel("Öğrenci kaydı 1 PII temizle").click();
  await page.getByRole("dialog", { name: "PII temizlemeyi onayla" }).getByRole("button", { name: "PII temizle" }).click();
  await expect(kvkkTable.getByRole("cell", { exact: true, name: "Öğrenci kaydı 1" })).toBeVisible();
  await expect(kvkkTable.getByRole("cell", { exact: true, name: "Temiz" })).toBeVisible();
  for (const value of rawPiiValues) {
    await expect(page.locator("body")).not.toContainText(value);
  }
  await expectNoHorizontalOverflow(page, "kvkk-purged");
  await expectNoUnlabeledControls(page, "kvkk-purged");
  await expectNoClippedVisibleText(page, "kvkk-purged");
  expect(purgePostCount).toBe(1);
});

function envelope<T>(data: T) {
  return { data };
}

function createTenantResponse() {
  return {
    contactEmail: "kvkk@example.test",
    id: "tenant-a",
    institutionType: "Dershane",
    name: "KVKK Akademi",
  };
}

function createAuthResponse(email: string) {
  return {
    accessToken: "next-access-token",
    session: {
      id: "session-a",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-a",
      userId: email === "admin-a@example.test" ? "user-tenant-a" : "user-other",
    },
  };
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return Math.max(documentElement.scrollWidth - documentElement.clientWidth, body.scrollWidth - body.clientWidth);
  });

  expect(overflow, `${label}: yatay taşma ${overflow}px`).toBeLessThanOrEqual(1);
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
        ".next-operation-summary__item",
        ".next-operation-summary__action",
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
