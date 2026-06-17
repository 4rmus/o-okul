import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const artifactDir = path.join(repoRoot, "artifacts/ui-smoke");

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("Öğrenci ilişki haritası", () => {
  test("React Flow alanı dolu render olur ve liste fallback korunur", async ({ page }) => {
    await openStudentDetail(page, { width: 1280, height: 900 });

    const flow = page.locator(".next-student-relationship-flow");
    await expect(flow).toHaveAttribute("data-node-count", "6");
    await expect(flow).toHaveAttribute("data-edge-count", "5");
    await expect(page.locator(".next-student-relationship-flow .react-flow__node")).toHaveCount(6);
    await expect(page.locator(".next-student-relationship-flow .react-flow__edge")).toHaveCount(5);

    const viewport = page.locator(".next-student-relationship-flow .react-flow__viewport");
    const initialTransform = await readViewportTransform(viewport);
    await page.locator(".next-student-relationship-flow .react-flow__controls-zoomin").click();
    await expect.poll(() => readViewportTransform(viewport)).not.toBe(initialTransform);

    await expect(page.getByLabel("İlişki haritası liste görünümü")).toContainText("Ayşe Yılmaz");
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toContainText("Mehmet Demir");

    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ fullPage: true, path: path.join(artifactDir, "faz7-student-relationship-flow.png") });
  });

  test("mobilde flow gizlenir, liste fallback taşmadan kalır", async ({ page }) => {
    await openStudentDetail(page, { width: 390, height: 844 });

    await expect(page.locator(".next-student-relationship-flow-shell")).toBeHidden();
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toBeVisible();
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toContainText("11-A");
    await expectNoHorizontalOverflow(page, "student-relationship-mobile");

    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ fullPage: true, path: path.join(artifactDir, "faz7-student-relationship-mobile.png") });
  });
});

async function openStudentDetail(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await installStudentApiMocks(page);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);

  await page.goto("/kurum/ogrenciler/student-a");
  await expect(page.getByRole("heading", { level: 1, name: "Ada Kaya" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "İlişki haritası" })).toBeVisible();
}

async function installStudentApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    const response = mockApiResponse(pathName);
    await fulfillData(route, response.data, response.meta);
  });
}

function mockApiResponse(pathName: string): { data: unknown; meta?: { limit: number; page: number; total: number; totalPages: number } } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse() };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/students/student-a/profile") return { data: createStudentProfile() };
  if (pathName === "/students/student-a/guardian-links") return { data: createGuardianLinks() };
  if (pathName === "/students/student-a/guardians") return { data: createGuardians() };
  if (pathName === "/students/student-a/class-history") return { data: createClassHistory() };
  if (pathName === "/students/student-a/enrollments") return { data: createEnrollments() };
  if (pathName === "/students/student-a/teacher-assignments") return { data: createTeacherAssignments() };
  if (pathName === "/attendance/summary") return { data: { absent: 1, excused: 0, late: 1, present: 28, studentId: "student-a", total: 30 } };
  if (pathName === "/audit-logs") return { data: [] };
  if (pathName === "/payment-plans") return { data: [] };
  if (pathName === "/homework/materials") return { data: [] };
  if (pathName === "/teachers") return { data: createTeachers() };
  if (pathName === "/teacher-notes") return { data: [] };
  if (pathName === "/classes") return { data: createClasses() };
  if (pathName === "/courses") return { data: createCourses() };
  if (pathName === "/academic-terms") return { data: createAcademicTerms() };
  if (pathName === "/exams") return { data: [] };
  if (pathName.endsWith("/reports/students/student-a/progress")) {
    return {
      data: {
        examId: "fallback-report-exam",
        points: [],
        studentId: "student-a",
        tenantId: "tenant-flow",
      },
    };
  }
  if (pathName.includes("/reports/")) return { data: [] };

  return { data: [] };
}

function createAuthResponse() {
  return {
    accessToken: "student-flow-access-token",
    session: {
      id: "session-student-flow",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
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
      isPrimary: true,
      relationshipType: "MOTHER",
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
      isPrimary: false,
      relationshipType: "FATHER",
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

async function readViewportTransform(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    return htmlElement.style.transform || getComputedStyle(htmlElement).transform;
  });
}
