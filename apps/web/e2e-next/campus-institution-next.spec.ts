import { expect, test, type Page } from "@playwright/test";
import type { InstitutionDashboardSummary } from "@o-okul/shared-types";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

for (const role of ["TENANT_ADMIN", "OPERATIONS_STAFF"]) {
  test(`Campus ${role} gerçek akademik sayıları ve tek sınav özetini gösterir`, async ({ page }) => {
    const summary = createSummary();
    summary.academicOps = { date: "2026-11-06", rollCallMissingClassCount: 2, missingGradeEntryAssessmentCount: 3, unpublishedDraftAssessmentCount: 1 };
    await openInstitution(page, summary, role);

    const metrics = page.getByRole("region", { exact: true, name: "Kurum başarı görünümü" });
    await expect(metrics).toContainText("Yoklaması eksik sınıf");
    await expect(metrics).toContainText("Eksik not girişi");
    await expect(metrics).toContainText("Yayınlanmamış notlar");
    await expect(metrics).not.toContainText("Başarı %");
    const attention = page.getByRole("region", { exact: true, name: "Bugün ilgilenmeniz gerekenler" });
    await expect(attention.getByRole("link")).toHaveCount(3);
    await expect(attention.getByRole("link", { name: /Yoklama alınmamış sınıflar 2/ })).toHaveAttribute("href", "/kurum/devamsizlik");
    await expect(attention.getByRole("link", { name: /Eksik not girişi 3/ })).toHaveAttribute("href", "/kurum/not-defteri");
    const exam = page.getByRole("region", { exact: true, name: "Son sınav ve rapor durumu" });
    await expect(exam).toContainText("%75");
    await expect(exam).toContainText("67,5 net / 90 soru");
    await expect(exam.getByRole("link", { name: "Raporları aç" })).toHaveAttribute("href", "/kurum/raporlar");
  });
}

test("Campus okunamayan akademik sayıları sıfır göstermez ve hazır olmayan raporu ayırır", async ({ page }) => {
  const summary = createSummary();
  summary.latestExam!.reportStatus = "MISSING";
  delete summary.latestExam!.report;
  await openInstitution(page, summary);

  const metrics = page.getByRole("region", { exact: true, name: "Kurum başarı görünümü" });
  await expect(metrics.locator(".uh-metric-card")).toHaveCount(1);
  await expect(metrics).not.toContainText("Yoklaması eksik sınıf");
  const exam = page.getByRole("region", { exact: true, name: "Son sınav ve rapor durumu" });
  await expect(exam).toContainText("Rapor bekliyor");
  await expect(exam).toContainText("Veri yok");
  await expect(exam).not.toContainText("%0");
});

test("Campus kampüs kapsamına kurum geneli sınav verisi eklemez", async ({ page }) => {
  const summary = createSummary();
  summary.campusScoped = true;
  delete summary.latestExam;
  await openInstitution(page, summary, "OPERATIONS_STAFF");

  await expect(page.getByRole("region", { name: "Kurum başarı görünümü", exact: true })).toContainText("12");
  await expect(page.getByRole("region", { name: "Son sınav ve rapor durumu", exact: true })).not.toContainText("Kasım Denemesi");
});

function createSummary(): InstitutionDashboardSummary {
  return {
    generatedAt: "2026-11-06T08:00:00.000Z",
    institution: { name: "Kampüs Test Koleji" },
    activeStudentCount: 12,
    attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
    latestExam: {
      examId: "exam-campus", title: "Kasım Denemesi", registeredParticipantCount: 12,
      attendedParticipantCount: 11, absentParticipantCount: 1, reportStatus: "READY",
      report: { snapshotId: "snapshot-campus", resultCount: 11, successRate: 75, net: 67.5, questionCount: 90, classes: [] },
    },
  };
}

async function openInstitution(page: Page, summary: InstitutionDashboardSummary, role = "TENANT_ADMIN") {
  await page.route("**/api/v1/**", async (route) => {
    const headers = {
      "access-control-allow-origin": route.request().headers().origin ?? appOrigin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization,content-type,x-csrf-token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "content-type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const data = path === "/auth/refresh"
      ? { accessToken: "campus-test-token", session: { id: "campus-session", membershipVersion: 1, activePersona: "STAFF", roles: [role], status: "ACTIVE", tenantId: "campus-tenant", userId: "campus-user" } }
      : path === "/me/institution-dashboard" ? summary
      : path === "/me/tenant" ? { id: "campus-tenant", name: summary.institution.name }
      : [];
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ data, meta: { limit: 10, page: 1, total: 0, totalPages: 1 } }) });
  });
  await page.addInitScript(() => { document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax"; });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/kurum");
  await expect(page.getByRole("heading", { level: 1, name: summary.institution.name })).toBeVisible();
}
