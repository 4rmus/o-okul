import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

// UAT F-22 / F-23 (docs/staging-uat-s1.md): the teachers list and the students list resolve assignment data from the
// same read-model fields the detail screens are built on, and row actions carry the teacher's full name.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
};

const tenantId = "tenant-uat";
// Two teachers with the same first name: only the full name tells them apart (F-23).
const teachers = [
  {
    id: "teacher-uat",
    tenantId,
    firstName: "UAT",
    lastName: "ÖĞRETMEN",
    branch: "Matematik",
    hasAccount: true,
    // GET /teachers/:id/assignments has 2 rows: CLASS_TEACHER 8-A and BRANCH_TEACHER 8-A Matematik.
    assignmentSummary: { total: 2, classCount: 1, courseCount: 1, studentCount: 0 },
  },
  {
    id: "teacher-uat-2",
    tenantId,
    firstName: "UAT",
    lastName: "YEDEK",
    branch: "Fen",
    hasAccount: true,
    assignmentSummary: { total: 0, classCount: 0, courseCount: 0, studentCount: 0 },
  },
];
const classes = [{ id: "class-8a", tenantId, name: "8-A", campusId: "campus-main", gradeLevelId: "grade-8", section: "A" }];
const courses = [{ id: "course-math", tenantId, name: "Matematik", code: "MAT" }];
const gradeLevels = [{ id: "grade-8", tenantId, name: "8. SINIF", code: "8" }];
const terms = [{ id: "term-1", tenantId, academicYearId: "year-1", name: "1. Dönem", startsAt: "2026-09-01", endsAt: "2027-01-31", isActive: true }];
// 8-A students without a stored responsibleTeacherId: the API resolves the active CLASS_TEACHER of 8-A (F-22b).
const students = [
  { id: "student-ada", tenantId, firstName: "Ada", lastName: "Ak", studentNo: "801", gradeLevelId: "grade-8", classId: "class-8a", status: "ACTIVE", assignedTeacherId: "teacher-uat", assignedTeacherRole: "CLASS_TEACHER" },
  { id: "student-bora", tenantId, firstName: "Bora", lastName: "Bal", studentNo: "802", gradeLevelId: "grade-8", classId: "class-8a", status: "ACTIVE", responsibleTeacherId: "teacher-uat-2" },
  { id: "student-can", tenantId, firstName: "Can", lastName: "Cem", studentNo: "803", gradeLevelId: "grade-8", status: "ACTIVE" },
];

test.describe("Öğretmen ataması tutarlılığı (UAT F-22, F-23)", () => {
  test("öğretmen listesi atama kartında ve satırında ayrıntıyla aynı sayıları gösterir; işlem adları tam adı taşır", async ({ page }) => {
    await open(page, "/kurum/ogretmenler");
    const region = page.getByLabel("Öğretmen yönetimi");
    const summary = region.getByRole("region", { exact: true, name: "Öğretmen operasyon özeti" });
    await expect(summary).toContainText("Atama referansı");
    // 2 assignments / 1 class binding / 1 course binding on this page, like the detail's 2 atama · 1 sınıf · 1 ders.
    await expect(summary).toContainText("2/1/1");
    await expect(summary).toContainText("Atama / sınıf bağı / ders bağı");

    const table = region.getByRole("table", { name: "Öğretmen operasyon listesi" });
    await expect(table.getByRole("row", { name: /UAT ÖĞRETMEN/ })).toContainText("2 atama · 1 sınıf · 1 ders");
    await expect(table.getByRole("row", { name: /UAT YEDEK/ })).toContainText("Atama yok");

    // F-23: both "UAT" teachers get distinct accessible names on every row action.
    for (const fullName of ["UAT ÖĞRETMEN", "UAT YEDEK"]) {
      await expect(table.getByRole("link", { name: `${fullName} detay` })).toHaveCount(1);
      await expect(table.getByRole("button", { name: `${fullName} düzenle` })).toHaveCount(1);
      await expect(table.getByRole("button", { name: `${fullName} sil` })).toHaveCount(1);
    }
    await expect(table.getByRole("link", { name: "UAT detay", exact: true })).toHaveCount(0);
    await expect(table.getByRole("button", { name: "UAT sil", exact: true })).toHaveCount(0);
  });

  test("öğrenci listesi sorumlu öğretmeni sınıf öğretmeni atamasından çözer, açık alan önceliklidir", async ({ page }) => {
    await open(page, "/kurum/ogrenciler?columns=studentNo,name,class,responsibleTeacher,status,actions");
    const table = page.getByRole("table", { name: "Öğrenci listesi" });
    await expect(table.getByRole("row", { name: /Ada Ak/ })).toContainText("UAT ÖĞRETMEN (sınıf öğretmeni)");
    await expect(table.getByRole("row", { name: /Bora Bal/ })).toContainText("UAT YEDEK");
    await expect(table.getByRole("row", { name: /Bora Bal/ })).not.toContainText("sınıf öğretmeni");
    await expect(table.getByRole("row", { name: /Can Cem/ })).toContainText("—");
  });

  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`öğretmen ve öğrenci listeleri ${width}px genişlikte yatay taşma yapmaz`, async ({ page }) => {
      await open(page, "/kurum/ogretmenler", width);
      const region = page.getByLabel("Öğretmen yönetimi");
      await expect(region.getByRole("table", { name: "Öğretmen operasyon listesi" })).toBeVisible();
      await expect(region.getByRole("region", { exact: true, name: "Öğretmen operasyon özeti" })).toContainText("2/1/1");
      await expectNoHorizontalOverflow(page, `öğretmen listesi ${width}px`);

      await page.goto("/kurum/ogrenciler?columns=studentNo,name,class,responsibleTeacher,status,actions");
      await expect(page.getByRole("table", { name: "Öğrenci listesi" }).getByRole("row", { name: /Ada Ak/ })).toContainText("UAT ÖĞRETMEN");
      await expectNoHorizontalOverflow(page, `öğrenci listesi ${width}px`);
    });
  }
});

async function open(page: Page, path: string, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/v1/**", (route) => handle(route));
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
}

async function handle(route: Route) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ headers: corsFor(route), status: 204 });
    return;
  }
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "");
  if (path === "/teachers" && url.searchParams.has("page")) {
    await fulfill(route, teachers, { total: teachers.length, page: 1, limit: 10, totalPages: 1 });
    return;
  }
  if (path === "/students" && url.searchParams.has("limit")) {
    await fulfill(route, students, { limit: Number(url.searchParams.get("limit") ?? "20"), total: students.length });
    return;
  }
  const responses: Record<string, unknown> = {
    "/auth/refresh": {
      accessToken: "uat-access-token",
      session: { id: "session-uat", membershipVersion: 1, roles: ["TENANT_ADMIN"], status: "ACTIVE", tenantId, userId: "user-uat-admin" },
    },
    "/me/tenant": { id: tenantId, name: "UAT Koleji", institutionType: "Özel okul", slug: "uat-koleji" },
    "/me/notification-devices": [],
    "/me/feature-rollouts": { enabledFeatureKeys: [] },
    "/teachers": teachers,
    "/classes": classes,
    "/courses": courses,
    "/grade-levels": gradeLevels,
    "/academic-terms": terms,
    "/students": students,
    "/identity-invitations": [],
  };
  await fulfill(route, path in responses ? responses[path] : []);
}

async function fulfill(route: Route, data: unknown, meta?: Record<string, unknown>) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
    headers: { ...corsFor(route), "content-type": "application/json" },
    status: 200,
  });
}

function corsFor(route: Route) {
  return { ...corsHeaders, "access-control-allow-origin": route.request().headers().origin ?? appOrigin };
}
