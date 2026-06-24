import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("Rapor çalışma alanı sözleşmesi", () => {
  test("aktif rapor sekmesi URL state ile korunur", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar?tab=exports", { height: 960, width: 1440 });

    await expect(page.getByRole("tab", { name: "Çıktılar" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("exports");

    await page.getByRole("tab", { name: "Kurum Analitiği" }).click();
    await expect(page.getByRole("tab", { name: "Kurum Analitiği" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("analytics");

    await page.getByRole("tab", { name: "Sorgu / Üretim" }).click();
    await expect(page.getByRole("tab", { name: "Sorgu / Üretim" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBeNull();
  });

  test("öğrenci listesini yalnız rapor sorgusunda yükler", async ({ page }) => {
    const studentRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/v1/students") {
        studentRequests.push(request.url());
      }
    });

    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    expect(studentRequests).toHaveLength(0);

    await page.getByRole("button", { name: "Raporu getir" }).click();

    await expect(page.getByRole("tab", { name: "Kurum Analitiği" })).toHaveAttribute("aria-selected", "true");
    expect(studentRequests).toHaveLength(1);
  });

  test("sınıfsız raporda genel öğrenci listesi yerine katılımcı kayıtlarını yükler", async ({ page }) => {
    const broadStudentRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && url.pathname === "/api/v1/students",
    );
    const scopedStudentRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && /^\/api\/v1\/students\/student-[ab]$/.test(url.pathname),
    );
    const studentDetailRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && /^\/api\/v1\/exams\/[^/]+\/reports\/(?:snapshots\/[^/]+\/students\/[^/]+(?:\/error-booklet)?|students\/[^/]+\/progress)$/.test(url.pathname),
    );

    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    await page.getByRole("combobox", { name: "Sınav" }).selectOption("exam-report-general");
    await page.getByRole("button", { name: "Raporu getir" }).click();

    await expect(page.getByRole("tab", { name: "Kurum Analitiği" })).toHaveAttribute("aria-selected", "true");
    expect(broadStudentRequests).toHaveLength(0);
    await expect.poll(() => scopedStudentRequests.length).toBe(2);
    expect(studentDetailRequests).toHaveLength(0);

    await page.getByRole("tab", { name: "Öğrenci Sonuçları" }).click();
    const studentResultsTable = page.getByRole("table", { name: "Öğrenci sıralamaları" });
    await expect(studentResultsTable).toContainText("Ada Kaya");
    await expect(studentResultsTable).toContainText("Bora Yılmaz");
    expect(scopedStudentRequests.filter((requestUrl) => requestUrl.endsWith("/students/student-a"))).toHaveLength(1);
    expect(scopedStudentRequests.filter((requestUrl) => requestUrl.endsWith("/students/student-b"))).toHaveLength(1);
  });

  test("rapor sekmeleri klavyede roving focus ve panel odağını korur", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    const queryTab = page.getByRole("tab", { name: "Sorgu / Üretim" });
    const analyticsTab = page.getByRole("tab", { name: "Kurum Analitiği" });
    const studentsTab = page.getByRole("tab", { name: "Öğrenci Sonuçları" });
    const exportsTab = page.getByRole("tab", { name: "Çıktılar" });

    await expect(queryTab).toHaveAttribute("aria-selected", "true");
    await expect(queryTab).toHaveAttribute("tabindex", "0");
    await expect(analyticsTab).toHaveAttribute("tabindex", "-1");

    await queryTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(analyticsTab).toBeFocused();
    await expect(analyticsTab).toHaveAttribute("aria-selected", "true");
    await expect(analyticsTab).toHaveAttribute("tabindex", "0");
    await expect(queryTab).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowRight");
    await expect(studentsTab).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Öğrenci Sonuçları" })).toBeVisible();

    await page.keyboard.press("End");
    await expect(exportsTab).toBeFocused();
    await expect(exportsTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Home");
    await expect(queryTab).toBeFocused();
    await expect(queryTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowLeft");
    await expect(exportsTab).toBeFocused();
    await expect(exportsTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel", { name: "Çıktılar" })).toBeFocused();
  });

  test("READY snapshot bağlam, girdi ve çıktı hazırlığını görünür tutar", async ({ page }) => {
    const studentListRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && url.pathname === "/api/v1/students",
    );
    const studentDetailRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && /^\/api\/v1\/exams\/[^/]+\/reports\/(?:snapshots\/[^/]+\/students\/[^/]+(?:\/error-booklet)?|students\/[^/]+\/progress)$/.test(url.pathname),
    );

    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    await expect(page.getByRole("heading", { level: 1, name: "Sınav Raporu" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sorgu / Üretim" })).toHaveAttribute("aria-selected", "true");
    expect(studentListRequests).toHaveLength(0);
    expect(studentDetailRequests).toHaveLength(0);

    const reportFilters = page.getByLabel("Rapor filtreleri").locator("select");
    await reportFilters.nth(0).selectOption("campus-main");
    await reportFilters.nth(1).selectOption("grade-8");
    await reportFilters.nth(2).selectOption("class-8a");
    await reportFilters.nth(3).selectOption("course-math");
    await reportFilters.nth(4).selectOption("term-2026");

    const snapshotsRequest = page.waitForRequest(
      (request) =>
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/v1/exams/exam-report-ready/reports/snapshots",
    );
    await page.getByRole("button", { name: "Raporu getir" }).click();
    const snapshotsUrl = new URL((await snapshotsRequest).url());
    expect(snapshotsUrl.searchParams.get("campusId")).toBe("campus-main");
    expect(snapshotsUrl.searchParams.get("gradeLevelId")).toBe("grade-8");
    expect(snapshotsUrl.searchParams.get("classId")).toBe("class-8a");
    expect(snapshotsUrl.searchParams.get("courseId")).toBe("course-math");
    expect(snapshotsUrl.searchParams.get("termId")).toBe("term-2026");

    await expect(page.getByRole("tab", { name: "Kurum Analitiği" })).toHaveAttribute("aria-selected", "true");
    expect(studentListRequests).toHaveLength(1);
    expect(new URL(studentListRequests[0]!).searchParams.get("classId")).toBe("class-8a");
    expect(studentDetailRequests).toHaveLength(0);
    const contextStrip = page.locator(".next-report-context-strip");
    await expect(contextStrip).toHaveClass(/uh-info-grid/);
    await expect(contextStrip.locator(".uh-info-item")).toHaveCount(6);
    await expect(contextStrip).toContainText("LGS Rapor Denemesi");
    await expect(contextStrip).not.toContainText("exam-report-ready");
    await expect(contextStrip).toContainText("Hazır");
    await expect(contextStrip).toContainText("17.06.2026");
    await expect(contextStrip).toContainText("Ana Kampüs");
    await expect(contextStrip).toContainText("8-A");
    await expect(contextStrip).toContainText("Matematik");
    await expect(contextStrip).toContainText("2026 Bahar");
    await expect(contextStrip).toContainText("1 sonuç girdisi");
    await expect(contextStrip).toContainText("cevap anahtarı");
    await expect(contextStrip).toContainText("Excel/PDF hazır");

    const analyticsPanel = page.getByRole("tabpanel", { name: "Kurum Analitiği" });
    await expect(analyticsPanel.getByRole("region", { name: "Kurum analitiği" })).toContainText("Başarı %");
    await expect(analyticsPanel.getByRole("region", { name: "Kurum analitiği" })).toContainText("%81,7");
    await expect(analyticsPanel.getByRole("region", { name: "Rapor özeti" }).locator(".uh-metric-card")).toHaveCount(8);
    await expect(analyticsPanel.locator(".next-report-summary-card")).toHaveCount(0);

    await page.getByRole("tab", { name: "Öğrenci Sonuçları" }).click();
    const studentResultsTable = page.getByRole("table", { name: "Öğrenci sıralamaları" });
    await expect(studentResultsTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(studentResultsTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(studentResultsTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
    await expect(studentResultsTable).toContainText("Ada Kaya");
    await expect(studentResultsTable).toContainText("Bora Yılmaz");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("Ada Kaya");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("%81,7");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("24,5");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("30");
    await expect(studentResultsTable.getByRole("row").nth(2)).toContainText("Bora Yılmaz");
    await expect(studentResultsTable.getByRole("row").nth(2)).toContainText("%60,0");
    await expect(studentResultsTable.getByRole("row").nth(2)).toContainText("30");
    await expect(studentResultsTable.getByRole("row").nth(2)).toContainText("50");

    await studentResultsTable.getByRole("button", { name: "Ada Kaya karnesini aç" }).click();
    await expect(page.getByRole("tab", { name: "Karne Önizleme" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => studentDetailRequests.length).toBe(3);
    const karnePanel = page.getByRole("tabpanel", { name: "Karne Önizleme" });
    const karneSheet = karnePanel.getByRole("region", { name: "Öğrenci karne özeti özet sayfası" });
    await expect(karneSheet).toHaveClass(/next-report-karne-sheet/);
    await expect(karneSheet).not.toHaveClass(/next-report-list/);
    const karneContext = karneSheet.getByRole("region", { exact: true, name: "Karne rapor bağlamı" });
    const karneContextMetrics = karneContext.getByRole("group", { name: "Karne rapor bağlam metrikleri" });
    await expect(karneContextMetrics).toHaveClass(/uh-info-grid/);
    await expect(karneContextMetrics.locator(".uh-info-item")).toHaveCount(6);
    await expect(karneContext).toContainText("Rapor bağlamı");
    await expect(karneContext).toContainText("Rapor kaydı");
    await expect(karneContext).toContainText("Rapor kaydı hazır");
    await expect(karneContext).not.toContainText("snapshot-ready");
    await expect(karneContext).toContainText("Excel/PDF hazır");
    await expect(karneContext).toContainText("Üretim");
    await expect(karneContext).toContainText("Soru");
    const karneSummary = karneSheet.getByRole("region", { exact: true, name: "Karne başarı özeti" });
    await expect(karneSummary).toHaveClass(/uh-metric-grid/);
    await expect(karneSummary.locator(".uh-metric-card")).toHaveCount(7);
    await expect(karneSummary).toContainText("Başarı %");
    await expect(karneSummary).toContainText("%66,7");
    await expect(karneSummary).toContainText("Soru");
    await expect(karneSummary).toContainText("30");
    await expect(karneSummary).toContainText("Net");
    await expect(karneSummary).toContainText("20,0");
    await expect(karneSummary).toContainText("Genel sıra");
    const branchPsychometryTable = karnePanel.getByRole("table", { name: "Öğrenci branş karne tablosu" });
    await expectSuccessRatePrimaryColumns(branchPsychometryTable);
    await expect(branchPsychometryTable.getByRole("row", { name: /Matematik/ })).toContainText("%80,0");
    await expect(branchPsychometryTable.getByRole("row", { name: /Matematik/ })).toContainText("8");
    await expect(branchPsychometryTable.getByRole("row", { name: /Matematik/ })).toContainText("10");
    await expect(branchPsychometryTable.getByRole("row", { name: /Türkçe/ })).toContainText("%60,0");
    await expect(branchPsychometryTable.getByRole("row", { name: /Türkçe/ })).toContainText("12");
    await expect(branchPsychometryTable.getByRole("row", { name: /Türkçe/ })).toContainText("20");
    const errorBookletRegion = page.getByRole("region", { name: "Hata kitapçığı" });
    await expect(errorBookletRegion).toHaveClass(/next-report-output-panel/);
    await expect(errorBookletRegion.getByRole("table", { name: "Seçili öğrenci hata kitapçığı" })).toBeVisible();

    await page.getByRole("tab", { name: "Çıktılar" }).click();
    const exportsRegion = page.getByRole("region", { name: "Rapor çıktıları" });
    await expect(exportsRegion).toHaveClass(/next-report-output-panel/);
    await expect(exportsRegion).toContainText("Hazır");
    await expect(exportsRegion.getByRole("button", { name: "Excel indir" })).toBeEnabled();
    await expect(exportsRegion.getByRole("button", { name: "PDF indir" })).toBeEnabled();

    await expectNoHorizontalOverflow(page, "report-workspace-ready");
    await expectNoUnlabeledControls(page, "report-workspace-ready");
  });

  test("STALE snapshot analizi açık bırakır ama çıktıları kilitler", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar", { height: 844, width: 390 });

    await page.getByRole("combobox", { name: "Sınav" }).selectOption("exam-report-stale");
    await page.getByRole("button", { name: "Raporu getir" }).click();

    await expect(page.getByRole("tab", { name: "Kurum Analitiği" })).toHaveAttribute("aria-selected", "true");
    const contextStrip = page.locator(".next-report-context-strip");
    await expect(contextStrip).toHaveClass(/uh-info-grid/);
    await expect(contextStrip.locator(".uh-info-item")).toHaveCount(6);
    await expect(contextStrip).toContainText("Eski Rapor Denemesi");
    await expect(contextStrip).not.toContainText("exam-report-stale");
    await expect(contextStrip).toContainText("Eski");
    await expect(contextStrip).toContainText("READY snapshot gerekli");
    await expect(contextStrip).toContainText("1 sonuç girdisi");
    await expect(page.getByText("Snapshot çıktıya hazır değil")).toBeVisible();

    await page.getByRole("tab", { name: "Çıktılar" }).click();
    const exportsRegion = page.getByRole("region", { name: "Rapor çıktıları" });
    await expect(exportsRegion).toHaveClass(/next-report-output-panel/);
    await expect(exportsRegion).toContainText("Eski");
    await expect(exportsRegion.getByRole("button", { name: "Excel indir" })).toBeDisabled();
    await expect(exportsRegion.getByRole("button", { name: "PDF indir" })).toBeDisabled();

    await page.getByRole("tab", { name: "Karne Önizleme" }).click();
    const karnePanel = page.getByRole("tabpanel", { name: "Karne Önizleme" });
    await expect(karnePanel).toContainText("Çıktı: READY snapshot gerekli");

    await expectNoHorizontalOverflow(page, "report-workspace-stale-mobile");
    await expectNoUnlabeledControls(page, "report-workspace-stale-mobile");
  });

  test("READY snapshot mobil karne önizleme başarı net ve soru bağlamını taşmadan korur", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar", { height: 780, width: 360 });

    await page.getByRole("button", { name: "Raporu getir" }).click();
    await expect(page.getByRole("tab", { name: "Kurum Analitiği" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Öğrenci Sonuçları" }).click();
    await page.getByRole("table", { name: "Öğrenci sıralamaları" }).getByRole("button", { name: "Ada Kaya karnesini aç" }).click();

    const karnePanel = page.getByRole("tabpanel", { name: "Karne Önizleme" });
    const karneSheet = karnePanel.getByRole("region", { name: "Öğrenci karne özeti özet sayfası" });
    const karneContext = karneSheet.getByRole("region", { exact: true, name: "Karne rapor bağlamı" });
    const karneContextMetrics = karneContext.getByRole("group", { name: "Karne rapor bağlam metrikleri" });
    await expect(karneContextMetrics).toHaveClass(/uh-info-grid/);
    await expect(karneContextMetrics.locator(".uh-info-item")).toHaveCount(6);
    await expect(karneContext).toContainText("Excel/PDF hazır");
    await expect(karneContext).toContainText("Soru");
    const karneSummary = karneSheet.getByRole("region", { exact: true, name: "Karne başarı özeti" });
    await expect(karneSummary).toHaveClass(/uh-metric-grid/);
    await expect(karneSummary.locator(".uh-metric-card")).toHaveCount(7);
    await expect(karneSummary).toContainText("Başarı %");
    await expect(karneSummary).toContainText("%66,7");
    await expect(karneSummary).toContainText("Net");
    await expect(karneSummary).toContainText("20,0");
    const mobileBranchTable = karnePanel.getByRole("table", { name: "Öğrenci branş karne tablosu" });
    await expectSuccessRatePrimaryColumns(mobileBranchTable);
    await expect(mobileBranchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("columnheader", { exact: true, name: "Net" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("columnheader", { exact: true, name: "Soru sayısı" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("row", { name: /Matematik/ })).toContainText("%80,0");
    await expect(mobileBranchTable.getByRole("row", { name: /Türkçe/ })).toContainText("%60,0");

    await expectNoHorizontalOverflow(page, "report-workspace-ready-karne-mobile");
    await expectNoUnlabeledControls(page, "report-workspace-ready-karne-mobile");
    await expectNoClippedVisibleText(page, "report-workspace-ready-karne-mobile");
  });
});

async function openWithReportMocks(page: Page, pathName: string, viewport: { height: number; width: number }) {
  await page.setViewportSize(viewport);
  await installReportApiMocks(page);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(pathName);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installReportApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    const response = mockReportApiResponse(pathName, route.request().method());
    await fulfillData(route, response.data, response.meta);
  });
}

function mockReportApiResponse(pathName: string, method: string): { data: unknown; meta?: ListMeta } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse() };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/campuses") return listResponse([{ id: "campus-main", name: "Ana Kampüs", tenantId: "tenant-report" }]);
  if (pathName === "/classes") return listResponse([{ campusId: "campus-main", gradeLevelId: "grade-8", id: "class-8a", name: "8-A", tenantId: "tenant-report" }]);
  if (pathName === "/courses") return listResponse([{ id: "course-math", name: "Matematik", tenantId: "tenant-report" }]);
  if (pathName === "/grade-levels") return listResponse([{ id: "grade-8", name: "8. Sınıf", tenantId: "tenant-report" }]);
  if (pathName === "/academic-terms") return listResponse([{ id: "term-2026", name: "2026 Bahar", tenantId: "tenant-report" }]);
  if (pathName === "/students") return listResponse(createStudents());
  if (pathName === "/students/student-a") return { data: createStudents()[0] };
  if (pathName === "/students/student-b") return { data: createStudents()[1] };
  if (pathName === "/exams") {
    return listResponse([
      { courseId: "course-math", id: "exam-report-ready", status: "PUBLISHED", tenantId: "tenant-report", title: "LGS Rapor Denemesi" },
      { courseId: "course-math", id: "exam-report-stale", status: "DRAFT", tenantId: "tenant-report", title: "Eski Rapor Denemesi" },
      { courseId: "course-math", id: "exam-report-general", status: "DRAFT", tenantId: "tenant-report", title: "Genel Rapor Denemesi" },
    ]);
  }
  if (pathName === "/exams/exam-report-ready/reports/snapshots") return { data: [createReportSnapshot("exam-report-ready", "READY")] };
  if (pathName === "/exams/exam-report-stale/reports/snapshots") return { data: [createReportSnapshot("exam-report-stale", "STALE")] };
  if (pathName === "/exams/exam-report-general/reports/snapshots") return { data: [createReportSnapshot("exam-report-general", "READY", { classId: null })] };
  if (pathName === "/exams/exam-report-ready/participants" || pathName === "/exams/exam-report-stale/participants" || pathName === "/exams/exam-report-general/participants") return { data: createParticipants() };
  if (pathName === "/exams/exam-report-ready/reports/snapshots/snapshot-ready/students/student-a") return { data: createStudentReport() };
  if (pathName === "/exams/exam-report-ready/reports/snapshots/snapshot-ready/students/student-a/error-booklet") return { data: createErrorBooklet() };
  if (pathName === "/exams/exam-report-ready/reports/students/student-a/progress") return { data: createProgress() };
  if (/^\/exams\/[^/]+\/reports\/snapshots\/[^/]+\/students\/student-a$/.test(pathName)) return { data: null };
  if (/^\/exams\/[^/]+\/reports\/snapshots\/[^/]+\/students\/student-a\/error-booklet$/.test(pathName)) return { data: null };
  if (/^\/exams\/[^/]+\/reports\/students\/student-a\/progress$/.test(pathName)) return { data: null };
  if (method === "POST" && /^\/exams\/[^/]+\/reports\/generation-jobs$/.test(pathName)) return { data: { jobId: "job-report-a", status: "queued" } };

  return { data: [] };
}

function createAuthResponse() {
  return {
    accessToken: "report-access-token",
    session: {
      id: "session-report",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-report",
      userId: "user-report-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@rapor-akademi.example",
    id: "tenant-report",
    institutionType: "Dershane",
    name: "Rapor Akademi",
  };
}

function createStudents() {
  return [
    { classId: "class-8a", firstName: "Ada", id: "student-a", lastName: "Kaya", studentNo: "1001", tenantId: "tenant-report" },
    { classId: "class-8a", firstName: "Bora", id: "student-b", lastName: "Yılmaz", studentNo: "1002", tenantId: "tenant-report" },
  ];
}

function createParticipants() {
  return [
    {
      bookletType: "A",
      examId: "exam-report-ready",
      id: "participant-a",
      participantNo: "001",
      status: "ATTENDED",
      studentId: "student-a",
      tenantId: "tenant-report",
    },
    {
      bookletType: "B",
      examId: "exam-report-ready",
      id: "participant-b",
      participantNo: "002",
      status: "ATTENDED",
      studentId: "student-b",
      tenantId: "tenant-report",
    },
  ];
}

function createReportSnapshot(examId: string, status: "READY" | "STALE", options: { classId?: string | null } = {}) {
  const classId = options.classId === undefined ? "class-8a" : options.classId;
  return {
    campusId: "campus-main",
    ...(classId ? { classId } : {}),
    courseId: "course-math",
    createdAt: "2026-06-17T12:00:00.000Z",
    examId,
    generatedAt: "2026-06-17T12:00:00.000Z",
    gradeLevelId: "grade-8",
    id: status === "READY" ? "snapshot-ready" : "snapshot-stale",
    inputRefs: {
      answerKeyId: "answer-key-a",
      parserConfigId: "parser-config-a",
      resultKeys: ["result-a"],
    },
    reportType: "EXAM_RESULT_SUMMARY",
    snapshotData: {
      averages: {
        blank: 1,
        correct: 25,
        net: 24.5,
        questionCount: 30,
        standardScore: 440,
        successRate: 81.7,
        wrong: 4,
      },
      branches: [
        { blank: 0, branch: "Matematik", correct: 12, net: 11.5, questionCount: 15, resultCount: 1, successRate: 80, wrong: 3 },
        { blank: 1, branch: "Türkçe", correct: 13, net: 13, questionCount: 15, resultCount: 1, successRate: 86.7, wrong: 1 },
      ],
      classes: [
        {
          averages: { blank: 1, correct: 25, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
          classId: "class-8a",
          className: "8-A",
          resultCount: 2,
        },
      ],
      generatedAt: "2026-06-17T12:00:00.000Z",
      outcomes: [
        { branch: "Matematik", correct: 4, net: 4, outcomeCode: "M.8.1.1", questionCount: 5, resultCount: 1, successRate: 80, wrong: 1 },
      ],
      resultCount: 2,
      students: [
        {
          classId: "class-8a",
          className: "8-A",
          resultKey: "result-a",
          studentId: "student-a",
          total: {
            blank: 1,
            correct: 25,
            net: 24.5,
            questionCount: 30,
            successRate: 81.7,
            wrong: 4,
          },
        },
        {
          classId: "class-8a",
          className: "8-A",
          resultKey: "result-b",
          studentId: "student-b",
          total: {
            blank: 10,
            correct: 35,
            net: 30,
            questionCount: 50,
            successRate: 60,
            wrong: 5,
          },
        },
      ],
    },
    status,
    tenantId: "tenant-report",
    termId: "term-2026",
    updatedAt: "2026-06-17T12:00:00.000Z",
  };
}

function createStudentReport() {
  return {
    branches: [
      { blank: 2, branch: "Matematik", classNetAverage: 10.5, correct: 8, generalNetAverage: 9.8, net: 8, questionCount: 10, schoolNetAverage: 10.8, successRate: 80, wrong: 0 },
      { blank: 6, branch: "Türkçe", classNetAverage: 12.2, correct: 12, generalNetAverage: 11.1, net: 12, questionCount: 20, schoolNetAverage: 12.9, successRate: 60, wrong: 2 },
    ],
    classId: "class-8a",
    className: "8-A",
    courseId: "course-math",
    examId: "exam-report-ready",
    examStartsAt: "2026-06-17T09:00:00.000Z",
    examTitle: "LGS Rapor Denemesi",
    generatedAt: "2026-06-17T12:00:00.000Z",
    institutionName: "Rapor Akademi",
    outcomes: [
      { branch: "Matematik", correct: 4, net: 4, outcomeCode: "M.8.1.1", questionCount: 5, successRate: 80, wrong: 1 },
    ],
    participantNo: "001",
    bookletType: "A",
    questions: createQuestionSummaries(),
    resultKey: "result-a",
    snapshotId: "snapshot-ready",
    statistics: {
      branches: [],
      class: { outOf: 1, percentile: 1, rank: 1 },
      general: { outOf: 1, percentile: 1, rank: 1 },
      standardScore: 440,
    },
    studentId: "student-a",
    studentName: "Ada Kaya",
    tenantId: "tenant-report",
    termId: "term-2026",
    total: {
      blank: 8,
      correct: 20,
      net: 20,
      questionCount: 30,
      standardScore: 410,
      successRate: 66.7,
      wrong: 2,
    },
  };
}

function createQuestionSummaries() {
  return [
    { answer: "A", branch: "Matematik", correctAnswer: "A", outcomeCode: "M.8.1.1", questionNo: 1, status: "CORRECT" },
    { answer: "B", branch: "Matematik", correctAnswer: "C", outcomeCode: "M.8.1.1", questionNo: 2, status: "WRONG" },
    { answer: "", branch: "Türkçe", correctAnswer: "D", outcomeCode: "T.8.2.1", questionNo: 3, status: "BLANK" },
  ];
}

function createErrorBooklet() {
  return {
    examId: "exam-report-ready",
    generatedAt: "2026-06-17T12:00:00.000Z",
    items: createQuestionSummaries().filter((question) => question.status !== "CORRECT"),
    snapshotId: "snapshot-ready",
    studentId: "student-a",
    tenantId: "tenant-report",
  };
}

function createProgress() {
  return {
    examId: "exam-report-ready",
    netDelta: 3.5,
    points: [
      { examTitle: "Mayıs Denemesi", generatedAt: "2026-05-17T12:00:00.000Z", snapshotId: "snapshot-prev", total: { blank: 2, correct: 22, net: 21, questionCount: 30, standardScore: 405, successRate: 70, wrong: 6 } },
      { examTitle: "LGS Rapor Denemesi", generatedAt: "2026-06-17T12:00:00.000Z", snapshotId: "snapshot-ready", total: { blank: 8, correct: 20, net: 20, questionCount: 30, standardScore: 410, successRate: 66.7, wrong: 2 } },
    ],
    standardScoreDelta: 5,
    studentId: "student-a",
    tenantId: "tenant-report",
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

function trackApiRequests(page: Page, predicate: (url: URL, method: string) => boolean): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (predicate(url, request.method())) {
      requests.push(request.url());
    }
  });
  return requests;
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return Math.max(documentElement.scrollWidth - documentElement.clientWidth, body.scrollWidth - body.clientWidth);
  });

  expect(overflow, `${label}: yatay taşma ${overflow}px`).toBeLessThanOrEqual(1);
}

async function expectSuccessRatePrimaryColumns(table: Locator) {
  const headers = (await table.getByRole("columnheader").allTextContents()).map((text) => text.trim());
  const questionHeaderIndex = headers.findIndex((header) => header === "Soru" || header === "Soru sayısı");
  expect(headers.indexOf("Başarı %")).toBeGreaterThanOrEqual(0);
  expect(headers.indexOf("Başarı %")).toBeLessThan(headers.indexOf("Net"));
  expect(headers.indexOf("Başarı %")).toBeLessThan(questionHeaderIndex);
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

    return Array.from(document.querySelectorAll(
      [
        "a",
        "label",
        "button",
        ".uh-status-badge",
        ".next-report-context-strip > .uh-info-item",
        ".next-report-export-grid > div",
        ".next-karne-context-strip .uh-info-item",
        ".next-karne-summary-strip .uh-metric-card",
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
