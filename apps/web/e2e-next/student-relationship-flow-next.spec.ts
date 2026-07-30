import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
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
  test("liste görünümü ilişki haritasını PII sızdırmadan gösterir", async ({ page }) => {
    const auditLogRequests: URL[] = [];
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 1280, height: 900 }, { auditLogRequests, requestedPaths });

    const operationSummary = page.getByRole("region", { exact: true, name: "Öğrenci detay operasyon özeti" });
    await expect(operationSummary).toContainText("Kayıt durumu");
    await expect(operationSummary).toContainText("Başarı %");
    await expect(operationSummary).toContainText("Net - / Soru -");
    await expect(operationSummary).toContainText("PII maskeli");
    await expect(operationSummary.getByLabel("Öğrenci detay operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const studentProfile = page.getByLabel("Öğrenci profil kartı");
    await expect(studentProfile).toContainText("Aktif");
    const studentProfileInfo = studentProfile.getByRole("region", { name: "Öğrenci profil özeti" });
    await expect(studentProfileInfo).toHaveClass(/uh-info-grid/);
    await expect(studentProfileInfo.locator(".uh-info-item")).toHaveCount(4);
    const decisionCards = page.getByLabel("Öğrenci karar kartları");
    await expect(decisionCards.locator(".next-student-decision-card.uh-action-card")).toHaveCount(4);
    await expect(decisionCards.locator(".next-dashboard-summary-card")).toHaveCount(0);
    await expect(decisionCards).toContainText("Sınav performansı");

    await expect(page.getByLabel("İlişki haritası liste görünümü")).toContainText("Ayşe Yılmaz");
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toContainText("Mehmet Demir");
    await expect(page.getByLabel("İlişki haritası liste görünümü")).not.toContainText("Ödeme görür");
    await expect(page.getByLabel("İlişki haritası liste görünümü")).not.toContainText("Ödeme kapalı");

    const relationshipHistory = page.getByLabel("İlişki geçmişi");
    await expect(relationshipHistory.getByRole("table", { name: "Veli ilişki geçmişi" })).toBeVisible();
    await expect(relationshipHistory).toContainText("Finans görünürlüğü ve bildirim izinleri");
    await expect(relationshipHistory).toContainText("Finans görünürlüğü: açık");
    await expect(relationshipHistory).toContainText("Finans görünürlüğü: kapalı");
    await expect(relationshipHistory).not.toContainText("Ödeme görür");
    await expect(relationshipHistory).not.toContainText("Ödeme kapalı");

    const auditSummary = page.getByLabel("Denetim özeti");
    await expect(auditSummary).toContainText("Profil güncellendi");
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
    expect(auditLogRequests).toHaveLength(1);
    expect(auditLogRequests[0]?.pathname).toBe("/api/v1/audit-logs/student-summary");
    expect(auditLogRequests[0]?.searchParams.get("studentId")).toBe("student-a");
    expect(auditLogRequests[0]?.searchParams.get("limit")).toBe("5");
    expect(requestedPaths.some((path) => path.includes("/reports/students/student-a/snapshots"))).toBe(false);
    expect(requestedPaths.some((path) => path.includes("/reports/snapshots"))).toBe(false);
    expect(requestedPaths.filter((path) => path === "/homework/material-assignments")).toHaveLength(1);
    expect(requestedPaths.some((path) => /^\/homework\/materials\/[^/]+\/assignments$/.test(path))).toBe(false);
    const relationships = page.getByLabel("İletişim ve veli", { exact: true });
    await expect(relationships.getByRole("table", { name: "İletişim ve veli kayıtları" })).toBeVisible();
    await expect(relationships).toContainText("••• ••• ••33");
    await expect(relationships).toContainText("ad••@•••.test");
    await expectNoVisibleTextValues(page, "student-detail-pii-desktop", rawStudentDetailPiiValues);
    await expectNoHorizontalOverflow(page, "student-relationship-desktop");
    await expectNoUnlabeledControls(page, "student-relationship-desktop");
  });

  test("mobilde liste görünümü taşmadan kalır", async ({ page }) => {
    await openStudentDetail(page, { width: 390, height: 844 });

    await expect(page.getByRole("region", { exact: true, name: "Öğrenci detay operasyon özeti" })).toBeVisible();
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toBeVisible();
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toContainText("11-A");
    await expectNoHorizontalOverflow(page, "student-relationship-mobile");
    await expectNoUnlabeledControls(page, "student-relationship-mobile");
    await expectNoVisibleTextValues(page, "student-detail-pii-mobile", rawStudentDetailPiiValues);
  });

  test("tablette ilişki dashboard taşmadan ve erişilebilir adlarla kalır", async ({ page }) => {
    await openStudentDetail(page, { width: 768, height: 1024 });

    const studentDashboard = page.getByLabel("Öğrenci dashboard");
    await expect(studentDashboard).toBeVisible();
    await expect(studentDashboard.getByRole("region", { exact: true, name: "Öğrenci detay operasyon özeti" })).toBeVisible();
    await expect(studentDashboard.getByRole("region", { name: "Öğrenci profil özeti" })).toHaveClass(/uh-info-grid/);
    await expect(page.getByRole("heading", { name: "İlişki haritası" })).toBeVisible();
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toBeVisible();
    await expect(page.getByLabel("Öğretmen ilişkileri").getByRole("table", { name: "Öğretmen ilişki kayıtları" })).toBeVisible();
    await expectNoVisibleTextValues(page, "student-detail-pii-tablet", rawStudentDetailPiiValues);
    await expectNoHorizontalOverflow(page, "student-relationship-tablet");
    await expectNoUnlabeledControls(page, "student-relationship-tablet");
  });

  test("finance yetkisi olmayan rolde ödeme ve finans görünürlüğü açılmaz", async ({ page }) => {
    const requestedPaths: string[] = [];
    await openStudentDetail(page, { width: 768, height: 1024 }, { requestedPaths, roles: ["ASSISTANT_ADMIN"] });

    expect(requestedPaths).not.toContain("/payment-plans");
    await expect(page.locator("body")).not.toContainText("Finans görünürlüğü");
    await expect(page.locator("body")).not.toContainText("bekleyen ödeme");
  });
});

async function openStudentDetail(
  page: Page,
  viewport: { width: number; height: number },
  options: { auditLogRequests?: URL[]; requestedPaths?: string[]; roles?: string[] } = {},
) {
  await page.setViewportSize(viewport);
  await installStudentApiMocks(page, options);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);

  await page.goto("/kurum/ogrenciler/student-a");
  await expect(page.getByRole("heading", { level: 1, name: "Ada Kaya" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "İlişki haritası" })).toBeVisible();
}

async function installStudentApiMocks(
  page: Page,
  options: { auditLogRequests?: URL[]; requestedPaths?: string[]; roles?: string[] } = {},
) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    options.requestedPaths?.push(pathName);
    const response = mockApiResponse(pathName, url, options);
    await fulfillData(route, response.data, response.meta);
  });
}

function mockApiResponse(
  pathName: string,
  url: URL,
  options: { auditLogRequests?: URL[]; roles?: string[] },
): { data: unknown; meta?: { limit: number; page: number; total: number; totalPages: number } } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse(options.roles) };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
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
    email: "ada@example.test",
    firstName: "Ada",
    id: "student-a",
    lastName: "Kaya",
    phone: "+905551112233",
    status: "ACTIVE",
    studentNo: "1101",
    tenantId: "tenant-flow",
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
