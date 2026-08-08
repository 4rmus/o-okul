import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("Portal rapor paneli sözleşmesi", () => {
  test("öğrenci portalında karne detayı isteğe bağlı kalır", async ({ page }) => {
    await openStudentPortal(page, { height: 900, width: 1280 });

    const reportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
    await expect(reportSummary).toContainText("Başarı %");
    await expect(reportSummary).toContainText("%66,7");
    await expect(reportSummary).toContainText("20");
    await expect(reportSummary).toContainText("30");
    await expect(reportSummary).toContainText("Ders bilgisi yok");
    await expect(reportSummary).toContainText("Dönem bilgisi yok");
    const reportMetrics = reportSummary.getByRole("region", { name: "Portal rapor metrikleri" });
    await expect(reportMetrics.locator(".uh-metric-card")).toHaveCount(4);
    await expect(reportMetrics).toContainText("Ana karşılaştırma metriği");
    await expect(reportSummary.locator(".next-portal-report-metrics")).toHaveCount(0);
    for (const internalValue of ["course-math", "term-2026", "snapshot-a", "tenant-portal", "student-a"]) {
      await expect(page.locator("body")).not.toContainText(internalValue);
    }

    const branchTable = page.getByRole("table", { name: "Portal branş başarıları" });
    await expectSuccessRatePrimaryColumns(branchTable);
    await expect(branchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(branchTable.getByRole("columnheader", { name: "Net" })).toBeVisible();
    await expect(branchTable.getByRole("columnheader", { name: "Soru" })).toBeVisible();
    await expect(branchTable.getByRole("row", { name: /Matematik/ })).toContainText("%80,0");
    await expect(branchTable.getByRole("row", { name: /Matematik/ })).toContainText("8");
    await expect(branchTable.getByRole("row", { name: /Matematik/ })).toContainText("10");
    await expect(branchTable.getByRole("row", { name: /Türkçe|Turkce/ })).toContainText("%60,0");
    await expect(branchTable.getByRole("row", { name: /Türkçe|Turkce/ })).toContainText("12");
    await expect(branchTable.getByRole("row", { name: /Türkçe|Turkce/ })).toContainText("20");

    const detailToggle = reportSummary.getByRole("button", { name: "Karne detayını göster" });
    await expect(detailToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: "Sınav raporu özet sayfası" })).toHaveCount(0);
    await expect(page.getByText("Öğrenci cevabı")).toHaveCount(0);
    await expect(page.getByText("Doğru cevap")).toHaveCount(0);

    await detailToggle.click();
    await expect(reportSummary.getByRole("button", { name: "Karne detayını gizle" })).toHaveAttribute("aria-expanded", "true");
    const karneSummary = page.getByRole("region", { name: "Sınav raporu özet sayfası" });
    await expect(karneSummary).toBeVisible();
    await expect(karneSummary).toHaveClass(/next-portal-karne-sheet/);
    await expect(karneSummary).not.toHaveClass(/next-list-panel/);
    const karneContext = karneSummary.getByRole("region", { exact: true, name: "Karne rapor bilgileri" });
    const karneContextMetrics = karneContext.getByRole("group", { name: "Karne rapor ölçüleri" });
    await expect(karneContextMetrics).toHaveClass(/uh-info-grid/);
    await expect(karneContextMetrics.locator(".uh-info-item")).toHaveCount(7);
    await expect(karneContext).toContainText("Rapor bağlamı");
    await expect(karneContext).toContainText("Rapor kaydı");
    await expect(karneContext).toContainText("Rapor kaydı hazır");
    await expect(karneContext).not.toContainText("snapshot-a");
    await expect(karneContext).not.toContainText("course-math");
    await expect(karneContext).not.toContainText("term-2026");
    await expect(karneContext).toContainText("Ders bilgisi yok");
    await expect(karneContext).toContainText("Dönem bilgisi yok");
    await expect(karneContext).toContainText("Rapor hazır");
    await expect(karneContext).toContainText("Üretim");
    await expect(karneContext).toContainText("Soru");
    const karneSuccessSummary = karneSummary.getByRole("region", { exact: true, name: "Karne başarı özeti" });
    await expect(karneSuccessSummary).toHaveClass(/uh-metric-grid/);
    await expect(karneSuccessSummary.locator(".uh-metric-card")).toHaveCount(6);
    await expect(karneSuccessSummary).toContainText("Başarı %");
    await expect(karneSuccessSummary).toContainText("%66,7");
    await expect(karneSuccessSummary).toContainText("Soru");
    await expect(karneSuccessSummary).toContainText("30");
    await expect(karneSuccessSummary).toContainText("Net");
    await expect(karneSuccessSummary).toContainText("20,00");
    await expect(karneSuccessSummary).toContainText("Eski hesaplama");
    await expect(reportSummary).not.toContainText("Standart sapma kullanılmadan hesaplanan deneme puanıdır.");
    await expect(karneSummary.getByRole("row", { name: /GELİŞİM/ })).toContainText("-%3,3");
    await expect(karneSummary.getByRole("table", { name: "Branş psikometri tablosu" })).toContainText("%");
    await expect(page.getByRole("region", { name: "Sınav raporu detaylı deneme analizi" })).toContainText("Öğrenci cevabı");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/ogrenci?examId=exam-demo-isem-lgs-1");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const mobileReportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
    await expect(mobileReportSummary).toContainText("Başarı %");
    await expect(page.getByRole("region", { name: "Sınav raporu özet sayfası" })).toHaveCount(0);
    await mobileReportSummary.getByRole("button", { name: "Karne detayını göster" }).click();
    const mobileKarneSummary = page.getByRole("region", { name: "Sınav raporu özet sayfası" });
    await expect(mobileKarneSummary).toBeVisible();
    await expect(mobileKarneSummary).toHaveClass(/next-portal-karne-sheet/);
    const mobileKarneSuccessSummary = mobileKarneSummary.getByRole("region", { exact: true, name: "Karne başarı özeti" });
    await expect(mobileKarneSuccessSummary).toHaveClass(/uh-metric-grid/);
    await expect(mobileKarneSuccessSummary).toContainText("Başarı %");
    await expect(mobileKarneSuccessSummary).toContainText("%66,7");
    await expect(mobileKarneSuccessSummary).toContainText("Net");
    await expect(mobileKarneSuccessSummary).toContainText("20,00");
    const mobileBranchTable = mobileKarneSummary.getByRole("table", { name: "Branş psikometri tablosu" });
    await expectSuccessRatePrimaryColumns(mobileBranchTable);
    await expect(mobileBranchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("columnheader", { exact: true, name: "Net" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("columnheader", { exact: true, name: "Soru sayısı" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("row", { name: /Matematik/ })).toContainText("%80,0");
    await expect(mobileBranchTable.getByRole("row", { name: /Türkçe|Turkce/ })).toContainText("%60,0");
    await expectNoHorizontalOverflow(page);
    await expectNoUnlabeledControls(page);
    await expectNoClippedVisibleText(page);
  });
});

async function openStudentPortal(page: Page, viewport: { height: number; width: number }) {
  await page.setViewportSize(viewport);
  await installPortalApiMocks(page);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/ogrenci?examId=exam-demo-isem-lgs-1");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installPortalApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    const response = portalApiResponse(pathName);
    await fulfillData(route, response);
  });
}

function portalApiResponse(pathName: string): unknown {
  if (pathName === "/auth/refresh") return createAuthResponse();
  if (pathName === "/me/tenant") return createTenantResponse();
  if (pathName === "/me/notification-devices") return [];
  if (pathName === "/me/student/profile") return createStudentProfile();
  if (pathName === "/me/student/guardians") return [];
  if (pathName === "/me/student/guardian-links") return [];
  if (pathName === "/me/student/class-history") return createClassHistory();
  if (pathName === "/me/student/enrollments") return createEnrollments();
  if (pathName === "/me/student/announcements") return [];
  if (pathName === "/me/student/homework/material-assignments") return [];
  if (pathName === "/me/student/support-tickets") return [];
  if (pathName === "/me/student/attendance") return [];
  if (pathName === "/me/student/attendance/summary") return { absent: 0, excused: 0, late: 0, present: 30, studentId: "student-a", total: 30 };
  if (pathName === "/me/student/teacher-notes") return [];
  if (pathName === "/me/student/development-assessments") return [];
  if (pathName === "/me/student/reports") return [{ examId: "exam-demo-isem-lgs-1", latestGeneratedAt: "2026-06-17T10:00:00.000Z", latestReadySnapshotId: "snapshot-ready", title: "İSEM - LGS - 1" }];
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/latest") return createStudentReport();
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/latest/error-booklet") return createErrorBooklet();
  if (pathName === "/me/student/reports/exam-demo-isem-lgs-1/progress") return createProgress();
  if (pathName === "/courses") return [];
  if (pathName === "/academic-terms") return [];
  return [];
}

function createAuthResponse() {
  return {
    accessToken: "portal-report-access-token",
    session: {
      id: "session-portal-report",
      membershipVersion: 1,
      roles: ["STUDENT"],
      status: "ACTIVE",
      subjectId: "student-a",
      subjectType: "STUDENT",
      tenantId: "tenant-portal",
      userId: "student-a",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@portal-akademi.example",
    id: "tenant-portal",
    institutionType: "Dershane",
    name: "Portal Akademi",
  };
}

function createStudentProfile() {
  return {
    classId: "class-8a",
    firstName: "Ada",
    id: "student-a",
    lastName: "Kaya",
    status: "ACTIVE",
    studentNo: "8001",
    tenantId: "tenant-portal",
  };
}

function createClassHistory() {
  return [{ classId: "class-8a", className: "8-A", id: "history-a", startsAt: "2026-09-01T00:00:00.000Z", studentId: "student-a", tenantId: "tenant-portal", termId: "term-2026" }];
}

function createEnrollments() {
  return [{ classId: "class-8a", className: "8-A", id: "enrollment-a", startsAt: "2026-09-01T00:00:00.000Z", status: "ACTIVE", studentId: "student-a", tenantId: "tenant-portal", termId: "term-2026" }];
}

function createStudentReport() {
  return {
    branches: [
      { blank: 2, branch: "Matematik", classNetAverage: 10.5, correct: 8, generalNetAverage: 9.8, net: 8, questionCount: 10, schoolNetAverage: 10.8, successRate: 80, wrong: 0 },
      { blank: 6, branch: "Turkce", classNetAverage: 11.2, correct: 12, generalNetAverage: 10.1, net: 12, questionCount: 20, schoolNetAverage: 11.9, successRate: 60, wrong: 2 },
    ],
    classId: "class-8a",
    className: "8-A",
    courseId: "course-math",
    examId: "exam-demo-isem-lgs-1",
    examStartsAt: "2026-06-10T09:00:00.000Z",
    examTitle: "LGS Hazirlik Denemesi",
    generatedAt: "2026-06-10T12:00:00.000Z",
    institutionName: "Portal Akademi",
    outcomes: [
      { branch: "Matematik", correct: 8, net: 7.5, outcomeCode: "M.8.1", questionCount: 10, successRate: 75, wrong: 2 },
      { branch: "Turkce", correct: 9, net: 8.5, outcomeCode: "T.8.2", questionCount: 10, successRate: 85, wrong: 1 },
    ],
    participantNo: "176",
    questions: createQuestionSummaries(),
    resultKey: "student-a",
    snapshotId: "snapshot-a",
    statistics: {
      branches: [],
      class: { outOf: 2, percentile: 100, rank: 1 },
      general: { outOf: 2, percentile: 100, rank: 1 },
      standardScore: 440,
    },
    studentId: "student-a",
    studentName: "Ada Kaya",
    tenantId: "tenant-portal",
    termId: "term-2026",
    total: { blank: 8, correct: 20, estimatedRawScore: 410, net: 20, questionCount: 30, standardScore: 410, successRate: 66.7, wrong: 2 },
  };
}

function createQuestionSummaries() {
  return [
    { answer: "A", branch: "Matematik", correctAnswer: "A", outcomeCode: "M.8.1", questionNo: 1, status: "CORRECT" },
    { answer: "B", branch: "Matematik", correctAnswer: "C", outcomeCode: "M.8.1", questionNo: 2, status: "WRONG" },
    { answer: "", branch: "Turkce", correctAnswer: "D", outcomeCode: "T.8.2", questionNo: 3, status: "BLANK" },
  ];
}

function createErrorBooklet() {
  return {
    examId: "exam-demo-isem-lgs-1",
    generatedAt: "2026-06-10T12:00:00.000Z",
    items: createQuestionSummaries().filter((question) => question.status !== "CORRECT"),
    snapshotId: "snapshot-a",
    studentId: "student-a",
    tenantId: "tenant-portal",
  };
}

function createProgress() {
  return {
    examId: "exam-demo-isem-lgs-1",
    netDelta: -1,
    points: [
      { examTitle: "Mayis Denemesi", generatedAt: "2026-05-10T12:00:00.000Z", snapshotId: "snapshot-prev", total: { blank: 2, correct: 20, net: 21, questionCount: 30, standardScore: 405, successRate: 70, wrong: 8 } },
      { examTitle: "LGS Hazirlik Denemesi", generatedAt: "2026-06-10T12:00:00.000Z", snapshotId: "snapshot-a", total: { blank: 8, correct: 20, net: 20, questionCount: 30, standardScore: 410, successRate: 66.7, wrong: 2 } },
    ],
    standardScoreDelta: 5,
    successRateDelta: -3.3,
    studentId: "student-a",
    tenantId: "tenant-portal",
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    return documentElement.scrollWidth - documentElement.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectSuccessRatePrimaryColumns(table: Locator) {
  const headers = (await table.getByRole("columnheader").allTextContents()).map((text) => text.trim());
  const questionHeaderIndex = headers.findIndex((header) => header === "Soru" || header === "Soru sayısı");
  expect(headers.indexOf("Başarı %")).toBeGreaterThanOrEqual(0);
  expect(headers.indexOf("Başarı %")).toBeLessThan(headers.indexOf("Net"));
  expect(headers.indexOf("Başarı %")).toBeLessThan(questionHeaderIndex);
}

async function expectNoUnlabeledControls(page: Page) {
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
  expect(unlabeledControls).toEqual([]);
}

async function expectNoClippedVisibleText(page: Page) {
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
        ".next-portal-report-summary",
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

  expect(clippedTexts).toEqual([]);
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
    "access-control-allow-origin": new URL(route.request().url()).origin === appOrigin ? appOrigin : corsHeaders["access-control-allow-origin"],
  };
}
