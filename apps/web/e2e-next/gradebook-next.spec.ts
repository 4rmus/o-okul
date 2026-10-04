import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
};

const assessment = {
  id: "ga-1",
  tenantId: "tenant-gb",
  classId: "class-8a",
  courseId: "course-math",
  termId: "term-1",
  kind: "WRITTEN",
  title: "1. Yazılı",
  heldOn: "2026-03-10",
  maxScore: 100,
  publishedVersion: 1,
  createdById: "user-admin",
  createdAt: "2026-03-10T08:00:00.000Z",
};
const entry = (studentId: string, version: number, score: number, published: boolean) => ({
  id: `${studentId}-v${version}`,
  assessmentId: "ga-1",
  studentId,
  version,
  score,
  absent: false,
  ...(published ? { publishedAt: "2026-03-11T08:00:00.000Z" } : {}),
  enteredById: "user-teacher",
  createdAt: "2026-03-10T09:00:00.000Z",
});
// Ada: published v1 and a correction draft v2; Bora: published only; Can: nothing yet.
const detail = { assessment, entries: [entry("student-a", 1, 72.3, true), entry("student-a", 2, 75, false), entry("student-b", 1, 60, true)] };
const students = [
  { id: "student-a", tenantId: "tenant-gb", firstName: "Ada", lastName: "Kaya", classId: "class-8a", status: "ACTIVE" },
  { id: "student-b", tenantId: "tenant-gb", firstName: "Bora", lastName: "Yılmaz", classId: "class-8a", status: "ACTIVE" },
  { id: "student-c", tenantId: "tenant-gb", firstName: "Can", lastName: "Demir", classId: "class-8a", status: "ACTIVE" },
];
const classes = [{ id: "class-8a", tenantId: "tenant-gb", name: "8-A", campusId: "campus-main", gradeLevelId: "grade-8" }];
const courses = [{ id: "course-math", tenantId: "tenant-gb", name: "Matematik", code: "MAT" }];
const terms = [{ id: "term-1", tenantId: "tenant-gb", academicYearId: "year-1", name: "2. Dönem", startsAt: "2026-02-01", endsAt: "2026-06-30", isActive: true }];

interface Captured { publish: Array<{ key: string }>; saves: string[] }

test.describe("Not defteri", () => {
  test("yönetici sürüm geçmişini görür, yayınlanmış notu salt okunur görür ve idempotent yayınlar", async ({ page }) => {
    const captured: Captured = { publish: [], saves: [] };
    await open(page, "admin", "/kurum/not-defteri", captured);
    await expect(page.getByRole("heading", { level: 1, name: "Not Defteri" })).toBeVisible();

    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    const grid = page.getByRole("table", { name: "Öğrenci notları" });
    await expect(grid.getByRole("row", { name: /Ada Kaya/ })).toContainText("v1 72,3 · v2 75 (taslak)");
    await expect(grid.getByRole("row", { name: /Ada Kaya/ })).toContainText("Düzeltme taslağı v2");
    await expect(page.getByLabel("Bora Yılmaz notu", { exact: true })).toHaveCount(0);
    await expect(grid.getByRole("row", { name: /Bora Yılmaz/ })).toContainText("Yayında v1");
    await expect(page.getByRole("button", { name: "Bora Yılmaz notunu düzelt" })).toBeVisible();
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toBeEditable();

    await page.getByRole("button", { name: "Yayınla", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Notları yayınla" });
    await expect(dialog).toContainText("değiştirilemez");
    await dialog.getByRole("button", { name: "Yayınla" }).click();
    await expect(page.getByRole("status")).toContainText("1 not yayınlandı (v2).");
    expect(captured.publish).toHaveLength(1);
    expect(captured.publish[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("öğretmen yalnız listelenen değerlendirmeye not girer; yayınlanmış hücreyi düzeltmeden değiştiremez", async ({ page }) => {
    const captured: Captured = { publish: [], saves: [] };
    await open(page, "teacher", "/ogretmen/not-defteri", captured);
    const panel = page.getByRole("region", { name: "Öğretmen not girişi" });
    await expect(panel).toBeVisible();

    await panel.getByLabel("Değerlendirme").selectOption("ga-1");
    await expect(page.getByLabel("Bora Yılmaz notu", { exact: true })).toHaveCount(0);
    await page.getByLabel("Can Demir notu", { exact: true }).fill("88,5");
    await page.getByLabel("Can Demir notu", { exact: true }).press("Enter");
    await page.getByRole("button", { name: "Taslağı kaydet" }).click();
    await expect.poll(() => captured.saves.length).toBe(1);
    expect(JSON.parse(captured.saves[0]!)).toEqual({ entries: [{ studentId: "student-c", score: 88.5, absent: false }] });

    await page.getByRole("button", { name: "Bora Yılmaz notunu düzelt" }).click();
    await expect(page.getByLabel("Bora Yılmaz notu", { exact: true })).toBeEditable();
  });
});

async function open(page: Page, persona: "admin" | "teacher", path: string, captured: Captured) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/v1/**", (route) => handle(route, persona, captured));
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
}

async function handle(route: Route, persona: "admin" | "teacher", captured: Captured) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ headers: corsFor(route), status: 204 });
    return;
  }
  const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
  if (path === "/grade-assessments/ga-1/publish" && request.method() === "POST") {
    captured.publish.push({ key: request.headers()["idempotency-key"] ?? "" });
    await fulfill(route, { assessment: { ...assessment, publishedVersion: 2 }, publishedCount: 1 });
    return;
  }
  if (path === "/grade-assessments/ga-1/entries" && request.method() === "PUT") {
    captured.saves.push(request.postData() ?? "");
    await fulfill(route, detail.entries);
    return;
  }
  const responses: Record<string, unknown> = {
    "/auth/refresh": auth(persona),
    "/me/tenant": { id: "tenant-gb", name: "Not Akademi", institutionType: "Özel okul", slug: "not-akademi" },
    "/me/notification-devices": [],
    "/me/feature-rollouts": { enabledFeatureKeys: [] },
    "/grade-assessments": [assessment],
    "/grade-assessments/ga-1": detail,
    "/classes": classes,
    "/courses": courses,
    "/academic-terms": terms,
    "/students": students,
    "/me/teacher/students": students,
    "/me/teacher/lookups": { attendanceClassIds: ["class-8a"], campuses: [], classes, courses, gradeLevels: [], terms },
  };
  await fulfill(route, path in responses ? responses[path] : []);
}

function auth(persona: "admin" | "teacher") {
  const profile = persona === "admin"
    ? { activePersona: "STAFF", roles: ["TENANT_ADMIN"], userId: "user-admin" }
    : { roles: ["TEACHER"], subjectId: "teacher-math", subjectType: "TEACHER", userId: "user-teacher" };
  return { accessToken: "gradebook-access-token", session: { id: `session-${persona}`, membershipVersion: 1, status: "ACTIVE", tenantId: "tenant-gb", ...profile } };
}

async function fulfill(route: Route, data: unknown) {
  await route.fulfill({ body: JSON.stringify({ data }), headers: { ...corsFor(route), "content-type": "application/json" }, status: 200 });
}

function corsFor(route: Route) {
  return { ...corsHeaders, "access-control-allow-origin": route.request().headers().origin ?? appOrigin };
}
