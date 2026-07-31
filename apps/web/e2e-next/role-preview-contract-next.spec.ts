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
    const operationSummary = page.getByRole("region", { exact: true, name: "Önizleme güvenlik özeti" });
    await expect(operationSummary).toContainText("Güvenlik");
    await expect(operationSummary).toContainText("Gizli");
    await expect(operationSummary.getByLabel("Önizleme güvenlik özeti aksiyon kuyruğu")).toBeVisible();

    const portalCards = page.getByLabel("Rol portal kartları");
    await expect(portalCards.getByRole("heading", { name: "Öğretmen Portalı" })).toBeVisible();
    await expect(portalCards.getByRole("heading", { name: "Öğrenci Portalı" })).toBeVisible();
    await expect(portalCards.getByRole("heading", { name: "Veli Portalı" })).toBeVisible();
    await expect(portalCards).toContainText("Öğretmen hesabı");
    await expect(portalCards).toContainText("Öğrenci hesabı");
    await expect(portalCards).toContainText("Veli hesabı");
    await expect(portalCards).toContainText("/ogretmen");
    await expect(portalCards).toContainText("/ogrenci");
    await expect(portalCards).toContainText("/veli");
    await expect(portalCards.getByText("Kişisel giriş bilgileri önizlemede gösterilmez.")).toHaveCount(3);
    await expect(portalCards.getByLabel("Önizleme kişisi")).toHaveCount(3);
    await expect(portalCards).toContainText("Öğretmen kaydı 1");
    await expect(portalCards).toContainText("Öğrenci kaydı 1");
    await expect(portalCards).toContainText("Veli kaydı 1");
    await expect(portalCards).toContainText("Kimliği gizlenmiş öğretmen kaydı");
    await expect(portalCards).toContainText("Kimliği gizlenmiş öğrenci kaydı");
    await expect(portalCards).toContainText("Kimliği gizlenmiş veli kaydı");
    await expect(portalCards.getByRole("table", { name: "Öğretmen Portalı görülebilen bilgiler" })).toContainText("Yalnızca öğretmene atanmış öğrenci ve ders bilgileri");
    await expect(portalCards.getByRole("table", { name: "Öğrenci Portalı görülebilen bilgiler" })).toContainText("Yalnızca öğrencinin kendi bilgileri");
    await expect(portalCards.getByRole("table", { name: "Veli Portalı görülebilen bilgiler" })).toContainText("Yalnızca veliye bağlı öğrencilerin bilgileri");
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
    const roleSelect = roleViewPreview.getByRole("combobox");
    await expect(roleViewPreview.getByRole("table", { name: "Rolün görebileceği alanlar" })).toBeVisible();
    await expect(roleViewPreview.getByRole("columnheader", { name: "Menü grubu" })).toBeVisible();
    await expect(roleViewPreview.getByRole("columnheader", { name: "Görünür öğe" })).toBeVisible();
    await expect(roleViewPreview.getByText("Ödemeler")).toBeVisible();
    await expect(roleViewPreview.getByText("Kullanıcılar")).toBeVisible();
    await roleSelect.selectOption("ASSISTANT_ADMIN");
    await expect(roleViewPreview.getByText("Öğrenciler")).toBeVisible();
    await expect(roleViewPreview.getByText("Ödemeler")).toHaveCount(0);
    await expect(roleViewPreview.getByText("Kullanıcılar")).toHaveCount(0);
    await roleSelect.selectOption("TEACHER");
    await expect(roleViewPreview).toContainText("Öğretmen Portalı");
    await expect(roleViewPreview).toContainText("/ogretmen");
    await expect(roleViewPreview).toContainText("Kurum sol menüsü görünmez");
    await roleSelect.selectOption("STUDENT");
    await expect(roleViewPreview).toContainText("Öğrenci Portalı");
    await expect(roleViewPreview).toContainText("/ogrenci");
    await roleSelect.selectOption("GUARDIAN");
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
      "Öğretmen",
      "TEACHER",
      "teacher-preview-main",
      "Öğretmen kaydı doğrulandı",
      "Öğretmen ekranı: Erişim doğrulandı",
      "Öğretmen ekranına geç",
      "/ogretmen?rolePreview=1",
    );
    await expectNoVisibleTextValues(page, "role-preview-teacher-token", ["preview-token-teacher", "teacher-a", "teacher-preview-main"]);
    await expectPreviewTokensNotLeaked(page, "role-preview-teacher-token", ["preview-token-teacher"]);

    await startPreview(
      page,
      "Öğrenci",
      "STUDENT",
      "student-preview-main",
      "Öğrenci kaydı doğrulandı",
      "Öğrenci ekranı: Kendi bilgilerine erişim doğrulandı",
      "Öğrenci ekranına geç",
      "/ogrenci?rolePreview=1",
    );
    await expectNoVisibleTextValues(page, "role-preview-student-token", ["preview-token-student", "student-a", "student-preview-main"]);
    await expectPreviewTokensNotLeaked(page, "role-preview-student-token", ["preview-token-student"]);

    await startPreview(
      page,
      "Veli",
      "GUARDIAN",
      "guardian-preview-main",
      "Veli kaydı doğrulandı",
      "Veli ekranı: 1 bağlı öğrenci",
      "Veli ekranına geç",
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
    await expect(page.getByRole("region", { exact: true, name: "Önizleme güvenlik özeti" })).toBeVisible();

    await openRolePreview(page, { height: 844, width: 390 }, unexpectedMutations, { roles: ["ASSISTANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("region", { exact: true, name: "Önizleme güvenlik özeti" })).toHaveCount(0);
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
    await expect(page.getByLabel("Rol önizleme bilgisi")).toHaveCount(0);
    await expect(page.getByRole("region", { exact: true, name: "Seçili öğrenci özeti" })).toHaveCount(0);
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
  await page.getByLabel("Rol portal kartları").getByRole("button", { name: `${roleLabel} ekranını önizle` }).click();
  expect((await previewRequest).postDataJSON()).toEqual({ targetRole: role, targetSubjectId: subjectId });

  const activePreview = page.getByLabel("Aktif rol önizleme kaydı");
  await expect(activePreview).toContainText(`Seçili rol: ${role}`);
  await expect(activePreview).toContainText(`Kişi kaydı: ${subjectPrivacyText}`);
  await expect(activePreview).toContainText("Erişim: Yalnızca görüntüleme");
  await expect(activePreview).toContainText("Kişi erişimi doğrulandı");
  await expect(activePreview).toContainText("Kişi kaydı: Kimliği gizlenmiş kayıt");
  await expect(activePreview).toContainText(probeText);
  await expect(activePreview.getByLabel("Aktif önizleme güven durumu")).toContainText("Yalnızca görüntüleme");
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
  if (pathName === "/me/institution-dashboard") return { data: createInstitutionDashboardResponse() };
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

function createInstitutionDashboardResponse() {
  return {
    activeStudentCount: 0,
    attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
    generatedAt: "2026-06-18T09:00:00.000Z",
    institution: { name: "Rol Önizleme Akademi" },
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
