import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const smsEnabled = process.env.NEXT_PUBLIC_SMS_ENABLED === "true";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("DataTable mobil sözleşmesi", () => {
  test("öğrenci 360 modalı mobilde sınıf ve kayıt geçmişini tabloyla gösterir", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/ogrenciler");

    await page.getByRole("button", { name: "Ada düzenle" }).click();

    const student360 = page.getByLabel("Öğrenci 360");
    const student360Summary = student360.getByRole("region", { name: "Öğrenci 360 özeti" });
    await expect(student360Summary).toHaveClass(/uh-info-grid/);
    await expect(student360Summary.locator(".uh-info-item")).toHaveCount(11);
    await expect(student360.getByText("Devamsızlık")).toBeVisible();
    await expect(student360.getByText("Problem çözüm adımlarında takip yapılacak.")).toBeVisible();

    const classHistoryTable = student360.getByRole("table", { name: "Sınıf geçmişi" });
    await expect(classHistoryTable.getByRole("columnheader", { name: "Sınıf" })).toBeVisible();
    await expect(classHistoryTable.locator('th[data-column-key="class"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(classHistoryTable.locator('th[data-column-key="class"]')).toHaveAttribute("data-sticky", "left");
    await expectMobileDataCells(classHistoryTable, [
      { key: "class", label: "Sınıf", text: "8-A" },
      { key: "context", label: "Bağlam", text: "Ana Kampüs" },
      { key: "dates", label: "Tarih", text: "devam ediyor" },
    ]);

    const enrollmentTable = student360.getByRole("table", { name: "Kayıt geçmişi" });
    await expect(enrollmentTable.getByRole("columnheader", { name: "İşlem" })).toBeVisible();
    await expect(enrollmentTable.locator('th[data-column-key="reason"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(enrollmentTable.locator('th[data-column-key="reason"]')).toHaveAttribute("data-sticky", "left");
    await expect(enrollmentTable.locator('th[data-column-key="context"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(enrollmentTable).toContainText("Nakil");
    await expect(enrollmentTable).toContainText("9-B");
    await expect(enrollmentTable).toContainText("Sınıf eşleşmedi");
    await expect(enrollmentTable).toContainText("Dönem eşleşmedi");
    await expectMobileDetailCells(enrollmentTable, [
      { label: "Bağlam", text: "Akademik yıl eşleşmedi / Dönem eşleşmedi" },
    ]);

    await expectNoVisibleTextValues(page, "student-360-mobile", [
      "student-a",
      "guardian-a",
      "class-8a",
      "class-9b",
      "class-missing",
      "academic-year-2026",
      "academic-year-missing",
      "term-2026",
      "term-missing",
      "12345678901",
      "+905551110001",
      "ada.kaya@example.test",
    ]);
    await expectNoHorizontalOverflow(page, "student-360-mobile");
    await expectNoUnlabeledControls(page, "student-360-mobile");
    await expectNoClippedVisibleText(page, "student-360-mobile");
  });

  test("duyuru alıcı paneli mobilde taşmadan kalır", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/duyurular");

    const announcementSummary = page.getByRole("region", { exact: true, name: "Duyuru operasyon özeti" });
    await expect(announcementSummary).toContainText("Duyuru toplamı");
    if (smsEnabled) {
      await expect(announcementSummary).toContainText("SMS uygun");
    } else {
      await expect(announcementSummary).not.toContainText("SMS");
    }
    await expect(announcementSummary.getByLabel("Duyuru operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const announcementTable = page.getByRole("table", { name: "Duyuru yönetimi" });
    await expect(announcementTable.getByRole("columnheader", { name: "Başlık" })).toBeVisible();
    await expect(announcementTable.getByRole("columnheader", { name: "Kapsam" })).toHaveCount(0);
    await expect(announcementTable.locator('th[data-column-key="title"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(announcementTable.locator('th[data-column-key="scope"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(announcementTable.locator('th[data-column-key="recipients"]')).toHaveAttribute("data-sticky", "right");
    await expectMobileDataCells(announcementTable, [
      { key: "title", label: "Başlık", text: "Haftalık sınav duyurusu" },
      { key: "audience", label: "Hedef", text: "Veliler" },
    ]);
    const recipientsButton = announcementTable.getByRole("button", { name: "Alıcılar" });
    await recipientsButton.scrollIntoViewIfNeeded();
    await recipientsButton.click();
    await expect(announcementTable.getByRole("row", { name: /Haftalık sınav duyurusu/ })).toHaveClass(/next-announcement-row--selected/);

    const reportRegion = page.getByLabel("Duyuru alıcı raporu");
    await expect(reportRegion.locator(".uh-panel__body").first()).toBeVisible();
    const recipientMetrics = reportRegion.getByRole("region", { name: "Alıcı raporu özeti" });
    await expect(recipientMetrics.locator(".uh-metric-card")).toHaveCount(3);
    await expect(recipientMetrics).toContainText("Duyuru kapsamındaki kişi");
    await expect(recipientMetrics).toContainText("Bekleyen");
    await expect(reportRegion.locator(".next-announcement-recipient-metrics")).toHaveCount(0);
    const recipientsTable = reportRegion.getByRole("table", { name: "Duyuru alıcıları" });
    await expect(recipientsTable.getByRole("columnheader", { name: "Alıcı" })).toBeVisible();
    await expect(recipientsTable.getByText("Bekliyor")).toBeVisible();

    const smsRegion = page.getByLabel("Duyuru SMS gönderimi");
    if (smsEnabled) {
      await expect(smsRegion.getByLabel("SMS şablonu")).toBeVisible();
      await smsRegion.getByRole("button", { name: "SMS gönder" }).click();
      await expect(smsRegion.getByRole("status").filter({ hasText: "SMS kuyruğa alındı" })).toContainText("1 alıcı");
      const announcementDeliveryReport = smsRegion.getByLabel("SMS teslim raporu");
      const announcementDeliveryMetrics = announcementDeliveryReport.getByRole("region", { name: "SMS teslim metrikleri" });
      await expect(announcementDeliveryMetrics.locator(".uh-metric-card")).toHaveCount(5);
      await expect(announcementDeliveryReport.locator(".next-sms-delivery-metrics")).toHaveCount(0);
      await expect(announcementDeliveryReport).toContainText("Kuyrukta");
      await expect(announcementDeliveryReport).toContainText("Provider kabulü");
    } else {
      await expect(smsRegion).toHaveCount(0);
    }

    await expectNoVisibleTextValues(page, "duyuru-mobile", [
      "announcement-a",
      "guardian-a",
      "guardian-b",
      "student-a",
      "905551110001",
      "job-sms-a",
    ]);
    await expectNoHorizontalOverflow(page, "duyuru-mobile");
    await expectNoUnlabeledControls(page, "duyuru-mobile");
    await expectNoClippedVisibleText(page, "duyuru-mobile");
  });

  test("şablon SMS çalışma alanı env kapısına uyar", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/sablonlar");
    if (!smsEnabled) {
      await expect(page.getByLabel("Şablon yönetimi")).toHaveCount(0);
      await expect(page.getByRole("region", { name: "SMS gönderim" })).toHaveCount(0);
      return;
    }

    const templateRegion = page.getByLabel("Şablon yönetimi");
    const templateSummary = templateRegion.getByRole("region", { exact: true, name: "Şablon operasyon özeti" });
    await expect(templateSummary).toContainText("Şablon toplamı");
    await expect(templateSummary).toContainText("SMS hazır");
    await expect(templateSummary.getByLabel("Şablon operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(page.getByLabel("Aktarım şablonları").getByRole("link", { name: "Veli XLSX şablonu" })).toHaveAttribute("href", "/templates/veli-aktarim-sablonu.xlsx");
    const templateTable = templateRegion.getByRole("table", { name: "Şablon yönetimi" });
    await expect(templateTable.getByRole("columnheader", { name: "Şablon" })).toBeVisible();
    await expect(templateTable.getByRole("columnheader", { name: "Metin" })).toHaveCount(0);
    await expect(templateTable.locator('th[data-column-key="name"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(templateTable.locator('th[data-column-key="body"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(templateTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expectMobileDataCells(templateTable, [
      { key: "name", label: "Şablon", text: "Haftalık bilgilendirme" },
      { key: "channel", label: "Kanal", text: "SMS" },
    ]);

    const smsWorkflow = page.getByRole("region", { name: "SMS gönderim" });
    const smsMetrics = smsWorkflow.getByRole("region", { name: "SMS gönderim özeti" });
    await expect(smsMetrics.locator(".uh-metric-card")).toHaveCount(3);
    await expect(smsMetrics).toContainText("Gönderimde kullanılacak mesaj");
    await expect(smsWorkflow.locator(".next-sms-workflow-metrics")).toHaveCount(0);
    await expect(smsWorkflow.locator("form.next-form")).toHaveCount(0);
    await expect(smsWorkflow.locator(".uh-filter-bar")).toBeVisible();
    await expect(smsWorkflow.locator(".uh-field")).toHaveCount(9);
    await expect(smsWorkflow.locator(".uh-select")).toHaveCount(8);
    await expect(smsWorkflow.locator(".uh-textarea")).toHaveCount(1);
    const filterFields = smsWorkflow.locator(".uh-filter-bar .uh-field");
    await filterFields.nth(0).locator("select").selectOption("announcement-a");
    await expect(filterFields.nth(1).locator("select")).toHaveValue("campus-main");
    await expect(filterFields.nth(3).locator("select")).toHaveValue("class-8a");
    const previewRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/sms-batches/recipients/preview",
    );
    await smsWorkflow.getByRole("button", { name: "Alıcıları getir" }).click();
    expect(JSON.parse((await previewRequest).postData() ?? "{}")).toMatchObject({
      announcementId: "announcement-a",
      campusId: "campus-main",
      classId: "class-8a",
      studentStatus: "ACTIVE",
    });
    await expect(smsWorkflow.getByRole("region", { name: "SMS alıcı önizleme" })).toContainText("1 izinli veli");
    await expect(smsWorkflow.getByRole("table", { name: "SMS alıcı önizleme" })).toContainText("İzinli veli");
    await expect(smsWorkflow.getByRole("region", { name: "SMS alıcı önizleme" })).not.toContainText("Ayşe Yılmaz");
    await expect(smsWorkflow.getByLabel("SMS alıcıları")).toHaveValue("");
    await expect(smsWorkflow.getByLabel("SMS önizleme")).toContainText("1 alıcı");
    const sendRequest = page.waitForRequest(
      (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/sms-batches",
    );
    await smsWorkflow.getByRole("button", { name: "SMS gönder" }).click();
    expect(JSON.parse((await sendRequest).postData() ?? "{}")).toEqual({
      templateId: "template-a",
      recipients: [{ to: "905551110001" }],
    });
    await expect(smsWorkflow.getByRole("status").filter({ hasText: "SMS durumu" })).toContainText("1 alıcı");
    const templateDeliveryReport = smsWorkflow.getByLabel("SMS teslim raporu");
    const templateDeliveryMetrics = templateDeliveryReport.getByRole("region", { name: "SMS teslim metrikleri" });
    await expect(templateDeliveryMetrics.locator(".uh-metric-card")).toHaveCount(5);
    await expect(templateDeliveryReport.locator(".next-sms-delivery-metrics")).toHaveCount(0);
    await expect(templateDeliveryReport).toContainText("Kuyrukta");

    await expectNoVisibleTextValues(page, "sablon-mobile", [
      "template-a",
      "announcement-a",
      "guardian-a",
      "student-a",
      "905551110001",
      "job-sms-a",
    ]);
    await expectNoHorizontalOverflow(page, "sablon-mobile");
    await expectNoUnlabeledControls(page, "sablon-mobile");
    await expectNoClippedVisibleText(page, "sablon-mobile");
  });

  test("finans ödeme tablosu mobilde operasyon sözleşmesini korur", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/finans");

    const financeRegion = page.getByLabel("Finans yönetimi");
    const financeSummary = financeRegion.getByRole("region", { exact: true, name: "Finans operasyon özeti" });
    await expect(financeSummary).toContainText("Bekleyen ödeme");
    await expect(financeSummary).toContainText("Kurum finans görünümü");
    await expect(financeSummary.getByLabel("Finans operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const listControls = financeRegion.locator(".next-list-controls").last();
    const financeFilters = financeRegion.getByLabel("Finans filtreleri");
    await expect(listControls.locator(".uh-field")).toHaveCount(3);
    await expect(financeFilters).toBeVisible();
    await expect(financeFilters).toHaveClass(/uh-filter-bar/);
    await expect(financeFilters.locator(".uh-field")).toHaveCount(6);
    const installmentsTable = financeRegion.getByRole("table", { name: "Ödeme taksitleri" });
    await expect(installmentsTable.getByRole("columnheader", { name: "Öğrenci" })).toBeVisible();
    await expect(installmentsTable.getByRole("columnheader", { name: "Tutar" })).toBeVisible();
    await expect(installmentsTable.getByRole("columnheader", { name: "Bağlam" })).toHaveCount(0);
    await expectMobileDataCells(installmentsTable, [
      { key: "student", label: "Öğrenci", text: "Ada Kaya" },
      { key: "amount", label: "Tutar", text: "₺1.200,00" },
      { key: "status", label: "Durum", text: "Gecikmiş" },
    ]);
    await expect(installmentsTable.getByText("Ada Kaya")).toBeVisible();
    await expect(installmentsTable.getByText("₺1.200,00")).toBeVisible();
    await expect(installmentsTable.getByRole("button", { name: "Haziran ödeme planı 1. taksit ödendi işaretle" })).toBeVisible();

    await expectNoVisibleTextValues(page, "finance-mobile", [
      "120000",
      "student-a",
      "campus-main",
      "payment-plan-a",
      "12345678901",
      "+905551110001",
      "ada.kaya@example.test",
    ]);
    await expectNoHorizontalOverflow(page, "finance-mobile");
    await expectNoUnlabeledControls(page, "finance-mobile");
    await expectNoClippedVisibleText(page, "finance-mobile");
  });

  test("devamsızlık günlük operasyon tablosu mobilde özet ve URL state korur", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/devamsizlik?page=2&limit=20&q=ada&sort=-date&classId=class-8a");

    const attendanceRegion = page.getByLabel("Devamsızlık yönetimi");
    const attendanceSummary = attendanceRegion.getByRole("region", { exact: true, name: "Devamsızlık operasyon özeti" });
    await expect(attendanceSummary).toContainText("Yoklama toplamı");
    await expect(attendanceSummary).toContainText("Takip gerektiren");
    await expect(attendanceSummary).toContainText("Sınıf: 8-A");
    await expect(attendanceRegion.getByLabel("Ara")).toHaveValue("ada");
    await expect(attendanceRegion.getByLabel("Sırala")).toHaveValue("-date");
    await expect(attendanceRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(attendanceRegion.getByLabel("Sınıf")).toHaveValue("class-8a");
    const attendanceControls = attendanceRegion.getByRole("group", { name: "Liste kontrolleri" });
    await expect(attendanceControls.getByRole("button", { name: "Devamsızlık ekle" })).toBeVisible();

    const attendanceTable = attendanceRegion.getByRole("table", { name: "Devamsızlık operasyon listesi" });
    await expect(attendanceTable.getByRole("columnheader", { name: "Öğrenci" })).toBeVisible();
    await expect(attendanceTable.getByRole("columnheader", { name: "Durum" })).toBeVisible();
    await expect(attendanceTable.getByRole("columnheader", { name: "Dönem" })).toHaveCount(0);
    await expectMobileDataCells(attendanceTable, [
      { key: "studentId", label: "Öğrenci", text: "Ada Kaya" },
      { key: "status", label: "Durum", text: "Yok" },
    ]);
    await expect(attendanceTable).toContainText("Yok");
    await expect(attendanceTable).toContainText("Öğrenci eşleşmedi");
    await expect(attendanceTable).toContainText("Ders bilgisi yok");
    await attendanceRegion.getByLabel("Sınıf").selectOption("");
    await expect.poll(() => new URL(page.url()).searchParams.get("classId")).toBeNull();

    await expectNoVisibleTextValues(page, "attendance-mobile", ["student-a", "student-b", "student-missing", "course-math", "course-missing", "term-2026", "term-missing"]);
    await expectNoHorizontalOverflow(page, "attendance-mobile");
    await expectNoUnlabeledControls(page, "attendance-mobile");
    await expectNoClippedVisibleText(page, "attendance-mobile");
  });

  test("öğretmen notları günlük operasyon tablosu mobilde özet ve form standardını korur", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/notlar?page=2&limit=20&q=takip&sort=-createdAt&classId=class-8a");

    const notesRegion = page.getByLabel("Öğretmen notu yönetimi");
    const notesSummary = notesRegion.getByRole("region", { exact: true, name: "Öğretmen notu operasyon özeti" });
    await expect(notesSummary).toContainText("Not toplamı");
    await expect(notesSummary).toContainText("Görünürlük");
    await expect(notesSummary).toContainText("Veli görünürlüğü kontrollü");
    await expect(notesRegion.getByLabel("Ara")).toHaveValue("takip");
    await expect(notesRegion.getByLabel("Sırala")).toHaveValue("-createdAt");
    await expect(notesRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(notesRegion.getByLabel("Sınıf")).toHaveValue("class-8a");

    const notesTable = notesRegion.getByRole("table", { name: "Öğretmen notları operasyon listesi" });
    await expect(notesTable.getByRole("columnheader", { name: "Öğrenci" })).toBeVisible();
    await expect(notesTable.getByRole("columnheader", { name: "Görünürlük" })).toBeVisible();
    await expect(notesTable.getByRole("columnheader", { name: "Not" })).toHaveCount(0);
    await expectMobileDataCells(notesTable, [
      { key: "studentId", label: "Öğrenci", text: "Ada Kaya" },
      { key: "visibility", label: "Görünürlük", text: "Veli/öğrenci görür" },
    ]);
    await expect(notesTable).toContainText("Veli/öğrenci görür");
    await expect(notesTable).toContainText("Öğrenci eşleşmedi");
    await expect(notesTable).toContainText("Öğretmen eşleşmedi");

    await notesRegion.getByRole("button", { name: "Not ekle" }).click();
    const noteDialog = page.getByRole("dialog", { name: "Not ekle" });
    await expect(noteDialog.locator(".uh-field")).toHaveCount(7);
    await expect(noteDialog.locator(".uh-select")).toHaveCount(5);
    await expect(noteDialog.locator(".uh-textarea")).toHaveCount(1);

    await expectNoVisibleTextValues(page, "teacher-notes-mobile", ["student-a", "student-missing", "teacher-a", "teacher-missing", "course-math", "course-missing", "term-2026", "term-missing"]);
    await expectNoHorizontalOverflow(page, "teacher-notes-mobile");
    await expectNoUnlabeledControls(page, "teacher-notes-mobile");
    await expectNoClippedVisibleText(page, "teacher-notes-mobile");
  });

  test("program, etüt ve kazanım tabloları mobilde planlama sözleşmesini korur", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/program?page=2&limit=20&q=geometri&sort=startsAt");

    const programRegion = page.getByLabel("Ders programı yönetimi");
    const programSummary = programRegion.getByRole("region", { exact: true, name: "Ders programı operasyon özeti" });
    await expect(programSummary).toContainText("Program toplamı");
    await expect(programSummary).toContainText("Saat planı");
    await expect(programSummary.getByLabel("Ders programı operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const programControls = programRegion.getByRole("group", { name: "Liste kontrolleri" });
    await expect(programControls.getByRole("button", { name: "Ders ekle" })).toBeVisible();
    const programTable = programRegion.getByRole("table", { name: "Ders programı operasyon listesi" });
    await expect(programTable.getByRole("columnheader", { name: "Ders" })).toBeVisible();
    await expect(programTable.getByRole("columnheader", { name: "Dönem" })).toHaveCount(0);
    await expect(programTable.locator('th[data-column-key="title"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(programTable.locator('th[data-column-key="termId"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(programTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expectMobileDataCells(programTable, [
      { key: "title", label: "Ders", text: "Geometri tekrar" },
      { key: "classId", label: "Sınıf", text: "8-A" },
      { key: "startsAt", label: "Başlangıç", text: "2026-06-19 09:30" },
    ]);
    await programRegion.getByRole("button", { name: "Ders ekle" }).click();
    let planningDialog = page.getByRole("dialog");
    await expect(planningDialog.locator(".uh-field")).toHaveCount(7);
    await expect(planningDialog.locator(".uh-select")).toHaveCount(4);
    await expect(planningDialog.getByLabel("Ders başlığı")).toBeVisible();
    await expectNoUnlabeledControls(page, "program-planning-form-mobile");
    await planningDialog.getByRole("button", { name: "Vazgeç" }).click();
    await expectNoVisibleTextValues(page, "program-planning-mobile", ["schedule-lesson-a", "class-8a", "course-math", "term-2026", "teacher-a", "tenant-datatable"]);
    await expectNoHorizontalOverflow(page, "program-planning-mobile");
    await expectNoUnlabeledControls(page, "program-planning-mobile");
    await expectNoClippedVisibleText(page, "program-planning-mobile");

    await page.goto(`${appOrigin}/kurum/etutler?page=2&limit=20&q=kesir&sort=-startsAt`);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const studyRegion = page.getByLabel("Etüt yönetimi");
    const studySummary = studyRegion.getByRole("region", { exact: true, name: "Etüt operasyon özeti" });
    await expect(studySummary).toContainText("Etüt toplamı");
    await expect(studySummary).toContainText("Kapasite kontrolü");
    await expect(studySummary.getByLabel("Etüt operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const studyTable = studyRegion.getByRole("table", { name: "Etüt operasyon listesi" });
    await expect(studyTable.getByRole("columnheader", { name: "Etüt" })).toBeVisible();
    await expect(studyTable.getByRole("columnheader", { name: "Öğrenci" })).toHaveCount(0);
    await expect(studyTable.locator('th[data-column-key="title"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(studyTable.locator('th[data-column-key="studentIds"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(studyTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expectMobileDataCells(studyTable, [
      { key: "title", label: "Etüt", text: "Kesir etüdü" },
      { key: "classId", label: "Sınıf", text: "8-A" },
      { key: "capacity", label: "Kapasite", text: "1/8" },
    ]);
    await studyRegion.getByRole("button", { name: "Etüt ekle" }).click();
    planningDialog = page.getByRole("dialog");
    await expect(planningDialog.locator(".uh-field")).toHaveCount(9);
    await expect(planningDialog.locator(".uh-select")).toHaveCount(5);
    await expect(planningDialog.getByLabel("Öğrenciler")).toBeVisible();
    await expectNoUnlabeledControls(page, "study-session-form-mobile");
    await planningDialog.getByRole("button", { name: "Vazgeç" }).click();
    await expectNoVisibleTextValues(page, "study-session-mobile", ["study-session-a", "class-8a", "course-math", "term-2026", "teacher-a", "student-a", "tenant-datatable"]);
    await expectNoHorizontalOverflow(page, "study-session-mobile");
    await expectNoUnlabeledControls(page, "study-session-mobile");
    await expectNoClippedVisibleText(page, "study-session-mobile");

    await page.goto(`${appOrigin}/kurum/kazanimlar?page=2&limit=20&q=kesir&sort=-code`);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const outcomeRegion = page.getByLabel("Kazanım yönetimi");
    const outcomeSummary = outcomeRegion.getByRole("region", { exact: true, name: "Kazanım operasyon özeti" });
    await expect(outcomeSummary).toContainText("Kazanım toplamı");
    await expect(outcomeSummary).toContainText("Kod standardı");
    await expect(outcomeSummary.getByLabel("Kazanım operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const outcomeTable = outcomeRegion.getByRole("table", { name: "Kazanım katalog listesi" });
    await expect(outcomeTable.getByRole("columnheader", { name: "Kod" })).toBeVisible();
    await expect(outcomeTable.getByRole("columnheader", { name: "Seviye" })).toHaveCount(0);
    await expect(outcomeTable.locator('th[data-column-key="code"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(outcomeTable.locator('th[data-column-key="level"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(outcomeTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expectMobileDataCells(outcomeTable, [
      { key: "code", label: "Kod", text: "M.5.1.1" },
      { key: "title", label: "Kazanım", text: "Kesirleri karşılaştırır" },
      { key: "branch", label: "Branş", text: "Matematik" },
    ]);
    await expectNoVisibleTextValues(page, "learning-outcomes-mobile", ["learning-outcome-a", "tenant-datatable"]);
    await expectNoHorizontalOverflow(page, "learning-outcomes-mobile");
    await expectNoUnlabeledControls(page, "learning-outcomes-mobile");
    await expectNoClippedVisibleText(page, "learning-outcomes-mobile");
  });

  test("öğretmen detay paneli mobilde görev ilişkilerini güvenli gösterir", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/ogretmenler/teacher-a");

    await expect(page.getByRole("heading", { level: 1, name: "Deniz Arslan" })).toBeVisible();
    const detailRegion = page.getByLabel("Öğretmen detayı");
    const detailSummary = detailRegion.getByRole("region", { exact: true, name: "Öğretmen detay operasyon özeti" });
    await expect(detailSummary).toContainText("Atama toplamı");
    await expect(detailSummary).toContainText("Portal bağlı");
    await expect(detailSummary).toContainText("eşleşme kontrolü");
    await expect(detailSummary.getByLabel("Öğretmen detay operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const teacherProfile = page.getByLabel("Öğretmen profil kartı");
    await expect(teacherProfile).toContainText("Matematik");
    await expect(teacherProfile).toContainText("Bağlı");
    const teacherProfileInfo = teacherProfile.getByRole("region", { name: "Öğretmen profil özeti" });
    await expect(teacherProfileInfo).toHaveClass(/uh-info-grid/);
    await expect(teacherProfileInfo.locator(".uh-info-item")).toHaveCount(3);
    await expect(teacherProfileInfo).toContainText("Portal");

    const assignmentsTable = page.getByRole("table", { name: "Öğretmen atama ilişkileri" });
    await expect(assignmentsTable.getByRole("columnheader", { name: "Rol" })).toBeVisible();
    await expect(assignmentsTable.getByRole("columnheader", { name: "Dönem" })).toHaveCount(0);
    await expect(assignmentsTable.locator('th[data-column-key="role"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(assignmentsTable.locator('th[data-column-key="term"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(assignmentsTable.locator('th[data-column-key="role"]')).toHaveAttribute("data-sticky", "left");
    await expectMobileDataCells(assignmentsTable, [
      { key: "role", label: "Rol", text: "Sınıf öğretmeni" },
      { key: "scope", label: "Kapsam", text: "8-A / Ada Kaya" },
      { key: "course", label: "Ders", text: "Matematik" },
    ]);
    await expect(assignmentsTable).toContainText("Sınıf eşleşmedi");
    await expect(assignmentsTable).toContainText("Öğrenci eşleşmedi");
    await expect(assignmentsTable).toContainText("Ders eşleşmedi");

    await expectNoVisibleTextValues(page, "teacher-detail-mobile", [
      "teacher-a",
      "teacher-assignment-class",
      "teacher-assignment-missing",
      "class-8a",
      "class-missing",
      "student-a",
      "student-missing",
      "course-math",
      "course-missing",
      "term-2026",
      "term-missing",
      "tenant-datatable",
    ]);
    await expectNoHorizontalOverflow(page, "teacher-detail-mobile");
    await expectNoUnlabeledControls(page, "teacher-detail-mobile");
    await expectNoClippedVisibleText(page, "teacher-detail-mobile");
  });

  test("öğretmen atama modalı mobilde tablo sözleşmesini korur", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/ogretmenler");

    await page.getByRole("button", { name: "Deniz düzenle" }).click();
    const dialog = page.getByRole("dialog", { name: "Öğretmen düzenle" });
    const assignmentRegion = dialog.getByLabel("Öğretmen atamaları");
    const assignmentTable = assignmentRegion.getByRole("table", { name: "Öğretmen atamaları" });

    await expect(assignmentRegion).toContainText("2 atama");
    await expect(assignmentTable.getByRole("columnheader", { name: "Rol" })).toBeVisible();
    await expect(assignmentTable.getByRole("columnheader", { name: "Kapsam" })).toBeVisible();
    await expect(assignmentTable.locator('th[data-column-key="role"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(assignmentTable.locator('th[data-column-key="context"]')).toHaveAttribute("data-mobile-priority", "secondary");
    await expect(assignmentTable.locator('th[data-column-key="role"]')).toHaveAttribute("data-sticky", "left");
    await expect(assignmentTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expectMobileDataCells(assignmentTable, [
      { key: "role", label: "Rol", text: "Sınıf öğretmeni" },
      { key: "scope", label: "Kapsam", text: "8-A · Ada Kaya · Matematik" },
      { key: "context", label: "Dönem ve tarih", text: "2026 Bahar" },
    ]);
    await expect(assignmentTable).toContainText("Sınıf eşleşmedi");
    await expect(assignmentTable).toContainText("Öğrenci eşleşmedi");
    await expect(assignmentTable).toContainText("Ders eşleşmedi");
    await expect(assignmentTable).toContainText("Dönem eşleşmedi");
    await expect(assignmentRegion.getByLabel("Yeni öğretmen ataması")).toBeVisible();

    await expectNoVisibleTextValues(page, "teacher-assignment-modal-mobile", [
      "teacher-a",
      "teacher-assignment-class",
      "teacher-assignment-missing",
      "class-8a",
      "class-missing",
      "student-a",
      "student-missing",
      "course-math",
      "course-missing",
      "term-2026",
      "term-missing",
      "tenant-datatable",
    ]);
    await expectNoHorizontalOverflow(page, "teacher-assignment-modal-mobile");
    await expectNoUnlabeledControls(page, "teacher-assignment-modal-mobile");
    await expectNoClippedVisibleText(page, "teacher-assignment-modal-mobile");
  });

  test("sınıf detay paneli mobilde rapor bağlamını ve tabloları güvenli gösterir", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/siniflar/class-8a");

    await expect(page.getByRole("heading", { level: 1, name: "8-A" })).toBeVisible();
    const detailRegion = page.getByLabel("Sınıf detayı");
    const detailSummary = detailRegion.getByRole("region", { exact: true, name: "Sınıf detay operasyon özeti" });
    await expect(detailSummary).toContainText("Öğrenci toplamı");
    await expect(detailSummary).toContainText("Başarı %");
    await expect(detailSummary).toContainText("Rapor hazır");
    await expect(detailSummary.getByLabel("Sınıf detay operasyon özeti aksiyon kuyruğu")).toBeVisible();

    const reportContext = detailRegion.getByLabel("Sınıf rapor bağlamı");
    const classReportContext = reportContext.getByRole("region", { name: "Sınıf rapor bağlam özeti" });
    await expect(classReportContext).toHaveClass(/uh-info-grid/);
    await expect(classReportContext.locator(".uh-info-item")).toHaveCount(4);
    await expect(reportContext).toContainText("LGS Denemesi");
    await expect(reportContext).toContainText("10.06.2026");
    await expect(reportContext).toContainText("%76,7");
    await expect(reportContext).toContainText("30");

    const studentsTable = detailRegion.getByRole("table", { name: "Sınıf öğrenci listesi" });
    await expect(studentsTable.getByRole("columnheader", { name: "Öğrenci" })).toBeVisible();
    await expect(studentsTable.getByRole("columnheader", { name: "Durum" })).toBeVisible();
    await expect(studentsTable.locator('th[data-column-key="name"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(studentsTable.locator('th[data-column-key="name"]')).toHaveAttribute("data-sticky", "left");
    await expectMobileDataCells(studentsTable, [
      { key: "name", label: "Öğrenci", text: "Ada Kaya" },
      { key: "studentNo", label: "No", text: "176" },
      { key: "status", label: "Durum", text: "Aktif" },
    ]);

    const resultsTable = detailRegion.getByRole("table", { name: "Sınıf sınav sonucu karşılaştırması" });
    await expect(resultsTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(resultsTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(resultsTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
    await expect(resultsTable.getByRole("columnheader", { name: "LGS" })).toHaveCount(0);
    await expect(resultsTable.getByRole("columnheader", { name: "Standart" })).toHaveCount(0);
    await expect(resultsTable.locator('th[data-column-key="student"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(resultsTable.locator('th[data-column-key="lgsScore"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expectMobileDataCells(resultsTable, [
      { key: "student", label: "Öğrenci", text: "Ada Kaya" },
      { key: "successRate", label: "Başarı %", text: "%81,7" },
      { key: "net", label: "Net", text: "24,5" },
      { key: "questionCount", label: "Soru", text: "30" },
    ]);
    await expect(resultsTable).toContainText("Öğrenci eşleşmedi");

    const outcomesTable = detailRegion.getByRole("table", { name: "Sınıf kazanım kırılımı" });
    await expect(outcomesTable.getByRole("columnheader", { name: "Kazanım" })).toBeVisible();
    await expect(outcomesTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(outcomesTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(outcomesTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
    await expectMobileDataCells(outcomesTable, [
      { key: "outcome", label: "Kazanım", text: "Matematik / M.8.1" },
      { key: "successRate", label: "Başarı %", text: "%80,7" },
      { key: "net", label: "Net", text: "7,5" },
      { key: "questionCount", label: "Soru", text: "10" },
    ]);

    await expectNoVisibleTextValues(page, "class-detail-mobile", [
      "class-8a",
      "student-a",
      "student-b",
      "student-missing",
      "exam-lgs",
      "snapshot-a",
      "tenant-datatable",
      "campus-main",
      "grade-8",
      "12345678901",
      "12345678902",
      "ada.kaya@example.test",
      "bora.kaya@example.test",
      "+905551110001",
      "+905551110002",
    ]);
    await expectNoHorizontalOverflow(page, "class-detail-mobile");
    await expectNoUnlabeledControls(page, "class-detail-mobile");
    await expectNoClippedVisibleText(page, "class-detail-mobile");
  });

  test("sınav yönetimi seçili sınav katılımcılarını izole tutar", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/sinavlar");

    const examTable = page.getByRole("table", { name: "Sınav yönetimi" });
    const examSummary = page.getByRole("region", { exact: true, name: "Sınav operasyon özeti" });
    const selectedExamDetail = page.getByRole("region", { name: "Sınav seçili detay" });
    await expect(examSummary).toContainText("Sınav toplamı");
    await expect(examSummary).toContainText("Yayında");
    await expect(examSummary).toContainText("Taslak");
    await expect(examTable).toContainText("LGS Denemesi");
    await expect(examTable).toContainText("TYT Provasi");
    await expect(selectedExamDetail.getByLabel("Seçili sınav durumu")).toContainText("Yayında");
    await expect(selectedExamDetail.getByLabel("Sınav hazırlık durumu")).toContainText("1 sınıf kapsamı");
    const selectedExamMetrics = selectedExamDetail.getByRole("region", { name: "Seçili sınav metrikleri" });
    await expect(selectedExamMetrics).toHaveClass(/uh-info-grid/);
    await expect(selectedExamMetrics.locator(".uh-info-item")).toHaveCount(4);
    await expect(selectedExamDetail.locator(".next-support-ticket-meta")).toHaveCount(0);
    const lgsParticipants = selectedExamDetail.getByRole("table", { name: "LGS Denemesi katılımcıları" });
    await expect(lgsParticipants).toContainText("Ada Kaya");
    await expect(lgsParticipants).not.toContainText("Bora Kaya");

    const tytParticipantRequest = page.waitForRequest(
      (request) =>
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/v1/exams/exam-tyt/participants",
    );
    await examTable.getByRole("button", { name: "TYT Provasi katılımcıları" }).click();
    await tytParticipantRequest;
    await expect(selectedExamDetail).toContainText("TYT Provasi");
    await expect(selectedExamDetail.getByLabel("Seçili sınav durumu")).toContainText("Taslak");
    await expect(selectedExamMetrics).toContainText("B");
    const tytParticipants = selectedExamDetail.getByRole("table", { name: "TYT Provasi katılımcıları" });
    await expect(tytParticipants).toContainText("Bora Kaya");
    await expect(tytParticipants).not.toContainText("Ada Kaya");
    await expect(selectedExamDetail.getByRole("columnheader", { exact: true, name: "Öğrenci no" })).toHaveCount(0);
    await expect(selectedExamDetail.getByRole("columnheader", { exact: true, name: "Kitapçık" })).toHaveCount(0);

    await page.getByRole("button", { name: "Sınav ekle" }).click();
    const examDialog = page.getByRole("dialog", { name: "Sınav ekle" });
    await expect(examDialog.locator(".uh-field")).toHaveCount(6);
    await expect(examDialog.getByLabel("Sınav türü")).toBeVisible();
    await expect(examDialog.getByLabel("Seviye")).toBeVisible();
    await expect(examDialog.getByLabel("Alan")).toBeVisible();
    await expect(examDialog.getByLabel("Cevap anahtarı dosyası")).toBeVisible();
    await expect(examDialog.getByLabel("Sınıf ara")).toBeVisible();
    await expect(examDialog.locator(".next-checkbox-list .uh-checkbox")).toHaveCount(2);
    await expect(examDialog.getByRole("checkbox", { name: /8-A/ })).toBeVisible();
    await expectNoUnlabeledControls(page, "exam-form-mobile");
    await examDialog.getByRole("button", { name: "Vazgeç" }).click();

    await expectNoVisibleTextValues(page, "exams-mobile", [
      "student-a",
      "student-b",
      "12345678901",
      "12345678902",
      "ada.kaya@example.test",
      "bora.kaya@example.test",
      "+905551110001",
      "+905551110002",
    ]);
    await expectNoHorizontalOverflow(page, "exams-mobile");
    await expectNoUnlabeledControls(page, "exams-mobile");
    await expectNoClippedVisibleText(page, "exams-mobile");
  });

  test("destek triage tablosu mobilde operasyon sözleşmesini korur", async ({ page }) => {
    await openWithDataTableMocks(page, "/kurum/destek");

    const supportRegion = page.getByLabel("Destek bildirimi yönetimi");
    const supportSummary = supportRegion.getByRole("region", { exact: true, name: "Destek operasyon özeti" });
    await expect(supportSummary).toContainText("Açık");
    await expect(supportSummary).toContainText("Yüksek öncelik");
    await expect(supportSummary.getByLabel("Destek operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(supportSummary).toContainText("Triage kuyruğu");
    await expect(supportRegion.getByLabel("Destek filtreleri")).toBeVisible();
    const supportTable = supportRegion.getByRole("table", { name: "Destek triage listesi" });
    await expect(supportTable.getByRole("columnheader", { name: "Konu" })).toBeVisible();
    await expect(supportTable.getByRole("columnheader", { name: "Bağlam" })).toHaveCount(0);
    await expectMobileDataCells(supportTable, [
      { key: "subject", label: "Konu", text: "Optik dosya okunmuyor" },
      { key: "priority", label: "Öncelik", text: "Yüksek" },
      { key: "status", label: "Durum", text: "Açık" },
    ]);
    await expect(supportTable.getByText("Optik dosya okunmuyor")).toBeVisible();
    await expect(supportTable.getByText("Bağlı öğrenci")).toHaveCount(4);
    await expectMobileDetailCells(supportTable, [
      { label: "Öğrenci", text: "Bağlı öğrenci" },
      { label: "Bağlam", text: "Ana Kampüs / 8. Sınıf / 8-A / Matematik / 2026 Bahar" },
    ]);
    await expect(supportTable.getByRole("button", { name: "Optik dosya okunmuyor işleme al" })).toBeVisible();
    await expect(supportTable.getByRole("row", { name: /Optik dosya okunmuyor/ })).toHaveClass(/next-support-row--selected/);
    const selectedDetail = page.getByRole("region", { name: "Destek seçili bildirim detayı" });
    const selectedTicketControl = selectedDetail.getByRole("combobox", { name: "Bildirim" });
    await expect(selectedTicketControl).toHaveValue("ticket-a");
    await expect(selectedDetail.locator(".next-support-ticket-context")).toContainText("Optik dosya okunmuyor");
    const selectedTicketMetrics = selectedDetail.getByRole("region", { name: "Seçili bildirim metrikleri" });
    await expect(selectedTicketMetrics).toHaveClass(/uh-info-grid/);
    await expect(selectedTicketMetrics.locator(".uh-info-item")).toHaveCount(3);
    await expect(selectedTicketMetrics).toContainText("Ana Kampüs / 8. Sınıf / 8-A / Matematik / 2026 Bahar");
    await expect(selectedDetail).toContainText("İlk mesaj");
    await expect(selectedDetail).toContainText("Ekler");
    await expect(selectedDetail).toContainText("Yorum akışı");
    await expect(page.getByLabel("Destek ek ve yorum listesi")).toContainText("Ek: hata-ekrani.txt");
    await expect(page.getByLabel("Destek ek ve yorum listesi")).toContainText("Yorum: İlk kontrol yapıldı.");

    await supportTable.getByRole("button", { name: "Rapor ekranı açılmıyor detayını aç" }).click();
    await expect(selectedTicketControl).toHaveValue("ticket-b");
    await expect(supportTable.getByRole("row", { name: /Rapor ekranı açılmıyor/ })).toHaveClass(/next-support-row--selected/);
    await expect(selectedDetail.locator(".next-support-ticket-context")).toContainText("Rapor ekranı açılmıyor");
    await expect(page.getByLabel("Destek ek ve yorum listesi")).toContainText("Ek yok");
    await expect(page.getByLabel("Destek ek ve yorum listesi")).toContainText("Yorum yok");
    await expect(page.getByLabel("Destek ek ve yorum listesi")).not.toContainText("hata-ekrani.txt");

    const attachmentRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/support-tickets/ticket-b/attachments",
    );
    await selectedDetail.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from("rapor panel notu"),
      mimeType: "text/plain",
      name: "rapor-panel.txt",
    });
    await selectedDetail.getByRole("button", { name: "Ek yükle" }).click();
    const attachmentPayload = JSON.parse((await attachmentRequest).postData() ?? "{}");
    expect(Object.keys(attachmentPayload).sort()).toEqual(["contentType", "fileBase64", "fileName"]);
    expect(attachmentPayload).toMatchObject({ contentType: "text/plain", fileName: "rapor-panel.txt" });
    expect(JSON.stringify(attachmentPayload)).not.toContain("student-b");
    await expect(page.getByLabel("Destek ek ve yorum listesi")).toContainText("Ek: rapor-panel.txt");

    const commentRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/support-tickets/ticket-b/comments",
    );
    await selectedDetail.getByRole("textbox", { name: "Yorum" }).fill("Mobil panelden dönüş yapıldı.");
    await selectedDetail.getByRole("button", { name: "Yorum ekle" }).click();
    const commentPayload = JSON.parse((await commentRequest).postData() ?? "{}");
    expect(Object.keys(commentPayload)).toEqual(["body"]);
    expect(JSON.stringify(commentPayload)).not.toContain("guardian-b");
    await expect(page.getByLabel("Destek ek ve yorum listesi")).toContainText("Yorum: Mobil panelden dönüş yapıldı.");

    await expectNoVisibleTextValues(page, "support-mobile", ["12345678901", "+905551110001", "ada.kaya@example.test", "student-a", "student-b", "guardian-a", "guardian-b"]);
    await expectNoHorizontalOverflow(page, "support-mobile");
    await expectNoUnlabeledControls(page, "support-mobile");
    await expectNoClippedVisibleText(page, "support-mobile");
  });

  test("materyal ve ödev panelleri mobilde operasyon sözleşmesini korur", async ({ page }) => {
    test.setTimeout(45_000);

    await openWithDataTableMocks(page, "/kurum/materyaller");

    const homeworkRegion = page.getByLabel("Ödev kontrolü");
    const materialRegion = page.getByLabel("Materyal listesi");
    const materialSummary = homeworkRegion.getByRole("region", { exact: true, name: "Materyal operasyon özeti" });
    await expect(materialSummary).toContainText("Kontrol bekleyen");
    await expect(materialSummary).toContainText("Atanmış materyal");
    await expect(materialSummary.getByLabel("Materyal operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const homeworkTable = homeworkRegion.getByRole("table", { name: "Ödev kontrol akışı" });
    const materialTable = materialRegion.getByRole("table", { name: "Materyal havuzu" });
    await expect(homeworkTable).toContainText("Kesirler tekrar");
    await expect(homeworkTable.locator('th[data-column-key="title"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(homeworkTable.locator('th[data-column-key="material"]')).toHaveAttribute("data-mobile-priority", "secondary");
    await expect(homeworkTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expect(materialTable).toContainText("Kesirler Çalışma Kağıdı");
    await expect(materialTable).toContainText("1 dosya");
    await expect(materialTable).toContainText("1 öğrenci ataması");
    await expect(materialTable.locator('th[data-column-key="title"]')).toHaveAttribute("data-mobile-priority", "primary");
    await expect(materialTable.locator('th[data-column-key="description"]')).toHaveAttribute("data-mobile-priority", "hidden");
    await expect(materialTable.locator('th[data-column-key="actions"]')).toHaveAttribute("data-sticky", "right");
    await expect(materialTable.getByRole("row", { name: /Kesirler Çalışma Kağıdı/ })).toHaveClass(/next-material-row--selected/);
    await expect(materialRegion.getByText("Dosya: kesirler.txt")).toHaveCount(0);
    await expect(materialRegion.getByText("Atama: Ada Kaya")).toHaveCount(0);
    const materialTools = page.getByLabel("Materyal araçları");
    const selectedMaterialDetail = page.getByRole("region", { name: "Materyal seçili detay" });
    const selectedMaterialControl = selectedMaterialDetail.getByRole("combobox", { name: "Materyal" });
    await expect(selectedMaterialControl).toHaveValue("material-a");
    await expect(selectedMaterialDetail.locator(".uh-field")).toHaveCount(5);
    await expect(selectedMaterialDetail.locator(".uh-select")).toHaveCount(2);
    await expect(selectedMaterialDetail.locator(".uh-textarea")).toHaveCount(1);
    await expect(selectedMaterialDetail.locator(".next-material-selected-context")).toContainText("Kesirler Çalışma Kağıdı");
    await expect(selectedMaterialDetail.getByLabel("Seçili materyal durumu")).toContainText("Dosyalı");
    const selectedMaterialMetrics = selectedMaterialDetail.getByRole("region", { name: "Seçili materyal metrikleri" });
    await expect(selectedMaterialMetrics).toHaveClass(/uh-info-grid/);
    await expect(selectedMaterialMetrics.locator(".uh-info-item")).toHaveCount(3);
    await expect(selectedMaterialMetrics).toContainText("1 dosya");
    await expect(selectedMaterialMetrics).toContainText("1 öğrenci");
    await expect(page.getByLabel("Seçili materyal dosyaları")).toContainText("Dosya: kesirler.txt");
    await expect(page.getByLabel("Seçili materyal atamaları")).toContainText("Atama: Ada Kaya");
    await expect(materialTools.getByRole("button", { name: "Dosya yükle" })).toBeVisible();
    await expect(materialTools.getByRole("button", { name: "Öğrenciye ata" })).toBeVisible();

    await materialRegion.getByRole("button", { name: "Problemler Föyü detayını aç" }).click();
    await expect(selectedMaterialControl).toHaveValue("material-b");
    await expect(materialTable.getByRole("row", { name: /Problemler Föyü/ })).toHaveClass(/next-material-row--selected/);
    await expect(materialTable.getByRole("row", { name: /Kesirler Çalışma Kağıdı/ })).not.toHaveClass(/next-material-row--selected/);
    await expect(selectedMaterialDetail.locator(".next-material-selected-context")).toContainText("Problemler Föyü");
    await expect(selectedMaterialDetail.getByLabel("Seçili materyal durumu")).toContainText("Dosya yok");
    await expect(selectedMaterialDetail.getByLabel("Seçili materyal durumu")).toContainText("Atama bekliyor");
    await expect(page.getByLabel("Seçili materyal dosyaları")).toContainText("Dosya yok");
    await expect(page.getByLabel("Seçili materyal atamaları")).toContainText("Atama yok");
    await expect(page.getByLabel("Materyal dosya ve atama listesi")).not.toContainText("kesirler.txt");

    const materialFileRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/homework/materials/material-b/files",
    );
    await selectedMaterialDetail.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from("problem panel notu"),
      mimeType: "text/plain",
      name: "problem-panel.txt",
    });
    await selectedMaterialDetail.getByRole("button", { name: "Dosya yükle" }).click();
    const materialFilePayload = JSON.parse((await materialFileRequest).postData() ?? "{}");
    expect(Object.keys(materialFilePayload).sort()).toEqual(["contentType", "fileBase64", "fileName"]);
    expect(materialFilePayload).toMatchObject({ contentType: "text/plain", fileName: "problem-panel.txt" });
    expect(JSON.stringify(materialFilePayload)).not.toContain("material-b");
    expect(JSON.stringify(materialFilePayload)).not.toContain("tenant-datatable");
    expect(JSON.stringify(materialFilePayload)).not.toContain("teacher-a");
    await expect(page.getByLabel("Seçili materyal dosyaları")).toContainText("Dosya: problem-panel.txt");

    const materialAssignmentRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/homework/materials/material-b/assignments",
    );
    await selectedMaterialDetail.getByRole("combobox", { name: /^Öğrenci/ }).selectOption("student-b");
    await selectedMaterialDetail.getByRole("textbox", { name: /^Not / }).fill("Seçili materyal denemesi");
    await selectedMaterialDetail.getByLabel("Teslim", { exact: true }).fill("2026-06-22");
    await selectedMaterialDetail.getByRole("button", { name: "Öğrenciye ata" }).click();
    const materialAssignmentPayload = JSON.parse((await materialAssignmentRequest).postData() ?? "{}");
    expect(Object.keys(materialAssignmentPayload).sort()).toEqual(["dueAt", "note", "studentId"]);
    expect(materialAssignmentPayload).toMatchObject({ dueAt: "2026-06-22", note: "Seçili materyal denemesi", studentId: "student-b" });
    expect(JSON.stringify(materialAssignmentPayload)).not.toContain("ada.kaya@example.test");
    expect(JSON.stringify(materialAssignmentPayload)).not.toContain("bora.kaya@example.test");
    await expect(page.getByLabel("Seçili materyal atamaları")).toContainText("Atama: Bora Kaya");

    await expectNoVisibleTextValues(page, "materials-mobile", [
      "student-a",
      "student-b",
      "guardian-a",
      "guardian-b",
      "12345678901",
      "12345678902",
      "ada.kaya@example.test",
      "bora.kaya@example.test",
      "+905551110001",
      "+905551110002",
      "homework-a",
      "material-a",
      "material-b",
      "material-file-material-a",
      "material-file-material-b",
      "assignment-material-a",
      "assignment-material-b",
      "teacher-a",
      "tenant-datatable",
      "material-file-hash",
    ]);
    await expectNoHorizontalOverflow(page, "materials-mobile");
    await expectNoUnlabeledControls(page, "materials-mobile");
    await expectNoClippedVisibleText(page, "materials-mobile");
  });
});

async function openWithDataTableMocks(page: Page, pathName: string) {
  await page.setViewportSize({ height: 844, width: 390 });
  await installDataTableApiMocks(page);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(pathName);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installDataTableApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    const response = mockApiResponse(pathName, route.request().method());
    await fulfillData(route, response.data, response.meta);
  });
}

function mockApiResponse(pathName: string, method: string): { data: unknown; meta?: ListMeta } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse() };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/announcements" && method === "GET") return listResponse(createAnnouncements());
  if (pathName === "/announcements/announcement-a/recipients") return { data: createRecipientReport() };
  if (pathName === "/message-templates" && method === "GET") return listResponse(createMessageTemplates());
  if (pathName === "/sms-batches/recipients/preview" && method === "POST") return { data: createSmsRecipientPreview() };
  if (pathName === "/sms-batches" && method === "POST") {
    return { data: { jobId: "job-sms-a", queueName: "sms-batch", recipientCount: 1, status: "queued", templateId: "template-a", tenantId: "tenant-datatable" } };
  }
  if (pathName === "/sms-batches/job-sms-a") return { data: createSmsDeliveryReport() };
  if (pathName === "/campuses") return { data: [{ id: "campus-main", name: "Ana Kampüs", tenantId: "tenant-datatable" }] };
  if (pathName === "/classes") return { data: createClasses() };
  if (pathName === "/classes/class-8a" && method === "GET") return { data: createClasses()[0] };
  if (pathName === "/courses") return { data: [{ id: "course-math", name: "Matematik", tenantId: "tenant-datatable" }] };
  if (pathName === "/grade-levels") return { data: [{ id: "grade-8", name: "8. Sınıf", tenantId: "tenant-datatable" }] };
  if (pathName === "/academic-terms") return { data: [{ id: "term-2026", name: "2026 Bahar", tenantId: "tenant-datatable" }] };
  if (pathName === "/students") return listResponse(createStudents());
  if (pathName === "/students/student-a/profile") return { data: createStudentProfile() };
  if (pathName === "/students/student-a/guardians") return { data: createStudentGuardians() };
  if (pathName === "/students/student-a/class-history") return { data: createStudentClassHistory() };
  if (pathName === "/students/student-a/enrollments") return { data: createStudentEnrollments() };
  if (pathName === "/teachers/teacher-a" && method === "GET") return { data: createTeachers()[0] };
  if (pathName === "/teachers/teacher-a/assignments" && method === "GET") return { data: createTeacherDetailAssignments() };
  if (pathName === "/teachers") return listResponse(createTeachers());
  if (pathName === "/attendance/summary") return { data: createStudentAttendanceSummary() };
  if (pathName === "/attendance" && method === "GET") return listResponse(createAttendance());
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/students/student-a/progress") return { data: createStudentReportProgress() };
  if (pathName === "/teacher-notes" && method === "GET") return listResponse(createTeacherNotes());
  if (pathName === "/schedule-lessons" && method === "GET") return listResponse(createScheduleLessons());
  if (pathName === "/study-sessions" && method === "GET") return listResponse(createStudySessions());
  if (pathName === "/learning-outcomes" && method === "GET") return listResponse(createLearningOutcomes());
  if (pathName === "/exams" && method === "GET") return { data: createExamManagementExams() };
  if (pathName === "/exams/exam-lgs/reports/snapshots") return { data: createClassDetailSnapshots() };
  if (pathName.startsWith("/exams/") && pathName.endsWith("/participants")) {
    const examId = pathName.replace("/exams/", "").replace("/participants", "");
    return { data: createExamManagementParticipants(examId) };
  }
  if (pathName === "/payment-plans" && method === "GET") return listResponse(createPaymentPlans());
  if (pathName === "/support-tickets" && method === "GET") return listResponse(createSupportTickets());
  if (pathName.startsWith("/support-tickets/") && pathName.endsWith("/attachments")) {
    const ticketId = pathName.replace("/support-tickets/", "").replace("/attachments", "");
    if (method === "POST") return { data: createSupportTicketAttachment(ticketId, "rapor-panel.txt") };
    return { data: ticketId === "ticket-a" ? createSupportTicketAttachments() : [] };
  }
  if (pathName.startsWith("/support-tickets/") && pathName.endsWith("/comments")) {
    const ticketId = pathName.replace("/support-tickets/", "").replace("/comments", "");
    if (method === "POST") return { data: createSupportTicketComment(ticketId, "Mobil panelden dönüş yapıldı.") };
    return { data: ticketId === "ticket-a" ? createSupportTicketComments() : [] };
  }
  if (pathName === "/homework" && method === "GET") return listResponse(createHomework());
  if (pathName === "/homework/materials" && method === "GET") return listResponse(createHomeworkMaterials());
  if (pathName.startsWith("/homework/materials/") && pathName.endsWith("/files")) {
    const materialId = pathName.replace("/homework/materials/", "").replace("/files", "");
    if (method === "POST") return { data: createHomeworkMaterialFile(materialId, "problem-panel.txt") };
    return { data: materialId === "material-a" ? createHomeworkMaterialFiles() : [] };
  }
  if (pathName.startsWith("/homework/materials/") && pathName.endsWith("/assignments")) {
    const materialId = pathName.replace("/homework/materials/", "").replace("/assignments", "");
    if (method === "POST") return { data: createHomeworkMaterialAssignment(materialId, "student-b") };
    return { data: materialId === "material-a" ? createHomeworkMaterialAssignments() : [] };
  }

  return { data: [] };
}

function createAuthResponse() {
  return {
    accessToken: "datatable-access-token",
    session: {
      id: "session-datatable",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-datatable",
      userId: "user-datatable-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@datatable-akademi.example",
    id: "tenant-datatable",
    institutionType: "Dershane",
    name: "DataTable Akademi",
  };
}

function createAnnouncements() {
  return [
    {
      audience: "GUARDIANS",
      body: "Haftalık sınav bilgilendirmesi.",
      campusId: "campus-main",
      classId: "class-8a",
      courseId: "course-math",
      gradeLevelId: "grade-8",
      id: "announcement-a",
      publishedAt: "2026-06-17T09:00:00.000Z",
      tenantId: "tenant-datatable",
      termId: "term-2026",
      title: "Haftalık sınav duyurusu",
    },
  ];
}

function createMessageTemplates() {
  return [
    {
      body: "Sayın veli, haftalık çalışma planı portala eklenmiştir.",
      channel: "SMS",
      id: "template-a",
      name: "Haftalık bilgilendirme",
      tenantId: "tenant-datatable",
    },
  ];
}

function createRecipientReport() {
  return {
    announcementId: "announcement-a",
    read: 1,
    recipients: [
      { announcementId: "announcement-a", displayName: "Ayşe Yılmaz", readAt: "2026-06-17T10:00:00.000Z", recipientType: "GUARDIAN", relatedStudentId: "student-a", relatedStudentName: "Ada Kaya", subjectId: "guardian-a" },
      { announcementId: "announcement-a", displayName: "Kemal Kaya", recipientType: "GUARDIAN", relatedStudentId: "student-a", relatedStudentName: "Ada Kaya", subjectId: "guardian-b" },
    ],
    total: 2,
    unread: 1,
  };
}

function createSmsRecipientPreview() {
  return {
    recipientCount: 1,
    recipients: [
      { guardianId: "guardian-a", guardianName: "Ayşe Yılmaz", studentIds: ["student-a"], studentNames: ["Ada Kaya"], to: "905551110001" },
    ],
  };
}

function createSmsDeliveryReport() {
  return {
    billableSegments: 1,
    failedCount: 0,
    id: "sms-delivery-a",
    jobId: "job-sms-a",
    recipientCount: 1,
    sentCount: 0,
    status: "queued",
    templateId: "template-a",
    tenantId: "tenant-datatable",
  };
}

function createClasses() {
  return [
    { campusId: "campus-main", gradeLevelId: "grade-8", id: "class-8a", name: "8-A", tenantId: "tenant-datatable" },
    { campusId: "campus-main", gradeLevelId: "grade-9", id: "class-9b", name: "9-B", tenantId: "tenant-datatable" },
  ];
}

function createStudents() {
  return [
    {
      classId: "class-8a",
      email: "ada.kaya@example.test",
      firstName: "Ada",
      id: "student-a",
      lastName: "Kaya",
      nationalId: "12345678901",
      phone: "+905551110001",
      status: "ACTIVE",
      studentNo: "176",
      tenantId: "tenant-datatable",
    },
    {
      classId: "class-9b",
      email: "bora.kaya@example.test",
      firstName: "Bora",
      id: "student-b",
      lastName: "Kaya",
      nationalId: "12345678902",
      phone: "+905551110002",
      status: "ACTIVE",
      studentNo: "177",
      tenantId: "tenant-datatable",
    },
  ];
}

function createStudentProfile() {
  return {
    classId: "class-8a",
    email: "ada.kaya@example.test",
    firstName: "Ada",
    id: "student-a",
    lastName: "Kaya",
    nationalIdMasked: "*******8901",
    phone: "+905551110001",
    status: "ACTIVE",
    tenantId: "tenant-datatable",
  };
}

function createStudentGuardians() {
  return [
    {
      firstName: "Ayşe",
      id: "guardian-a",
      lastName: "Yılmaz",
      phone: "+905551110001",
      tenantId: "tenant-datatable",
    },
  ];
}

function createStudentAttendanceSummary() {
  return { absent: 1, excused: 0, late: 0, present: 12, studentId: "student-a", total: 13 };
}

function createStudentReportProgress() {
  return { netDelta: 2.5, studentId: "student-a", successRateDelta: 8.4 };
}

function createStudentClassHistory() {
  return [
    {
      academicYearId: "academic-year-2026",
      campusName: "Ana Kampüs",
      classId: "class-8a",
      className: "8-A",
      gradeLevelName: "8. Sınıf",
      id: "student-class-history-a",
      reason: "CREATED",
      section: "A",
      startsAt: "2026-06-01",
      studentId: "student-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
    },
  ];
}

function createStudentEnrollments() {
  return [
    {
      academicYearId: "academic-year-2026",
      campusName: "Ana Kampüs",
      classId: "class-8a",
      className: "8-A",
      gradeLevelName: "8. Sınıf",
      id: "student-enrollment-created",
      reason: "CREATED",
      section: "A",
      startsAt: "2026-06-01",
      status: "ACTIVE",
      studentId: "student-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
    },
    {
      academicYearId: "academic-year-2026",
      classId: "class-9b",
      endsAt: "2026-06-18",
      id: "student-enrollment-transferred",
      reason: "TRANSFERRED",
      startsAt: "2026-06-10",
      status: "ACTIVE",
      studentId: "student-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
    },
    {
      academicYearId: "academic-year-missing",
      classId: "class-missing",
      id: "student-enrollment-unmatched",
      reason: "RENEWED",
      startsAt: "2026-06-18",
      status: "ACTIVE",
      studentId: "student-a",
      tenantId: "tenant-datatable",
      termId: "term-missing",
    },
  ];
}

function createTeachers() {
  return [
    {
      branch: "Matematik",
      firstName: "Deniz",
      id: "teacher-a",
      lastName: "Arslan",
      tenantId: "tenant-datatable",
      userId: "user-teacher-a",
    },
  ];
}

function createAttendance() {
  return [
    {
      courseId: "course-math",
      date: "2026-06-17",
      id: "attendance-a",
      status: "ABSENT",
      studentId: "student-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
    },
    {
      courseId: "course-math",
      date: "2026-06-17",
      id: "attendance-b",
      status: "PRESENT",
      studentId: "student-b",
      tenantId: "tenant-datatable",
      termId: "term-2026",
    },
    {
      courseId: "course-missing",
      date: "2026-06-16",
      id: "attendance-missing",
      status: "LATE",
      studentId: "student-missing",
      tenantId: "tenant-datatable",
      termId: "term-missing",
    },
  ];
}

function createTeacherNotes() {
  return [
    {
      body: "Problem çözüm adımlarında takip yapılacak.",
      courseId: "course-math",
      createdAt: "2026-06-17T10:00:00.000Z",
      developmentStatus: "Takip",
      id: "note-a",
      studentId: "student-a",
      teacherId: "teacher-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
      visibility: "GUARDIAN_STUDENT",
    },
    {
      body: "Ders içi katılım notu.",
      courseId: "course-math",
      createdAt: "2026-06-16T10:00:00.000Z",
      id: "note-b",
      studentId: "student-b",
      teacherId: "teacher-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
      visibility: "INTERNAL",
    },
    {
      body: "Referans eşleşmesi bekleniyor.",
      courseId: "course-missing",
      createdAt: "2026-06-15T10:00:00.000Z",
      id: "note-missing",
      studentId: "student-missing",
      teacherId: "teacher-missing",
      tenantId: "tenant-datatable",
      termId: "term-missing",
      visibility: "INTERNAL",
    },
  ];
}

function createTeacherDetailAssignments() {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      id: "teacher-assignment-class",
      role: "CLASS_TEACHER",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      teacherId: "teacher-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
    },
    {
      classId: "class-missing",
      courseId: "course-missing",
      id: "teacher-assignment-missing",
      role: "BRANCH_TEACHER",
      startsAt: "2026-09-08T00:00:00.000Z",
      studentId: "student-missing",
      teacherId: "teacher-a",
      tenantId: "tenant-datatable",
      termId: "term-missing",
    },
  ];
}

function createScheduleLessons() {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      endsAt: "2026-06-19T10:30:00.000Z",
      id: "schedule-lesson-a",
      startsAt: "2026-06-19T09:30:00.000Z",
      teacherId: "teacher-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
      title: "Geometri tekrar",
    },
  ];
}

function createStudySessions() {
  return [
    {
      capacity: 8,
      classId: "class-8a",
      courseId: "course-math",
      endsAt: "2026-06-20T11:00:00.000Z",
      id: "study-session-a",
      startsAt: "2026-06-20T10:00:00.000Z",
      studentIds: ["student-a"],
      teacherId: "teacher-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
      title: "Kesir etüdü",
    },
  ];
}

function createLearningOutcomes() {
  return [
    {
      branch: "Matematik",
      code: "M.5.1.1",
      id: "learning-outcome-a",
      level: "5",
      tenantId: "tenant-datatable",
      title: "Kesirleri karşılaştırır",
    },
  ];
}

function createExamManagementExams() {
  return [
    {
      createdAt: "2026-06-17T09:00:00.000Z",
      id: "exam-lgs",
      startsAt: "2026-06-20T09:00:00.000Z",
      status: "PUBLISHED",
      tenantId: "tenant-datatable",
      title: "LGS Denemesi",
      updatedAt: "2026-06-17T09:10:00.000Z",
    },
    {
      createdAt: "2026-06-17T10:00:00.000Z",
      id: "exam-tyt",
      startsAt: "2026-06-21T09:00:00.000Z",
      status: "DRAFT",
      tenantId: "tenant-datatable",
      title: "TYT Provasi",
      updatedAt: "2026-06-17T10:10:00.000Z",
    },
  ];
}

function createClassDetailSnapshots() {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      createdAt: "2026-06-10T12:00:00.000Z",
      examId: "exam-lgs",
      generatedAt: "2026-06-10T12:00:00.000Z",
      gradeLevelId: "grade-8",
      id: "snapshot-a",
      inputRefs: {},
      reportType: "EXAM_SUMMARY",
      snapshotData: {
        averages: {
          blank: 2,
          correct: 24,
          estimatedRawScore: 430,
          net: 23,
          questionCount: 30,
          standardScore: 430,
          successRate: 76.7,
          wrong: 4,
        },
        classes: [
          {
            averages: { blank: 2, correct: 24, estimatedRawScore: 430, net: 23, questionCount: 30, standardScore: 430, successRate: 76.7, wrong: 4 },
            classId: "class-8a",
            className: "8-A",
            resultCount: 3,
          },
        ],
        generatedAt: "2026-06-10T12:00:00.000Z",
        resultCount: 3,
        students: [
          {
            classId: "class-8a",
            className: "8-A",
            outcomes: [
              { branch: "Matematik", correct: 9, net: 8.5, outcomeCode: "M.8.1", questionCount: 10, successRate: 92, wrong: 1 },
              { branch: "Turkce", correct: 8, net: 7.5, outcomeCode: "T.8.2", questionCount: 10, successRate: 75, wrong: 2 },
            ],
            resultKey: "student-a",
            studentId: "student-a",
            total: { blank: 1, correct: 25, estimatedRawScore: 440, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
          },
          {
            classId: "class-8a",
            className: "8-A",
            outcomes: [
              { branch: "Matematik", correct: 8, net: 7.5, outcomeCode: "M.8.1", questionCount: 10, successRate: 80, wrong: 2 },
              { branch: "Turkce", correct: 7, net: 6.5, outcomeCode: "T.8.2", questionCount: 10, successRate: 65, wrong: 3 },
            ],
            resultKey: "student-b",
            studentId: "student-b",
            total: { blank: 2, correct: 20, estimatedRawScore: 395, net: 19, questionCount: 30, standardScore: 395, successRate: 63.3, wrong: 8 },
          },
          {
            classId: "class-8a",
            className: "8-A",
            outcomes: [
              { branch: "Matematik", correct: 7, net: 6.5, outcomeCode: "M.8.1", questionCount: 10, successRate: 70, wrong: 3 },
              { branch: "Turkce", correct: 6, net: 5.5, outcomeCode: "T.8.2", questionCount: 10, successRate: 55, wrong: 4 },
            ],
            resultKey: "student-missing",
            studentId: "student-missing",
            total: { blank: 3, correct: 18, estimatedRawScore: 360, net: 17, questionCount: 30, standardScore: 360, successRate: 56.7, wrong: 9 },
          },
        ],
      },
      status: "READY",
      tenantId: "tenant-datatable",
      termId: "term-2026",
      updatedAt: "2026-06-10T12:00:00.000Z",
    },
  ];
}

function createExamManagementParticipants(examId: string) {
  if (examId === "exam-tyt") {
    return [
      {
        bookletType: "B",
        createdAt: "2026-06-17T10:20:00.000Z",
        examId,
        id: "participant-tyt-b",
        participantNo: "402",
        status: "REGISTERED",
        studentId: "student-b",
        tenantId: "tenant-datatable",
        updatedAt: "2026-06-17T10:20:00.000Z",
      },
    ];
  }

  return [
    {
      bookletType: "A",
      createdAt: "2026-06-17T09:20:00.000Z",
      examId,
      id: "participant-lgs-a",
      participantNo: "301",
      status: "ATTENDED",
      studentId: "student-a",
      tenantId: "tenant-datatable",
      updatedAt: "2026-06-17T09:20:00.000Z",
    },
  ];
}

function createPaymentPlans() {
  return [
    {
      campusId: "campus-main",
      classId: "class-8a",
      courseId: "course-math",
      createdAt: "2026-06-17T08:00:00.000Z",
      currency: "TRY",
      gradeLevelId: "grade-8",
      id: "payment-plan-a",
      installments: [
        {
          amount: 120000,
          dueDate: "2026-06-30",
          id: "installment-a",
          installmentNo: 1,
          paidAt: undefined,
          planId: "payment-plan-a",
          status: "OVERDUE",
          tenantId: "tenant-datatable",
        },
      ],
      studentId: "student-a",
      tenantId: "tenant-datatable",
      termId: "term-2026",
      title: "Haziran ödeme planı",
      totalAmount: 120000,
    },
  ];
}

function createSupportTickets() {
  return [
    {
      campusId: "campus-main",
      classId: "class-8a",
      courseId: "course-math",
      createdAt: "2026-06-17T09:30:00.000Z",
      gradeLevelId: "grade-8",
      id: "ticket-a",
      message: "Optik dosya hata veriyor.",
      priority: "HIGH",
      requesterId: "guardian-a",
      status: "OPEN",
      studentId: "student-a",
      subject: "Optik dosya okunmuyor",
      tenantId: "tenant-datatable",
      termId: "term-2026",
    },
    {
      campusId: "campus-main",
      classId: "class-8a",
      courseId: "course-math",
      createdAt: "2026-06-17T09:45:00.000Z",
      gradeLevelId: "grade-8",
      id: "ticket-b",
      message: "Veli portalında rapor boş görünüyor.",
      priority: "NORMAL",
      requesterId: "guardian-b",
      status: "IN_PROGRESS",
      studentId: "student-b",
      subject: "Rapor ekranı açılmıyor",
      tenantId: "tenant-datatable",
      termId: "term-2026",
    },
  ];
}

function createSupportTicketAttachments() {
  return [createSupportTicketAttachment("ticket-a", "hata-ekrani.txt")];
}

function createSupportTicketAttachment(ticketId: string, fileName: string) {
  return {
    byteSize: 42,
    contentType: "text/plain",
    createdAt: "2026-06-17T09:35:00.000Z",
    fileName,
    id: `attachment-${ticketId}`,
    sha256: "support-attachment-hash",
    tenantId: "tenant-datatable",
    ticketId,
    uploadedById: "support-agent",
  };
}

function createSupportTicketComments() {
  return [createSupportTicketComment("ticket-a", "İlk kontrol yapıldı.")];
}

function createSupportTicketComment(ticketId: string, body: string) {
  return {
    body,
    createdAt: "2026-06-17T09:40:00.000Z",
    id: `comment-${ticketId}`,
    tenantId: "tenant-datatable",
    ticketId,
    userId: "support-agent",
  };
}

function createHomework() {
  return [
    {
      classId: "class-8a",
      dueAt: "2026-06-20T12:00:00.000Z",
      id: "homework-a",
      sourceMaterialId: "material-a",
      sourceMaterialTitle: "Kesirler Çalışma Kağıdı",
      tenantId: "tenant-datatable",
      title: "Kesirler tekrar",
    },
  ];
}

function createHomeworkMaterials() {
  return [
    {
      description: "Kesir alıştırmaları",
      id: "material-a",
      tenantId: "tenant-datatable",
      title: "Kesirler Çalışma Kağıdı",
    },
    {
      description: "Problem çözme föyü",
      id: "material-b",
      tenantId: "tenant-datatable",
      title: "Problemler Föyü",
    },
  ];
}

function createHomeworkMaterialFiles() {
  return [createHomeworkMaterialFile("material-a", "kesirler.txt")];
}

function createHomeworkMaterialFile(materialId: string, fileName: string) {
  return {
    byteSize: 64,
    contentType: "text/plain",
    createdAt: "2026-06-17T10:00:00.000Z",
    fileName,
    id: `material-file-${materialId}`,
    materialId,
    sha256: "material-file-hash",
    tenantId: "tenant-datatable",
    uploadedById: "teacher-a",
  };
}

function createHomeworkMaterialAssignments() {
  return [createHomeworkMaterialAssignment("material-a", "student-a")];
}

function createHomeworkMaterialAssignment(materialId: string, studentId: string) {
  return {
    createdAt: "2026-06-17T10:10:00.000Z",
    dueAt: "2026-06-21",
    id: `assignment-${materialId}`,
    materialId,
    materialTitle: materialId === "material-a" ? "Kesirler Çalışma Kağıdı" : "Problemler Föyü",
    note: "Ek tekrar",
    studentId,
    tenantId: "tenant-datatable",
  };
}

interface ListMeta {
  limit: number;
  page: number;
  total: number;
  totalPages: number;
}

function listResponse(data: unknown[]): { data: unknown[]; meta: ListMeta } {
  return {
    data,
    meta: {
      limit: Math.max(data.length, 1),
      page: 1,
      total: data.length,
      totalPages: data.length === 0 ? 0 : 1,
    },
  };
}

async function fulfillData(route: Route, data: unknown, meta?: ListMeta) {
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

async function expectMobileDataCells(table: Locator, cells: Array<{ key: string; label: string; text: string }>) {
  const firstRow = table.locator("tbody tr").first();
  for (const cell of cells) {
    const locator = firstRow.locator(`td[data-column-key="${cell.key}"]`);
    await expect(locator).toHaveAttribute("data-label", cell.label);
    await expect(locator).toContainText(cell.text);
  }
}

async function expectMobileDetailCells(table: Locator, cells: Array<{ label: string; text: string }>) {
  const detailRows = table.locator('tbody tr[data-mobile-detail="true"]');
  await expect(detailRows.first()).toBeVisible();

  for (const cell of cells) {
    const detailItem = detailRows.locator(".uh-data-table__mobile-detail-item").filter({ hasText: cell.text }).first();
    await expect(detailItem.locator("dt")).toHaveText(cell.label);
    await expect(detailItem.locator("dd")).toContainText(cell.text);
  }
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

    return Array.from(document.querySelectorAll("label, button, .uh-status-badge, .next-operation-summary__item, .uh-data-table th, .uh-data-table td"))
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

async function expectNoVisibleTextValues(page: Page, label: string, values: string[]) {
  const body = page.locator("body");
  for (const value of values) {
    await expect(body, `${label}: ${value} görünür metinde yer almamalı`).not.toContainText(value);
  }
}
