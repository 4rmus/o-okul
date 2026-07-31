import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const smsEnabled = process.env.NEXT_PUBLIC_SMS_ENABLED === "true";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

interface CapturedRequests {
  academicTerms: URLSearchParams[];
  academicYears: URLSearchParams[];
  announcements: URLSearchParams[];
  campuses: URLSearchParams[];
  classes: URLSearchParams[];
  courses: URLSearchParams[];
  gradeLevels: URLSearchParams[];
  guardians: URLSearchParams[];
  homework: URLSearchParams[];
  homeworkMaterials: URLSearchParams[];
  invitations: URLSearchParams[];
  invitationCreates: Array<{ authorization: string | undefined; body: unknown }>;
  invitationResends: Array<{ authorization: string | undefined; id: string }>;
  learningOutcomes: URLSearchParams[];
  messageTemplates: URLSearchParams[];
  paymentPlans: URLSearchParams[];
  roleUpdates: Array<{ authorization: string | undefined; body: unknown; userId: string }>;
  scheduleLessons: URLSearchParams[];
  students: URLSearchParams[];
  studySessions: URLSearchParams[];
  supportTickets: URLSearchParams[];
  teachers: URLSearchParams[];
  users: URLSearchParams[];
}

test.describe("Liste URL state", () => {
  test("tek listeli ekran URL state'i okur ve değişiklikleri URL'ye yazar", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/ogretmenler?page=2&limit=20&q=mat&sort=-firstName");

    const teachersRegion = page.getByLabel("Öğretmen yönetimi");
    const teacherSummary = teachersRegion.getByRole("region", { exact: true, name: "Öğretmen operasyon özeti" });
    await expect(teacherSummary).toContainText("Öğretmen toplamı");
    await expect(teacherSummary).toContainText("Portal hazır");
    await expect(teacherSummary.getByLabel("Öğretmen operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(teacherSummary).toContainText("Branş temizliği");
    await expect(teacherSummary).toContainText("Portal hesabı");
    await expect(teachersRegion.getByLabel("Ara")).toHaveValue("mat");
    await expect(teachersRegion.getByLabel("Sırala")).toHaveValue("-firstName");
    await expect(teachersRegion.getByLabel("Göster")).toHaveValue("20");
    await expect.poll(() => captured.teachers.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.teachers.at(-1)?.get("q")).toBe("mat");

    await teachersRegion.getByLabel("Ara").fill("zeynep");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("zeynep");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");

    await teachersRegion.getByLabel("Sırala").selectOption("lastName");
    await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("lastName");
  });

  test("kullanıcı ekranında URL state namespace ile ayrılır", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(
      page,
      captured,
      "/kurum/kullanicilar?usersPage=2&usersLimit=20&usersQ=admin&usersSort=email",
    );

    const usersRegion = page.getByLabel("Kullanıcı ve rol yönetimi");
    await expect(usersRegion.getByLabel("Ara")).toHaveValue("admin");
    await expect(usersRegion.getByLabel("Sırala")).toHaveValue("email");
    await expect(usersRegion.getByLabel("Göster")).toHaveValue("20");
    await expect.poll(() => captured.users.at(-1)?.get("q")).toBe("admin");

    await usersRegion.getByLabel("Ara").fill("yardımcı");
    await expect.poll(() => new URL(page.url()).searchParams.get("usersQ")).toBe("yardımcı");
    await expect.poll(() => new URL(page.url()).searchParams.get("usersPage")).toBe("1");
  });

  test("kullanıcı rol taslağını kaydetmeden mutasyona göndermez ve kayıttan sonra temizler", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/kullanicilar");

    const usersRegion = page.getByLabel("Kullanıcı ve rol yönetimi");
    const summary = usersRegion.getByRole("region", { exact: true, name: "Kullanıcı operasyon özeti" });
    const saveButton = page.getByRole("button", { name: "Admin Kullanıcı rollerini kaydet" });
    const adminRoles = usersRegion.getByLabel("Admin Kullanıcı rolleri", { exact: true });
    await expect(summary).toContainText("Kullanıcı toplamı");
    await expect(summary).toContainText("TC + telefon girişi");
    await expect(summary).toContainText("Rol taslağı");
    await expect(adminRoles.locator(".next-role-grid--compact .uh-checkbox")).toHaveCount(2);
    await expect(adminRoles).toContainText("Tüm kurum operasyonları");
    await expect(saveButton).toBeDisabled();

    await adminRoles.getByRole("checkbox", { name: /Kurum admin/ }).check();
    expect(captured.roleUpdates).toEqual([]);
    await expect(summary).toContainText("Henüz kaydedilmemiş rol satırı");
    await expect(summary).toContainText("1");
    await expect(usersRegion.getByText("Kaydedilmemiş rol değişikliği")).toBeVisible();
    await expect(saveButton).toBeEnabled();

    await saveButton.click();
    await expect.poll(() => captured.roleUpdates).toHaveLength(1);
    expect(captured.roleUpdates[0]).toMatchObject({
      authorization: "Bearer list-url-access-token",
      body: { roles: ["TENANT_ADMIN"] },
      userId: "tenant-user-a",
    });
    await expect(saveButton).toBeDisabled();
    await expect(usersRegion.getByText("Kaydedilmemiş rol değişikliği")).toHaveCount(0);

    await usersRegion.getByRole("button", { name: "Kullanıcı ekle" }).click();
    const userDialog = page.getByRole("dialog", { name: "Kullanıcı ekle" });
    await expect(userDialog.locator(".next-role-fieldset .uh-checkbox")).toHaveCount(2);
    await expect(userDialog).toContainText("Kullanıcının kurum yönetim kapsamını seç.");
    await expect(userDialog.getByRole("checkbox", { name: /Yardımcı yönetici/ })).toBeChecked();
    await userDialog.getByLabel("Telefon").fill("5551234567");
    await expect(userDialog.getByLabel("Telefon")).toHaveValue("+90 555 123 45 67");
    await userDialog.getByRole("button", { name: "Vazgeç" }).click();

    for (const value of ["12345678901", "+905551234567", "guardian-private@example.test"]) {
      await expect(page.locator("body")).not.toContainText(value);
    }
  });

  test("kullanıcı ekranı davet tokenı göstermeden PII maskesini korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/kullanicilar");

    await expect(page.getByRole("button", { name: "Davet oluştur" })).toHaveCount(0);
    await expect(page.getByLabel("Son aktivasyon tokenı")).toHaveCount(0);
    expect(captured.invitationCreates).toEqual([]);
    expect(captured.invitationResends).toEqual([]);

    for (const value of ["12345678901", "+905551234567", "guardian-private@example.test", "activation-token-created-secret", "activation-token-resent-secret"]) {
      await expect(page.locator("body")).not.toContainText(value);
    }
  });

  test("öğrenci listesi filtre, kolon ve yoğunluk state'ini URL'de korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(
      page,
      captured,
      "/kurum/ogrenciler?page=2&limit=20&q=ada&sort=-lastName&classId=class-11a&level=grade-11&responsibleTeacherId=teacher-a&status=ACTIVE&guardianLinked=true&density=compact&columns=name,class,status,actions",
    );

    const studentsRegion = page.getByLabel("Öğrenci yönetimi");
    const studentSummary = studentsRegion.getByRole("region", { exact: true, name: "Öğrenci operasyon özeti" });
    const filters = page.getByLabel("Öğrenci filtreleri");
    const tableView = page.getByLabel("Öğrenci tablo görünümü");
    await page.getByText("Filtreler ve görünüm", { exact: true }).click();
    await expect(studentSummary).toContainText("Öğrenci toplamı");
    await expect(studentSummary).toContainText("Yoğun");
    await expect(studentSummary).toContainText("Veli: Bağlı");
    await expect(studentSummary.getByLabel("Öğrenci operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(studentSummary).toContainText("Sınıf eşleştirme");
    await expect(studentSummary).toContainText("Toplu dönem geçişi");
    await expect(studentsRegion.getByLabel("Ara")).toHaveValue("ada");
    await expect(studentsRegion.getByLabel("Sırala")).toHaveValue("-lastName");
    await expect(studentsRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(filters.locator(".uh-field")).toHaveCount(5);
    await expect(filters.locator(".uh-select")).toHaveCount(5);
    await expect(filters.getByRole("combobox").nth(0)).toHaveValue("class-11a");
    await expect(filters.getByRole("combobox").nth(1)).toHaveValue("grade-11");
    await expect(filters.getByLabel("Sorumlu")).toHaveValue("teacher-a");
    await expect(filters.getByLabel("Durum")).toHaveValue("ACTIVE");
    await expect(filters.getByLabel("Veli")).toHaveValue("true");
    await expect(tableView.locator(".uh-field")).toHaveCount(1);
    await expect(tableView.locator(".uh-select")).toHaveCount(1);
    await expect(tableView.locator(".uh-checkbox")).toHaveCount(6);
    await expect(tableView.getByLabel("Görünüm")).toHaveValue("compact");
    await expect(tableView.getByLabel("Sorumlu")).not.toBeChecked();
    await expect(studentsRegion).toHaveClass(/next-students-page--compact/);
    await expect.poll(() => captured.students.at(-1)?.get("classId")).toBe("class-11a");
    await expect.poll(() => captured.students.at(-1)?.get("guardianLinked")).toBe("true");

    await filters.getByLabel("Veli").selectOption("false");
    await expect.poll(() => new URL(page.url()).searchParams.get("guardianLinked")).toBe("false");

    await tableView.getByLabel("Okul No").check();
    await expect.poll(() => new URL(page.url()).searchParams.get("columns")).toContain("studentNo");
  });

  test("finans listesi filtre ve tahsilat state'ini URL'de korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(
      page,
      captured,
      "/kurum/finans?page=2&limit=20&q=haziran&sort=-dueDate&studentId=student-a&campusId=campus-a&gradeLevelId=grade-11&classId=class-11a&courseId=course-math&termId=term-2026-spring",
    );

    const financeRegion = page.getByLabel("Finans yönetimi");
    const financeSummary = financeRegion.getByRole("region", { exact: true, name: "Finans operasyon özeti" });
    const financeListControls = financeRegion.locator(".next-list-controls").last();
    const filters = financeRegion.getByLabel("Finans filtreleri");
    const installmentsTable = financeRegion.getByRole("table", { name: "Ödeme taksitleri" });

    await expect(financeSummary).toContainText("Bekleyen ödeme");
    await expect(financeSummary).toContainText("Geciken taksit");
    await expect(financeSummary).toContainText("Kurum finans görünümü");
    await expect(financeSummary).toContainText("6 filtre aktif");
    await expect(financeSummary.getByLabel("Finans operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(financeListControls.locator(".uh-field")).toHaveCount(3);
    await expect(filters).toHaveClass(/uh-filter-bar/);
    await expect(financeRegion.getByLabel("Ara")).toHaveValue("haziran");
    await expect(financeRegion.getByLabel("Sırala")).toHaveValue("-dueDate");
    await expect(financeRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(filters.getByLabel("Öğrenci")).toHaveValue("student-a");
    await expect(filters.getByLabel("Kampüs")).toHaveValue("campus-a");
    await expect(filters.getByLabel("Seviye")).toHaveValue("grade-11");
    await expect(filters.getByLabel("Sınıf")).toHaveValue("class-11a");
    await expect(filters.getByLabel("Ders")).toHaveValue("course-math");
    await expect(filters.getByLabel("Dönem")).toHaveValue("term-2026-spring");
    await expect(installmentsTable.locator('th[data-column-key="student"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(installmentsTable.locator('th[data-column-key="context"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(installmentsTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expect.poll(() => captured.paymentPlans.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.paymentPlans.at(-1)?.get("q")).toBe("haziran");
    await expect.poll(() => captured.paymentPlans.at(-1)?.get("studentId")).toBe("student-a");
    await expect.poll(() => captured.paymentPlans.at(-1)?.get("termId")).toBe("term-2026-spring");

    await filters.getByLabel("Ders").selectOption("");
    await expect.poll(() => new URL(page.url()).searchParams.get("courseId")).toBeNull();
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");

    for (const value of ["student-a", "campus-a", "grade-11", "course-math"]) {
      await expect(financeRegion).not.toContainText(value);
    }
  });

  test("destek listesi triage filtre state'ini URL'de korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(
      page,
      captured,
      "/kurum/destek?page=2&limit=20&q=optik&sort=-createdAt&campusId=campus-a&gradeLevelId=grade-11&classId=class-11a&courseId=course-math&termId=term-2026-spring",
    );

    const supportRegion = page.getByLabel("Destek bildirimi yönetimi");
    const supportSummary = supportRegion.getByRole("region", { exact: true, name: "Destek operasyon özeti" });
    const filters = supportRegion.getByLabel("Destek filtreleri");
    const supportTable = supportRegion.getByRole("table", { name: "Destek triage listesi" });

    await expect(supportSummary).toContainText("Açık");
    await expect(supportSummary).toContainText("Triage kuyruğu");
    await expect(supportSummary).toContainText("5 aktif filtre");
    await expect(supportSummary.getByLabel("Destek operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(filters).toHaveClass(/uh-filter-bar/);
    await expect(supportRegion.getByLabel("Ara")).toHaveValue("optik");
    await expect(supportRegion.getByLabel("Sırala")).toHaveValue("-createdAt");
    await expect(supportRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(filters.getByLabel("Kampüs")).toHaveValue("campus-a");
    await expect(filters.getByLabel("Seviye")).toHaveValue("grade-11");
    await expect(filters.getByLabel("Sınıf")).toHaveValue("class-11a");
    await expect(filters.getByLabel("Ders")).toHaveValue("course-math");
    await expect(filters.getByLabel("Dönem")).toHaveValue("term-2026-spring");
    await expect(supportTable.locator('th[data-column-key="subject"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(supportTable.locator('th[data-column-key="context"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(supportTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expect.poll(() => captured.supportTickets.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.supportTickets.at(-1)?.get("q")).toBe("optik");
    await expect.poll(() => captured.supportTickets.at(-1)?.get("campusId")).toBe("campus-a");
    await expect.poll(() => captured.supportTickets.at(-1)?.get("termId")).toBe("term-2026-spring");

    await filters.getByLabel("Dönem").selectOption("");
    await expect.poll(() => new URL(page.url()).searchParams.get("termId")).toBeNull();
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");

    for (const value of ["student-a", "guardian-a", "12345678901", "+905551234567", "ada.kaya@example.test"]) {
      await expect(supportRegion).not.toContainText(value);
    }
  });

  test("duyuru listesi URL state ve operasyon özetini korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/duyurular?page=2&limit=20&q=sınav&sort=-publishedAt");

    const announcementsRegion = page.getByLabel("Duyuru yönetimi");
    const announcementSummary = announcementsRegion.getByRole("region", { exact: true, name: "Duyuru operasyon özeti" });

    await expect(announcementSummary).toContainText("Duyuru toplamı");
    if (smsEnabled) {
      await expect(announcementSummary).toContainText("SMS uygun");
    } else {
      await expect(announcementSummary).not.toContainText("SMS");
    }
    await expect(announcementSummary.getByLabel("Duyuru operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(announcementSummary).toContainText("Alıcı raporu");
    await expect(announcementsRegion.getByLabel("Ara")).toHaveValue("sınav");
    await expect(announcementsRegion.getByLabel("Sırala")).toHaveValue("-publishedAt");
    await expect(announcementsRegion.getByLabel("Göster")).toHaveValue("20");
    await expect.poll(() => captured.announcements.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.announcements.at(-1)?.get("q")).toBe("sınav");
    await expect.poll(() => captured.announcements.at(-1)?.get("sort")).toBe("-publishedAt");

    await announcementsRegion.getByRole("button", { name: "Duyuru ekle" }).click();
    const announcementDialog = page.getByRole("dialog", { name: "Duyuru ekle" });
    await expect(announcementDialog.locator(".uh-field")).toHaveCount(8);
    await expect(announcementDialog.locator(".uh-select")).toHaveCount(6);
    await expect(announcementDialog.locator(".uh-textarea")).toHaveCount(1);
    await expect(announcementDialog.getByRole("textbox", { name: /^Duyuru metni / })).toBeVisible();
    await announcementDialog.getByRole("button", { name: "Vazgeç" }).click();

    await announcementsRegion.getByLabel("Ara").fill("veli");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("veli");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");
  });

  test("şablon listesi URL state ve SMS operasyon özetini korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/sablonlar?page=2&limit=20&q=hafta&sort=-name");
    if (!smsEnabled) {
      await expect(page.getByLabel("Şablon yönetimi")).toHaveCount(0);
      return;
    }

    const templatesRegion = page.getByLabel("Şablon yönetimi");
    const templateSummary = templatesRegion.getByRole("region", { exact: true, name: "Şablon operasyon özeti" });

    await expect(templateSummary).toContainText("Şablon toplamı");
    await expect(templateSummary).toContainText("SMS hazır");
    await expect(templateSummary.getByLabel("Şablon operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(templateSummary).toContainText("Alıcı kontrolü");
    await expect(page.getByLabel("Aktarım şablonları").getByRole("link", { name: "Öğretmen XLSX şablonu" })).toHaveAttribute("href", "/templates/ogretmen-aktarim-sablonu.xlsx");
    await expect(page.getByLabel("Aktarım şablonları").getByRole("link", { name: "Öğrenci XLSX şablonu" })).toHaveAttribute("href", "/templates/ogrenci-aktarim-sablonu.xlsx");
    await expect(page.getByLabel("Aktarım şablonları").getByRole("link", { name: "Veli XLSX şablonu" })).toHaveCount(0);
    await expect(templatesRegion.getByLabel("Ara")).toHaveValue("hafta");
    await expect(templatesRegion.getByLabel("Sırala")).toHaveValue("-name");
    await expect(templatesRegion.getByLabel("Göster")).toHaveValue("20");
    await expect.poll(() => captured.messageTemplates.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.messageTemplates.at(-1)?.get("q")).toBe("hafta");
    await expect.poll(() => captured.messageTemplates.at(-1)?.get("sort")).toBe("-name");

    await templatesRegion.getByRole("button", { name: "Şablon ekle" }).click();
    const templateDialog = page.getByRole("dialog", { name: "Şablon ekle" });
    await expect(templateDialog.locator(".uh-field")).toHaveCount(2);
    await expect(templateDialog.locator(".uh-textarea")).toHaveCount(1);
    await expect(templateDialog.getByRole("textbox", { name: /^Mesaj metni / })).toBeVisible();
    await templateDialog.getByRole("button", { name: "Vazgeç" }).click();

    await templatesRegion.getByLabel("Ara").fill("veli");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("veli");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");
  });

  test("materyal ve ödev listeleri URL state namespace ile ayrılır", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(
      page,
      captured,
      "/kurum/materyaller?homeworkPage=2&homeworkLimit=20&homeworkQ=kesir&homeworkSort=-checkedAt&materialsPage=3&materialsLimit=5&materialsQ=problem&materialsSort=title",
    );

    const homeworkRegion = page.getByLabel("Ödev kontrolü");
    const materialRegion = page.getByLabel("Materyal listesi");
    const materialSummary = homeworkRegion.getByRole("region", { exact: true, name: "Materyal operasyon özeti" });

    await expect(materialSummary).toContainText("Kontrol bekleyen");
    await expect(materialSummary).toContainText("Materyal detayı");
    await expect(materialSummary.getByLabel("Materyal operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(homeworkRegion.getByLabel("Ara")).toHaveValue("kesir");
    await expect(homeworkRegion.getByLabel("Sırala")).toHaveValue("-checkedAt");
    await expect(homeworkRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(materialRegion.getByLabel("Ara")).toHaveValue("problem");
    await expect(materialRegion.getByLabel("Sırala")).toHaveValue("title");
    await expect(materialRegion.getByLabel("Göster")).toHaveValue("5");
    await expect.poll(() => captured.homework.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.homework.at(-1)?.get("q")).toBe("kesir");
    await expect.poll(() => captured.homework.at(-1)?.get("sort")).toBe("-checkedAt");
    await expect.poll(() => captured.homeworkMaterials.at(-1)?.get("page")).toBe("3");
    await expect.poll(() => captured.homeworkMaterials.at(-1)?.get("q")).toBe("problem");
    await expect.poll(() => captured.homeworkMaterials.at(-1)?.get("sort")).toBe("title");

    await materialRegion.getByRole("button", { name: "Materyal ekle" }).click();
    const materialDialog = page.getByRole("dialog", { name: "Materyal ekle" });
    await expect(materialDialog.locator(".uh-field")).toHaveCount(2);
    await expect(materialDialog.locator(".uh-textarea")).toHaveCount(1);
    await expect(materialDialog.getByRole("textbox", { name: /^Açıklama / })).toBeVisible();
    await materialDialog.getByRole("button", { name: "Vazgeç" }).click();

    await materialRegion.getByLabel("Ara").fill("problem çöz");
    await expect.poll(() => new URL(page.url()).searchParams.get("homeworkQ")).toBe("kesir");
    await expect.poll(() => new URL(page.url()).searchParams.get("materialsQ")).toBe("problem çöz");
    await expect.poll(() => new URL(page.url()).searchParams.get("materialsPage")).toBe("1");
  });

  test("öğrenci listesi mobil operasyon sözleşmesini korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await page.setViewportSize({ height: 844, width: 390 });
    await openWithListMocks(
      page,
      captured,
      "/kurum/ogrenciler?page=2&limit=20&q=ada&sort=-lastName&classId=class-11a&level=grade-11&responsibleTeacherId=teacher-a&status=ACTIVE&guardianLinked=true&density=compact&columns=name,class,status,actions",
    );

    const studentsRegion = page.getByLabel("Öğrenci yönetimi");
    const studentSummary = studentsRegion.getByRole("region", { exact: true, name: "Öğrenci operasyon özeti" });
    const filters = page.getByLabel("Öğrenci filtreleri");
    const tableView = page.getByLabel("Öğrenci tablo görünümü");
    const bulkTransition = page.getByLabel("Toplu dönem geçişi");
    await expect(studentsRegion.getByRole("table", { name: "Öğrenci listesi" })).toBeVisible();
    await expect(page.getByText("Filtreler ve görünüm", { exact: true })).toBeVisible();
    await expect(page.getByText("Toplu işlemler", { exact: true })).toBeVisible();
    await page.getByText("Filtreler ve görünüm", { exact: true }).click();
    await page.getByText("Toplu işlemler", { exact: true }).click();
    await expect(studentSummary).toContainText("Öğrenci toplamı");
    await expect(studentSummary).toContainText("Sınıf kapsamı");
    await expect(studentSummary).toContainText("Veli: Bağlı");
    await expect(studentSummary.getByLabel("Öğrenci operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(studentSummary).toContainText("Sorumlu öğretmen");
    await expect(studentSummary).toContainText("Toplu dönem geçişi");
    await expect(filters.locator(".uh-field")).toHaveCount(5);
    await expect(filters.locator(".uh-select")).toHaveCount(5);
    await expect(filters.getByRole("combobox").nth(0)).toHaveValue("class-11a");
    await expect(filters.getByRole("combobox").nth(1)).toHaveValue("grade-11");
    await expect(tableView.locator(".uh-checkbox")).toHaveCount(6);
    await expect(tableView.getByLabel("Görünüm")).toHaveValue("compact");
    await expect(bulkTransition.locator(".uh-field")).toHaveCount(3);
    await expect(bulkTransition.locator(".uh-select")).toHaveCount(2);
    await expect(bulkTransition.locator(".uh-checkbox")).toHaveCount(1);
    await expect(bulkTransition.getByLabel("Geçiş tarihi")).toBeVisible();
    await expect(bulkTransition.getByLabel("Otomatik seviye yükselt")).toBeVisible();

    await filters.getByLabel("Veli").selectOption("false");
    await expect.poll(() => new URL(page.url()).searchParams.get("guardianLinked")).toBe("false");
    await tableView.getByLabel("Okul No").check();
    await expect.poll(() => new URL(page.url()).searchParams.get("columns")).toContain("studentNo");

    for (const value of ["12345678901", "5554443322", "+905551234567", "ada.kaya@example.test"]) {
      await expect(studentsRegion).not.toContainText(value);
    }
    await expectNoHorizontalOverflow(page, "student-list-mobile");
    await expectNoUnlabeledControls(page, "student-list-mobile");
    await expectNoClippedVisibleText(page, "student-list-mobile");
  });

  test("kurum kişi yönetimi ekranları mobil ve tablet operasyon sözleşmesini korur", async ({ page }) => {
    for (const viewport of [
      { height: 844, label: "mobile", width: 390 },
      { height: 1024, label: "tablet", width: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const qaLabel = viewport.label === "mobile" ? "people-management-mobile" : "people-management-tablet";

      const captured = createCapturedRequests();
      await openWithListMocks(page, captured, "/kurum/ogrenciler?density=compact&columns=name,class,status,actions&guardianLinked=true");
      const studentsRegion = page.getByLabel("Öğrenci yönetimi");
      const studentSummary = studentsRegion.getByRole("region", { exact: true, name: "Öğrenci operasyon özeti" });
      await expect(studentSummary).toContainText("Aktif kayıt");
      await expect(studentSummary).toContainText("Tablo görünümü");
      await expect(studentSummary).toContainText("Toplu geçiş: manuel");
      await expect(studentSummary).toContainText("Sınıf eşleştirme");
      await expect(studentsRegion.getByRole("table", { name: "Öğrenci listesi" })).toBeVisible();
      await expect(studentsRegion.getByRole("link", { name: "Ada öğrenci dashboard" })).toBeVisible();
      await expect(studentsRegion.getByRole("button", { name: "Ada düzenle" })).toBeVisible();
      await expect(studentsRegion.getByRole("button", { name: "Ada sil" })).toBeVisible();
      await expect(page.getByLabel("Öğrenci tablo görünümü").getByLabel("Görünüm")).toHaveValue("compact");

      await openWithListMocks(page, captured, "/kurum/veliler?page=1&limit=10&q=zeynep&sort=lastName");
      const guardiansRegion = page.getByLabel("Veli yönetimi");
      const guardianSummary = guardiansRegion.getByRole("region", { exact: true, name: "Veli operasyon özeti" });
      await expect(guardianSummary).toContainText("Maskeli iletişim");
      await expect(guardianSummary).toContainText("Portal hazır");
      await expect(guardianSummary).toContainText("PII modu");
      await expect(guardianSummary).toContainText("Telefon varsayılan maskeli");
      await expect(guardianSummary).toContainText("İletişim temizliği");
      await expect(guardianSummary).toContainText("Portal bağlantısı");
      await expect(guardiansRegion.getByRole("table", { name: "Veli operasyon listesi" })).toBeVisible();
      await expect(guardiansRegion.getByRole("link", { name: "Zeynep detay" })).toBeVisible();
      await expect(guardiansRegion.getByRole("button", { name: "Zeynep düzenle" })).toBeVisible();
      await expect(guardiansRegion.getByRole("button", { name: "Zeynep sil" })).toBeVisible();
      await expect(guardiansRegion).not.toContainText("5554443322");
      await expect(guardiansRegion).toContainText("••• ••• ••22");

      await openWithListMocks(page, captured, "/kurum/ogretmenler?page=1&limit=10&q=mat&sort=-firstName");
      const teachersRegion = page.getByLabel("Öğretmen yönetimi");
      const teacherSummary = teachersRegion.getByRole("region", { exact: true, name: "Öğretmen operasyon özeti" });
      await expect(teacherSummary).toContainText("Branş kapsamı");
      await expect(teacherSummary).toContainText("Portal hazır");
      await expect(teacherSummary).toContainText("Atama bağlamı");
      await expect(teacherSummary).toContainText("Portal hesabı");
      await expect(teacherSummary).toContainText("Branş temizliği");
      await expect(teacherSummary).toContainText("Atama referansı");
      const teachersTable = teachersRegion.getByRole("table", { name: "Öğretmen operasyon listesi" });
      await expect(teachersTable).toBeVisible();
      await expect(teachersTable.getByText("TC + telefon bekliyor")).toBeVisible();
      await expect(teachersRegion.getByRole("link", { name: "Zeynep detay" })).toBeVisible();

      for (const value of ["12345678901", "+905551234567", "ada.kaya@example.test", "5554443322"]) {
        await expect(page.locator("body")).not.toContainText(value);
      }

      await expectNoHorizontalOverflow(page, qaLabel);
      await expectNoUnlabeledControls(page, qaLabel);
      await expectNoClippedVisibleText(page, qaLabel);
    }
  });

  test("akademik takvim mobil ve tablet yönetim sözleşmesini korur", async ({ page }) => {
    for (const viewport of [
      { height: 844, label: "mobile", width: 390 },
      { height: 1024, label: "tablet", width: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const qaLabel = viewport.label === "mobile" ? "academic-calendar-mobile" : "academic-calendar-tablet";
      const captured = createCapturedRequests();

      await openWithListMocks(
        page,
        captured,
        "/kurum/akademik-takvim?yearsPage=2&yearsLimit=20&yearsQ=2025&yearsSort=-startsAt&termsPage=2&termsLimit=5&termsQ=donem&termsSort=name",
      );

      const yearsRegion = page.getByLabel("Akademik yıl yönetimi");
      const termsRegion = page.getByLabel("Akademik dönem yönetimi");
      const yearSummary = yearsRegion.getByRole("region", { exact: true, name: "Akademik yıl operasyon özeti" });
      const termSummary = termsRegion.getByRole("region", { exact: true, name: "Akademik dönem operasyon özeti" });

      await expect(yearsRegion.getByRole("heading", { name: "Akademik Takvim" })).toBeVisible();
      await expect(yearSummary).toContainText("Akademik yıl toplamı");
      await expect(yearSummary).toContainText("Aktif yıl kontrolü");
      await expect(yearSummary).toContainText("Yıl listesi URL state");
      await expect(yearSummary.getByLabel("Akademik yıl operasyon özeti aksiyon kuyruğu")).toBeVisible();
      await expect(yearsRegion.getByRole("table", { name: "Akademik yıl takvimi" })).toBeVisible();
      await expect(yearsRegion.getByText("2025-2026")).toBeVisible();
      await expect(yearsRegion.getByRole("row", { name: /2025-2026/ }).getByText("Aktif", { exact: true })).toBeVisible();
      await expect(yearsRegion.getByLabel("Ara")).toHaveValue("2025");
      await expect(yearsRegion.getByLabel("Sırala")).toHaveValue("-startsAt");
      await expect(yearsRegion.getByLabel("Göster")).toHaveValue("20");
      await expect(yearsRegion.getByRole("button", { name: "2025-2026 yılını düzenle" })).toBeVisible();
      await expect(yearsRegion.getByRole("button", { name: "2025-2026 yılını sil" })).toBeVisible();

      await yearsRegion.getByRole("button", { name: "Akademik yıl ekle" }).click();
      const yearDialog = page.getByRole("dialog", { name: "Akademik yıl ekle" });
      await expect(yearDialog.locator(".uh-checkbox")).toHaveCount(1);
      await expect(yearDialog.getByRole("checkbox", { name: "Aktif akademik yıl" })).toBeVisible();
      await expect(yearDialog).toContainText("Ders programı, yoklama ve rapor bağlamında varsayılan yıl olur.");
      await yearDialog.getByRole("button", { name: "Vazgeç" }).click();

      await expect(termsRegion.getByRole("heading", { name: "Dönemler" })).toBeVisible();
      await expect(termSummary).toContainText("Dönem toplamı");
      await expect(termSummary).toContainText("Aktif dönem kontrolü");
      await expect(termSummary).toContainText("Dönem ekleme hazır");
      await expect(termSummary.getByLabel("Akademik dönem operasyon özeti aksiyon kuyruğu")).toBeVisible();
      await expect(termsRegion.getByRole("table", { name: "Akademik dönem takvimi" })).toBeVisible();
      await expect(termsRegion.getByText("2. Donem")).toBeVisible();
      await expect(termsRegion).toContainText("2025-2026");
      await expect(termsRegion).not.toContainText("academic-year-2026");
      await expect(termsRegion.getByLabel("Ara")).toHaveValue("donem");
      await expect(termsRegion.getByLabel("Sırala")).toHaveValue("name");
      await expect(termsRegion.getByLabel("Göster")).toHaveValue("5");
      await expect(termsRegion.getByRole("button", { name: "Dönem ekle" })).toBeEnabled();
      await expect(termsRegion.getByRole("button", { name: "2. Donem dönemini düzenle" })).toBeVisible();
      await expect(termsRegion.getByRole("button", { name: "2. Donem dönemini sil" })).toBeVisible();

      await termsRegion.getByRole("button", { name: "Dönem ekle" }).click();
      const termDialog = page.getByRole("dialog", { name: "Dönem ekle" });
      await expect(termDialog.getByLabel("Akademik yıl")).toHaveValue("academic-year-2026");
      await expect(termDialog.getByLabel("Dönem adı")).toBeVisible();
      await expect(termDialog.getByLabel("Başlangıç")).toBeVisible();
      await expect(termDialog.getByLabel("Bitiş")).toBeVisible();
      await expect(termDialog.locator(".uh-checkbox")).toHaveCount(1);
      await expect(termDialog.getByRole("checkbox", { name: "Aktif dönem" })).toBeVisible();
      await expect(termDialog).toContainText("Not, yoklama ve karne akışlarında varsayılan dönem olur.");

      await expect.poll(() => captured.academicYears.at(-1)?.get("page")).toBe("2");
      await expect.poll(() => captured.academicYears.at(-1)?.get("q")).toBe("2025");
      await expect.poll(() => captured.academicTerms.at(-1)?.get("limit")).toBe("5");
      await expect.poll(() => captured.academicTerms.at(-1)?.get("sort")).toBe("name");

      await expectNoHorizontalOverflow(page, qaLabel);
      await expectNoUnlabeledControls(page, qaLabel);
      await expectNoClippedVisibleText(page, qaLabel);
    }
  });

  test("akademik yapı referans ekranları mobil ve tablet operasyon sözleşmesini korur", async ({ page }) => {
    test.setTimeout(90_000);

    for (const viewport of [
      { height: 844, label: "mobile", width: 390 },
      { height: 1024, label: "tablet", width: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const captured = createCapturedRequests();
      const screens = [
        {
          actionTexts: ["Referans eşleşmesi", "Kampüs dağılımı", "Bu sayfada şube"],
          deleteButtonName: "11-A sil",
          editButtonName: "11-A düzenle",
          path: "/kurum/siniflar?page=2&limit=20&q=8&sort=-name",
          queryLog: () => captured.classes,
          regionLabel: "Sınıf yönetimi",
          searchValue: "8",
          sortValue: "-name",
          summaryName: "Sınıf operasyon özeti",
          tableName: "Sınıf eğitim yapısı",
        },
        {
          actionTexts: ["Kod temizliği", "Program bağı", "Rapor eşleşmesi"],
          deleteButtonName: "Matematik sil",
          editButtonName: "Matematik düzenle",
          path: "/kurum/dersler?page=2&limit=20&q=mat&sort=code",
          queryLog: () => captured.courses,
          regionLabel: "Ders yönetimi",
          searchValue: "mat",
          sortValue: "code",
          summaryName: "Ders operasyon özeti",
          tableName: "Ders eğitim yapısı",
        },
        {
          actionTexts: ["Kod temizliği", "Kurum yapısı", "Rapor filtresi"],
          deleteButtonName: "Merkez Kampüs sil",
          editButtonName: "Merkez Kampüs düzenle",
          path: "/kurum/kampusler?page=2&limit=20&q=merkez&sort=-code",
          queryLog: () => captured.campuses,
          regionLabel: "Kampüs yönetimi",
          searchValue: "merkez",
          sortValue: "-code",
          summaryName: "Kampüs operasyon özeti",
          tableName: "Kampüs eğitim yapısı",
        },
        {
          actionTexts: ["Kod temizliği", "Sınıf eşleşmesi", "Rapor filtresi"],
          deleteButtonName: "11. Sınıf sil",
          editButtonName: "11. Sınıf düzenle",
          path: "/kurum/seviyeler?page=2&limit=20&q=11&sort=code",
          queryLog: () => captured.gradeLevels,
          regionLabel: "Seviye yönetimi",
          searchValue: "11",
          sortValue: "code",
          summaryName: "Seviye operasyon özeti",
          tableName: "Seviye eğitim yapısı",
        },
      ];

      for (const screen of screens) {
        await openWithListMocks(page, captured, screen.path);

        const region = page.getByLabel(screen.regionLabel);
        const summary = region.getByRole("region", { exact: true, name: screen.summaryName });
        await expect(summary.getByLabel(`${screen.summaryName} aksiyon kuyruğu`)).toBeVisible();
        for (const actionText of screen.actionTexts) {
          await expect(summary).toContainText(actionText);
        }
        const listControls = region.getByRole("group", { name: "Liste kontrolleri" });
        await expect(listControls).toBeVisible();
        await expect(listControls.getByLabel("Ara")).toHaveValue(screen.searchValue);
        await expect(listControls.getByLabel("Sırala")).toHaveValue(screen.sortValue);
        await expect(listControls.getByLabel("Göster")).toHaveValue("20");

        const table = region.getByRole("table", { name: screen.tableName });
        await expect(table).toBeVisible();
        await expect(table.locator('th[data-column-key="name"]')).toHaveAttribute("data-mobile-priority", "primary");
        await expect(table.locator('th[data-column-key="actions"]')).toHaveAttribute("data-mobile-priority", "primary");
        await expect(region.getByRole("button", { name: screen.editButtonName })).toBeVisible();
        await expect(region.getByRole("button", { name: screen.deleteButtonName })).toBeVisible();
        await expect.poll(() => screen.queryLog().at(-1)?.get("page")).toBe("2");
        await expect.poll(() => screen.queryLog().at(-1)?.get("limit")).toBe("20");

        const qaLabel = `academic-structure-${screen.tableName}-${viewport.label}`;
        await expectNoHorizontalOverflow(page, qaLabel);
        await expectNoUnlabeledControls(page, qaLabel);
        await expectNoClippedVisibleText(page, qaLabel);
      }
    }
  });

  test("öğrenci edit formu kayıtlı PII değerlerini ham göstermeden maskeler", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/ogrenciler?page=1&limit=10&q=ada");

    const studentsRegion = page.getByLabel("Öğrenci yönetimi");
    await studentsRegion.getByRole("button", { name: "Ada düzenle" }).click();
    const studentDialog = page.getByRole("dialog", { name: "Öğrenci düzenle" });
    await expect(studentDialog.getByRole("textbox", { name: /^Telefon\b/ })).toBeVisible();
    await expect(studentDialog.getByText("Kayıtlı: ••• ••• ••67")).toBeVisible();
    await expect(studentDialog.getByText(/Kayıtlı: ad•+@example\.test/)).toBeVisible();

    for (const value of ["12345678901", "+905551234567", "ada.kaya@example.test", "5554443322"]) {
      await expect(studentDialog).not.toContainText(value);
    }
  });

  test("veli listesi telefon PII'sini maskeli tutar", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/veliler?page=1&limit=10&q=zeynep&sort=lastName");

    const guardiansRegion = page.getByLabel("Veli yönetimi");
    const guardianSummary = guardiansRegion.getByRole("region", { exact: true, name: "Veli operasyon özeti" });
    await expect(guardianSummary).toContainText("PII modu");
    await expect(guardianSummary).toContainText("Telefon varsayılan maskeli");
    await expect(guardianSummary.getByLabel("Veli operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(guardianSummary).toContainText("İletişim temizliği");
    await expect(guardianSummary).toContainText("Portal bağlantısı");
    await expect(guardiansRegion.getByRole("heading", { name: "Veliler" })).toBeVisible();
    await expect(guardiansRegion.getByLabel("Ara")).toHaveAttribute("placeholder", "Ad veya soyad ara");
    await expect(guardiansRegion.getByLabel("Sırala")).not.toContainText("Telefon");
    await expect(guardiansRegion.getByText("Zeynep Veli")).toBeVisible();
    await expect(guardiansRegion.getByText("5554443322")).toHaveCount(0);
    await expect(guardiansRegion.getByText("••• ••• ••22")).toBeVisible();
    await expect.poll(() => captured.guardians.at(-1)?.get("q")).toBe("zeynep");
  });

  test("etüt listesi URL state ve operasyon özetini korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/etutler?page=2&limit=20&q=kesir&sort=-startsAt");

    const studyRegion = page.getByLabel("Etüt yönetimi");
    const studySummary = studyRegion.getByRole("region", { exact: true, name: "Etüt operasyon özeti" });
    const studyTable = studyRegion.getByRole("table", { name: "Etüt operasyon listesi" });

    await expect(studySummary).toContainText("Etüt toplamı");
    await expect(studySummary).toContainText("Kapasite kontrolü");
    await expect(studySummary).toContainText("Öğrenci ataması");
    await expect(studySummary.getByLabel("Etüt operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(studyRegion.getByLabel("Ara")).toHaveValue("kesir");
    await expect(studyRegion.getByLabel("Sırala")).toHaveValue("-startsAt");
    await expect(studyRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(studyTable).toContainText("Kesir etüdü");
    await expect(studyTable).toContainText("11-A");
    await expect(studyTable).toContainText("1/8");
    await expect(studyTable.locator('th[data-column-key="title"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(studyTable.locator('th[data-column-key="studentIds"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(studyTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expect.poll(() => captured.studySessions.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.studySessions.at(-1)?.get("limit")).toBe("20");
    await expect.poll(() => captured.studySessions.at(-1)?.get("q")).toBe("kesir");
    await expect.poll(() => captured.studySessions.at(-1)?.get("sort")).toBe("-startsAt");

    await studyRegion.getByLabel("Ara").fill("problem");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("problem");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");

    for (const value of ["study-session-a", "class-11a", "course-math", "term-2026-spring", "teacher-a", "student-a", "tenant-list-url"]) {
      await expect(studyRegion).not.toContainText(value);
    }
  });

  test("ders programı listesi URL state ve operasyon özetini korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/program?page=2&limit=20&q=geometri&sort=startsAt");

    const programRegion = page.getByLabel("Ders programı yönetimi");
    const programSummary = programRegion.getByRole("region", { exact: true, name: "Ders programı operasyon özeti" });
    const programTable = programRegion.getByRole("table", { name: "Ders programı operasyon listesi" });

    await expect(programSummary).toContainText("Program toplamı");
    await expect(programSummary).toContainText("Saat planı");
    await expect(programSummary).toContainText("Ders eşleşmesi");
    await expect(programSummary.getByLabel("Ders programı operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(programRegion.getByLabel("Ara")).toHaveValue("geometri");
    await expect(programRegion.getByLabel("Sırala")).toHaveValue("startsAt");
    await expect(programRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(programTable).toContainText("Geometri tekrar");
    await expect(programTable).toContainText("11-A");
    await expect(programTable).toContainText("Matematik");
    await expect(programTable.locator('th[data-column-key="title"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(programTable.locator('th[data-column-key="termId"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(programTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expect.poll(() => captured.scheduleLessons.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.scheduleLessons.at(-1)?.get("limit")).toBe("20");
    await expect.poll(() => captured.scheduleLessons.at(-1)?.get("q")).toBe("geometri");
    await expect.poll(() => captured.scheduleLessons.at(-1)?.get("sort")).toBe("startsAt");

    await programRegion.getByLabel("Ara").fill("analitik");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("analitik");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");

    for (const value of ["schedule-lesson-a", "class-11a", "course-math", "term-2026-spring", "teacher-a", "tenant-list-url"]) {
      await expect(programRegion).not.toContainText(value);
    }
  });

  test("kazanım listesi URL state ve operasyon özetini korur", async ({ page }) => {
    const captured = createCapturedRequests();
    await openWithListMocks(page, captured, "/kurum/kazanimlar?page=2&limit=20&q=kesir&sort=-code");

    const outcomeRegion = page.getByLabel("Kazanım yönetimi");
    const outcomeSummary = outcomeRegion.getByRole("region", { exact: true, name: "Kazanım operasyon özeti" });
    const outcomeTable = outcomeRegion.getByRole("table", { name: "Kazanım katalog listesi" });

    await expect(outcomeSummary).toContainText("Kazanım toplamı");
    await expect(outcomeSummary).toContainText("Branş kapsamı");
    await expect(outcomeSummary).toContainText("Kod standardı");
    await expect(outcomeSummary.getByLabel("Kazanım operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(outcomeRegion.getByLabel("Ara")).toHaveValue("kesir");
    await expect(outcomeRegion.getByLabel("Sırala")).toHaveValue("-code");
    await expect(outcomeRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(outcomeTable).toContainText("M.5.1.1");
    await expect(outcomeTable).toContainText("Matematik");
    await expect(outcomeTable).toContainText("Kesirleri karşılaştırır");
    await expect(outcomeTable.locator('th[data-column-key="code"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(outcomeTable.locator('th[data-column-key="level"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(outcomeTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expect.poll(() => captured.learningOutcomes.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.learningOutcomes.at(-1)?.get("limit")).toBe("20");
    await expect.poll(() => captured.learningOutcomes.at(-1)?.get("q")).toBe("kesir");
    await expect.poll(() => captured.learningOutcomes.at(-1)?.get("sort")).toBe("-code");

    await outcomeRegion.getByRole("button", { name: "Kazanım ekle" }).click();
    const outcomeDialog = page.getByRole("dialog", { name: "Kazanım ekle" });
    await expect(outcomeDialog.locator(".uh-field")).toHaveCount(4);
    await expect(outcomeDialog.getByRole("textbox", { name: "Kazanım kodu" })).toBeVisible();
    await outcomeDialog.getByRole("button", { name: "Vazgeç" }).click();

    await outcomeRegion.getByLabel("Ara").fill("oran");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("oran");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");

    for (const value of ["learning-outcome-a", "tenant-list-url"]) {
      await expect(outcomeRegion).not.toContainText(value);
    }
  });
});

async function openWithListMocks(page: Page, captured: CapturedRequests, path: string) {
  await installListApiMocks(page, captured);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
}

function createCapturedRequests(): CapturedRequests {
  return {
    academicTerms: [],
    academicYears: [],
    announcements: [],
    campuses: [],
    classes: [],
    courses: [],
    gradeLevels: [],
    guardians: [],
    homework: [],
    homeworkMaterials: [],
    invitations: [],
    invitationCreates: [],
    invitationResends: [],
    learningOutcomes: [],
    messageTemplates: [],
    paymentPlans: [],
    roleUpdates: [],
    scheduleLessons: [],
    students: [],
    studySessions: [],
    supportTickets: [],
    teachers: [],
    users: [],
  };
}

async function installListApiMocks(page: Page, captured: CapturedRequests) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");

    if (pathName === "/auth/refresh") {
      await fulfillData(route, createAuthResponse());
      return;
    }
    if (pathName === "/me/tenant") {
      await fulfillData(route, createTenantResponse());
      return;
    }
    if (pathName === "/me/notification-devices") {
      await fulfillData(route, []);
      return;
    }
    if (pathName.startsWith("/tenant-users/") && pathName.endsWith("/roles") && route.request().method() === "PATCH") {
      const userId = pathName.replace("/tenant-users/", "").replace("/roles", "");
      captured.roleUpdates.push({
        authorization: route.request().headers().authorization,
        body: route.request().postDataJSON(),
        userId,
      });
      await fulfillData(route, { ...createTenantUser(), id: userId, roles: route.request().postDataJSON().roles ?? [] });
      return;
    }
    if (pathName === "/tenant-users" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      await fulfillData(route, { ...createTenantUser(), ...body, id: "tenant-user-created" });
      return;
    }
    if (pathName === "/tenant-users") {
      captured.users.push(new URLSearchParams(url.search));
      await fulfillList(route, [createTenantUser()], url.searchParams);
      return;
    }
    if (pathName === "/identity-invitations" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      captured.invitationCreates.push({
        authorization: route.request().headers().authorization,
        body,
      });
      await fulfillData(route, {
        activationToken: "activation-token-created-secret",
        invitation: {
          ...createInvitation(),
          ...body,
          id: "invitation-created",
          role: body.subjectType,
          status: "PENDING",
        },
      });
      return;
    }
    if (pathName.startsWith("/identity-invitations/") && pathName.endsWith("/resend") && route.request().method() === "POST") {
      const id = pathName.replace("/identity-invitations/", "").replace("/resend", "");
      captured.invitationResends.push({
        authorization: route.request().headers().authorization,
        id,
      });
      await fulfillData(route, {
        activationToken: "activation-token-resent-secret",
        invitation: createInvitation(),
      });
      return;
    }
    if (pathName === "/identity-invitations") {
      captured.invitations.push(new URLSearchParams(url.search));
      await fulfillList(route, [createInvitation()], url.searchParams);
      return;
    }
    if (pathName === "/students") {
      if (url.searchParams.has("page")) {
        captured.students.push(new URLSearchParams(url.search));
        await fulfillList(route, [createStudent()], url.searchParams);
        return;
      }
      await fulfillData(route, [createStudent()]);
      return;
    }
    if (pathName === "/students/student-a/profile") {
      await fulfillData(route, createStudentProfile());
      return;
    }
    if (pathName === "/students/student-a/guardians") {
      await fulfillData(route, [createGuardian()]);
      return;
    }
    if (pathName === "/students/student-a/class-history" || pathName === "/students/student-a/enrollments") {
      await fulfillData(route, []);
      return;
    }
    if (pathName === "/teachers") {
      if (!url.searchParams.has("page")) {
        await fulfillData(route, [createTeacher()]);
        return;
      }
      captured.teachers.push(new URLSearchParams(url.search));
      await fulfillList(route, [createTeacher()], url.searchParams);
      return;
    }
    if (pathName === "/classes") {
      if (url.searchParams.has("page")) {
        captured.classes.push(new URLSearchParams(url.search));
        await fulfillList(route, [createClass()], url.searchParams);
        return;
      }
      await fulfillData(route, [createClass()]);
      return;
    }
    if (pathName === "/campuses") {
      if (url.searchParams.has("page")) {
        captured.campuses.push(new URLSearchParams(url.search));
        await fulfillList(route, [createCampus()], url.searchParams);
        return;
      }
      await fulfillData(route, [createCampus()]);
      return;
    }
    if (pathName === "/grade-levels") {
      if (url.searchParams.has("page")) {
        captured.gradeLevels.push(new URLSearchParams(url.search));
        await fulfillList(route, [createGradeLevel()], url.searchParams);
        return;
      }
      await fulfillData(route, [createGradeLevel()]);
      return;
    }
    if (pathName === "/courses") {
      if (url.searchParams.has("page")) {
        captured.courses.push(new URLSearchParams(url.search));
        await fulfillList(route, [createCourse()], url.searchParams);
        return;
      }
      await fulfillData(route, [createCourse()]);
      return;
    }
    if (pathName === "/guardians") {
      captured.guardians.push(new URLSearchParams(url.search));
      await fulfillList(route, [createGuardian()], url.searchParams);
      return;
    }
    if (pathName === "/academic-years") {
      captured.academicYears.push(new URLSearchParams(url.search));
      await fulfillList(route, [createAcademicYear()], url.searchParams);
      return;
    }
    if (pathName === "/academic-terms") {
      captured.academicTerms.push(new URLSearchParams(url.search));
      await fulfillList(route, [createAcademicTerm()], url.searchParams);
      return;
    }
    if (pathName === "/payment-plans") {
      captured.paymentPlans.push(new URLSearchParams(url.search));
      await fulfillList(route, [createPaymentPlan()], url.searchParams);
      return;
    }
    if (pathName === "/support-tickets") {
      captured.supportTickets.push(new URLSearchParams(url.search));
      await fulfillList(route, [createSupportTicket()], url.searchParams);
      return;
    }
    if (pathName === "/support-tickets/ticket-a/attachments" || pathName === "/support-tickets/ticket-a/comments") {
      await fulfillData(route, []);
      return;
    }
    if (pathName === "/announcements") {
      captured.announcements.push(new URLSearchParams(url.search));
      await fulfillList(route, [createAnnouncement()], url.searchParams);
      return;
    }
    if (pathName === "/message-templates") {
      captured.messageTemplates.push(new URLSearchParams(url.search));
      await fulfillList(route, [createMessageTemplate()], url.searchParams);
      return;
    }
    if (pathName === "/homework") {
      captured.homework.push(new URLSearchParams(url.search));
      await fulfillList(route, [createHomework()], url.searchParams);
      return;
    }
    if (pathName === "/homework/materials") {
      captured.homeworkMaterials.push(new URLSearchParams(url.search));
      await fulfillList(route, [createHomeworkMaterial()], url.searchParams);
      return;
    }
    if (pathName === "/homework/material-assignments") {
      await fulfillData(route, []);
      return;
    }
    if (pathName.startsWith("/homework/materials/") && (pathName.endsWith("/files") || pathName.endsWith("/assignments"))) {
      await fulfillData(route, []);
      return;
    }
    if (pathName === "/study-sessions") {
      captured.studySessions.push(new URLSearchParams(url.search));
      await fulfillList(route, [createStudySession()], url.searchParams);
      return;
    }
    if (pathName === "/schedule-lessons") {
      captured.scheduleLessons.push(new URLSearchParams(url.search));
      await fulfillList(route, [createScheduleLesson()], url.searchParams);
      return;
    }
    if (pathName === "/learning-outcomes") {
      captured.learningOutcomes.push(new URLSearchParams(url.search));
      await fulfillList(route, [createLearningOutcome()], url.searchParams);
      return;
    }

    await fulfillData(route, []);
  });
}

function createAuthResponse() {
  return {
    accessToken: "list-url-access-token",
    session: {
      id: "session-list-url",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-list-url",
      userId: "user-list-url-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@liste-akademi.example",
    id: "tenant-list-url",
    institutionType: "Dershane",
    name: "Liste Akademi",
  };
}

function createTenantUser() {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    email: "admin@liste-akademi.example",
    id: "tenant-user-a",
    name: "Admin Kullanıcı",
    roles: ["TEACHER"],
    tenantId: "tenant-list-url",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createInvitation() {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    email: "veli@liste-akademi.example",
    expiresAt: "2026-02-01T00:00:00.000Z",
    id: "invitation-a",
    name: "Veli Daveti",
    role: "GUARDIAN",
    status: "PENDING",
    subjectId: "guardian-a",
    subjectType: "GUARDIAN",
    tenantId: "tenant-list-url",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createTeacher() {
  return {
    branch: "Matematik",
    firstName: "Zeynep",
    id: "teacher-a",
    lastName: "Arslan",
    tenantId: "tenant-list-url",
  };
}

function createClass() {
  return {
    campusId: "campus-a",
    gradeLevelId: "grade-11",
    id: "class-11a",
    name: "11-A",
    section: "A",
    tenantId: "tenant-list-url",
  };
}

function createCampus() {
  return {
    code: "MRK",
    id: "campus-a",
    name: "Merkez Kampüs",
    tenantId: "tenant-list-url",
  };
}

function createGradeLevel() {
  return {
    code: "11",
    id: "grade-11",
    name: "11. Sınıf",
    tenantId: "tenant-list-url",
  };
}

function createCourse() {
  return {
    code: "MAT",
    id: "course-math",
    name: "Matematik",
    tenantId: "tenant-list-url",
  };
}

function createAcademicYear() {
  return {
    endsAt: "2026-06-30",
    id: "academic-year-2026",
    isActive: true,
    name: "2025-2026",
    startsAt: "2025-09-01",
    tenantId: "tenant-list-url",
  };
}

function createAcademicTerm() {
  return {
    academicYearId: "academic-year-2026",
    endsAt: "2026-06-30",
    id: "term-2026-spring",
    isActive: true,
    name: "2. Donem",
    startsAt: "2026-02-01",
    tenantId: "tenant-list-url",
  };
}

function createStudent() {
  return {
    classId: "class-11a",
    firstName: "Ada",
    id: "student-a",
    lastName: "Kaya",
    responsibleTeacherId: "teacher-a",
    status: "ACTIVE",
    studentNo: "1101",
    tenantId: "tenant-list-url",
  };
}

function createStudentProfile() {
  return {
    ...createStudent(),
    email: "ada.kaya@example.test",
    nationalIdMasked: "*********01",
    phone: "+905551234567",
  };
}

function createGuardian() {
  return {
    firstName: "Zeynep",
    id: "guardian-a",
    lastName: "Veli",
    phone: "5554443322",
    tenantId: "tenant-list-url",
  };
}

function createPaymentPlan() {
  return {
    campusId: "campus-a",
    classId: "class-11a",
    courseId: "course-math",
    createdAt: "2026-06-05T09:00:00.000Z",
    currency: "TRY",
    gradeLevelId: "grade-11",
    id: "payment-plan-a",
    installments: [
      {
        amount: 120000,
        createdAt: "2026-06-05T09:00:00.000Z",
        dueDate: "2026-07-01",
        id: "payment-installment-a-1",
        installmentNo: 1,
        planId: "payment-plan-a",
        status: "OVERDUE",
        tenantId: "tenant-list-url",
      },
    ],
    studentId: "student-a",
    tenantId: "tenant-list-url",
    termId: "term-2026-spring",
    title: "Haziran ödeme planı",
    totalAmount: 120000,
  };
}

function createAnnouncement() {
  return {
    audience: "GUARDIANS",
    body: "Haftalık sınav bilgilendirmesi.",
    campusId: "campus-a",
    classId: "class-11a",
    courseId: "course-math",
    gradeLevelId: "grade-11",
    id: "announcement-a",
    publishedAt: "2026-06-17T09:00:00.000Z",
    tenantId: "tenant-list-url",
    termId: "term-2026-spring",
    title: "Haftalık sınav duyurusu",
  };
}

function createMessageTemplate() {
  return {
    body: "Sayın veli, haftalık çalışma planı portala eklenmiştir.",
    channel: "SMS",
    id: "message-template-a",
    name: "Haftalık bilgilendirme",
    tenantId: "tenant-list-url",
  };
}

function createHomework() {
  return {
    checkedAt: null,
    id: "homework-a",
    sourceMaterialId: "material-a",
    sourceMaterialTitle: "Kesirler Çalışma Kağıdı",
    studentId: "student-a",
    tenantId: "tenant-list-url",
    title: "Kesirler tekrar",
  };
}

function createHomeworkMaterial() {
  return {
    description: "Kesirler kazanımı için kısa çalışma",
    id: "material-a",
    tenantId: "tenant-list-url",
    title: "Kesirler Çalışma Kağıdı",
  };
}

function createStudySession() {
  return {
    capacity: 8,
    classId: "class-11a",
    courseId: "course-math",
    endsAt: "2026-06-20T11:00:00.000Z",
    id: "study-session-a",
    startsAt: "2026-06-20T10:00:00.000Z",
    studentIds: ["student-a"],
    teacherId: "teacher-a",
    tenantId: "tenant-list-url",
    termId: "term-2026-spring",
    title: "Kesir etüdü",
  };
}

function createScheduleLesson() {
  return {
    classId: "class-11a",
    courseId: "course-math",
    endsAt: "2026-06-19T10:30:00.000Z",
    id: "schedule-lesson-a",
    startsAt: "2026-06-19T09:30:00.000Z",
    teacherId: "teacher-a",
    tenantId: "tenant-list-url",
    termId: "term-2026-spring",
    title: "Geometri tekrar",
  };
}

function createLearningOutcome() {
  return {
    branch: "Matematik",
    code: "M.5.1.1",
    id: "learning-outcome-a",
    level: "5",
    tenantId: "tenant-list-url",
    title: "Kesirleri karşılaştırır",
  };
}

function createSupportTicket() {
  return {
    campusId: "campus-a",
    classId: "class-11a",
    courseId: "course-math",
    createdAt: "2026-06-05T09:00:00.000Z",
    gradeLevelId: "grade-11",
    id: "ticket-a",
    message: "Optik dosya yukleme akisi kontrol edilmeli.",
    priority: "HIGH",
    requesterId: "guardian-a",
    status: "OPEN",
    studentId: "student-a",
    subject: "Optik destek bildirimi",
    tenantId: "tenant-list-url",
    termId: "term-2026-spring",
  };
}

async function fulfillList(route: Route, data: unknown[], searchParams: URLSearchParams) {
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "10");
  await fulfillData(route, data, {
    limit,
    page,
    total: 30,
    totalPages: Math.ceil(30 / limit),
  });
}

async function fulfillData(route: Route, data: unknown, meta?: { limit: number; page: number; total: number; totalPages: number }) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
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

    return Array.from(document.querySelectorAll("label, button, .uh-status-badge, .next-operation-summary__item, .next-operation-summary__action"))
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
