import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token,x-role-preview-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("Rol önizleme UI sözleşmesi", () => {
  test("portal kartları PII göstermeden kapsam ve route sözleşmesini korur", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    await openRolePreview(page, { height: 844, width: 390 }, unexpectedMutations);

    await expect(page.getByRole("heading", { level: 1, name: "Rol Önizleme" })).toBeVisible();
    const rolePreviewMetrics = page.getByRole("region", { name: "Rol önizleme özeti" });
    await expect(rolePreviewMetrics).toContainText("3 rol");
    await expect(rolePreviewMetrics.locator(".uh-metric-card")).toHaveCount(3);
    await expect(page.locator(".next-role-preview-metrics")).toHaveCount(0);
    const operationSummary = page.getByRole("region", { exact: true, name: "Rol önizleme operasyon özeti" });
    await expect(operationSummary).toContainText("Token");
    await expect(operationSummary).toContainText("URL'de yok");
    await expect(operationSummary.getByLabel("Rol önizleme operasyon özeti aksiyon kuyruğu")).toBeVisible();

    const portalCards = page.getByLabel("Rol portal kartları");
    await expect(portalCards.getByRole("heading", { name: "Öğretmen Portalı" })).toBeVisible();
    await expect(portalCards.getByRole("heading", { name: "Öğrenci Portalı" })).toBeVisible();
    await expect(portalCards.getByRole("heading", { name: "Veli Portalı" })).toBeVisible();
    await expect(portalCards).toContainText("TEACHER + subjectType TEACHER");
    await expect(portalCards).toContainText("STUDENT + subjectType STUDENT");
    await expect(portalCards).toContainText("GUARDIAN + subjectType GUARDIAN");
    await expect(portalCards).toContainText("/ogretmen");
    await expect(portalCards).toContainText("/ogrenci");
    await expect(portalCards).toContainText("/veli");
    await expect(portalCards.getByText("Demo hesap bilgisi görünüm kanıtlarında gösterilmez.")).toHaveCount(3);
    await expect(portalCards.getByLabel("Önizleme kişisi")).toHaveCount(3);
    await expect(portalCards).toContainText("Öğretmen kaydı 1");
    await expect(portalCards).toContainText("Öğrenci kaydı 1");
    await expect(portalCards).toContainText("Veli kaydı 1");
    await expect(portalCards).toContainText("Maskeli öğretmen referansı");
    await expect(portalCards).toContainText("Maskeli öğrenci referansı");
    await expect(portalCards).toContainText("Maskeli veli referansı");
    await expect(portalCards.getByRole("table", { name: "Öğretmen Portalı kapsam özeti" })).toContainText("/me/teacher");
    await expect(portalCards.getByRole("table", { name: "Öğrenci Portalı kapsam özeti" })).toContainText("/me/student");
    await expect(portalCards.getByRole("table", { name: "Veli Portalı kapsam özeti" })).toContainText("/me/guardian");
    await expectNoVisibleTextValues(page, "role-preview-cards", [
      "teacher-a",
      "student-a",
      "guardian-a",
      "5554443322",
      "teacher-preview-main",
      "student-preview-main",
      "guardian-preview-main",
      "Ayse Ogretmen",
      "Ada Ogrenci",
      "Zeynep Veli",
      "Branş: Matematik",
      "Öğrenci no: 1001",
      "Portal kullanıcısı bağlı veli kaydı",
      "1001",
      "Matematik",
      "teacher-a@example.test",
      "student-a@example.test",
      "guardian-a@example.test",
      "preview-token-teacher",
      "preview-token-student",
      "preview-token-guardian",
    ]);
    expect(unexpectedMutations).toEqual([]);

    await expectNoHorizontalOverflow(page, "role-preview-cards-mobile");
    await expectNoUnlabeledControls(page, "role-preview-cards-mobile");
    await expectNoClippedVisibleText(page, "role-preview-cards-mobile");
  });

  test("rol görünüm seçimi kurum menüsü ve portal kapsamı arasında geçiş yapar", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    await openRolePreview(page, { height: 1024, width: 768 }, unexpectedMutations);

    const roleViewPreview = page.getByLabel("Rol görünüm önizleme");
    await expect(roleViewPreview.getByRole("table", { name: "Rol görünüm kapsamı" })).toBeVisible();
    await expect(roleViewPreview.getByRole("columnheader", { name: "Kapsam" })).toBeVisible();
    await expect(roleViewPreview.getByRole("columnheader", { name: "Görünür öğe" })).toBeVisible();
    await expect(roleViewPreview.getByText("Ödemeler")).toBeVisible();
    await expect(roleViewPreview.getByText("Kullanıcılar")).toBeVisible();
    await roleViewPreview.getByLabel("Rol").selectOption("ASSISTANT_ADMIN");
    await expect(roleViewPreview.getByText("Öğrenciler")).toBeVisible();
    await expect(roleViewPreview.getByText("Ödemeler")).toHaveCount(0);
    await expect(roleViewPreview.getByText("Kullanıcılar")).toHaveCount(0);
    await roleViewPreview.getByLabel("Rol").selectOption("TEACHER");
    await expect(roleViewPreview).toContainText("Öğretmen Portalı");
    await expect(roleViewPreview).toContainText("/ogretmen");
    await expect(roleViewPreview).toContainText("Kurum sol menüsü görünmez");
    await roleViewPreview.getByLabel("Rol").selectOption("STUDENT");
    await expect(roleViewPreview).toContainText("Öğrenci Portalı");
    await expect(roleViewPreview).toContainText("/ogrenci");
    await roleViewPreview.getByLabel("Rol").selectOption("GUARDIAN");
    await expect(roleViewPreview).toContainText("Veli Portalı");
    await expect(roleViewPreview).toContainText("/veli");
    expect(unexpectedMutations).toEqual([]);

    await expectNoHorizontalOverflow(page, "role-preview-roles-tablet");
    await expectNoUnlabeledControls(page, "role-preview-roles-tablet");
    await expectNoClippedVisibleText(page, "role-preview-roles-tablet");
  });

  test("önizleme kayıtları token sızdırmadan doğru portal probe ile açılır", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    await openRolePreview(page, { height: 844, width: 390 }, unexpectedMutations);

    await startPreview(
      page,
      "öğretmen",
      "TEACHER",
      "teacher-preview-main",
      "Öğretmen kaydı doğrulandı",
      "Öğretmen portal verisi: Kapsam doğrulandı",
      "Öğretmen portalını önizle",
      "/ogretmen?rolePreview=1",
    );
    await expectNoVisibleTextValues(page, "role-preview-teacher-token", ["preview-token-teacher", "teacher-a", "teacher-preview-main"]);
    await expectPreviewTokensNotLeaked(page, "role-preview-teacher-token", ["preview-token-teacher"]);

    await startPreview(
      page,
      "öğrenci",
      "STUDENT",
      "student-preview-main",
      "Öğrenci kaydı doğrulandı",
      "Öğrenci portal verisi: Kendi profil kapsamı doğrulandı",
      "Öğrenci portalını önizle",
      "/ogrenci?rolePreview=1",
    );
    await expectNoVisibleTextValues(page, "role-preview-student-token", ["preview-token-student", "student-a", "student-preview-main"]);
    await expectPreviewTokensNotLeaked(page, "role-preview-student-token", ["preview-token-student"]);

    await startPreview(
      page,
      "veli",
      "GUARDIAN",
      "guardian-preview-main",
      "Veli kaydı doğrulandı",
      "Veli portal verisi: 1 bağlı öğrenci",
      "Veli portalını önizle",
      "/veli?rolePreview=1",
    );
    await expectNoVisibleTextValues(page, "role-preview-guardian-token", ["preview-token-guardian", "guardian-a", "guardian-preview-main"]);
    await expectPreviewTokensNotLeaked(page, "role-preview-guardian-token", ["preview-token-guardian"]);

    expect(unexpectedMutations).toEqual([]);
    await expectNoHorizontalOverflow(page, "role-preview-active-mobile");
    await expectNoUnlabeledControls(page, "role-preview-active-mobile");
    await expectNoClippedVisibleText(page, "role-preview-active-mobile");
  });

  test("direct route erişimi role-preview capability ile hizalıdır", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    await openRolePreview(page, { height: 844, width: 390 }, unexpectedMutations, { roles: ["TENANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum\/rol-onizleme$/);
    await expect(page.getByRole("region", { exact: true, name: "Rol önizleme operasyon özeti" })).toBeVisible();

    await openRolePreview(page, { height: 844, width: 390 }, unexpectedMutations, { roles: ["ASSISTANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("region", { exact: true, name: "Rol önizleme operasyon özeti" })).toHaveCount(0);
    await expect(page.getByLabel("Rol portal kartları")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Rol Önizleme" })).toHaveCount(0);
    await page.getByRole("button", { name: "Komut paleti" }).click();
    const commandPalette = page.getByRole("dialog", { name: "Komut paleti" });
    await commandPalette.getByLabel("Komut ara").fill("rol");
    await expect(commandPalette.getByRole("link", { name: /Rol Önizleme/ })).toHaveCount(0);
    await commandPalette.getByRole("button", { name: "Kapat" }).click();
    expect(unexpectedMutations.filter((mutation) => mutation.includes("/role-previews"))).toEqual([]);
  });

  test("portal önizleme route'u role-preview capability olmadan tokenla açılmaz", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    const requestedPaths: string[] = [];
    await page.setViewportSize({ height: 844, width: 390 });
    await installRolePreviewApiMocks(page, unexpectedMutations, { requestedPaths, roles: ["ASSISTANT_ADMIN"] });
    await page.addInitScript(() => {
      document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
      window.sessionStorage.setItem("o-okul.role-preview-token", "preview-token-student");
    });
    await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);

    await page.goto("/ogrenci?rolePreview=1");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByLabel("Rol önizleme modu")).toHaveCount(0);
    await expect(page.getByRole("region", { exact: true, name: "Öğrenci operasyon bağlamı" })).toHaveCount(0);
    expect(requestedPaths.filter((path) => path.startsWith("/me/student"))).toEqual([]);
    expect(unexpectedMutations.filter((mutation) => mutation.includes("/role-previews"))).toEqual([]);
  });
});

interface RolePreviewMockOptions {
  requestedPaths?: string[];
  roles?: string[];
}

async function openRolePreview(
  page: Page,
  viewport: { height: number; width: number },
  unexpectedMutations: string[],
  options: RolePreviewMockOptions = {},
) {
  await page.setViewportSize(viewport);
  await installRolePreviewApiMocks(page, unexpectedMutations, options);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/kurum/rol-onizleme");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function startPreview(
  page: Page,
  roleLabel: string,
  role: "TEACHER" | "STUDENT" | "GUARDIAN",
  subjectId: string,
  subjectPrivacyText: string,
  probeText: string,
  linkLabel: string,
  href: string,
) {
  const previewRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/role-previews",
  );
  await page.getByLabel("Rol portal kartları").getByRole("button", { name: `Auditli ${roleLabel} önizleme başlat` }).click();
  expect((await previewRequest).postDataJSON()).toEqual({ targetRole: role, targetSubjectId: subjectId });

  const activePreview = page.getByLabel("Aktif rol önizleme kaydı");
  await expect(activePreview).toContainText(`Hedef rol: ${role}`);
  await expect(activePreview).toContainText(`Kişi kaydı: ${subjectPrivacyText}`);
  await expect(activePreview).toContainText("Mod: READ_ONLY");
  await expect(activePreview).toContainText("Portal context doğrulandı");
  await expect(activePreview).toContainText("Context kişi kaydı: Maskeli subject ref");
  await expect(activePreview).toContainText(probeText);
  await expect(activePreview.getByLabel("Aktif önizleme güven durumu")).toContainText("Salt-okuma");
  await expect(activePreview.getByRole("link", { name: linkLabel })).toHaveAttribute("href", href);
}

async function installRolePreviewApiMocks(page: Page, unexpectedMutations: string[], options: RolePreviewMockOptions = {}) {
  await page.unroute("**/api/v1/**").catch(() => undefined);
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    const method = route.request().method();
    options.requestedPaths?.push(pathName);
    if (method !== "GET" && !(method === "POST" && (pathName === "/auth/refresh" || pathName === "/role-previews"))) {
      unexpectedMutations.push(`${method} ${pathName}`);
    }
    const response = mockRolePreviewApiResponse(pathName, route, options);
    await fulfillData(route, response.data);
  });
}

function mockRolePreviewApiResponse(pathName: string, route: Route, options: RolePreviewMockOptions = {}): { data: unknown } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse(options.roles) };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/teachers") {
    return {
      data: [{ branch: "Matematik", firstName: "Ayse", id: "teacher-preview-main", lastName: "Ogretmen", tenantId: "tenant-role-preview", userId: "teacher-user" }],
    };
  }
  if (pathName === "/students") {
    return {
      data: [{ firstName: "Ada", id: "student-preview-main", lastName: "Ogrenci", status: "ACTIVE", studentNo: "1001", tenantId: "tenant-role-preview", userId: "student-user" }],
    };
  }
  if (pathName === "/guardians") {
    return {
      data: [{ firstName: "Zeynep", id: "guardian-preview-main", lastName: "Veli", phone: "5554443322", tenantId: "tenant-role-preview", userId: "guardian-user" }],
    };
  }
  if (pathName === "/role-previews" && route.request().method() === "POST") {
    const body = route.request().postDataJSON() as { targetRole: "TEACHER" | "STUDENT" | "GUARDIAN"; targetSubjectId: string };
    return {
      data: {
        createdAt: "2026-06-18T09:00:00.000Z",
        expiresAt: "2026-06-18T09:15:00.000Z",
        id: `role-preview-${body.targetRole.toLowerCase()}`,
        mode: "READ_ONLY",
        previewToken: `preview-token-${body.targetRole.toLowerCase()}`,
        targetRole: body.targetRole,
        targetSubjectId: body.targetSubjectId,
        targetSubjectType: body.targetRole,
        tenantId: "tenant-role-preview",
      },
    };
  }
  if (pathName === "/me/profile" && route.request().headers()["x-role-preview-token"]) {
    const role = roleFromPreviewToken(route.request().headers()["x-role-preview-token"]);
    return {
      data: {
        roles: [role],
        subjectId: subjectIdForRole(role),
        subjectType: role,
        userId: "admin-role-preview",
      },
    };
  }
  if (pathName === "/me/teacher") {
    expect(route.request().headers()["x-role-preview-token"]).toBe("preview-token-teacher");
    return { data: { id: "teacher-a", tenantId: "tenant-role-preview" } };
  }
  if (pathName === "/me/student/profile") {
    expect(route.request().headers()["x-role-preview-token"]).toBe("preview-token-student");
    return { data: { id: "student-a", tenantId: "tenant-role-preview" } };
  }
  if (pathName === "/me/guardian/students") {
    expect(route.request().headers()["x-role-preview-token"]).toBe("preview-token-guardian");
    return { data: [{ id: "student-a", tenantId: "tenant-role-preview" }] };
  }

  return { data: [] };
}

function createAuthResponse(roles = ["TENANT_ADMIN"]) {
  return {
    accessToken: "role-preview-access-token",
    session: {
      id: "session-role-preview",
      membershipVersion: 1,
      roles,
      status: "ACTIVE",
      tenantId: "tenant-role-preview",
      userId: "admin-role-preview",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@role-preview-akademi.example",
    id: "tenant-role-preview",
    institutionType: "Dershane",
    name: "Rol Önizleme Akademi",
  };
}

function roleFromPreviewToken(token: string | undefined): "TEACHER" | "STUDENT" | "GUARDIAN" {
  if (token === "preview-token-student") return "STUDENT";
  if (token === "preview-token-guardian") return "GUARDIAN";
  return "TEACHER";
}

function subjectIdForRole(role: "TEACHER" | "STUDENT" | "GUARDIAN") {
  if (role === "STUDENT") return "student-a";
  if (role === "GUARDIAN") return "guardian-a";
  return "teacher-a";
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
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}

async function expectNoVisibleTextValues(page: Page, label: string, values: string[]) {
  const body = page.locator("body");
  for (const value of values) {
    await expect(body, `${label}: ${value} görünür metinde yer almamalı`).not.toContainText(value);
  }
}

async function expectPreviewTokensNotLeaked(page: Page, label: string, tokens: string[]) {
  const url = page.url();
  const title = await page.title();
  const anchorHrefs = await page.locator("a").evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
  );
  const storageDump = await page.evaluate(() =>
    JSON.stringify({
      localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index) ?? "";
        return [key, localStorage.getItem(key)];
      })),
      sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index) ?? "";
        return [key, sessionStorage.getItem(key)];
      })),
    }),
  );

  for (const token of tokens) {
    expect(url, `${label}: token URL'de olmamalı`).not.toContain(token);
    expect(title, `${label}: token document title'da olmamalı`).not.toContain(token);
    for (const href of anchorHrefs) {
      expect(href, `${label}: token anchor href içinde olmamalı`).not.toContain(token);
    }
    expect(storageDump, `${label}: token link tıklanmadan storage'a yazılmamalı`).not.toContain(token);
  }
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
      .filter((element) => isVisible(element))
      .filter((element) => {
        const htmlElement = element as HTMLElement;
        const text = htmlElement.textContent?.trim();
        const ariaLabel = htmlElement.getAttribute("aria-label")?.trim();
        const labelledBy = htmlElement.getAttribute("aria-labelledby")?.trim();
        const id = htmlElement.getAttribute("id");
        const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrappingLabel = htmlElement.closest("label");
        return !text && !ariaLabel && !labelledBy && !label && !wrappingLabel;
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

    return Array.from(document.querySelectorAll("label, button, .uh-status-badge, .next-operation-summary__item"))
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
