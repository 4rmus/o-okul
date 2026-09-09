import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
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
  test("sunucu readiness sonucunu eski çerezden üstün tutar ve beş form adımı gösterir", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      readiness: "incomplete",
      legacyReadiness: true,
      requestedPaths,
      roles: ["TENANT_ADMIN"],
      spoofCompletedCookie: true,
    });

    await expect(page.getByLabel("Sunucu kurulum durumu")).toContainText("Aktif dönem");
    await expect(page.getByLabel("Sunucu kurulum durumu")).toContainText("Eksik");
    await expect(page.getByText("İlk giriş akışı")).toBeVisible();
    expect(requestedPaths).toContain("GET /setup/readiness");
    await expect(page.getByRole("tablist", { name: "Adım ilerlemesi" }).locator(".uh-tab-button")).toHaveCount(5);
  });

  test("öğretmen ve öğrenci eksikken çekirdek kurulumu hazır, kişileri sonraki adım gösterir", async ({ page }) => {
    await openSetupWizard(page, { height: 844, width: 390 }, {
      readiness: "optional-missing",
      roles: ["TENANT_ADMIN"],
    });
    await page.goto(`${appOrigin}/kurum/kurulum/hazirlik`);

    const readiness = page.getByLabel("Hazırlık kontrolü");
    await expect(readiness).toContainText("Çekirdek kurulum tamamlandı.");
    await expect(readiness.getByRole("listitem").filter({ hasText: "Öğretmen" })).toContainText("Sonraki adım");
    await expect(readiness.getByRole("listitem").filter({ hasText: "Öğrenci" })).toContainText("Sonraki adım");
  });

  test("her kurulum adımı deep-link ve ileri geri navigasyonunu korur", async ({ page }) => {
    await openSetupWizard(page, { height: 844, width: 390 }, {
      readiness: "incomplete",
      roles: ["TENANT_ADMIN"],
    });

    const tabs = page.getByRole("tablist", { name: "Adım ilerlemesi" });
    await tabs.getByRole("tab", { name: /Akademik Dönem Ayarları/ }).click();
    await expect(page).toHaveURL(/\/kurum\/kurulum\/donem$/);
    await expect(page.getByRole("heading", { name: "Akademik Dönem Ayarları" })).toBeVisible();

    await page.getByRole("button", { name: "Geri" }).click();
    await expect(page).toHaveURL(/\/kurum\/kurulum\/genel$/);
    await page.goto(`${appOrigin}/kurum/kurulum/hazirlik`, { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Hazırlık kontrolü")).toContainText("Aktif dönem");
    await expect(page.getByLabel("Hazırlık kontrolü")).toContainText("Eksik");
  });

  test("mobilde profesyonel metrik, validation ve upload gizliliğini korur", async ({ page }) => {
    await openSetupWizard(page, { height: 844, width: 390 }, { roles: ["TENANT_ADMIN"] });

    await expect(page.getByRole("heading", { level: 1, name: "Kurulum Sihirbazı" })).toBeVisible();
    const setupMetrics = page.getByRole("region", { name: "Kurulum operasyon metrikleri" });
    await expect(setupMetrics).toContainText("Form ilerlemesi");
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
    const classCounts = setupForm.getByRole("group", { name: "Kademeye göre sınıf sayısı" });
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
    await expect(setupForm.getByRole("group", { name: "Veli veri girişi" })).toHaveCount(0);
    await expect(setupForm.getByRole("link", { name: "Öğretmen XLSX şablonu" })).toHaveAttribute("href", "/templates/ogretmen-aktarim-sablonu.xlsx");
    await expect(setupForm.getByRole("link", { name: "Öğrenci XLSX şablonu" })).toHaveAttribute("href", "/templates/ogrenci-aktarim-sablonu.xlsx");
    await expect(setupForm.getByRole("link", { name: "Kazanım XLSX şablonu" })).toHaveAttribute("href", "/templates/kazanim-aktarim-sablonu.xlsx");
    await expect(setupForm.getByRole("link", { name: "Veli XLSX şablonu" })).toHaveCount(0);
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

    await expect(setupForm.getByLabel("Öğretmen aktarım dosyası")).toHaveCount(0);
    await setupForm.getByRole("group", { name: "Öğretmen veri girişi" }).getByRole("button", { name: "Excel aktarımı" }).click();
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
    await expect(page.getByLabel("Öğretmen aktarım güven durumu")).toContainText("Sunucu ön kontrolü bekleniyor");
    await expect(setupForm).toContainText("XLSX dosyası seçildi");
    await expect(setupForm).toContainText("CSV dosyası seçildi");
    await expect(studentUploadStatus).toContainText("Yerel kontrol tamam");
    await expect(studentUploadStatus).toContainText("Sunucu ön kontrolü bekleniyor");
    await expectNoVisibleTextValues(page, "setup-upload-filenames", hostileUploadValues);
    await expectDraftStorageDoesNotContain(page, "setup-upload-storage", hostileUploadValues);
    const storedDraft = await page.evaluate(() =>
      JSON.parse(window.sessionStorage.getItem("uh_onboarding_tenant-setup_draft") ?? "{}"),
    );
    expect(storedDraft.general.contactEmail).toBe("");
    expect(storedDraft.people.kazanimImportFileName).toBe("");
    expect(storedDraft.people.teacherImportFileName).toBe("");
    expect(storedDraft.people.studentImportFileName).toBe("");

    await expectNoHorizontalOverflow(page, "setup-wizard-mobile");
    await expectNoUnlabeledControls(page, "setup-wizard-mobile");
    await expectNoClippedVisibleText(page, "setup-wizard-mobile");
  });

  test("önerilen sınıf adını düzenler, taslakta korur ve adı kırpılmış biçimiyle ayrı seviye/şube alanlarıyla gönderir", async ({ page }) => {
    const classCreateBodies: Array<Record<string, unknown>> = [];
    const gradeLevelCourseLinks: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      classCreateBodies,
      gradeLevelCourseLinks,
      roles: ["TENANT_ADMIN"],
    });

    const setupForm = page.getByLabel("Kurulum formu");
    const stepNavigation = page.getByLabel("Adım ilerlemesi");
    await stepNavigation.getByRole("tab", { name: /Sınıf ve Şubeler/ }).click();
    const classAName = setupForm.getByLabel(/8\. sınıf \/ LGS · A şubesi · Sınıf adı/);
    const classBName = setupForm.getByLabel(/8\. sınıf \/ LGS · B şubesi · Sınıf adı/);
    await expect(classAName).toHaveValue("8-A");
    await expect(classBName).toHaveValue("8-B");

    await classAName.fill("  Bilim Atölyesi  ");
    await classBName.fill("bİLİMAtölyesi");
    await setupForm.getByRole("button", { name: "İleri" }).click();
    await expect(setupForm.getByText("Aktif sınıf adları boşluk ve harf farkı olmadan tekil olmalıdır.").first()).toBeVisible();

    await classBName.fill("8-B");
    await stepNavigation.getByRole("tab", { name: /Derslerin Oluşturulması/ }).click();
    await stepNavigation.getByRole("tab", { name: /Sınıf ve Şubeler/ }).click();
    await expect(classAName).toHaveValue("Bilim Atölyesi");

    await page.reload();
    await expect(setupForm.getByLabel(/8\. sınıf \/ LGS · A şubesi · Sınıf adı/)).toHaveValue("Bilim Atölyesi");
    const storedDraft = await page.evaluate(() =>
      JSON.parse(window.sessionStorage.getItem("uh_onboarding_tenant-setup_draft") ?? "{}"),
    );
    expect(storedDraft.classes.classNames["8-LGS:A"]).toBe("Bilim Atölyesi");

    await stepNavigation.getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(setupForm).toContainText("2 sınıf, 6 ders");
    await expect(page).toHaveURL(/\/kurum\/kurulum\/hazirlik$/);
    await expect(setupForm.getByRole("heading", { name: "Hazırlık Kontrolü" })).toBeVisible();
    await expect(page.getByLabel("Adım ilerlemesi")).toHaveCount(0);
    await expect(setupForm.getByRole("button", { name: "Kaydet ve kontrol et" })).toHaveCount(0);
    await expect(setupForm).toContainText("Çekirdek kurulum tamamlandı.");
    await setupForm.getByText("Kişi Yönetim Altyapısı kontrolleri").click();
    await expect(setupForm.getByText("Öğretmen (isteğe bağlı)")).toBeVisible();

    expect(classCreateBodies).toEqual(expect.arrayContaining([
      {
        campusId: "campus-setup",
        gradeLevelId: "grade-setup-lgs",
        name: "Bilim Atölyesi",
        section: "A",
      },
      {
        campusId: "campus-setup",
        gradeLevelId: "grade-setup-lgs",
        name: "8-B",
        section: "B",
      },
    ]));
    expect(gradeLevelCourseLinks).toEqual([
      "grade-setup-lgs/course-LGS-TUR",
      "grade-setup-lgs/course-LGS-MAT",
      "grade-setup-lgs/course-LGS-FEN",
      "grade-setup-lgs/course-LGS-INK",
      "grade-setup-lgs/course-LGS-ING",
      "grade-setup-lgs/course-LGS-DIN",
    ]);
  });

  test("tek kampüsü otomatik seçer, çok kampüste seçim ister ve kampüs yoksa kaydı durdurur", async ({ page }) => {
    const setupForm = page.getByLabel("Kurulum formu");
    await openSetupWizard(page, { height: 844, width: 390 }, {
      campuses: [
        { id: "campus-a", tenantId: "tenant-setup", name: "A Kampüsü" },
        { id: "campus-b", tenantId: "tenant-setup", name: "B Kampüsü" },
      ],
      roles: ["TENANT_ADMIN"],
    });
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Sınıf ve Şubeler/ }).click();
    await expect(setupForm.getByLabel("Sınıfların kampüsü")).toHaveValue("");
    await setupForm.getByRole("button", { name: "İleri" }).click();
    await expect(setupForm).toContainText("Sınıfların kampüsü seçilmelidir.");
    await setupForm.getByLabel("Sınıfların kampüsü").selectOption("campus-b");
    await setupForm.getByRole("button", { name: "İleri" }).click();
    await expect(page).toHaveURL(/\/kurum\/kurulum\/dersler$/);

    await openSetupWizard(page, { height: 844, width: 390 }, { campuses: [], roles: ["TENANT_ADMIN"] });
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Sınıf ve Şubeler/ }).click();
    await expect(setupForm.getByRole("link", { name: "Önce kampüs oluştur" })).toHaveAttribute("href", "/kurum/kampusler?new=1");
    await setupForm.getByRole("button", { name: "İleri" }).click();
    await expect(setupForm).toContainText("Sınıfları oluşturmadan önce bir kampüs eklenmelidir.");
  });

  test("seçili kampüs kayıt öncesinde silinmişse hiçbir mutation başlatmaz", async ({ page }) => {
    const campuses = [{ id: "campus-setup", tenantId: "tenant-setup", name: "Merkez Kampüs" }];
    const unexpectedMutations: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      campuses,
      roles: ["TENANT_ADMIN"],
      unexpectedMutations,
    });
    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    campuses.length = 0;
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();

    await expect(setupForm).toContainText("Seçili kampüs artık kullanılamıyor.");
    expect(unexpectedMutations).toEqual([]);
  });

  test("kısmi sunucu şablonunda eksik seviye ailesini fallback derslerle tamamlar", async ({ page }) => {
    const classCreateBodies: Array<Record<string, unknown>> = [];
    const gradeLevelCreateBodies: Array<Record<string, unknown>> = [];
    const gradeLevelCourseLinks: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      classCreateBodies,
      gradeLevelCreateBodies,
      gradeLevelCourseLinks,
      roles: ["TENANT_ADMIN"],
    });
    const setupForm = page.getByLabel("Kurulum formu");
    const steps = page.getByLabel("Adım ilerlemesi");
    await steps.getByRole("tab", { name: /Sınıf ve Şubeler/ }).click();
    const classCounts = setupForm.getByRole("group", { name: "Kademeye göre sınıf sayısı" });
    await classCounts.getByLabel("8. sınıf / LGS").fill("0");
    await classCounts.getByLabel("7. sınıf").fill("1");
    await steps.getByRole("tab", { name: /Derslerin Oluşturulması/ }).click();
    await expect(setupForm.getByRole("button", { name: /7-MAT/ })).toHaveAttribute("aria-pressed", "true");
    await steps.getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(page).toHaveURL(/\/kurum\/kurulum\/hazirlik$/);

    expect(gradeLevelCreateBodies).toContainEqual({ code: "7", name: "7. sınıf" });
    expect(classCreateBodies).toContainEqual({
      campusId: "campus-setup",
      gradeLevelId: "grade-7",
      name: "7-A",
      section: "A",
    });
    expect(gradeLevelCourseLinks).toContain("grade-7/course-7-MAT");
  });

  test("aynı seviyedeki kısmi sunucu şablonunu eksik fallback derslerle tamamlar", async ({ page }) => {
    const gradeLevelCourseLinks: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      gradeLevelCourseLinks,
      partialLgsTemplates: true,
      roles: ["TENANT_ADMIN"],
    });
    const setupForm = page.getByLabel("Kurulum formu");
    const steps = page.getByLabel("Adım ilerlemesi");
    await steps.getByRole("tab", { name: /Derslerin Oluşturulması/ }).click();
    await expect(setupForm.getByRole("button", { name: /LGS-MAT/ })).toHaveAttribute("aria-pressed", "true");
    await steps.getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(setupForm).toContainText("2 sınıf, 6 ders");

    expect(gradeLevelCourseLinks).toHaveLength(6);
    expect(gradeLevelCourseLinks).toContain("grade-setup-lgs/course-LGS-MAT");
  });

  test("fresh 11 ve 12 sınıflarını kendi seviyelerine ve ortak üst seviye derslerine bağlar", async ({ page }) => {
    const classCreateBodies: Array<Record<string, unknown>> = [];
    const gradeLevelCreateBodies: Array<Record<string, unknown>> = [];
    const gradeLevelCourseLinks: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      classCreateBodies,
      emptyCourseTemplates: true,
      gradeLevelCreateBodies,
      gradeLevelCourseLinks,
      roles: ["TENANT_ADMIN"],
    });
    const setupForm = page.getByLabel("Kurulum formu");
    const steps = page.getByLabel("Adım ilerlemesi");
    await steps.getByRole("tab", { name: /Sınıf ve Şubeler/ }).click();
    const classCounts = setupForm.getByRole("group", { name: "Kademeye göre sınıf sayısı" });
    await classCounts.getByLabel("8. sınıf / LGS").fill("0");
    await classCounts.getByLabel("11. sınıf").fill("1");
    await classCounts.getByLabel("12. sınıf").fill("1");
    await steps.getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(page).toHaveURL(/\/kurum\/kurulum\/hazirlik$/);

    expect(gradeLevelCreateBodies.map((body) => body.code)).toEqual(["11", "12"]);
    expect(classCreateBodies).toEqual(expect.arrayContaining([
      { campusId: "campus-setup", gradeLevelId: "grade-11", name: "11-A", section: "A" },
      { campusId: "campus-setup", gradeLevelId: "grade-12", name: "12-A", section: "A" },
    ]));
    expect(gradeLevelCourseLinks).toContain("grade-11/course-AYT-TMAT");
    expect(gradeLevelCourseLinks).toContain("grade-12/course-AYT-TMAT");
  });

  test("gerçek 11 ve 12 sunucu şablonlarını karşı seviyeye yaymaz", async ({ page }) => {
    const gradeLevelCourseLinks: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      gradeLevelCourseLinks,
      roles: ["TENANT_ADMIN"],
      upperServerTemplates: true,
    });
    const setupForm = page.getByLabel("Kurulum formu");
    const steps = page.getByLabel("Adım ilerlemesi");
    await steps.getByRole("tab", { name: /Sınıf ve Şubeler/ }).click();
    const classCounts = setupForm.getByRole("group", { name: "Kademeye göre sınıf sayısı" });
    await classCounts.getByLabel("8. sınıf / LGS").fill("0");
    await classCounts.getByLabel("11. sınıf").fill("1");
    await classCounts.getByLabel("12. sınıf").fill("1");
    await steps.getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(page).toHaveURL(/\/kurum\/kurulum\/hazirlik$/);

    expect(gradeLevelCourseLinks).toContain("grade-setup-11/course-11-MAT");
    expect(gradeLevelCourseLinks).toContain("grade-setup-12/course-12-MAT");
    expect(gradeLevelCourseLinks).not.toContain("grade-setup-12/course-11-MAT");
    expect(gradeLevelCourseLinks).not.toContain("grade-setup-11/course-12-MAT");
  });

  test("mevcut sınıfın eksik bağlarını tamamlar, farklı kampüse bağlı sınıfı taşımaz", async ({ page }) => {
    const classPatchBodies: Array<Record<string, unknown>> = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      classPatchBodies,
      existingClasses: [{ id: "class-existing", tenantId: "tenant-setup", name: "8-A", section: "A" }],
      roles: ["TENANT_ADMIN"],
    });
    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(page).toHaveURL(/\/kurum\/kurulum\/hazirlik$/);
    expect(classPatchBodies).toContainEqual({ campusId: "campus-setup", gradeLevelId: "grade-setup-lgs" });
    await expect(setupForm).toContainText("1 sınıf bağlantısı tamamlandı.");

    const unexpectedMutations: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      existingClasses: [{
        id: "class-conflict",
        tenantId: "tenant-setup",
        name: "8-A",
        campusId: "campus-other",
        gradeLevelId: "grade-setup-lgs",
      }],
      roles: ["TENANT_ADMIN"],
      unexpectedMutations,
    });
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(setupForm).toContainText("8-A sınıfı farklı bir kampüse bağlı. Bu kayıt otomatik taşınmadı.");
    expect(unexpectedMutations).toEqual([]);
  });

  test("aynı adlı pasif akademik yıl ve dönemi tarihlerini değiştirmeden etkinleştirir", async ({ page }) => {
    const academicTermPatchBodies: Array<Record<string, unknown>> = [];
    const academicYearPatchBodies: Array<Record<string, unknown>> = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      academicTermPatchBodies,
      academicYearPatchBodies,
      existingAcademicTerms: [{
        id: "academic-term-existing",
        tenantId: "tenant-setup",
        academicYearId: "academic-year-existing",
        name: "1. Dönem",
        startsAt: "2026-09-01",
        endsAt: "2027-01-16",
        isActive: false,
      }],
      existingAcademicYears: [{
        id: "academic-year-existing",
        tenantId: "tenant-setup",
        name: "2026-2027",
        startsAt: "2026-09-01",
        endsAt: "2027-06-19",
        isActive: false,
      }],
      roles: ["TENANT_ADMIN"],
    });
    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(page).toHaveURL(/\/kurum\/kurulum\/hazirlik$/);

    expect(academicYearPatchBodies).toEqual([{ isActive: true }]);
    expect(academicTermPatchBodies).toEqual([{ isActive: true }]);
  });

  test("tenant-geneli readiness yetkisi yoksa hiçbir kurulum kaydı başlatmaz", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      readinessForbidden: true,
      roles: ["ASSISTANT_ADMIN"],
      unexpectedMutations,
    });
    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();

    await expect(setupForm).toContainText("Kurulum yalnız kurum genelinde yetkili bir hesapla tamamlanabilir.");
    expect(unexpectedMutations).toEqual([]);
  });

  test("bozuk readiness yanıtında hiçbir kurulum kaydı başlatmaz", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      malformedReadiness: true,
      roles: ["TENANT_ADMIN"],
      unexpectedMutations,
    });
    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();

    await expect(setupForm).toContainText("Sunucu kurulum durumu doğrulanamadı. Kayıt başlatılmadı");
    expect(unexpectedMutations).toEqual([]);
  });

  test("tablette taşma üretmez ve assistant rolünde kurulum yüzeyini açar", async ({ page }) => {
    const unexpectedMutations: string[] = [];
    await openSetupWizard(page, { height: 1024, width: 768 }, { roles: ["TENANT_ADMIN"], unexpectedMutations });
    await expect(page.getByLabel("Kurulum operasyon metrikleri")).toContainText("Sınıf");
    await expectNoHorizontalOverflow(page, "setup-wizard-tablet");
    await expectNoUnlabeledControls(page, "setup-wizard-tablet");
    await expectNoClippedVisibleText(page, "setup-wizard-tablet");

    await openSetupWizard(page, { height: 844, width: 390 }, { roles: ["ASSISTANT_ADMIN"], unexpectedMutations });
    await expect(page).toHaveURL(/\/kurum\/kurulum$/);
    await expect(page.getByRole("heading", { level: 1, name: "Kurulum Sihirbazı" })).toBeVisible();
    await expect(page.getByLabel("Kurulum formu")).toBeVisible();
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await expect(page.getByLabel("Öğretmen aktarım dosyası")).toHaveCount(0);
    await expect(page.getByLabel("Öğrenci aktarım dosyası")).toBeVisible();
    await page.getByRole("group", { name: "Öğretmen veri girişi" }).getByRole("button", { name: "Excel aktarımı" }).click();
    await expect(page.getByLabel("Öğretmen aktarım dosyası")).toBeVisible();
    await expect(page.getByLabel("Kazanım aktarım dosyası (opsiyonel)")).toBeVisible();
    await expect(page.getByLabel("Veli aktarım dosyası")).toHaveCount(0);
    await page.getByRole("button", { name: "Komut paleti" }).click();
    const commandDialog = page.getByRole("dialog", { name: "Komut paleti" });
    await commandDialog.getByLabel("Komut ara").fill("kurulum");
    await expect(commandDialog.getByRole("link", { name: /Yeni dönem açılışı|Kurulum/ }).first()).toBeVisible();
    expect(unexpectedMutations).toEqual([]);
  });

  test("ayrı dosya ön kontrolü kayıt oluşturmadan dry-run özetini gösterir", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, { requestedPaths, roles: ["TENANT_ADMIN"] });

    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByLabel("Öğrenci aktarım dosyası").setInputFiles({
      buffer: Buffer.from("\uFEFFokul_no;ad;soyad\n100;Ada;Kaya\n", "utf8"),
      mimeType: "text/csv",
      name: "ogrenci-ada-kaya-tckn-12345678901.csv",
    });
    await setupForm.getByRole("button", { name: "Dosyaları ön kontrol et" }).click();

    await expect(setupForm).toContainText("Sunucu ön kontrolü geçti: 1 öğrenci. Henüz kayıt oluşturulmadı.");
    await expect(page.getByLabel("Öğrenci aktarım güven durumu")).toContainText("Ön kontrol geçti");
    const setupPosts = requestedPaths.filter((path) => path.startsWith("POST ") && path !== "POST /auth/refresh");
    expect(setupPosts).toEqual(["POST /students/imports/dry-run"]);
    await expectNoVisibleTextValues(page, "setup-preflight-success", hostileUploadValues);
    await expectDraftStorageDoesNotContain(page, "setup-preflight-success-storage", hostileUploadValues);
  });

  test("dry-run hatasını import değerini açmadan gösterir", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      requestedPaths,
      roles: ["TENANT_ADMIN"],
      studentDryRun: "duplicate",
    });

    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByLabel("Öğrenci aktarım dosyası").setInputFiles({
      buffer: Buffer.from("\uFEFFokul_no;ad;soyad;sinif\n12345678901;Ada;Kaya;8-A\n", "utf8"),
      mimeType: "text/csv",
      name: "ogrenci-ada-kaya-tckn-12345678901.csv",
    });
    await setupForm.getByRole("button", { name: "Dosyaları ön kontrol et" }).click();

    await expect(setupForm).toContainText("Öğrenci dosyasında tekrar eden veya sistemde zaten kayıtlı okul no var. Satır: 2.");
    const setupPosts = requestedPaths.filter((path) => path.startsWith("POST ") && path !== "POST /auth/refresh");
    expect(setupPosts).toEqual(["POST /students/imports/dry-run"]);
    await expectNoVisibleTextValues(page, "setup-dry-run-error", hostileUploadValues);
    await expectDraftStorageDoesNotContain(page, "setup-dry-run-error-storage", hostileUploadValues);
  });

  test("öğretmen Excel dosyasını zorunlu tutar ve import sonucunu özetler", async ({ page }) => {
    const teacherImportIdempotencyKeys: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      roles: ["TENANT_ADMIN"],
      teacherImportFailures: 1,
      teacherImportIdempotencyKeys,
    });

    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğretmen veri girişi" }).getByRole("button", { name: "Excel aktarımı" }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(setupForm).toContainText("Öğretmen aktarım dosyası zorunludur.");

    await setupForm.getByLabel("Öğretmen aktarım dosyası").setInputFiles({
      buffer: Buffer.from("\uFEFFad;soyad;brans;tc_kimlik_no;telefon\nAyse;Yilmaz;Matematik;10000001440;5550000012\n", "utf8"),
      mimeType: "text/csv",
      name: "ogretmen-zeynep-5551112233.csv",
    });
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(setupForm).toContainText("Sunucudan kesin sonuç alınamadı.");
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();

    await expect(setupForm).toContainText("2 sınıf, 6 ders, 1 öğretmen, 0 öğretmen ataması");
    expect(teacherImportIdempotencyKeys).toHaveLength(2);
    expect(teacherImportIdempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(teacherImportIdempotencyKeys[1]).toBe(teacherImportIdempotencyKeys[0]);
    await expectNoVisibleTextValues(page, "setup-teacher-import-summary", hostileUploadValues);
    await expectDraftStorageDoesNotContain(page, "setup-teacher-import-storage", hostileUploadValues);
  });

  test("öğrenci Excel dosyasını zorunlu tutar ve veli bağlantı mesajını özetler", async ({ page }) => {
    const requestedPaths: string[] = [];
    const studentImportIdempotencyKeys: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      requestedPaths,
      roles: ["TENANT_ADMIN"],
      studentImportFailures: 1,
      studentImportIdempotencyKeys,
    });

    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğretmen veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Excel aktarımı" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(setupForm).toContainText("Öğrenci aktarım dosyası zorunludur.");

    await setupForm.getByLabel("Öğrenci aktarım dosyası").setInputFiles({
      buffer: Buffer.from("\uFEFFokul_no;ad;soyad;sinif;veli_ad;veli_soyad;veli_telefon;veli_tc_kimlik_no\n100;Ada;Kaya;8-A;Ayse;Veli;05550000101;10000001990\n", "utf8"),
      mimeType: "text/csv",
      name: "ogrenci-ada-veli-5550000101.csv",
    });
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(setupForm).toContainText("Sunucudan kesin sonuç alınamadı.");
    const coreCreatesAfterFailure = coreSetupCreateRequests(requestedPaths);
    await installPersistedCoreSetupReads(page);
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();

    await expect(setupForm).toContainText("0 sınıf, 0 ders, 0 öğretmen, 0 öğretmen ataması");
    await expect(setupForm).toContainText("1 öğrenci ve dosyadaki veli bağlantıları işlendi");
    expect(coreSetupCreateRequests(requestedPaths)).toEqual(coreCreatesAfterFailure);
    expect(studentImportIdempotencyKeys).toHaveLength(2);
    expect(studentImportIdempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(studentImportIdempotencyKeys[1]).toBe(studentImportIdempotencyKeys[0]);
    await expect(setupForm).not.toContainText("veli eklendi");
    await expectNoVisibleTextValues(page, "setup-student-guardian-link-summary", [
      ...hostileUploadValues,
      "ogrenci-ada-veli-5550000101.csv",
      "5550000101",
    ]);
    await expectDraftStorageDoesNotContain(page, "setup-student-guardian-link-storage", [
      ...hostileUploadValues,
      "ogrenci-ada-veli-5550000101.csv",
      "5550000101",
    ]);
  });

  test("boş ders şablonu cevabında yerel derslerle kaydı tamamlar", async ({ page }) => {
    await openSetupWizard(page, { height: 844, width: 390 }, { emptyCourseTemplates: true, roles: ["TENANT_ADMIN"] });

    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();

    await expect(setupForm).not.toContainText("Ders şablonu bulunamadı.");
    await expect(setupForm).toContainText("2 sınıf, 6 ders");
  });

  test("kazanım aktarım dosyası opsiyoneldir ve seçilirse özetlenir", async ({ page }) => {
    const kazanimImportIdempotencyKeys: string[] = [];
    await openSetupWizard(page, { height: 844, width: 390 }, {
      kazanimImportFailures: 1,
      kazanimImportIdempotencyKeys,
      roles: ["TENANT_ADMIN"],
    });

    const setupForm = page.getByLabel("Kurulum formu");
    await page.getByLabel("Adım ilerlemesi").getByRole("tab", { name: /Kişi Yönetim Altyapısı/ }).click();
    await setupForm.getByRole("group", { name: "Öğretmen veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByRole("group", { name: "Öğrenci veri girişi" }).getByRole("button", { name: "Tek tek giriş" }).click();
    await setupForm.getByLabel("Kazanım aktarım dosyası (opsiyonel)").setInputFiles({
      buffer: Buffer.from("\uFEFFkod;brans;baslik\nMAT.8.1.1;Matematik;Çarpanlar ve katlar\n", "utf8"),
      mimeType: "text/csv",
      name: "kazanimlar.csv",
    });
    await expect(page.getByLabel("Kazanım aktarım güven durumu")).toContainText("Yerel kontrol tamam");
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();
    await expect(setupForm).toContainText("Sunucudan kesin sonuç alınamadı.");
    await setupForm.getByRole("button", { name: "Kaydet ve kontrol et" }).click();

    await expect(setupForm).toContainText("1 kazanım");
    expect(kazanimImportIdempotencyKeys).toHaveLength(2);
    expect(kazanimImportIdempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(kazanimImportIdempotencyKeys[1]).toBe(kazanimImportIdempotencyKeys[0]);
  });
});

async function openSetupWizard(
  page: Page,
  viewport: { height: number; width: number },
  options: SetupMockOptions = {},
) {
  await page.setViewportSize(viewport);
  await installSetupApiMocks(page, options);
  if (page.url().startsWith(appOrigin)) {
    await page.evaluate(() => {
      window.sessionStorage.clear();
      window.name = "";
    });
  }
  await page.addInitScript(() => {
    if (window.name !== "__setup_test_initialized") {
      window.sessionStorage.clear();
      window.name = "__setup_test_initialized";
    }
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  if (options.spoofCompletedCookie) {
    await page.context().addCookies([{
      name: "uh_onboarding_tenant-setup_completed",
      url: appOrigin,
      value: "true",
    }]);
  }
  await page.goto("/kurum/kurulum");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installPersistedCoreSetupReads(page: Page) {
  const recordsByPath: Record<string, unknown[]> = {
    "/academic-years": [{
      id: "academic-year-setup",
      tenantId: "tenant-setup",
      name: "2026-2027",
      startsAt: "2026-09-01",
      endsAt: "2027-06-19",
      isActive: true,
    }],
    "/academic-terms": [{
      id: "academic-term-setup",
      tenantId: "tenant-setup",
      academicYearId: "academic-year-setup",
      name: "1. Dönem",
      startsAt: "2026-09-01",
      endsAt: "2027-01-16",
      isActive: true,
    }],
    "/campuses": [{ id: "campus-setup", tenantId: "tenant-setup", name: "Merkez Kampüs", code: "MRK" }],
    "/classes": [
      { id: "class-8-a", tenantId: "tenant-setup", campusId: "campus-setup", gradeLevelId: "grade-setup-lgs", name: "8-A", section: "A" },
      { id: "class-8-b", tenantId: "tenant-setup", campusId: "campus-setup", gradeLevelId: "grade-setup-lgs", name: "8-B", section: "B" },
    ],
    "/courses": [
      { id: "course-LGS-TUR", tenantId: "tenant-setup", code: "LGS-TUR", name: "Türkçe" },
      { id: "course-LGS-MAT", tenantId: "tenant-setup", code: "LGS-MAT", name: "Matematik" },
      { id: "course-LGS-FEN", tenantId: "tenant-setup", code: "LGS-FEN", name: "Fen Bilgisi" },
      { id: "course-LGS-INK", tenantId: "tenant-setup", code: "LGS-INK", name: "Atatürk İlke ve İnkılapları" },
      { id: "course-LGS-ING", tenantId: "tenant-setup", code: "LGS-ING", name: "Yabancı Dil (İngilizce)" },
      { id: "course-LGS-DIN", tenantId: "tenant-setup", code: "LGS-DIN", name: "Din Kültürü" },
    ],
    "/grade-levels": [
      { code: "8-LGS", id: "grade-setup-lgs", name: "8. sınıf / LGS", tenantId: "tenant-setup" },
      { code: "10", id: "grade-setup-10", name: "10. sınıf", tenantId: "tenant-setup" },
    ],
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const records = recordsByPath[pathName];
    if (request.method() !== "GET" || !records) {
      await route.fallback();
      return;
    }
    await fulfillData(route, records);
  });
}

function coreSetupCreateRequests(requestedPaths: string[]) {
  const corePaths = new Set([
    "POST /academic-years",
    "POST /academic-terms",
    "POST /classes",
    "POST /courses",
    "POST /grade-levels",
  ]);
  return requestedPaths.filter((path) => corePaths.has(path));
}

async function installSetupApiMocks(
  page: Page,
  options: SetupMockOptions = {},
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
    options.requestedPaths?.push(`${request.method()} ${pathName}`);
    if (request.method() === "GET" && pathName === "/setup/readiness" && options.readinessForbidden) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "SETUP_TENANT_WIDE_SCOPE_REQUIRED" } }),
        contentType: "application/json",
        headers: corsHeadersFor(route),
        status: 403,
      });
      return;
    }
    if (request.method() === "GET" && pathName === "/setup/readiness" && options.malformedReadiness) {
      await fulfillData(route, { invalid: true });
      return;
    }
    if (request.method() === "POST" && pathName === "/students/imports") {
      options.studentImportIdempotencyKeys?.push(request.headers()["idempotency-key"] ?? "");
      if ((options.studentImportFailures ?? 0) > 0) {
        options.studentImportFailures = (options.studentImportFailures ?? 0) - 1;
        await route.fulfill({
          body: JSON.stringify({ error: { code: "TRANSIENT_IMPORT_FAILURE" } }),
          contentType: "application/json",
          headers: corsHeadersFor(route),
          status: 503,
        });
        return;
      }
    }
    if (request.method() === "POST" && pathName === "/classes") {
      options.classCreateBodies?.push(request.postDataJSON() as Record<string, unknown>);
    }
    if (request.method() === "PATCH" && pathName.startsWith("/classes/")) {
      options.classPatchBodies?.push(request.postDataJSON() as Record<string, unknown>);
    }
    if (request.method() === "PATCH" && pathName.startsWith("/academic-years/")) {
      options.academicYearPatchBodies?.push(request.postDataJSON() as Record<string, unknown>);
    }
    if (request.method() === "PATCH" && pathName.startsWith("/academic-terms/")) {
      options.academicTermPatchBodies?.push(request.postDataJSON() as Record<string, unknown>);
    }
    if (request.method() === "POST" && pathName === "/teachers/imports") {
      options.teacherImportIdempotencyKeys?.push(request.headers()["idempotency-key"] ?? "");
      if ((options.teacherImportFailures ?? 0) > 0) {
        options.teacherImportFailures = (options.teacherImportFailures ?? 0) - 1;
        await route.fulfill({
          body: JSON.stringify({ error: { code: "TRANSIENT_IMPORT_FAILURE" } }),
          contentType: "application/json",
          headers: corsHeadersFor(route),
          status: 503,
        });
        return;
      }
    }
    if (request.method() === "POST" && pathName === "/learning-outcomes/imports") {
      options.kazanimImportIdempotencyKeys?.push(request.headers()["idempotency-key"] ?? "");
      if ((options.kazanimImportFailures ?? 0) > 0) {
        options.kazanimImportFailures = (options.kazanimImportFailures ?? 0) - 1;
        await route.fulfill({
          body: JSON.stringify({ error: { code: "TRANSIENT_IMPORT_FAILURE" } }),
          contentType: "application/json",
          headers: corsHeadersFor(route),
          status: 503,
        });
        return;
      }
    }
    if (request.method() === "PUT") {
      const match = pathName.match(/^\/grade-levels\/([^/]+)\/courses\/([^/]+)$/);
      if (match) {
        options.gradeLevelCourseLinks?.push(`${match[1]}/${match[2]}`);
        await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
        return;
      }
    }
    if (request.method() !== "GET" && pathName !== "/auth/refresh") {
      options.unexpectedMutations?.push(`${request.method()} ${pathName}`);
    }
    if (request.method() === "POST" && pathName === "/courses") {
      const body = request.postDataJSON() as { code: string; name: string };
      await fulfillData(route, { id: `course-${body.code}`, ...body });
      return;
    }
    if (request.method() === "POST" && pathName === "/grade-levels") {
      const body = request.postDataJSON() as { code: string; name: string };
      options.gradeLevelCreateBodies?.push(body);
      await fulfillData(route, { id: `grade-${body.code}`, tenantId: "tenant-setup", ...body });
      return;
    }
    const response = mockSetupApiResponse(pathName, request.method(), options);
    await fulfillData(route, response);
  });
}

function mockSetupApiResponse(
  pathName: string,
  method: string,
  options: SetupMockOptions = {},
) {
  if (pathName === "/auth/refresh") return createAuthResponse(options.roles ?? ["TENANT_ADMIN"]);
  if (pathName === "/me/feature-rollouts") {
    return { enabledFeatureKeys: [] };
  }
  if (pathName === "/setup/readiness") return createSetupReadiness(options.readiness ?? "ready", options.legacyReadiness);
  if (pathName === "/me/tenant") return createTenantResponse();
  if (pathName === "/me/notification-devices") return [];
  if (method === "GET" && pathName === "/campuses") {
    return options.campuses ?? [{ id: "campus-setup", tenantId: "tenant-setup", name: "Merkez Kampüs", code: "MRK" }];
  }
  if (method === "GET" && pathName === "/classes") return options.existingClasses ?? [];
  if (method === "GET" && pathName === "/academic-years") return options.existingAcademicYears ?? [];
  if (method === "GET" && pathName === "/academic-terms") return options.existingAcademicTerms ?? [];
  if (method === "PATCH" && pathName.startsWith("/classes/")) {
    return { id: pathName.slice("/classes/".length), tenantId: "tenant-setup", ...options.classPatchBodies?.at(-1) };
  }
  if (method === "PATCH" && pathName.startsWith("/academic-years/")) {
    return { ...options.existingAcademicYears?.[0], ...options.academicYearPatchBodies?.at(-1) };
  }
  if (method === "PATCH" && pathName.startsWith("/academic-terms/")) {
    return { ...options.existingAcademicTerms?.[0], ...options.academicTermPatchBodies?.at(-1) };
  }
  if (method === "GET" && pathName === "/grade-levels") {
    if (options.emptyCourseTemplates) return [];
    if (options.upperServerTemplates) {
      return [
        { code: "11", id: "grade-setup-11", name: "11. sınıf", tenantId: "tenant-setup" },
        { code: "12", id: "grade-setup-12", name: "12. sınıf", tenantId: "tenant-setup" },
      ];
    }
    return [
      { code: "8-LGS", id: "grade-setup-lgs", name: "8. sınıf / LGS", tenantId: "tenant-setup" },
      { code: "10", id: "grade-setup-10", name: "10. sınıf", tenantId: "tenant-setup" },
    ];
  }
  if (method === "GET" && pathName === "/grade-levels/grade-setup-lgs/courses") {
    if (options.partialLgsTemplates) {
      return [{
        courseCode: "LGS-TUR",
        courseId: "course-setup-turkce",
        courseName: "Türkçe",
        gradeLevelId: "grade-setup-lgs",
        id: "template-lgs-turkce",
        isDefault: true,
        sortOrder: 10,
        tenantId: "tenant-setup",
      }];
    }
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
  if (method === "GET" && pathName === "/grade-levels/grade-setup-11/courses") {
    return [{
      courseCode: "11-MAT",
      courseId: "course-setup-11-matematik",
      courseName: "11 Matematik",
      gradeLevelId: "grade-setup-11",
      id: "template-11-matematik",
      isDefault: true,
      sortOrder: 10,
      tenantId: "tenant-setup",
    }];
  }
  if (method === "GET" && pathName === "/grade-levels/grade-setup-12/courses") {
    return [{
      courseCode: "12-MAT",
      courseId: "course-setup-12-matematik",
      courseName: "12 Matematik",
      gradeLevelId: "grade-setup-12",
      id: "template-12-matematik",
      isDefault: true,
      sortOrder: 10,
      tenantId: "tenant-setup",
    }];
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
      validRows: [{ firstName: "Ayse", lastName: "Yilmaz", row: 2 }],
      wouldImport: true,
    };
  }
  if (method === "POST" && pathName === "/teachers/imports") {
    return { assignments: [], createdAssignments: 0, createdTeachers: 1, importedRows: 1, teachers: [] };
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
  if (method === "POST" && pathName === "/learning-outcomes/imports/dry-run") {
    return {
      dryRun: true,
      errors: [],
      totalRows: 1,
      validRows: [{ branch: "Matematik", code: "MAT.8.1.1", row: 2, title: "Çarpanlar ve katlar" }],
      wouldImport: true,
    };
  }
  if (method === "POST" && pathName === "/learning-outcomes/imports") {
    return {
      createdOutcomes: 1,
      importedRows: 1,
      outcomes: [{ branch: "Matematik", code: "MAT.8.1.1", id: "learning-outcome-setup", tenantId: "tenant-setup", title: "Çarpanlar ve katlar" }],
      updatedOutcomes: 0,
    };
  }
  return [];
}

interface SetupMockOptions {
  academicTermPatchBodies?: Array<Record<string, unknown>>;
  academicYearPatchBodies?: Array<Record<string, unknown>>;
  campuses?: Array<{ id: string; tenantId: string; name: string; code?: string }>;
  classCreateBodies?: Array<Record<string, unknown>>;
  classPatchBodies?: Array<Record<string, unknown>>;
  emptyCourseTemplates?: boolean;
  existingClasses?: Array<{
    id: string;
    tenantId: string;
    name: string;
    campusId?: string;
    gradeLevelId?: string;
    section?: string;
  }>;
  existingAcademicTerms?: Array<{
    id: string;
    tenantId: string;
    academicYearId: string;
    name: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
  }>;
  existingAcademicYears?: Array<{
    id: string;
    tenantId: string;
    name: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
  }>;
  gradeLevelCreateBodies?: Array<Record<string, unknown>>;
  gradeLevelCourseLinks?: string[];
  kazanimImportFailures?: number;
  kazanimImportIdempotencyKeys?: string[];
  legacyReadiness?: boolean;
  malformedReadiness?: boolean;
  partialLgsTemplates?: boolean;
  readiness?: "ready" | "incomplete" | "optional-missing";
  readinessForbidden?: boolean;
  requestedPaths?: string[];
  roles?: string[];
  spoofCompletedCookie?: boolean;
  studentDryRun?: "duplicate";
  studentImportFailures?: number;
  studentImportIdempotencyKeys?: string[];
  teacherImportIdempotencyKeys?: string[];
  teacherImportFailures?: number;
  upperServerTemplates?: boolean;
  unexpectedMutations?: string[];
}

function createSetupReadiness(state: "ready" | "incomplete" | "optional-missing", legacy = false) {
  const keys = [
    "institution",
    "campus",
    "academic-year",
    "academic-term",
    "grade-level",
    "class",
    "course",
    "teacher",
    "student",
  ] as const;
  const steps = keys.map((key) => {
    const missing = (state === "incomplete" && key === "academic-term")
      || (state === "optional-missing" && (key === "teacher" || key === "student"));
    const step = {
      key,
      count: missing ? 0 : 1,
      ready: !missing,
    };
    return legacy ? step : { ...step, required: key !== "teacher" && key !== "student" };
  });
  const completedCount = steps.filter((step) => step.ready).length;
  return {
    status: legacy
      ? completedCount === steps.length ? "READY" : "ACTION_REQUIRED"
      : steps.every((step) => !("required" in step) || !step.required || step.ready) ? "READY" : "ACTION_REQUIRED",
    completedCount,
    totalCount: steps.length,
    steps,
  };
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
