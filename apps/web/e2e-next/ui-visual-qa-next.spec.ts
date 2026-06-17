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

test.describe("Faz 9 UI görsel smoke", () => {
  test("dashboard desktop kanıtı taşma, canvas ve kontrol etiketlerini korur", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum", { height: 900, width: 1280 });

    await expect(page.getByRole("heading", { level: 1, name: "Faz 9 Akademi" })).toBeVisible();
    await expect(page.getByLabel("Operasyon özeti")).toContainText("Sistem sağlığı");
    await expect(page.getByLabel("Operasyon özeti")).toContainText("Hazır");
    await expect(page.getByRole("heading", { name: "Sınav Sonuç Özeti" })).toBeVisible();
    await expectUiStable(page, "faz9-dashboard-desktop", consoleErrors);

    await saveScreenshot(page, "faz9-dashboard-desktop.png");
  });

  test("öğrenci listesi mobilde URL state ile taşmadan kalır", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(
      page,
      "/kurum/ogrenciler?page=1&limit=10&q=ada&sort=lastName&classId=class-8a&density=compact&columns=name,class,status,actions",
      { height: 844, width: 390 },
    );

    const studentsRegion = page.getByLabel("Öğrenci yönetimi");
    await expect(studentsRegion.getByRole("heading", { name: "Öğrenciler" })).toBeVisible();
    await expect(studentsRegion.getByLabel("Ara")).toHaveValue("ada");
    await expect(studentsRegion).toHaveClass(/next-students-page--compact/);
    await expectUiStable(page, "faz9-students-mobile", consoleErrors);

    await saveScreenshot(page, "faz9-students-mobile.png");
  });

  test("öğrenci detay desktop ve mobil kanıtları ilişki haritası fallback'iyle temizdir", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/ogrenciler/student-a/sinavlar", { height: 900, width: 1280 });

    await expect(page.getByRole("heading", { level: 1, name: "Ada Kaya" })).toBeVisible();
    await expect(page.getByLabel("Hata kitapçığı")).toContainText("Yanlış");
    await expect(page.getByLabel("Hata kitapçığı")).toContainText("Boş");
    await expectUiStable(page, "faz9-student-detail-desktop", consoleErrors);
    await saveScreenshot(page, "faz9-student-detail-desktop.png");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/kurum/ogrenciler/student-a");
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "İlişki haritası" })).toBeVisible();
    await expect(page.locator(".next-student-relationship-flow-shell")).toBeHidden();
    await expect(page.getByLabel("İlişki haritası liste görünümü")).toBeVisible();
    await expectUiStable(page, "faz9-student-detail-mobile", consoleErrors);
    await saveScreenshot(page, "faz9-student-detail-mobile.png");
  });

  test("rapor desktop kanıtı dolu metrik ve hata kitapçığı ile temizdir", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await openWithUiMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    await expect(page.getByRole("heading", { level: 1, name: "Sınav Raporu" })).toBeVisible();
    await page.getByRole("button", { name: "Raporu getir" }).click();
    const reportPanel = page.locator(".next-report-panel").filter({ has: page.getByRole("heading", { name: "Rapor Özeti" }) });
    await expect(reportPanel).toContainText("Başarı");
    await expect(page.getByRole("heading", { name: "Öğrenci sıralamaları" })).toBeVisible();
    await expect(page.getByLabel("Hata kitapçığı")).toContainText("Yanlış");
    await expectUiStable(page, "faz9-reports-desktop", consoleErrors);

    await saveScreenshot(page, "faz9-reports-desktop.png");
  });
});

async function openWithUiMocks(page: Page, pathName: string, viewport: { height: number; width: number }) {
  await page.setViewportSize(viewport);
  await installUiApiMocks(page);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(pathName);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installUiApiMocks(page: Page) {
  await page.route("**/health/ready", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ dependencies: { postgres: "ok", redis: "ok" }, status: "ready" }),
      headers: { ...corsHeadersFor(route), "content-type": "application/json" },
      status: 200,
    });
  });
  await page.route("**/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ status: "ok" }),
      headers: { ...corsHeadersFor(route), "content-type": "application/json" },
      status: 200,
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    const response = mockUiApiResponse(pathName, url.searchParams);
    await fulfillData(route, response.data, response.meta);
  });
}

function mockUiApiResponse(pathName: string, searchParams: URLSearchParams): { data: unknown; meta?: ListMeta } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse() };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/classes") return { data: createClasses() };
  if (pathName === "/teachers") return { data: createTeachers() };
  if (pathName === "/students") {
    return searchParams.has("page")
      ? createListResponse(createStudents(), searchParams)
      : { data: createStudents() };
  }
  if (pathName === "/guardians") return createListResponse(createGuardians(), searchParams);
  if (pathName === "/campuses") return createListResponse(createCampuses(), searchParams);
  if (pathName === "/courses") return createListResponse(createCourses(), searchParams);
  if (pathName === "/grade-levels") return createListResponse(createGradeLevels(), searchParams);
  if (pathName === "/academic-terms") return createListResponse(createAcademicTerms(), searchParams);
  if (pathName === "/support-tickets") return { data: createSupportTickets() };
  if (pathName === "/payment-plans") return { data: createPaymentPlans() };
  if (pathName === "/attendance") return { data: createAttendanceRecords() };
  if (pathName === "/attendance/summary") return { data: { absent: 1, excused: 0, late: 1, present: 28, studentId: "student-a", total: 30 } };
  if (pathName === "/import-quarantines/summary") return { data: { openCount: 1 } };
  if (pathName === "/announcements") return createListResponse(createAnnouncements(), searchParams);
  if (pathName === "/exams") return { data: createExams() };
  if (pathName === "/students/student-a/profile") return { data: createStudentProfile() };
  if (pathName === "/students/student-a/guardian-links") return { data: createGuardianLinks() };
  if (pathName === "/students/student-a/guardians") return { data: createGuardians() };
  if (pathName === "/students/student-a/class-history") return { data: createClassHistory() };
  if (pathName === "/students/student-a/enrollments") return { data: createEnrollments() };
  if (pathName === "/students/student-a/teacher-assignments") return { data: createTeacherAssignments() };
  if (pathName === "/audit-logs") return { data: [] };
  if (pathName === "/homework/materials") return { data: [] };
  if (pathName === "/teacher-notes") return { data: [{ body: "Problem çözüm adımları takip edilecek.", id: "note-a", studentId: "student-a", tenantId: "tenant-faz9" }] };
  if (pathName === "/exams/exam-demo/reports/snapshots") return { data: createReportSnapshots("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/snapshots") return { data: createReportSnapshots("exam-demo-isem-lgs-1") };
  if (pathName === "/exams/exam-demo/participants" || pathName === "/exams/exam-demo-isem-lgs-1/participants") return { data: createExamParticipants() };
  if (pathName === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-a") return { data: createStudentReport("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-a/students/student-a") return { data: createStudentReport("exam-demo-isem-lgs-1") };
  if (pathName === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-a/error-booklet") return { data: createErrorBooklet("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-a/students/student-a/error-booklet") return { data: createErrorBooklet("exam-demo-isem-lgs-1") };
  if (pathName === "/exams/exam-demo/reports/students/student-a/progress") return { data: createProgress("exam-demo") };
  if (pathName === "/exams/exam-demo-isem-lgs-1/reports/students/student-a/progress") return { data: createProgress("exam-demo-isem-lgs-1") };
  if (pathName.includes("/reports/")) return { data: [] };

  return { data: [] };
}

function createAuthResponse() {
  return {
    accessToken: "faz9-access-token",
    session: {
      id: "session-faz9",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-faz9",
      userId: "user-faz9-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@faz9-akademi.example",
    id: "tenant-faz9",
    institutionType: "Dershane",
    name: "Faz 9 Akademi",
  };
}

function createClasses() {
  return [
    { campusId: "campus-main", gradeLevelId: "grade-8", id: "class-8a", level: "8", name: "8-A", section: "A", tenantId: "tenant-faz9" },
    { campusId: "campus-main", gradeLevelId: "grade-8", id: "class-8b", level: "8", name: "8-B", section: "B", tenantId: "tenant-faz9" },
  ];
}

function createTeachers() {
  return [
    { branch: "Sınıf", firstName: "Mehmet", id: "teacher-class", lastName: "Demir", tenantId: "tenant-faz9" },
    { branch: "Matematik", firstName: "Zeynep", id: "teacher-math", lastName: "Arslan", tenantId: "tenant-faz9" },
  ];
}

function createStudents() {
  return [
    { classId: "class-8a", firstName: "Ada", id: "student-a", lastName: "Kaya", responsibleTeacherId: "teacher-class", status: "ACTIVE", studentNo: "8001", tenantId: "tenant-faz9" },
    { classId: "class-8a", firstName: "Bora", id: "student-b", lastName: "Yilmaz", responsibleTeacherId: "teacher-math", status: "ACTIVE", studentNo: "8002", tenantId: "tenant-faz9" },
  ];
}

function createStudentProfile() {
  return {
    birthDate: "2012-05-12",
    classId: "class-8a",
    email: "ada@example.test",
    firstName: "Ada",
    id: "student-a",
    lastName: "Kaya",
    phone: "+905551112233",
    status: "ACTIVE",
    studentNo: "8001",
    tenantId: "tenant-faz9",
  };
}

function createGuardians() {
  return [
    { firstName: "Ayse", id: "guardian-mother", lastName: "Yilmaz", phone: "+905551110001", tenantId: "tenant-faz9" },
    { firstName: "Kemal", id: "guardian-father", lastName: "Kaya", phone: "+905551110002", tenantId: "tenant-faz9" },
  ];
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
      tenantId: "tenant-faz9",
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
      tenantId: "tenant-faz9",
    },
  ];
}

function createClassHistory() {
  return [
    {
      classId: "class-8a",
      className: "8-A",
      id: "class-history-a",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
  ];
}

function createEnrollments() {
  return [
    {
      classId: "class-8a",
      className: "8-A",
      id: "enrollment-a",
      reason: "CREATED",
      startsAt: "2026-09-01T00:00:00.000Z",
      status: "ACTIVE",
      studentId: "student-a",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
  ];
}

function createTeacherAssignments() {
  return [
    {
      classId: "class-8a",
      id: "teacher-assignment-class",
      role: "CLASS_TEACHER",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      teacherId: "teacher-class",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
    {
      classId: "class-8a",
      courseId: "course-math",
      id: "teacher-assignment-math",
      role: "BRANCH_TEACHER",
      startsAt: "2026-09-01T00:00:00.000Z",
      studentId: "student-a",
      teacherId: "teacher-math",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
    },
  ];
}

function createCampuses() {
  return [{ id: "campus-main", name: "Ana Kampus", tenantId: "tenant-faz9" }];
}

function createCourses() {
  return [
    { code: "MAT", id: "course-math", name: "Matematik", tenantId: "tenant-faz9" },
    { code: "TUR", id: "course-turkish", name: "Turkce", tenantId: "tenant-faz9" },
  ];
}

function createGradeLevels() {
  return [{ id: "grade-8", level: "8", name: "8. Sinif", tenantId: "tenant-faz9" }];
}

function createAcademicTerms() {
  return [
    {
      academicYearId: "year-2026",
      endsAt: "2027-01-15T00:00:00.000Z",
      id: "term-2026-fall",
      isActive: true,
      name: "2026 Guz",
      startsAt: "2026-09-01T00:00:00.000Z",
      tenantId: "tenant-faz9",
    },
  ];
}

function createSupportTickets() {
  return [{ id: "ticket-a", status: "OPEN", subject: "Veli talebi", tenantId: "tenant-faz9" }];
}

function createPaymentPlans() {
  return [
    {
      currency: "TRY",
      id: "payment-plan-a",
      installments: [
        { amount: 120000, currency: "TRY", dueDate: "2026-01-10", id: "installment-a", status: "OVERDUE" },
      ],
      studentId: "student-a",
      tenantId: "tenant-faz9",
    },
  ];
}

function createAttendanceRecords() {
  return [
    { classId: "class-8a", date: "2026-06-17", id: "attendance-a", status: "ABSENT", studentId: "student-a", tenantId: "tenant-faz9" },
    { classId: "class-8a", date: "2026-06-17", id: "attendance-b", status: "PRESENT", studentId: "student-b", tenantId: "tenant-faz9" },
  ];
}

function createAnnouncements() {
  return [
    {
      body: "Haftalik deneme programi yayinlandi.",
      createdAt: "2026-06-15T09:00:00.000Z",
      id: "announcement-a",
      publishedAt: "2026-06-16T09:00:00.000Z",
      status: "PUBLISHED",
      tenantId: "tenant-faz9",
      title: "Haftalik deneme programi",
      updatedAt: "2026-06-16T09:00:00.000Z",
    },
  ];
}

function createExams() {
  return [
    {
      createdAt: "2026-06-01T09:00:00.000Z",
      id: "exam-demo",
      startsAt: "2026-06-10T09:00:00.000Z",
      status: "PUBLISHED",
      tenantId: "tenant-faz9",
      title: "LGS Hazirlik Denemesi",
      updatedAt: "2026-06-10T09:00:00.000Z",
    },
  ];
}

function createExamParticipants() {
  return [
    { createdAt: "2026-06-01T09:00:00.000Z", examId: "exam-demo", id: "participant-a", participantNo: "176", bookletType: "A", status: "ATTENDED", studentId: "student-a", tenantId: "tenant-faz9", updatedAt: "2026-06-01T09:00:00.000Z" },
    { createdAt: "2026-06-01T09:00:00.000Z", examId: "exam-demo", id: "participant-b", participantNo: "177", bookletType: "B", status: "ATTENDED", studentId: "student-b", tenantId: "tenant-faz9", updatedAt: "2026-06-01T09:00:00.000Z" },
  ];
}

function createReportSnapshots(examId: string) {
  return [
    {
      classId: "class-8a",
      courseId: "course-math",
      createdAt: "2026-06-10T12:00:00.000Z",
      examId,
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
        branches: [
          { blank: 1, branch: "Matematik", correct: 12, net: 11, questionCount: 15, resultCount: 2, successRate: 73.3, wrong: 2 },
          { blank: 1, branch: "Turkce", correct: 12, net: 12, questionCount: 15, resultCount: 2, successRate: 80, wrong: 2 },
        ],
        classes: [
          {
            averages: { blank: 1, correct: 24, net: 23, questionCount: 30, standardScore: 430, successRate: 76.7, wrong: 5 },
            classId: "class-8a",
            className: "8-A",
            resultCount: 2,
          },
          {
            averages: { blank: 2, correct: 20, net: 19, questionCount: 30, standardScore: 395, successRate: 63.3, wrong: 8 },
            classId: "class-8b",
            className: "8-B",
            resultCount: 1,
          },
        ],
        generatedAt: "2026-06-10T12:00:00.000Z",
        outcomes: [
          { blank: 0, branch: "Matematik", correct: 8, net: 7.5, outcomeCode: "M.8.1", questionCount: 10, resultCount: 2, successRate: 75, wrong: 2 },
          { blank: 1, branch: "Turkce", correct: 9, net: 8.5, outcomeCode: "T.8.2", questionCount: 10, resultCount: 2, successRate: 85, wrong: 0 },
        ],
        resultCount: 2,
        students: [
          {
            classId: "class-8a",
            className: "8-A",
            resultKey: "student-a",
            studentId: "student-a",
            total: { blank: 1, correct: 25, estimatedRawScore: 440, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
          },
          {
            classId: "class-8a",
            className: "8-A",
            resultKey: "student-b",
            studentId: "student-b",
            total: { blank: 2, correct: 20, estimatedRawScore: 395, net: 19, questionCount: 30, standardScore: 395, successRate: 63.3, wrong: 8 },
          },
        ],
      },
      status: "READY",
      tenantId: "tenant-faz9",
      termId: "term-2026-fall",
      updatedAt: "2026-06-10T12:00:00.000Z",
    },
  ];
}

function createStudentReport(examId: string) {
  return {
    branches: [
      { blank: 1, branch: "Matematik", classNetAverage: 10.5, correct: 12, generalNetAverage: 9.8, net: 11, questionCount: 15, schoolNetAverage: 10.8, successRate: 73.3, wrong: 2 },
      { blank: 0, branch: "Turkce", classNetAverage: 11.2, correct: 13, generalNetAverage: 10.1, net: 13, questionCount: 15, schoolNetAverage: 11.9, successRate: 86.7, wrong: 2 },
    ],
    classId: "class-8a",
    className: "8-A",
    examId,
    examStartsAt: "2026-06-10T09:00:00.000Z",
    examTitle: "LGS Hazirlik Denemesi",
    generatedAt: "2026-06-10T12:00:00.000Z",
    institutionName: "Faz 9 Akademi",
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
    tenantId: "tenant-faz9",
    total: { blank: 1, correct: 25, estimatedRawScore: 440, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
  };
}

function createQuestionSummaries() {
  return [
    { answer: "A", branch: "Matematik", correctAnswer: "A", outcomeCode: "M.8.1", questionNo: 1, status: "CORRECT" },
    { answer: "B", branch: "Matematik", correctAnswer: "C", outcomeCode: "M.8.1", questionNo: 2, status: "WRONG" },
    { answer: "", branch: "Turkce", correctAnswer: "D", outcomeCode: "T.8.2", questionNo: 3, status: "BLANK" },
  ];
}

function createErrorBooklet(examId: string) {
  return {
    examId,
    generatedAt: "2026-06-10T12:00:00.000Z",
    items: createQuestionSummaries().filter((question) => question.status !== "CORRECT"),
    snapshotId: "snapshot-a",
    studentId: "student-a",
    tenantId: "tenant-faz9",
  };
}

function createProgress(examId: string) {
  return {
    examId,
    netDelta: 3.5,
    points: [
      {
        examTitle: "Mayis Denemesi",
        generatedAt: "2026-05-10T12:00:00.000Z",
        snapshotId: "snapshot-prev",
        total: { blank: 2, correct: 20, net: 21, questionCount: 30, standardScore: 405, successRate: 70, wrong: 8 },
      },
      {
        examTitle: "LGS Hazirlik Denemesi",
        generatedAt: "2026-06-10T12:00:00.000Z",
        snapshotId: "snapshot-a",
        total: { blank: 1, correct: 25, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
      },
    ],
    standardScoreDelta: 35,
    studentId: "student-a",
    tenantId: "tenant-faz9",
  };
}

interface ListMeta {
  limit: number;
  page: number;
  total: number;
  totalPages: number;
}

function createListResponse(data: unknown[], searchParams: URLSearchParams): { data: unknown[]; meta: ListMeta } {
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? String(Math.max(data.length, 1)));
  return {
    data,
    meta: {
      limit,
      page,
      total: data.length,
      totalPages: data.length === 0 ? 0 : Math.ceil(data.length / limit),
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

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function expectUiStable(page: Page, label: string, consoleErrors: string[]) {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await expect(page.locator(".uh-chart-loading")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, label);
  await expectNoBlankCanvas(page, label);
  await expectNoUnlabeledControls(page, label);
  expect(consoleErrors, `${label}: konsol hatası`).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return Math.max(documentElement.scrollWidth - documentElement.clientWidth, body.scrollWidth - body.clientWidth);
  });

  expect(overflow, `${label}: yatay taşma ${overflow}px`).toBeLessThanOrEqual(1);
}

async function expectNoBlankCanvas(page: Page, label: string) {
  const blankCanvasCount = await page.evaluate(() =>
    Array.from(document.querySelectorAll("canvas")).filter((canvas) => canvas.width <= 0 || canvas.height <= 0).length,
  );

  expect(blankCanvasCount, `${label}: boş canvas sayısı`).toBe(0);
}

async function expectNoUnlabeledControls(page: Page, label: string) {
  const unlabeledControls = await page.evaluate(() => {
    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    function hasName(element: Element) {
      const htmlElement = element as HTMLElement;
      const input = element as HTMLInputElement;
      return Boolean(
        htmlElement.closest("label") ||
          element.getAttribute("aria-label")?.trim() ||
          element.getAttribute("aria-labelledby")?.trim() ||
          element.getAttribute("title")?.trim() ||
          input.placeholder?.trim() ||
          htmlElement.textContent?.trim(),
      );
    }

    return Array.from(document.querySelectorAll("button, input, select, textarea"))
      .filter((element) => isVisible(element) && !(element as HTMLInputElement).disabled && !hasName(element))
      .map((element) => element.outerHTML.slice(0, 160));
  });

  expect(unlabeledControls, `${label}: etiketsiz kontrol`).toEqual([]);
}

async function saveScreenshot(page: Page, fileName: string) {
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ fullPage: true, path: path.join(artifactDir, fileName) });
}
