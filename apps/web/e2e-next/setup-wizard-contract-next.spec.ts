import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

const hostileUploadValues = [
  "ogrenci-ada-kaya-tckn-12345678901.csv",
  "ogretmen-zeynep-5551112233.xlsx",
  "ogrenci-ada-kaya-tckn-12345678901.pdf",
  "12345678901",
  "5551112233",
] as const;

test.describe("Kurulum sihirbazı UX sözleşmesi", () => {
  test("mobilde profesyonel metrik, validation ve upload gizliliğini korur", async ({ page }) => {
    await openSetupWizard(page, { height: 844, width: 390 }, { roles: ["TENANT_ADMIN"] });

    await expect(page.getByRole("heading", { level: 1, name: "Kurulum Sihirbazı" })).toBeVisible();
    const setupMetrics = page.getByRole("region", { name: "Kurulum operasyon metrikleri" });
    await expect(setupMetrics).toContainText("İlerleme");
    await expect(setupMetrics).toHaveClass(/uh-metric-grid/);
    await expect(setupMetrics.locator(".uh-metric-card")).toHaveCount(3);
    await expect(page.getByLabel("Adım ilerlemesi")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Adım ilerlemesi" }).locator(".uh-tab-button")).toHaveCount(5);
    await expect(page.getByLabel("Kurulum formu")).toBeVisible();
    await expect(page.getByLabel("Kurulum özeti")).toBeVisible();

    const setupForm = page.getByLabel("Kurulum formu");
    await setupForm.getByLabel("Kurum adı").fill("");
    await setupForm.getByRole("button", { name: "İleri" }).click();
    await expect(setupForm).toContainText("Kurum adı en az 2 karakter olmalıdır.");
    await expect(setupForm.getByRole("heading", { name: "Kurum Genel Bilgileri" })).toBeVisible();
    await setupForm.getByLabel("Kurum adı").fill("Kurulum Akademi");
    await setupForm.getByLabel("Logo adresi").fill("not-a-url");
    await setupForm.getByLabel("İletişim e-postası").fill("kurulum-akademi");
    await setupForm.getByRole("button", { name: "İleri" }).click();
    await expect(setupForm).toContainText("Logo adresi geçerli bir URL olmalıdır.");
    await expect(setupForm).toContainText("E-posta geçerli olmalıdır.");

    const stepNavigation = page.getByLabel("Adım ilerlemesi");
    await stepNavigation.getByRole("tab", { name: /Sınıf ve Şubeler/ }).click();
    const classCounts = setupForm.locator(".next-onboarding-class-counts");
    await expect(classCounts.locator(".uh-field")).toHaveCount(6);
    await expect(classCounts.locator(".uh-input")).toHaveCount(6);
    await expect(classCounts.getByLabel("8. sınıf / LGS")).toHaveValue("2");
    await classCounts.getByLabel("8. sınıf / LGS").fill("0");
    await classCounts.getByLabel("10. sınıf").fill("1");
    await stepNavigation.getByRole("tab", { name: /Derslerin Oluşturulması/ }).click();
    await expect(setupForm.getByLabel("Otomatik seçilen dersler")).toContainText("Matematik");
    await expect(setupForm.getByRole("button", { name: /10-MAT/ })).toHaveAttribute("aria-pressed", "true");
    await expect(setupForm.getByRole("button", { name: /LGS-MAT/ })).toHaveAttribute("aria-pressed", "false");

    await stepNavigation.getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await expect(setupForm.getByRole("group", { name: "Öğretmen veri girişi" })).toHaveClass(/uh-segmented-control/);
    await expect(setupForm.getByRole("group", { name: "Öğrenci veri girişi" })).toHaveClass(/uh-segmented-control/);
    await expect(setupForm.getByRole("link", { name: "Öğretmen XLSX şablonu" })).toHaveAttribute("href", "/templates/ogretmen-aktarim-sablonu.xlsx");
    await expect(setupForm.getByRole("link", { name: "Öğrenci XLSX şablonu" })).toHaveAttribute("href", "/templates/ogrenci-aktarim-sablonu.xlsx");
    await setupForm.getByLabel("Öğrenci aktarım dosyası").setInputFiles({
      buffer: Buffer.from("%PDF-1.7"),
      mimeType: "application/pdf",
      name: "ogrenci-ada-kaya-tckn-12345678901.pdf",
    });
    const studentUploadStatus = page.getByLabel("Öğrenci aktarım güven durumu");
    await expect(studentUploadStatus).toContainText("Dosya kabul edilmedi");
    await expect(studentUploadStatus).toContainText("CSV veya XLSX dosyası seçin.");
    await expect(setupForm).not.toContainText("PDF dosyası seçildi");
    await expectNoVisibleTextValues(page, "setup-upload-invalid", hostileUploadValues);
    await expectDraftStorageDoesNotContain(page, "setup-upload-invalid-storage", hostileUploadValues);

    await setupForm.getByLabel("Öğrenci aktarım dosyası").setInputFiles({
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1, "a"),
      mimeType: "text/csv",
      name: "ogrenci-ada-kaya-tckn-12345678901.csv",
    });
    await expect(studentUploadStatus).toContainText("Dosya kabul edilmedi");
    await expect(studentUploadStatus).toContainText("Dosya en fazla 5 MB olabilir.");
    await expectDraftStorageDoesNotContain(page, "setup-upload-oversize-storage", hostileUploadValues);

    await setupForm.getByLabel("Öğretmen aktarım dosyası").setInputFiles({
      buffer: Buffer.from("teacher"),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      name: "ogretmen-zeynep-5551112233.xlsx",
    });
    await setupForm.getByLabel("Öğrenci aktarım dosyası").setInputFiles({
      buffer: Buffer.from("student"),
      mimeType: "text/csv",
      name: "ogrenci-ada-kaya-tckn-12345678901.csv",
    });
    await expect(page.getByLabel("Öğretmen aktarım güven durumu")).toContainText("Sunucu dry-run bekliyor");
    await expect(setupForm).toContainText("XLSX dosyası seçildi");
    await expect(setupForm).toContainText("CSV dosyası seçildi");
    await expect(studentUploadStatus).toContainText("Yerel kontrol tamam");
    await expect(studentUploadStatus).toContainText("Sunucu dry-run bekliyor");
    await expectNoVisibleTextValues(page, "setup-upload-filenames", hostileUploadValues);
    await expectDraftStorageDoesNotContain(page, "setup-upload-storage", hostileUploadValues);
    const storedDraft = await page.evaluate(() =>
      JSON.parse(window.sessionStorage.getItem("uh_onboarding_tenant-setup_draft") ?? "{}"),
    );
    expect(storedDraft.general.contactEmail).toBe("");
    expect(storedDraft.people.importOwner).toBe("");
    expect(storedDraft.people.teacherImportFileName).toBe("");
    expect(storedDraft.people.studentImportFileName).toBe("");

    await expectNoHorizontalOverflow(page, "setup-wizard-mobile");
    await expectNoUnlabeledControls(page, "setup-wizard-mobile");
    await expectNoClippedVisibleText(page, "setup-wizard-mobile");
  });

  test("tablette taşma üretmez ve assistant rolünde mutasyon yüzeyini açmaz", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    await openSetupWizard(page, { height: 1024, width: 768 }, { roles: ["TENANT_ADMIN"], unexpectedMutations });
    await expect(page.getByLabel("Kurulum operasyon metrikleri")).toContainText("Sınıf");
    await expectNoHorizontalOverflow(page, "setup-wizard-tablet");
    await expectNoUnlabeledControls(page, "setup-wizard-tablet");
    await expectNoClippedVisibleText(page, "setup-wizard-tablet");

    await openSetupWizard(page, { height: 844, width: 390 }, { roles: ["ASSISTANT_ADMIN"], unexpectedMutations });
    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("heading", { level: 1, name: "Kurulum Sihirbazı" })).toHaveCount(0);
    await expect(page.getByLabel("Kurulum formu")).toHaveCount(0);
    await expect(page.getByLabel("Öğretmen aktarım dosyası")).toHaveCount(0);
    await expect(page.getByLabel("Öğrenci aktarım dosyası")).toHaveCount(0);
    await page.getByRole("button", { name: "Komut paleti" }).click();
    const commandDialog = page.getByRole("dialog", { name: "Komut paleti" });
    await commandDialog.getByLabel("Komut ara").fill("kurulum");
    await expect(commandDialog.getByRole("link", { name: /Yeni dönem açılışı|Kurulum/ })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => Object.keys(window.sessionStorage).filter((key) => key.startsWith("uh_onboarding_"))))
      .toEqual([]);
    expect(unexpectedMutations).toEqual([]);
  });

  test("dry-run hatasını import değerini açmadan gösterir", async ({ page }) => {
    await openSetupWizard(page, { height: 844, width: 390 }, { roles: ["TENANT_ADMIN"], studentDryRun: "duplicate" });

    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByLabel("Öğrenci aktarım dosyası").setInputFiles({
      buffer: Buffer.from("\uFEFFokul_no;ad;soyad;sinif\n12345678901;Ada;Kaya;8-A\n", "utf8"),
      mimeType: "text/csv",
      name: "ogrenci-ada-kaya-tckn-12345678901.csv",
    });
    await setupForm.getByLabel("Veri sorumlusu").fill("Operasyon sorumlusu");
    await setupForm.getByRole("button", { name: "Kaydet ve bitir" }).click();

    await expect(setupForm).toContainText("Öğrenci dosyasında tekrar eden veya sistemde zaten kayıtlı okul no var. Satır: 2.");
    await expectNoVisibleTextValues(page, "setup-dry-run-error", hostileUploadValues);
    await expectDraftStorageDoesNotContain(page, "setup-dry-run-error-storage", hostileUploadValues);
  });

  test("öğretmen Excel dosyasını zorunlu tutar ve import sonucunu özetler", async ({ page }) => {
    await openSetupWizard(page, { height: 844, width: 390 }, { roles: ["TENANT_ADMIN"] });

    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğretmen veri girişi" }).getByRole("button", { name: "Excel aktarımı" }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByLabel("Veri sorumlusu").fill("Operasyon sorumlusu");
    await setupForm.getByRole("button", { name: "Kaydet ve bitir" }).click();
    await expect(setupForm).toContainText("Öğretmen aktarım dosyası zorunludur.");

    await setupForm.getByLabel("Öğretmen aktarım dosyası").setInputFiles({
      buffer: Buffer.from("\uFEFFad;soyad;brans;atanacak_sinif;ders\nAyse;Yilmaz;Matematik;8-A;Matematik\n", "utf8"),
      mimeType: "text/csv",
      name: "ogretmen-zeynep-5551112233.csv",
    });
    await setupForm.getByRole("button", { name: "Kaydet ve bitir" }).click();

    await expect(setupForm).toContainText("2 sınıf, 3 ders, 1 öğretmen, 1 öğretmen ataması");
    await expectNoVisibleTextValues(page, "setup-teacher-import-summary", hostileUploadValues);
    await expectDraftStorageDoesNotContain(page, "setup-teacher-import-storage", hostileUploadValues);
  });
});

async function openSetupWizard(
  page: Page,
  viewport: { height: number; width: number },
  options: { roles?: string[]; studentDryRun?: "duplicate"; unexpectedMutations?: string[] } = {},
) {
  await page.setViewportSize(viewport);
  await installSetupApiMocks(page, options);
  await page.addInitScript(() => {
    window.sessionStorage.clear();
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/kurum/kurulum");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installSetupApiMocks(
  page: Page,
  options: { roles?: string[]; studentDryRun?: "duplicate"; unexpectedMutations?: string[] } = {},
) {
  await page.unroute("**/api/v1/**").catch(() => undefined);
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    if (request.method() !== "GET" && pathName !== "/auth/refresh") {
      options.unexpectedMutations?.push(`${request.method()} ${pathName}`);
    }
    const response = mockSetupApiResponse(pathName, request.method(), options);
    await fulfillData(route, response);
  });
}

function mockSetupApiResponse(
  pathName: string,
  method: string,
  options: { roles?: string[]; studentDryRun?: "duplicate" } = {},
) {
  if (pathName === "/auth/refresh") return createAuthResponse(options.roles ?? ["TENANT_ADMIN"]);
  if (pathName === "/me/tenant") return createTenantResponse();
  if (pathName === "/me/notification-devices") return [];
  if (method === "GET" && pathName === "/grade-levels") {
    return [
      { code: "8-LGS", id: "grade-setup-lgs", name: "8. sınıf / LGS", tenantId: "tenant-setup" },
      { code: "10", id: "grade-setup-10", name: "10. sınıf", tenantId: "tenant-setup" },
    ];
  }
  if (method === "GET" && pathName === "/grade-levels/grade-setup-lgs/courses") {
    return [
      {
        courseCode: "LGS-TUR",
        courseId: "course-setup-turkce",
        courseName: "Türkçe",
        gradeLevelId: "grade-setup-lgs",
        id: "template-lgs-turkce",
        isDefault: true,
        sortOrder: 10,
        tenantId: "tenant-setup",
      },
      {
        courseCode: "LGS-MAT",
        courseId: "course-setup-matematik",
        courseName: "Matematik",
        gradeLevelId: "grade-setup-lgs",
        id: "template-lgs-matematik",
        isDefault: true,
        sortOrder: 20,
        tenantId: "tenant-setup",
      },
      {
        courseCode: "LGS-FEN",
        courseId: "course-setup-fen",
        courseName: "Fen Bilgisi",
        gradeLevelId: "grade-setup-lgs",
        id: "template-lgs-fen",
        isDefault: true,
        sortOrder: 30,
        tenantId: "tenant-setup",
      },
    ];
  }
  if (method === "GET" && pathName === "/grade-levels/grade-setup-10/courses") {
    return [
      {
        courseCode: "10-MAT",
        courseId: "course-setup-10-matematik",
        courseName: "Matematik",
        gradeLevelId: "grade-setup-10",
        id: "template-10-matematik",
        isDefault: true,
        sortOrder: 10,
        tenantId: "tenant-setup",
      },
    ];
  }
  if (method === "POST" && pathName === "/academic-years") return { id: "academic-year-setup", name: "2026-2027" };
  if (method === "POST" && pathName === "/academic-terms") return { id: "academic-term-setup", name: "1. Dönem" };
  if (method === "POST" && pathName === "/courses") return { id: "course-setup", code: "LGS-TUR", name: "Türkçe" };
  if (method === "POST" && pathName === "/classes") return { id: "class-setup", name: "8-A", section: "A" };
  if (method === "POST" && pathName === "/teachers/imports/dry-run") {
    return {
      dryRun: true,
      errors: [],
      totalRows: 1,
      validRows: [{ classId: "class-setup", className: "8-A", firstName: "Ayse", lastName: "Yilmaz", row: 2 }],
      wouldImport: true,
    };
  }
  if (method === "POST" && pathName === "/teachers/imports") {
    return { assignments: [], createdAssignments: 1, createdTeachers: 1, importedRows: 1, teachers: [] };
  }
  if (method === "POST" && pathName === "/students/imports/dry-run") {
    if (options.studentDryRun === "duplicate") {
      return {
        dryRun: true,
        errors: [{ code: "STUDENT_NO_DUPLICATE", field: "studentNo", row: 2, value: "12345678901" }],
        quota: { current: 4, incoming: 1, limit: 100, wouldExceed: false },
        totalRows: 1,
        validRows: [],
        wouldImport: false,
      };
    }
    return {
      dryRun: true,
      errors: [],
      quota: { current: 4, incoming: 1, limit: 100, wouldExceed: false },
      totalRows: 1,
      validRows: [{ firstName: "Ada", lastName: "Kaya", row: 2, studentNo: "100" }],
      wouldImport: true,
    };
  }
  if (method === "POST" && pathName === "/students/imports") return { importedRows: 1, students: [] };
  return [];
}

function createAuthResponse(roles: string[]) {
  return {
    accessToken: "setup-access-token",
    session: {
      id: "session-setup",
      membershipVersion: 1,
      roles,
      status: "ACTIVE",
      tenantId: "tenant-setup",
      userId: "user-setup-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@kurulum-akademi.example",
    id: "tenant-setup",
    institutionType: "course-center",
    name: "Kurulum Akademi",
  };
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

async function expectNoVisibleTextValues(page: Page, label: string, values: readonly string[]) {
  const body = page.locator("body");
  for (const value of values) {
    await expect(body, `${label}: ${value} görünür metinde yer almamalı`).not.toContainText(value);
  }
}

async function expectDraftStorageDoesNotContain(page: Page, label: string, values: readonly string[]) {
  const draft = await page.evaluate(() => window.sessionStorage.getItem("uh_onboarding_tenant-setup_draft") ?? "");
  for (const value of values) {
    expect(draft, `${label}: ${value} saklı taslakta yer almamalı`).not.toContain(value);
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

    return Array.from(document.querySelectorAll("label, button, .uh-metric-card, .uh-tab-button, .uh-segmented-control"))
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
