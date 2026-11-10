import { expect, test, type Page, type Route } from "@playwright/test";

import {
  buildAttendanceCalendarMonth,
  defaultCalendarMonth,
  describeCalendarDay,
  shiftMonth,
} from "../app/(app)/portals/_shared/attendance-calendar-model.js";
import { buildStudentTimeline } from "../app/(app)/kurum/ogrenciler/student-timeline-model.js";
import { buildAttendanceStripDays, buildStudentNetOverview, studentNetDomain } from "../app/(app)/kurum/ogrenciler/student-profile-model.js";
import type { ReportStudentProgressPoint } from "@o-okul/shared-types";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

const rawStudentDetailPiiValues = [
  "ada@example.test",
  "+905551112233",
  "+905551110001",
  "+905551110002",
  "12345678901",
  "guardian-mother",
  "guardian-father",
] as const;

test.describe("Öğrenci ilişki haritası", () => {
  test("net comparison uses frozen matching scope and the last two results", () => {
    const first = netPoint("exam-first", "snapshot-first", 5, "2026-09-01T07:00:00Z");
    const previous = netPoint("exam-a", "snapshot-a1", 12, "2026-10-05T07:00:00Z");
    const current = netPoint("exam-b", "snapshot-b2", 15, "2026-10-15T07:00:00Z");
    const latest = { examId: "exam-b", snapshotId: "snapshot-b2", total: { net: 15, questionCount: 20 } };
    const history = { tenantId: "tenant-flow", studentId: "student-a", examId: "exam-b", points: [current, first, previous], netDelta: 99 };
    const model = buildStudentNetOverview(latest, history);
    expect(model.points.map((point) => point.net)).toEqual([5, 12, 15]);
    expect(model.previousDelta).toBe(3);
    expect(model.seriesDelta).toBe(10);
    expect(model.net).toBe(15);
    expect(studentNetDomain(model.points)).toEqual({ low: 0, high: 20 });

    for (const mismatch of [
      { examType: "LGS" }, { examYear: 2025 }, { scoringProfileId: "another-profile" },
      { gradeLevelId: "grade-12" }, { gradeLevelId: undefined },
      { courseId: "course-turkish" }, { termId: "another-term" },
      { total: { net: 12, questionCount: 30 }, branches: [{ branch: "Matematik", net: 12, questionCount: 30 }] },
      { branches: [{ branch: "Türkçe", net: 12, questionCount: 20 }] },
      { scoringProfileId: undefined }, { branches: undefined },
    ]) {
      const result = buildStudentNetOverview(latest, { ...history, points: [{ ...previous, ...mismatch }, current] });
      expect(result.previousDelta).toBeUndefined();
      expect(result.points).toHaveLength(1);
    }
    const otherVersion = buildStudentNetOverview({ ...latest, snapshotId: "not-loaded" }, history);
    expect(otherVersion.branches).toEqual([]);
    expect(otherVersion.previousDelta).toBeUndefined();
    expect(buildStudentNetOverview(undefined, history).hasLatestReport).toBe(false);
  });

  test("net overview retains negative/missing stored nets and excludes later exams", () => {
    const previous = netPoint("exam-a", "snapshot-a1", -5, "2026-10-05T07:00:00Z");
    const current = netPoint("exam-b", "snapshot-b2", -2, "2026-10-15T07:00:00Z");
    const later = netPoint("exam-c", "snapshot-c", 18, "2026-11-05T07:00:00Z");
    const history = { tenantId: "tenant-flow", studentId: "student-a", examId: "exam-b", points: [previous, current, later] };
    const latest = { examId: "exam-b", snapshotId: "snapshot-b2", total: { net: -2, questionCount: 20 } };
    const result = buildStudentNetOverview(latest, history);
    expect(result.net).toBe(-2);
    expect(result.previousDelta).toBe(3);
    expect(result.points.map((point) => point.net)).toEqual([-5, -2]);
    expect(studentNetDomain(result.points)).toEqual({ low: -10, high: 0 });
    expect(buildStudentNetOverview({ ...latest, total: { questionCount: 20 } }, history).net).toBeUndefined();
    expect(buildStudentNetOverview({ ...latest, total: { net: Number.NaN } }, history).previousDelta).toBeUndefined();
  });

  test("attendance strip preserves real weekend/multiple records and excludes deleted/future records", () => {
    const rows = [
      { date: "2026-10-30", status: "PRESENT" as const },
      { date: "2026-10-30", status: "ABSENT" as const },
      { date: "2026-10-31", status: "PRESENT" as const },
      { date: "2026-11-01", status: "ABSENT" as const, deletedAt: "2026-11-01T09:00:00Z" },
      { date: "2026-11-03", status: "ABSENT" as const },
    ].map((row, index) => ({ ...row, id: `att-${index}`, studentId: "student-a", tenantId: "tenant-flow" }));
    const days = buildAttendanceStripDays(rows, "2026-10-30", "2026-11-02");
    expect(days).toHaveLength(4);
    expect(days[0]).toMatchObject({ status: "ABSENT", total: 2, counts: { ABSENT: 1, PRESENT: 1 } });
    expect(days[1]).toMatchObject({ status: "PRESENT", total: 1 });
    expect(days[2]?.status).toBeUndefined();
    expect(days[3]?.status).toBeUndefined();
  });

  test("Tahta profile keeps compact nets, same-day attendance detail and published grades together", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 1280, height: 1000 }, {
      examFixtures: true, timelineFixtures: true, requestedPaths, section: "overview",
      responseOverrides: {
        "/attendance": ["PRESENT", "ABSENT", "LATE"].map((status, index) => ({ id: `att-${index}`, studentId: "student-a", tenantId: "tenant-flow", date: istanbulDayKey(), status })),
      },
    });
    const strip = page.getByRole("region", { name: "Öğrenci devam günleri" });
    await expect(strip).toContainText("1 günde Yok kaydı");
    await expect(strip).toContainText("1 günde Geç kaydı");
    await strip.locator('button[data-status="ABSENT"]').click();
    await expect(strip.locator("#student-attendance-day-detail")).toContainText("3 kayıt");
    await expect(strip.locator("#student-attendance-day-detail")).toContainText("1 Yok");
    await expect(page.getByRole("region", { name: "Öğrencinin yayımlanmış okul notları" })).toContainText("80 / 100");
    await expect(page.getByRole("region", { name: "Son deneme neti" })).toContainText("+3,00 net");
    await expect(page.getByRole("list", { name: "Son denemenin ders netleri" })).toContainText("15,00 / 20");
    expect((await page.locator(".next-student-net-trend").boundingBox())?.height).toBeLessThanOrEqual(80);
    const dayRequests = requestedPaths.filter((path) => path === "/attendance").length;
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(strip.locator(".next-student-attendance-strip__days button")).toHaveCount(5);
    const firstDate = await strip.locator(".next-student-attendance-strip__days button").first().getAttribute("aria-label");
    await strip.getByRole("button", { name: "Önceki günler" }).click();
    expect(await strip.locator(".next-student-attendance-strip__days button").first().getAttribute("aria-label")).not.toBe(firstDate);
    expect(requestedPaths.filter((path) => path === "/attendance")).toHaveLength(dayRequests);
    await expectNoHorizontalOverflow(page, "tahta-profile-320");
  });

  test("Tahta profile renders negative stored nets and a failed source without substituting zeros", async ({ page }) => {
    const latest = createLatestExam();
    latest.total.net = -2;
    latest.total.successRate = -10;
    await openStudentDetail(page, { width: 1280, height: 1000 }, {
      examFixtures: true, section: "overview",
      responseOverrides: {
        "/students/student-a/overview": { ...createStudentOverview(), latestExam: latest },
        "/exams/exam-b/reports/students/student-a/progress": {
          tenantId: "tenant-flow", studentId: "student-a", examId: "exam-b", netDelta: 99,
          points: [netPoint("exam-a", "snapshot-a1", -5, "2026-10-05T07:00:00Z"), netPoint("exam-b", "snapshot-b2", -2, "2026-10-15T07:00:00Z")],
        },
      },
    });
    const headline = page.getByRole("region", { name: "Son deneme neti" });
    await expect(headline).toContainText("-2,00 / 20");
    await expect(headline).toContainText("+3,00 net");
    await expect(page.locator('.next-student-net-branch-fill[data-negative="true"]')).toBeVisible();
    await page.route("**/api/v1/exams/exam-b/reports/students/student-a/progress**", (route) => route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: corsHeadersFor(route) })
      : route.fulfill({ status: 503, headers: corsHeadersFor(route), contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Unavailable" } }) }));
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Geçmiş raporlar alınamadı" })).toBeVisible();
    await expect(headline).toContainText("-2,00 / 20");
    await expect(headline).not.toContainText("+0,00");
  });

  test("liste görünümü ilişki haritasını PII sızdırmadan gösterir", async ({ page }) => {
    const auditLogRequests: URL[] = [];
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 1280, height: 900 }, { auditLogRequests, requestedPaths, section: "overview" });

    // The new identity/attendance/net areas replace the duplicated overview KPI cards.
    await expect(page.getByRole("tab", { name: "Genel bakış" })).toHaveAttribute("aria-selected", "true");
    const operationSummary = page.getByRole("region", { exact: true, name: "Öğrenci detay özeti" });
    const summaryMetrics = operationSummary.getByRole("group", { name: "Öğrenci detay özeti metrikleri" });
    await expect(summaryMetrics.locator(".next-operation-summary__item")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Son deneme neti" })).toContainText("Hazır deneme raporu yok");
    await expect(page.getByRole("region", { name: "Öğrenci devam günleri" })).toContainText("Yoklama kaydı yok");
    await expect(summaryMetrics).toContainText("Açık ödev");
    await expect(summaryMetrics).toContainText("Öğretmen notu");
    await expect(operationSummary).toContainText("Kişisel bilgiler maskeli");
    await expect(operationSummary).toContainText("2 veli bağlı");
    await expect(operationSummary.getByLabel("Öğrenci detay özeti önerilen işlemler")).toHaveCount(0);
    await expect(page.locator(".next-student-identity-meta")).toContainText("Aktif");
    await expect(page.locator(".next-student-identity-meta")).toContainText("11-A");
    await expect(page.getByLabel("Öğrenci karar kartları")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Öğretmen notları" })).toHaveAttribute("href", "/kurum/notlar?classId=class-11a");
    await expect(page.getByRole("link", { name: "Portal erişimi" })).toHaveAttribute("href", "/kurum/ogrenci-portal-erisimi");
    await expect(page.getByRole("link", { name: "Sınav detayları" })).toHaveAttribute("href", "/kurum/ogrenciler/student-a/sinavlar");
    await expect(page.locator(".next-student-detail-actions .uh-button:not(.uh-button--secondary)")).toHaveCount(1);
    await expect(page.getByLabel("Öğretmen notları", { exact: true }).getByRole("table", { name: "Öğretmen not kayıtları" })).toBeVisible();
    await expect(page.getByLabel("Ödevler", { exact: true }).getByRole("table", { name: "Öğrenci ödev kayıtları" })).toBeVisible();
    await expect(page.getByLabel("Öğrenci ilişki haritası")).toHaveCount(0);
    await expectNoVisibleTextValues(page, "student-detail-pii-overview", rawStudentDetailPiiValues);
    await expectNoHorizontalOverflow(page, "student-overview-desktop");
    await expectNoUnlabeledControls(page, "student-overview-desktop");

    await openRecordsSection(page);
    const studentProfile = page.getByLabel("Öğrenci profil kartı");
    await expect(studentProfile).toContainText("Aktif");
    await expect(studentProfile).toContainText("11-A");
    const studentProfileInfo = studentProfile.getByRole("region", { name: "Öğrenci profil özeti" });
    await expect(studentProfileInfo).toHaveClass(/uh-info-grid/);
    await expect(studentProfileInfo.locator(".uh-info-item")).toHaveCount(4);
    await expect(studentProfile).not.toContainText("Veli bağlantısı");
    const relationshipMap = page.getByLabel("Öğrenci ilişki haritası");
    await expect(relationshipMap).toContainText("Ayşe Yılmaz");
    await expect(relationshipMap).toContainText("Mehmet Demir");
    await expect(relationshipMap.getByRole("table", { name: "Veli bağlantıları" })).toBeVisible();
    await expect(relationshipMap.getByRole("table", { name: "Öğretmen görevleri" })).toBeVisible();
    await expect(relationshipMap.getByRole("table", { name: "Veli bağlantıları" }).getByRole("columnheader", { name: "İzinler" })).toBeVisible();
    await expect(relationshipMap.getByRole("table", { name: "Öğretmen görevleri" }).getByRole("columnheader", { name: "Görev" })).toBeVisible();
    await expect(relationshipMap).toContainText("Veli izinleri (finans, duyuru, destek)");
    await expect(relationshipMap).toContainText("Finans görünürlüğü: açık");
    await expect(relationshipMap).toContainText("Finans görünürlüğü: kapalı");
    await expect(relationshipMap).not.toContainText("Ödeme görür");
    await expect(relationshipMap).not.toContainText("Ödeme kapalı");
    await expect(page.getByLabel("İlişki geçmişi")).toHaveCount(0);
    await expect(page.getByLabel("Öğretmen ilişkileri")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("ham öğrenci anahtarı");
    await expect(page.locator("body")).not.toContainText("güvenli referans metinleriyle");

    const auditSummary = page.getByLabel("Denetim özeti");
    await expect(auditSummary).toContainText("Profil güncellendi");
    await expect(auditSummary.getByRole("columnheader", { name: "İşlem" })).toBeVisible();
    await expect(auditSummary).not.toContainText("Ham denetim alanları gizli");
    await expect(auditSummary).toContainText("Veli ilişkisi güncellendi");
    await expect(auditSummary).not.toContainText("student.profile_updated");
    await expect(auditSummary).not.toContainText("guardian_student.updated");
    await expect(auditSummary).not.toContainText("announcement.created");
    await expect(auditSummary).not.toContainText("Öğrenci silindi");
    await expect(auditSummary).not.toContainText("student-b");
    await expect(auditSummary).not.toContainText("announcement-unrelated");
    await expect(auditSummary).not.toContainText("guardian-link-mother");
    await expect(auditSummary).not.toContainText("entityId");
    await expect(auditSummary).not.toContainText("actorUserId");
    await expect(auditSummary).not.toContainText("diff");
    expect(auditLogRequests).toHaveLength(0);
    expect(requestedPaths.filter((path) => path === "/students/student-a/overview")).toHaveLength(1);
    expect(requestedPaths.some((path) => path === "/students/student-a/profile")).toBe(false);
    expect(requestedPaths.some((path) => path === "/students/student-a/guardian-links")).toBe(false);
    expect(requestedPaths.some((path) => path === "/teachers")).toBe(false);
    expect(requestedPaths.some((path) => path.includes("/reports/students/student-a/snapshots"))).toBe(false);
    expect(requestedPaths.some((path) => path.includes("/reports/snapshots"))).toBe(false);
    expect(requestedPaths.filter((path) => path === "/homework/material-assignments")).toHaveLength(0);
    expect(requestedPaths.some((path) => /^\/homework\/materials\/[^/]+\/assignments$/.test(path))).toBe(false);
    const relationships = page.getByLabel("Öğrenci iletişim kişileri", { exact: true });
    await expect(relationships.getByRole("table", { name: "Öğrenci iletişim kişisi kayıtları" })).toBeVisible();
    await expect(relationships).toContainText("••• ••• ••33");
    await expect(relationships).toContainText("ad••@•••.test");
    await expectNoVisibleTextValues(page, "student-detail-pii-desktop", rawStudentDetailPiiValues);
    await expectNoHorizontalOverflow(page, "student-relationship-desktop");
    await expectNoUnlabeledControls(page, "student-relationship-desktop");
  });

  test("K2: son sınav KPI'ı ve Sınavlar görünümü öğrencinin sonucu olan sınavla açılır", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 1280, height: 900 }, { examFixtures: true, requestedPaths, section: "overview" });

    const summaryMetrics = page.getByRole("group", { name: "Öğrenci detay özeti metrikleri" });
    const netHeadline = page.getByRole("region", { name: "Son deneme neti" });
    await expect(netHeadline).toContainText("15,00 / 20");
    await expect(netHeadline).toContainText("+3,00 net");
    await expect(netHeadline).not.toContainText("99");
    await expect(summaryMetrics.locator(".next-operation-summary__item").filter({ hasText: "Açık ödev" })).toContainText("3");
    await expect(summaryMetrics.locator(".next-operation-summary__item").filter({ hasText: "Öğretmen notu" })).toContainText("2");
    await expect(page.getByRole("region", { exact: true, name: "Öğrenci detay özeti" })).toContainText("Son sınav: Deneme B");
    // Genel bakış yalnız gelişim grafiğini yükler; rapor sürümleri Sınav detaylarında istenir.
    await expect.poll(() => requestedPaths.includes("/exams/exam-b/reports/students/student-a/progress")).toBe(true);
    // L8: the exam history labels each point with the exam title and the exam date, not the report generation date.
    const examHistory = page.getByRole("img", { name: /^Deneme netleri:/ });
    // tr-TR short date is d.MM.y: 5 Oct renders as "5.10.2026", 3 Nov as "3.11.2026".
    await expect(examHistory).toHaveAttribute("aria-label", /5\.10\.2026: 12,00/);
    await expect(examHistory).toHaveAttribute("aria-label", /15\.10\.2026: 15,00/);
    await expect(examHistory).not.toHaveAttribute("aria-label", /3\.11\.2026/);
    expect(requestedPaths.some((path) => path.endsWith("/snapshots"))).toBe(false);
    expect(requestedPaths.some((path) => path.includes("/reports/snapshots/"))).toBe(false);

    await Promise.all([
      page.waitForURL(/\/kurum\/ogrenciler\/student-a\/sinavlar$/),
      page.getByRole("link", { name: "Sınav detayları" }).click(),
    ]);
    const reportContext = page.getByLabel("Öğrenci sınav rapor bağlamı");
    const examSelect = reportContext.getByLabel("Sınav", { exact: true });
    await expect(examSelect).toHaveValue("exam-b");
    await expect(examSelect.locator("optgroup")).toHaveCount(3);
    await expect(examSelect.locator("optgroup").nth(0)).toHaveAttribute("label", "Son sonucu olan sınav");
    await expect(examSelect.locator("optgroup").nth(0).locator("option")).toHaveText(["Deneme B"]);
    await expect(examSelect.locator("optgroup").nth(1).locator("option")).toHaveText(["Deneme A"]);
    await expect(examSelect.locator("optgroup").nth(2)).toHaveAttribute("label", "Taslak sınavlar");
    await expect(reportContext).toContainText("%75,0");
    await expect(reportContext).toContainText("Puan (eski biçim)");
    await expect(reportContext).not.toContainText("Eski hesaplama");

    const versions = reportContext.locator("details", { hasText: "Önceki rapor sürümleri" });
    await expect(versions).not.toHaveAttribute("open", "");
    await expect(reportContext.getByLabel("Rapor sürümü")).toBeHidden();
    await versions.locator("summary").click();
    const versionSelect = reportContext.getByLabel("Rapor sürümü");
    await expect(versionSelect).toBeVisible();
    await expect(versionSelect).toHaveValue("snapshot-b2");
    await expect(versionSelect.locator("option")).toHaveCount(2);
    await expect(versionSelect.locator("option").first()).toContainText("(güncel)");
    await versionSelect.selectOption("snapshot-b1");
    await expect.poll(() => requestedPaths.includes("/exams/exam-b/reports/snapshots/snapshot-b1/students/student-a")).toBe(true);
    expect(requestedPaths.some((path) => path.startsWith("/exams/exam-a/"))).toBe(false);
    await expectNoHorizontalOverflow(page, "student-exam-versions-desktop");
    await expectNoUnlabeledControls(page, "student-exam-versions-desktop");
  });

  for (const viewport of [{ width: 320, height: 720 }, { width: 375, height: 812 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`K2: genel bakış ve kayıtlar ${viewport.width}px genişlikte taşmaz`, async ({ page }) => {
      await openStudentDetail(page, viewport, { examFixtures: true, section: "overview" });
      await expect(page.getByRole("group", { name: "Öğrenci detay özeti metrikleri" }).locator(".next-operation-summary__item")).toHaveCount(2);
      await expectNoHorizontalOverflow(page, `student-overview-${viewport.width}`);
      await expectNoUnlabeledControls(page, `student-overview-${viewport.width}`);
      await openRecordsSection(page);
      await expectNoHorizontalOverflow(page, `student-records-${viewport.width}`);
      await expectNoVisibleTextValues(page, `student-detail-pii-${viewport.width}`, rawStudentDetailPiiValues);
    });
  }

  test("mobilde liste görünümü taşmadan kalır", async ({ page }) => {
    await openStudentDetail(page, { width: 390, height: 844 });

    await expect(page.getByRole("region", { exact: true, name: "Öğrenci detay özeti" })).toBeVisible();
    await expect(page.getByLabel("Öğrenci profil kartı")).toContainText("11-A");
    await expect(page.getByLabel("Öğrenci ilişki haritası")).toBeVisible();
    await expect(page.getByLabel("Öğrenci ilişki haritası")).toContainText("Ayşe Yılmaz");
    await expectNoHorizontalOverflow(page, "student-relationship-mobile");
    await expectNoUnlabeledControls(page, "student-relationship-mobile");
    await expectNoVisibleTextValues(page, "student-detail-pii-mobile", rawStudentDetailPiiValues);
  });

  test("tablette öğrenci özeti taşmadan ve erişilebilir adlarla kalır", async ({ page }) => {
    await openStudentDetail(page, { width: 768, height: 1024 });

    const studentDashboard = page.getByLabel("Öğrenci özeti");
    await expect(studentDashboard).toBeVisible();
    await expect(studentDashboard.getByRole("region", { exact: true, name: "Öğrenci detay özeti" })).toBeVisible();
    await expect(studentDashboard.getByRole("region", { name: "Öğrenci profil özeti" })).toHaveClass(/uh-info-grid/);
    await expect(page.getByRole("heading", { name: "İlişki haritası" })).toBeVisible();
    await expect(page.getByLabel("Öğrenci ilişki haritası").getByRole("table", { name: "Öğretmen görevleri" })).toBeVisible();
    await expectNoVisibleTextValues(page, "student-detail-pii-tablet", rawStudentDetailPiiValues);
    await expectNoHorizontalOverflow(page, "student-relationship-tablet");
    await expectNoUnlabeledControls(page, "student-relationship-tablet");
  });

  // Every role that can import students also holds class:*, so the link branch is the one users see.
  for (const roles of [["TENANT_ADMIN"]] as const) {
    test(`UAT F-05 eksik sınıf hatası seviye/sınıf ekranlarına yönlendirir (${roles[0]})`, async ({ page }) => {
      await installStudentApiMocks(page, { roles: [...roles] });
      // Registered after the shared mocks, so it takes priority for this one path.
      await page.route("**/api/v1/students/imports/dry-run", async (route) => {
        if (route.request().method() === "OPTIONS") {
          await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
          return;
        }
        await fulfillData(route, {
          dryRun: true,
          errors: [{ code: "CLASS_NOT_FOUND", field: "className", row: 2, value: "9-Z" }],
          quota: { current: 1, incoming: 1, limit: 100, wouldExceed: false },
          totalRows: 1,
          validRows: [],
          wouldImport: false,
        });
      });
      await page.addInitScript(() => {
        document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
      });
      await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
      await page.goto("/kurum/ogrenciler");
      await page.getByRole("button", { name: "Toplu aktar" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Toplu öğrenci aktar" });
      await dialog.getByLabel("Aktarım dosyası").setInputFiles({
        buffer: Buffer.from("\uFEFFokul_no;ad;soyad;sinif\n100;Ada;Kaya;9-Z\n", "utf8"),
        mimeType: "text/csv",
        name: "ogrenciler.csv",
      });
      await expect(dialog).toContainText("2. satır: sınıf bulunamadı (9-Z)");
      await expect(dialog).toContainText("İçe aktarma seviye ve sınıf oluşturmaz.");
      await expect(dialog.getByRole("link", { name: "Seviyeler" })).toHaveAttribute("href", "/kurum/seviyeler");
      await expect(dialog.getByRole("link", { name: "Sınıflar" })).toHaveAttribute("href", "/kurum/siniflar");
    });
  }

  test("Öğrenci 360 başlığındaki Düzenle listedeki öğrenci formunu açar ve aynı güncellemeyi gönderir", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 1280, height: 900 }, { requestedPaths, section: "overview" });
    // The form's class/level/teacher lists load only when it opens.
    expect(requestedPaths).not.toContain("/grade-levels");
    const updates: string[] = [];
    await page.route("**/api/v1/students/student-a", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.fallback();
        return;
      }
      updates.push(route.request().postData() ?? "");
      await fulfillData(route, { ...createStudentProfile(), lastName: "Kaya Yıldız" });
    });

    await expect(page.locator(".next-student-identity-meta")).toContainText("Öğrenci no. 1101");
    await page.locator(".next-student-detail-actions").getByRole("button", { name: "Düzenle" }).click();
    const dialog = page.getByRole("dialog", { name: "Öğrenci düzenle" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => requestedPaths.includes("/grade-levels")).toBe(true);
    await expect(dialog.getByLabel("Ad", { exact: true })).toHaveValue("Ada");
    await expect(dialog.getByLabel("Soyad", { exact: true })).toHaveValue("Kaya");
    await expect(dialog.getByRole("region", { name: "Kayıt işlemleri" })).toBeVisible();
    await expect(dialog).toContainText("Kayıtlı: ••• ••• ••33");
    await expectNoVisibleTextValues(page, "student-detail-edit-dialog", rawStudentDetailPiiValues);

    const overviewRequests = () => requestedPaths.filter((path) => path === "/students/student-a/overview").length;
    const overviewRequestsBeforeSave = overviewRequests();
    await dialog.getByLabel("Soyad", { exact: true }).fill("Kaya Yıldız");
    await dialog.getByRole("button", { name: "Kaydet" }).click();
    await expect(dialog).toHaveCount(0);
    expect(updates).toHaveLength(1);
    expect(JSON.parse(updates[0] ?? "{}")).toMatchObject({ classId: "class-11a", firstName: "Ada", lastName: "Kaya Yıldız", status: "ACTIVE" });
    // No contact field was typed, so the profile endpoint is not written; the page reloads its overview.
    expect(requestedPaths).not.toContain("/students/student-a/profile");
    await expect.poll(overviewRequests).toBeGreaterThan(overviewRequestsBeforeSave);
  });

  test("finance yetkisi olmayan rolde ödeme ve finans görünürlüğü açılmaz", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 768, height: 1024 }, { requestedPaths, roles: ["ASSISTANT_ADMIN"] });

    expect(requestedPaths).not.toContain("/payment-plans");
    await expect(page.locator("body")).not.toContainText("Finans görünürlüğü");
    await expect(page.locator("body")).not.toContainText("bekleyen ödeme");
  });

  test("iletişim kişisi retry isteği aynı idempotency anahtarını kullanır", async ({ page }) => {
    const contactCreateRequests: Array<{ body: string; idempotencyKey: string }> = [];
    await openStudentDetail(page, { width: 1280, height: 900 }, {
      contactCreateRequests,
      failFirstContactCreate: true,
    });

    const contacts = page.getByLabel("Öğrenci iletişim kişileri", { exact: true });
    await contacts.getByLabel("Ad", { exact: true }).fill("Selin");
    await contacts.getByLabel("Soyad", { exact: true }).fill("Kaya");
    await contacts.getByRole("button", { name: "İletişim kişisi ekle" }).click();
    await expect(contacts).toContainText("İletişim kişisi kaydedilemedi.");
    await contacts.getByRole("button", { name: "İletişim kişisi ekle" }).click();

    await expect.poll(() => contactCreateRequests).toHaveLength(2);
    expect(contactCreateRequests[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(contactCreateRequests[1]?.idempotencyKey).toBe(contactCreateRequests[0]?.idempotencyKey);
    expect(contactCreateRequests[1]?.body).toBe(contactCreateRequests[0]?.body);
  });

  for (const viewport of [{ name: "masaüstü", width: 1280, height: 900 }, { name: "mobil", width: 390, height: 844 }]) {
    test(`yasal temsilci iletişimi onayla mevcut veliye bağlanır ve bağı kaldırılır (KV-3b, ${viewport.name})`, async ({ page }) => {
      const guardianLink = { guardianId: undefined as string | undefined, requests: [] as GuardianLinkRequest[] };
      await openStudentDetail(page, viewport, { guardianLink });

      const controls = page.getByLabel("Veli bağı", { exact: true });
      await expect(controls.getByLabel("Yasal temsilci")).toHaveValue("contact-legal");
      await controls.getByLabel("Veli ara").fill("Selin");
      await expect.poll(() => guardianLink.requests.some((request) => request.method === "GET" && request.search.includes("q=Selin"))).toBe(true);
      await controls.getByLabel("Veli seçimi").selectOption("guardian-sibling");
      await controls.getByRole("button", { name: "Mevcut veliye bağla" }).click();
      const linkDialog = page.getByRole("dialog", { name: "Mevcut veliye bağla" });
      await expect(linkDialog).toContainText("Veli hesabı açılmaz");
      await expectNoHorizontalOverflow(page, `student-guardian-link-dialog-${viewport.name}`);
      await linkDialog.getByRole("button", { name: "Bağla" }).click();

      await expect(controls.getByRole("status")).toHaveText("Bağlı veli: Selin Ak");
      await expect(page.getByLabel("Öğrenci iletişim kişileri", { exact: true })).toContainText("Veliye bağlı");
      await expectNoHorizontalOverflow(page, `student-guardian-link-${viewport.name}`);
      await expectNoUnlabeledControls(page, `student-guardian-link-${viewport.name}`);

      await controls.getByRole("button", { name: "Bağı kaldır" }).click();
      await page.getByRole("dialog", { name: "Veli bağını kaldır" }).getByRole("button", { name: "Bağı kaldır" }).click();
      await expect(controls.getByRole("button", { name: "Mevcut veliye bağla" })).toBeVisible();

      const writes = guardianLink.requests.filter((request) => request.method !== "GET");
      expect(writes).toEqual([
        { method: "PUT", path: "/students/student-a/contacts/contact-legal/guardian", search: "", body: JSON.stringify({ guardianId: "guardian-sibling" }), idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
        { method: "DELETE", path: "/students/student-a/contacts/contact-legal/guardian", search: "", body: "", idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      ]);
      expect(writes[0]?.idempotencyKey).not.toBe(writes[1]?.idempotencyKey);
    });

    test(`öğretmen/personel olan veli mevcut kullanıcı seçilerek ayrı hesap açılmadan bağlanır (KV-3b, ${viewport.name})`, async ({ page }) => {
      const guardianLink = { guardianId: undefined as string | undefined, requests: [] as GuardianLinkRequest[] };
      await openStudentDetail(page, viewport, { guardianLink });

      const controls = page.getByLabel("Veli bağı", { exact: true });
      const targetSelect = controls.getByLabel("Bağlanacak kişi");
      await expect(targetSelect.locator("option")).toHaveText(["Mevcut veli", "Mevcut kullanıcı (personel)"]);
      await targetSelect.selectOption("user");
      await controls.getByLabel("Kullanıcı ara").fill("Selin");
      await expect.poll(() => guardianLink.requests.some((request) => request.path === "/tenant-users" && request.search.includes("q=Selin"))).toBe(true);
      const userSelect = controls.getByLabel("Kullanıcı seçimi");
      // Student accounts are never offered (the API refuses them as well).
      await expect(userSelect.locator("option")).toHaveText(["Kullanıcı seçin", "Selin Ak"]);
      await userSelect.selectOption("user-teacher-parent");
      await controls.getByRole("button", { name: "Mevcut kullanıcıya bağla" }).click();
      const linkDialog = page.getByRole("dialog", { name: "Mevcut kullanıcıya bağla" });
      await expect(linkDialog).toContainText("Ayrı hesap açılmaz");
      await expect(linkDialog).toContainText("Veli rolü eklenir");
      await expectNoHorizontalOverflow(page, `student-guardian-user-link-dialog-${viewport.name}`);
      await linkDialog.getByRole("button", { name: "Bağla" }).click();

      await expect(controls.getByRole("status")).toHaveText("Bağlı veli: Selin Ak");
      await expect(page.getByText("Kullanıcıya veli rolü eklendi ve iletişim kaydı bağlandı.")).toBeVisible();
      await expectNoHorizontalOverflow(page, `student-guardian-user-link-${viewport.name}`);
      await expectNoUnlabeledControls(page, `student-guardian-user-link-${viewport.name}`);

      const writes = guardianLink.requests.filter((request) => request.method !== "GET");
      expect(writes).toEqual([
        { method: "PUT", path: "/students/student-a/contacts/contact-legal/guardian", search: "", body: JSON.stringify({ userId: "user-teacher-parent" }), idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      ]);
    });

    test(`eşzamanlı güncelleme 409'unda "Tekrar dene" aynı Idempotency-Key ile yeniden gönderir (KV-3e, ${viewport.name})`, async ({ page }) => {
      let releaseRetry = () => {};
      const guardianLink = {
        concurrentConflicts: 1,
        guardianId: undefined as string | undefined,
        holdWrite: new Promise<void>((resolve) => { releaseRetry = resolve; }),
        requests: [] as GuardianLinkRequest[],
      };
      await openStudentDetail(page, viewport, { guardianLink });

      const controls = page.getByLabel("Veli bağı", { exact: true });
      const section = page.locator(".next-form-section").filter({ has: controls });
      await controls.getByLabel("Veli ara").fill("Selin");
      await controls.getByLabel("Veli seçimi").selectOption("guardian-sibling");
      await controls.getByRole("button", { name: "Mevcut veliye bağla" }).click();
      await page.getByRole("dialog", { name: "Mevcut veliye bağla" }).getByRole("button", { name: "Bağla" }).click();

      const alert = section.getByRole("alert");
      await expect(alert).toContainText("eşzamanlı bir işlem");
      const retry = alert.getByRole("button", { name: "Tekrar dene" });
      await expect(retry).toBeVisible();
      await expectNoHorizontalOverflow(page, `student-guardian-link-retry-${viewport.name}`);
      const box = await retry.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);

      await retry.click();
      // The retry stays disabled while the resent request is in flight.
      await expect(retry).toBeDisabled();
      releaseRetry();

      await expect(controls.getByRole("status")).toHaveText("Bağlı veli: Selin Ak");
      await expect(page.getByText("İletişim kaydı veliye bağlandı.")).toBeVisible();
      await expect(section.getByRole("button", { name: "Tekrar dene" })).toHaveCount(0);
      const writes = guardianLink.requests.filter((request) => request.method !== "GET");
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual(writes[0]);
      expect(writes[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    });
  }
});

// DEC-20261102-08: Student 360 timeline (staff only) and the monthly attendance calendar on the records tab.
test.describe("Öğrenci 360 zaman çizelgesi ve yoklama takvimi", () => {
  test("model: takvim Pazartesi başlar, günün en ağır durumunu ve kayıt sayısını taşır", () => {
    const month = buildAttendanceCalendarMonth([
      { date: "2026-11-02", status: "PRESENT" },
      { date: "2026-11-02", status: "LATE" },
      { date: "2026-11-03", status: "ABSENT" },
      { date: "2026-11-04", status: "EXCUSED" },
      { date: "2026-11-05", status: "ABSENT", deletedAt: "2026-11-06T08:00:00.000Z" },
      { date: "2026-10-31", status: "ABSENT" },
    ], "2026-11");
    expect(month.label).toBe("Kasım 2026");
    // 1 Kasım 2026 Pazar: ilk haftada altı boş hücre, ardından 1.
    expect(month.weeks[0]?.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(month.weeks[0]?.[6]?.day).toBe(1);
    expect(month.weeks.every((week) => week.length === 7)).toBe(true);
    const days = month.weeks.flat().filter((day) => day !== null);
    expect(days).toHaveLength(30);
    const second = days.find((day) => day?.dateKey === "2026-11-02");
    expect(second?.status).toBe("LATE");
    expect(second && describeCalendarDay(second)).toBe("2 kayıt: 1 Var, 1 Geç");
    expect(days.find((day) => day?.dateKey === "2026-11-05")?.status).toBeUndefined();
    expect(month.counts).toEqual({ ABSENT: 1, EXCUSED: 1, LATE: 1, PRESENT: 1 });
    expect(month.total).toBe(4);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(defaultCalendarMonth([{ date: "2026-09-10" }], "2026-11-02")).toBe("2026-09");
    expect(defaultCalendarMonth([{ date: "2026-11-01" }, { date: "2026-09-10" }], "2026-11-02")).toBe("2026-11");
    expect(defaultCalendarMonth([], "2026-11-02")).toBe("2026-11");
  });

  test("model: zaman çizelgesi pencere dışını, Var yoklamasını, not metnini ve yetkisiz finansı göstermez", () => {
    const sources = {
      attendance: [
        { classId: "class-11a", date: "2026-10-30", id: "att-absent", status: "ABSENT" as const, studentId: "student-a", tenantId: "t" },
        { date: "2026-10-30", id: "att-present", status: "PRESENT" as const, studentId: "student-a", tenantId: "t" },
        { date: "2026-06-01", id: "att-old", status: "LATE" as const, studentId: "student-a", tenantId: "t" },
      ],
      development: [{ createdAt: "2026-10-20T09:00:00.000Z", id: "dev-1", periodLabel: "1. Dönem", visibility: "INTERNAL" as const }],
      examPoints: [
        { examTitle: "Deneme B", generatedAt: "2026-10-25T09:00:00.000Z", snapshotId: "snap-b", total: { net: 15, questionCount: 20, successRate: 75 } },
        // Sınav 19 Ekim 00:30 (İstanbul) yapıldı, raporu 27 Ekim'de hazırlandı: olay sınav gününe yerleşir.
        { examStartsAt: "2026-10-18T21:30:00.000Z", examTitle: "Deneme C", generatedAt: "2026-10-27T09:00:00.000Z", snapshotId: "snap-c", total: { net: 12, questionCount: 20, successRate: 60 } },
      ],
      grades: [{ absent: false, assessmentId: "g-1", classId: "class-11a", courseId: "course-math", heldOn: "2026-10-28", kind: "WRITTEN" as const, maxScore: 100, publishedAt: "2026-10-29T09:00:00.000Z", score: 72.5, title: "1. Yazılı", version: 2 }],
      homework: [],
      materialAssignments: [],
      paymentPlans: [{
        createdAt: "2026-09-01T09:00:00.000Z", currency: "TRY", id: "plan-1", installments: [], studentId: "student-a", tenantId: "t", totalAmount: 100000,
        transactions: [{ amount: 150000, createdAt: "2026-10-15T09:00:00.000Z", currency: "TRY", id: "tx-1", method: "CASH" as const, paidAt: "2026-10-15T09:00:00.000Z", planId: "plan-1", receiptNo: "R-1", tenantId: "t" }],
      }],
      teacherNotes: [{ body: "Gizli not metni", createdAt: "2026-10-26T09:00:00.000Z", developmentStatus: "WATCH", id: "note-1", studentId: "student-a", teacherId: "teacher-a", tenantId: "t", visibility: "INTERNAL" as const }],
    };
    const context = {
      canViewFinance: false,
      courseNameById: new Map([["course-math", "Matematik"]]),
      fromKey: "2026-08-04",
      links: { attendance: ({ classId }: { classId?: string }) => (classId ? `/kurum/devamsizlik?classId=${classId}` : "/kurum/devamsizlik") },
      todayKey: "2026-11-02",
    };
    const events = buildStudentTimeline(sources as never, context);
    expect(events.map((event) => event.id)).toEqual([
      "attendance:att-absent",
      "grade:g-1",
      "note:note-1",
      "exam:snap-b",
      "development:dev-1",
      "exam:snap-c",
    ]);
    expect(events[0]).toMatchObject({ link: { href: "/kurum/devamsizlik?classId=class-11a" }, status: { label: "Yok" }, title: "Yoklama: Yok" });
    expect(events.find((event) => event.kind === "grade")?.detail).toBe("Matematik · 72,5 / 100 · 2. sürüm");
    expect(events.find((event) => event.id === "exam:snap-b")).toMatchObject({
      dateKey: "2026-10-25",
      detail: "Başarı %75,0 · Net 15,00 · Soru 20",
      // Sınav tarihi saklanmamış raporda olay rapor tarihindedir ve sınav sonucu gibi adlandırılmaz.
      title: "Sınav raporu hazırlandı: Deneme B",
    });
    expect(events.find((event) => event.id === "exam:snap-c")).toMatchObject({ dateKey: "2026-10-19", title: "Sınav sonucu: Deneme C" });
    expect(JSON.stringify(events)).not.toContain("Gizli not metni");

    const withFinance = buildStudentTimeline(sources as never, { ...context, canViewFinance: true });
    expect(withFinance.find((event) => event.kind === "finance")).toMatchObject({ detail: "1.500,00 TRY · Makbuz R-1", title: "Ödeme alındı" });
  });

  test("records reuse the overview grade read and keep detailed sources bounded", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 1280, height: 900 }, { requestedPaths, section: "overview", timelineFixtures: true });
    expect(requestedPaths).not.toContain("/development/assessments");
    await expect.poll(() => requestedPaths.filter((path) => path === "/attendance").length).toBe(1);
    await expect.poll(() => requestedPaths.filter((path) => path === "/grade-assessments/students/student-a/published").length).toBe(1);
    // UAT U1: Genel bakış "Açık ödev" kartı sınıf ödevini sayar; bu tek istek zaman çizelgesiyle paylaşılır.
    await expect.poll(() => requestedPaths.filter((path) => path === "/homework/students/student-a").length).toBe(1);

    await openRecordsSection(page);
    const timeline = page.getByRole("region", { name: "Öğrenci zaman çizelgesi" });
    const events = timeline.getByRole("table", { name: "Zaman çizelgesi olayları" });
    await expect(events).toContainText("Yoklama: Yok");
    await expect(events).toContainText("Yazılı: 1. Yazılı");
    await expect(events).toContainText("Ödev teslim edildi: Kesirler");
    await expect(events).toContainText("Gelişim değerlendirmesi: 1. Dönem");
    await expect(events).toContainText("Ödeme alındı");
    await expect(events).not.toContainText("Mentör gizli notu");
    await expect(events.getByRole("link", { name: "Yoklama" }).first()).toHaveAttribute("href", "/kurum/devamsizlik?classId=class-11a");
    await expect(timeline.getByRole("alert")).toHaveCount(0);

    // Olay başına istek atılmaz: her kaynak bir kez, ödev teslimleri öğrenci başına tek istekle gelir.
    for (const path of ["/grade-assessments/students/student-a/published", "/homework/students/student-a", "/development/assessments"]) {
      expect(requestedPaths.filter((requested) => requested === path)).toHaveLength(1);
    }
    expect(requestedPaths.some((path) => /^\/homework\/[^/]+\/submissions$/.test(path))).toBe(false);

    await timeline.getByLabel("Olay türü").selectOption("grade");
    await expect(events.getByRole("row")).toHaveCount(2);
    await expect(events).toContainText("Yazılı: 1. Yazılı");

    const calendar = page.getByRole("region", { name: "Yoklama takvimi" });
    await expect(calendar.getByRole("list", { name: "Takvim açıklaması" })).toContainText("Var");
    await expect(calendar.getByRole("list", { name: "Takvim açıklaması" })).toContainText("İzinli");
    await expect(calendar.getByRole("table", { name: /Yoklama takvimi/ })).toContainText("Yok");
    await expect(calendar.getByRole("table", { name: "Ayın yoklama kayıtları" })).toContainText("Yok");
    await expect(calendar.getByRole("button", { name: "Sonraki ay" })).toBeDisabled();
    const attendanceRequestsBefore = requestedPaths.filter((path) => path === "/attendance").length;
    await calendar.getByRole("button", { name: "Önceki ay" }).click();
    await expect.poll(() => requestedPaths.filter((path) => path === "/attendance").length).toBe(attendanceRequestsBefore + 1);
    await expect(calendar.getByRole("button", { name: "Sonraki ay" })).toBeEnabled();
    await expectNoHorizontalOverflow(page, "student-timeline-desktop");
    await expectNoUnlabeledControls(page, "student-timeline-desktop");
  });

  test("Açık ödev kartı ve Ödevler paneli sınıf ödevini teslim durumuyla gösterir (UAT U1)", async ({ page }) => {
    await openStudentDetail(page, { width: 1280, height: 900 }, {
      responseOverrides: {
        "/homework/students/student-a": [
          { classId: "class-11a", dueAt: "2026-10-31T12:00:00.000Z", id: "homework-open", title: "S1-11 sınıf ödevi", submission: { homeworkId: "homework-open", status: "NOT_SUBMITTED", studentId: "student-a" } },
          { classId: "class-11a", id: "homework-done", title: "Teslim edilen ödev", submission: { homeworkId: "homework-done", status: "SUBMITTED", studentId: "student-a", submittedAt: "2026-10-20T09:00:00.000Z" } },
        ],
      },
      section: "overview",
    });

    const homeworkCard = page.getByRole("group", { name: "Öğrenci detay özeti metrikleri" }).locator(".next-operation-summary__item").filter({ hasText: "Açık ödev" });
    // Açık ödev = teslim edilmemiş sınıf ödevi (1) + materyal ataması (0); teslim edilen sayılmaz.
    await expect(homeworkCard.locator(".uh-metric-card__value")).toHaveText("1");
    const homeworkTable = page.getByLabel("Ödevler", { exact: true }).getByRole("table", { name: "Öğrenci ödev kayıtları" });
    await expect(homeworkTable).toContainText("S1-11 sınıf ödevi");
    await expect(homeworkTable).toContainText("Sınıf ödevi");
    await expect(homeworkTable).toContainText("Teslim edilmedi");
    await expect(homeworkTable).toContainText("Teslim edilen ödev");
    await expect(homeworkTable).not.toContainText("homework-open");
    await expect(homeworkTable).not.toContainText("Sınıf ödevi veya materyal ataması yok");
    await expectNoHorizontalOverflow(page, "student-homework-1280");
  });

  for (const viewport of [{ width: 320, height: 800 }, { width: 768, height: 1024 }]) {
    test(`kapanmış kayıt Aktif görünmez; Yoklama süzgeci yalnız devamsızlığı listelediğini söyler (UAT U2/U15) ${viewport.width}px`, async ({ page }) => {
      const renewed = { classId: "class-11a", id: "enrollment-renewed", reason: "RENEWED", startsAt: "2026-11-03T00:00:00.000Z", status: "ACTIVE", studentId: "student-a", tenantId: "tenant-flow" };
      const closed = { classId: "class-11a", endsAt: "2026-11-03T00:00:00.000Z", id: "enrollment-closed", reason: "CREATED", startsAt: "2026-10-11T00:00:00.000Z", status: "ACTIVE", studentId: "student-a", tenantId: "tenant-flow" };
      await openStudentDetail(page, viewport, {
        responseOverrides: {
          "/attendance": [{ classId: "class-11a", date: istanbulDayKey(-1), id: "att-present", status: "PRESENT", studentId: "student-a", tenantId: "tenant-flow" }],
          "/students/student-a/overview": { ...createStudentOverview(), activeEnrollment: renewed, enrollments: [renewed, closed] },
        },
        section: "records",
      });

      const history = page.getByLabel("Kayıt geçmişi", { exact: true });
      const mainRows = history.locator("tbody tr:not([data-mobile-detail])");
      const closedRow = mainRows.filter({ hasText: "İlk kayıt" });
      await expect(closedRow).toContainText("Kapandı");
      await expect(closedRow).not.toContainText("Aktif");
      await expect(mainRows.filter({ hasText: "Kayıt yenileme" })).toContainText("Aktif");

      const timeline = page.getByRole("region", { name: "Öğrenci zaman çizelgesi" });
      await timeline.getByLabel("Olay türü").selectOption("attendance");
      await expect(timeline).toContainText("\"Var\" yoklamaları zaman çizelgesine girmez; yoklama takviminde görünür.");
      await expectNoHorizontalOverflow(page, `student-records-${viewport.width}`);
    });
  }

  test("finans yetkisi olmayan rol finans olayı görmez; dar ekranda taşma olmaz", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 320, height: 800 }, { requestedPaths, roles: ["ASSISTANT_ADMIN"], timelineFixtures: true });
    const events = page.getByRole("region", { name: "Öğrenci zaman çizelgesi" }).getByRole("table", { name: "Zaman çizelgesi olayları" });
    await expect(events).toContainText("Yoklama: Yok");
    await expect(events).not.toContainText("Ödeme alındı");
    await expect(page.getByRole("region", { name: "Öğrenci zaman çizelgesi" }).getByLabel("Olay türü").locator("option", { hasText: "Finans" })).toHaveCount(0);
    expect(requestedPaths).not.toContain("/payment-plans");
    await expect(page.getByRole("region", { name: "Yoklama takvimi" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "student-timeline-320");
  });
});

function istanbulDayKey(offsetDays = 0) {
  const today = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul", year: "numeric" }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function mockStudentTimelineResponse(pathName: string, url: URL): { data: unknown } | undefined {
  const today = istanbulDayKey();
  if (pathName === "/attendance") {
    const records = [
      { classId: "class-11a", date: today, id: "att-today-absent", status: "ABSENT", studentId: "student-a", tenantId: "tenant-flow" },
      { classId: "class-11a", date: today, id: "att-today-present", status: "PRESENT", studentId: "student-a", tenantId: "tenant-flow" },
      { classId: "class-11a", date: istanbulDayKey(-40), id: "att-old-late", status: "LATE", studentId: "student-a", tenantId: "tenant-flow" },
    ];
    const from = url.searchParams.get("dateFrom") ?? "0000-00-00";
    const to = url.searchParams.get("dateTo") ?? "9999-99-99";
    return { data: records.filter((record) => record.date >= from && record.date <= to) };
  }
  if (pathName === "/grade-assessments/students/student-a/published") {
    return {
      data: [{
        absent: false, assessmentId: "grade-1", classId: "class-11a", courseId: "course-math", heldOn: istanbulDayKey(-3), kind: "WRITTEN",
        maxScore: 100, publishedAt: `${istanbulDayKey(-2)}T09:00:00.000Z`, score: 80, title: "1. Yazılı", version: 1,
      }],
    };
  }
  if (pathName === "/homework/students/student-a") {
    return {
      data: [{
        classId: "class-11a", id: "homework-1", title: "Kesirler",
        submission: { homeworkId: "homework-1", status: "SUBMITTED", studentId: "student-a", submittedAt: `${istanbulDayKey(-1)}T09:00:00.000Z` },
      }],
    };
  }
  if (pathName === "/development/assessments") {
    return {
      data: [{
        createdAt: `${istanbulDayKey(-5)}T09:00:00.000Z`, id: "dev-1", mentorNote: "Mentör gizli notu", periodLabel: "1. Dönem", scores: [],
        studentId: "student-a", teacherId: "teacher-a", tenantId: "tenant-flow", visibility: "INTERNAL",
      }],
    };
  }
  if (pathName === "/payment-plans") {
    return {
      data: [{
        createdAt: `${istanbulDayKey(-30)}T09:00:00.000Z`, currency: "TRY", id: "plan-1", installments: [], studentId: "student-a", tenantId: "tenant-flow", totalAmount: 150000,
        transactions: [{ amount: 150000, createdAt: `${istanbulDayKey(-4)}T09:00:00.000Z`, currency: "TRY", id: "tx-1", method: "CASH", paidAt: `${istanbulDayKey(-4)}T09:00:00.000Z`, planId: "plan-1", receiptNo: "R-1", tenantId: "tenant-flow" }],
      }],
    };
  }
  return undefined;
}

interface GuardianLinkMock {
  /** KV-3e: the first N link writes answer 409 GUARDIAN_LINK_CONCURRENT_UPDATE. */
  concurrentConflicts?: number;
  guardianId?: string;
  /** KV-3e: writes after the conflicts wait for this promise, so the test can see the in-flight state. */
  holdWrite?: Promise<void>;
  requests: GuardianLinkRequest[];
}

interface GuardianLinkRequest {
  body: string;
  idempotencyKey: string;
  method: string;
  path: string;
  search: string;
}

async function openStudentDetail(
  page: Page,
  viewport: { width: number; height: number },
  options: {
    auditLogRequests?: URL[];
    contactCreateRequests?: Array<{ body: string; idempotencyKey: string }>;
    examFixtures?: boolean;
    failFirstContactCreate?: boolean;
    guardianLink?: GuardianLinkMock;
    requestedPaths?: string[];
    responseOverrides?: Record<string, unknown>;
    roles?: string[];
    section?: "overview" | "records";
    timelineFixtures?: boolean;
  } = {},
) {
  await page.setViewportSize(viewport);
  await installStudentApiMocks(page, options);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);

  await page.goto("/kurum/ogrenciler/student-a");
  await expect(page.getByRole("heading", { level: 1, name: "Ada Kaya" })).toBeVisible();
  await expect(page.getByRole("region", { exact: true, name: "Öğrenci detay özeti" })).toBeVisible();
  if (options.section !== "overview") await openRecordsSection(page);
}

async function openRecordsSection(page: Page) {
  await page.getByRole("tab", { name: "İlişkiler ve kayıtlar" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "İlişki haritası" })).toBeVisible();
}

async function installStudentApiMocks(
  page: Page,
  options: {
    auditLogRequests?: URL[];
    contactCreateRequests?: Array<{ body: string; idempotencyKey: string }>;
    examFixtures?: boolean;
    failFirstContactCreate?: boolean;
    guardianLink?: GuardianLinkMock;
    requestedPaths?: string[];
    /** Yol başına sabit GET yanıtı (UAT U1/U2/U15 senaryoları). */
    responseOverrides?: Record<string, unknown>;
    roles?: string[];
    timelineFixtures?: boolean;
  } = {},
) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    options.requestedPaths?.push(pathName);
    const override = route.request().method() === "GET" ? options.responseOverrides?.[pathName] : undefined;
    if (override !== undefined) {
      await fulfillData(route, override);
      return;
    }
    if (pathName === "/students/student-a/contacts" && route.request().method() === "POST") {
      options.contactCreateRequests?.push({
        body: route.request().postData() ?? "",
        idempotencyKey: route.request().headers()["idempotency-key"] ?? "",
      });
      if (options.failFirstContactCreate && options.contactCreateRequests?.length === 1) {
        await route.fulfill({
          body: JSON.stringify({ error: { code: "TEMPORARY_FAILURE", message: "Retry" } }),
          headers: { ...corsHeadersFor(route), "content-type": "application/json" },
          status: 503,
        });
        return;
      }
    }
    const guardianLink = options.guardianLink;
    if (guardianLink && (pathName === "/guardians" || pathName === "/tenant-users" || pathName === "/students/student-a/contacts/contact-legal/guardian")) {
      const method = route.request().method();
      guardianLink.requests.push({
        body: route.request().postData() ?? "",
        idempotencyKey: route.request().headers()["idempotency-key"] ?? "",
        method,
        path: pathName,
        search: url.search,
      });
      if (pathName === "/guardians") {
        await fulfillData(route, [{ firstName: "Selin", id: "guardian-sibling", lastName: "Ak", tenantId: "tenant-flow" }]);
        return;
      }
      if (pathName === "/tenant-users") {
        await fulfillData(route, [
          { id: "user-teacher-parent", name: "Selin Ak", roles: ["TEACHER"] },
          { id: "user-student", name: "Ogrenci Hesap", roles: ["STUDENT"] },
        ]);
        return;
      }
      if (guardianLink.concurrentConflicts) {
        guardianLink.concurrentConflicts -= 1;
        await route.fulfill({
          body: JSON.stringify({ error: { code: "GUARDIAN_LINK_CONCURRENT_UPDATE", message: "Aynı kayıt üzerinde eşzamanlı bir işlem var, lütfen tekrar deneyin." } }),
          headers: { ...corsHeadersFor(route), "content-type": "application/json" },
          status: 409,
        });
        return;
      }
      await guardianLink.holdWrite;
      guardianLink.guardianId = method === "PUT" ? "guardian-sibling" : undefined;
      await fulfillData(route, {
        changed: true,
        contactId: "contact-legal",
        guardianId: guardianLink.guardianId,
        guardianStudentCreated: method === "PUT",
        studentId: "student-a",
      });
      return;
    }
    const response = mockApiResponse(pathName, url, options);
    await fulfillData(route, response.data, response.meta);
  });
}

function mockApiResponse(
  pathName: string,
  url: URL,
  options: { auditLogRequests?: URL[]; examFixtures?: boolean; guardianLink?: { guardianId?: string }; roles?: string[]; timelineFixtures?: boolean },
): { data: unknown; meta?: { limit: number; page: number; total: number; totalPages: number } } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse(options.roles) };
  if (options.timelineFixtures) {
    const timelineResponse = mockStudentTimelineResponse(pathName, url);
    if (timelineResponse) return timelineResponse;
  }
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/students/student-a/overview") {
    const overview = createStudentOverview(options.roles, options.guardianLink);
    return { data: options.examFixtures ? { ...overview, latestExam: createLatestExam(), openHomeworkCount: 3, teacherNoteCount: 2 } : overview };
  }
  if (options.examFixtures) {
    const examResponse = mockStudentExamResponse(pathName);
    if (examResponse) return examResponse;
  }
  if (pathName === "/students/student-a/profile") return { data: createStudentProfile() };
  if (pathName === "/students/student-a/guardian-links") return { data: createGuardianLinks() };
  if (pathName === "/students/student-a/guardians") return { data: createGuardians() };
  if (pathName === "/students/student-a/class-history") return { data: createClassHistory() };
  if (pathName === "/students/student-a/enrollments") return { data: createEnrollments() };
  if (pathName === "/students/student-a/teacher-assignments") return { data: createTeacherAssignments() };
  if (pathName === "/attendance/summary") return { data: { absent: 1, excused: 0, late: 1, present: 28, studentId: "student-a", total: 30 } };
  if (pathName === "/audit-logs/student-summary") {
    options.auditLogRequests?.push(url);
    return { data: createAuditSummaries() };
  }
  if (pathName === "/audit-logs") return { data: [{ action: "unscoped.audit_call", createdAt: "2026-06-18T08:20:00.000Z", id: "audit-unscoped" }] };
  if (pathName === "/payment-plans") return { data: [] };
  if (pathName === "/homework/material-assignments") return { data: [] };
  if (pathName === "/teachers") return { data: createTeachers() };
  if (pathName === "/teacher-notes") return { data: [] };
  if (pathName === "/classes") return { data: createClasses() };
  if (pathName === "/courses") return { data: createCourses() };
  if (pathName === "/academic-terms") return { data: createAcademicTerms() };
  if (pathName === "/exams") return { data: [] };
  if (pathName.includes("/reports/")) return { data: [] };

  return { data: [] };
}

// K2: öğrencinin sonucu olan son sınav (exam-b) listede ikinci sırada gelse de varsayılan seçilir.
function createLatestExam() {
  return {
    examId: "exam-b",
    examTitle: "Deneme B",
    generatedAt: "2026-10-20T09:00:00.000Z",
    snapshotId: "snapshot-b2",
    total: { blank: 2, correct: 16, net: 15, questionCount: 20, successRate: 75, wrong: 2 },
  };
}

function mockStudentExamResponse(pathName: string): { data: unknown } | undefined {
  if (pathName === "/exams") {
    return {
      data: [
        { id: "exam-a", status: "PUBLISHED", tenantId: "tenant-flow", title: "Deneme A" },
        { id: "exam-c", status: "DRAFT", tenantId: "tenant-flow", title: "Taslak C" },
        { id: "exam-b", status: "PUBLISHED", tenantId: "tenant-flow", title: "Deneme B" },
      ],
    };
  }
  if (pathName === "/exams/exam-b/reports/students/student-a/snapshots") {
    return {
      data: [
        { createdAt: "2026-10-20T09:00:00.000Z", examId: "exam-b", generatedAt: "2026-10-20T09:00:00.000Z", id: "snapshot-b2", status: "READY", tenantId: "tenant-flow" },
        { createdAt: "2026-10-10T09:00:00.000Z", examId: "exam-b", generatedAt: "2026-10-10T09:00:00.000Z", id: "snapshot-b1", status: "READY", tenantId: "tenant-flow" },
      ],
    };
  }
  if (/^\/exams\/exam-b\/reports\/snapshots\/snapshot-b[12]\/students\/student-a$/.test(pathName)) {
    return {
      data: {
        branches: [],
        outcomes: [],
        studentId: "student-a",
        total: { blank: 2, correct: 16, estimatedRawScore: 410, net: 15, questionCount: 20, successRate: 75, wrong: 2 },
      },
    };
  }
  if (/^\/exams\/exam-b\/reports\/snapshots\/snapshot-b[12]\/students\/student-a\/error-booklet$/.test(pathName)) {
    return { data: { examId: "exam-b", items: [], snapshotId: "snapshot-b2", studentId: "student-a", tenantId: "tenant-flow" } };
  }
  if (pathName === "/exams/exam-b/reports/students/student-a/progress") {
    // L7/L8: one point per exam, ordered by the frozen exam date; both reports were generated on the same later day.
    return {
      data: {
        examId: "exam-b",
        points: [
          { ...netPoint("exam-a", "snapshot-a1", 12, "2026-10-05T07:00:00.000Z"), examTitle: "Deneme A", generatedAt: "2026-11-03T09:00:00.000Z" },
          { ...netPoint("exam-b", "snapshot-b2", 15, "2026-10-15T07:00:00.000Z"), examTitle: "Deneme B", generatedAt: "2026-11-03T09:05:00.000Z" },
        ],
        netDelta: 99,
        studentId: "student-a",
        tenantId: "tenant-flow",
      },
    };
  }
  return undefined;
}

function netPoint(examId: string, snapshotId: string, net: number, examStartsAt: string): ReportStudentProgressPoint {
  return {
    examId, snapshotId, examStartsAt, examType: "TYT", examYear: 2026,
    scoringProfileId: "TR-YKS-2026-NOSD-V1", gradeLevelId: "grade-11",
    courseId: "course-math", termId: "term-2026-fall",
    total: { net, questionCount: 20 }, branches: [{ branch: "Matematik", net, questionCount: 20 }],
  };
}

function createAuditSummaries() {
  return [
    {
      actionLabel: "Profil güncellendi",
      createdAt: "2026-06-18T08:00:00.000Z",
      id: "audit-student-a",
    },
    {
      actionLabel: "Veli ilişkisi güncellendi",
      createdAt: "2026-06-18T08:05:00.000Z",
      id: "audit-guardian-student-a",
    },
  ];
}

function createAuthResponse(roles = ["TENANT_ADMIN"]) {
  return {
    accessToken: "student-flow-access-token",
    session: {
      id: "session-student-flow",
      membershipVersion: 1,
      roles,
      status: "ACTIVE",
      tenantId: "tenant-flow",
      userId: "user-flow-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@flow-akademi.example",
    id: "tenant-flow",
    institutionType: "Dershane",
    name: "Flow Akademi",
  };
}

function createStudentProfile() {
  return {
    classId: "class-11a",
    emailMasked: "ad••@•••.test",
    firstName: "Ada",
    id: "student-a",
    lastName: "Kaya",
    phoneMasked: "••• ••• ••33",
    status: "ACTIVE",
    studentNo: "1101",
    tenantId: "tenant-flow",
  };
}

function createStudentOverview(roles = ["TENANT_ADMIN"], guardianLink?: { guardianId?: string }) {
  const enrollments = createEnrollments();
  return {
    profile: createStudentProfile(),
    activeEnrollment: enrollments[0],
    enrollments,
    attendance: { absent: 1, excused: 0, late: 1, present: 28, studentId: "student-a", total: 30 },
    openHomeworkCount: 0,
    homeworkAssignments: [],
    teacherNoteCount: 0,
    teacherNotes: [],
    contacts: [{
      id: "contact-mother",
      tenantId: "tenant-flow",
      studentId: "student-a",
      firstName: "Ayşe",
      lastName: "Yılmaz",
      relationType: "MOTHER",
      phoneMasked: "••• ••• ••33",
      emailMasked: "ad••@•••.test",
      canReceiveSms: false,
      canReceiveAnnouncements: false,
      canReceiveFinance: false,
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:00:00.000Z",
    }, ...(guardianLink ? [{
      id: "contact-legal",
      tenantId: "tenant-flow",
      studentId: "student-a",
      firstName: "Deniz",
      lastName: "Temsilci",
      relationType: "LEGAL_GUARDIAN",
      canReceiveSms: false,
      canReceiveAnnouncements: false,
      canReceiveFinance: false,
      guardianId: guardianLink.guardianId,
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:00:00.000Z",
    }] : [])],
    guardians: [
      ...createGuardians().map(({ phone: _phone, ...guardian }) => ({ ...guardian, phoneMasked: "••• ••• ••01" })),
      ...(guardianLink?.guardianId ? [{ firstName: "Selin", id: "guardian-sibling", lastName: "Ak", tenantId: "tenant-flow" }] : []),
    ],
    guardianLinks: createGuardianLinks(),
    teacherAssignments: createTeacherAssignments(),
    teachers: createTeachers(),
    classes: createClasses(),
    courses: createCourses(),
    terms: createAcademicTerms(),
    canViewFinance: roles.includes("TENANT_ADMIN"),
    activity: createAuditSummaries(),
  };
}

function createGuardianLinks() {
  return [
    {
      canOpenSupportTickets: true,
      canReceiveAnnouncements: true,
      canReceiveSms: true,
      canViewFinance: true,
      guardianId: "guardian-mother",
      id: "guardian-link-mother",
      studentId: "student-a",
      tenantId: "tenant-flow",
    },
    {
      canOpenSupportTickets: false,
      canReceiveAnnouncements: true,
      canReceiveSms: true,
      canViewFinance: false,
      guardianId: "guardian-father",
      id: "guardian-link-father",
      studentId: "student-a",
      tenantId: "tenant-flow",
    },
  ];
}

function createGuardians() {
  return [
    { firstName: "Ayşe", id: "guardian-mother", lastName: "Yılmaz", phone: "+905551110001", tenantId: "tenant-flow" },
    { firstName: "Kemal", id: "guardian-father", lastName: "Kaya", phone: "+905551110002", tenantId: "tenant-flow" },
  ];
}

function createClassHistory() {
  return [
    {
      classId: "class-11a",
      id: "class-history-a",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      tenantId: "tenant-flow",
      termId: "term-2026-fall",
    },
  ];
}

function createEnrollments() {
  return [
    {
      classId: "class-11a",
      id: "enrollment-a",
      reason: "CREATED",
      startsAt: "2026-09-01T00:00:00.000Z",
      status: "ACTIVE",
      studentId: "student-a",
      tenantId: "tenant-flow",
      termId: "term-2026-fall",
    },
  ];
}

function createTeacherAssignments() {
  return [
    {
      classId: "class-11a",
      id: "teacher-assignment-class",
      role: "CLASS_TEACHER",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      teacherId: "teacher-class",
      tenantId: "tenant-flow",
      termId: "term-2026-fall",
    },
    {
      classId: "class-11a",
      courseId: "course-math",
      id: "teacher-assignment-math",
      role: "BRANCH_TEACHER",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      teacherId: "teacher-math",
      tenantId: "tenant-flow",
      termId: "term-2026-fall",
    },
  ];
}

function createTeachers() {
  return [
    { branch: "Sınıf", firstName: "Mehmet", id: "teacher-class", lastName: "Demir", tenantId: "tenant-flow" },
    { branch: "Matematik", firstName: "Zeynep", id: "teacher-math", lastName: "Arslan", tenantId: "tenant-flow" },
  ];
}

function createClasses() {
  return [{ id: "class-11a", name: "11-A", tenantId: "tenant-flow" }];
}

function createCourses() {
  return [{ code: "MAT", id: "course-math", name: "Matematik", tenantId: "tenant-flow" }];
}

function createAcademicTerms() {
  return [
    {
      academicYearId: "year-2026",
      endsAt: "2027-01-15T00:00:00.000Z",
      id: "term-2026-fall",
      isActive: true,
      name: "2026 Güz",
      startsAt: "2026-09-01T00:00:00.000Z",
      tenantId: "tenant-flow",
    },
  ];
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

async function expectNoVisibleTextValues(page: Page, label: string, values: readonly string[]) {
  const body = page.locator("body");
  for (const value of values) {
    await expect(body, `${label}: ${value} görünür metinde yer almamalı`).not.toContainText(value);
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
        const title = htmlElement.getAttribute("title")?.trim();
        const id = htmlElement.getAttribute("id");
        const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrappingLabel = htmlElement.closest("label");
        return !text && !ariaLabel && !labelledBy && !title && !label && !wrappingLabel;
      })
      .map((element) => element.outerHTML.slice(0, 120));
  });

  expect(unlabeledControls, `${label}: etiketsiz kontrol`).toEqual([]);
}
