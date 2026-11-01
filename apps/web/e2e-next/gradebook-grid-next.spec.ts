import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

// T2: keyboard grid, inline validation, sticky save/publish bar and the unsaved-change guard. Publication
// semantics (ADR-0011) are covered in gradebook-next.spec.ts and stay unchanged here.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
};

const base = {
  tenantId: "tenant-gb",
  courseId: "course-math",
  termId: "term-1",
  kind: "WRITTEN",
  heldOn: "2026-03-10",
  maxScore: 100,
  createdById: "user-admin",
  createdAt: "2026-03-10T08:00:00.000Z",
};
const assessments = [
  { ...base, id: "ga-1", classId: "class-8a", title: "1. Yazılı", publishedVersion: 1 },
  { ...base, id: "ga-2", classId: "class-8b", title: "Proje", kind: "PROJECT" },
  { ...base, id: "ga-3", classId: "class-8a", title: "2. Yazılı" },
];
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
// Ada: correction draft (editable); Bora: published only (read-only row); the rest have nothing yet.
const details: Record<string, unknown> = {
  "ga-1": { assessment: assessments[0], entries: [entry("student-a", 1, 72.3, true), entry("student-a", 2, 75, false), entry("student-b", 1, 60, true)] },
  "ga-2": { assessment: assessments[1], entries: [] },
  "ga-3": { assessment: assessments[2], entries: [] },
};
const student = (id: string, firstName: string, lastName: string, classId = "class-8a") => ({ id, tenantId: "tenant-gb", firstName, lastName, classId, status: "ACTIVE" });
const students = [
  student("student-a", "Ada", "Kaya"),
  student("student-b", "Bora", "Yılmaz"),
  student("student-c", "Can", "Demir"),
  ...Array.from({ length: 30 }, (_, index) => student(`student-x${index}`, "Öğrenci", String(index + 1).padStart(2, "0"))),
  student("student-d", "Deniz", "Ak", "class-8b"),
];
const classes = [
  { id: "class-8b", tenantId: "tenant-gb", name: "8-B", campusId: "campus-main", gradeLevelId: "grade-8" },
  { id: "class-8a", tenantId: "tenant-gb", name: "8-A", campusId: "campus-main", gradeLevelId: "grade-8" },
];
const courses = [{ id: "course-math", tenantId: "tenant-gb", name: "Matematik", code: "MAT" }];
const terms = [{ id: "term-1", tenantId: "tenant-gb", academicYearId: "year-1", name: "2. Dönem", startsAt: "2026-02-01", endsAt: "2026-06-30", isActive: true }];

interface Captured { saves: string[] }

test.describe("Not girişi tablosu", () => {
  test("öğretmen ok tuşlarıyla satır ve alan arasında geçer; yayınlanmış satır atlanır, Enter alta iner", async ({ page }) => {
    const panel = await openTeacher(page, { saves: [] });
    await panel.getByLabel("Değerlendirme").selectOption("ga-1");

    const ada = page.getByLabel("Ada Kaya notu", { exact: true });
    const can = page.getByLabel("Can Demir notu", { exact: true });
    await ada.focus();
    await ada.press("ArrowDown");
    await expect(can).toBeFocused();
    await can.press("ArrowUp");
    await expect(ada).toBeFocused();

    // Right leaves the text only from its end; left only from its start.
    await placeCaret(ada, "end");
    await ada.press("ArrowRight");
    await expect(page.getByLabel("Ada Kaya sınava girmedi")).toBeFocused();
    await page.getByLabel("Ada Kaya sınava girmedi").press("ArrowDown");
    await expect(page.getByLabel("Can Demir sınava girmedi")).toBeFocused();
    await page.getByLabel("Can Demir sınava girmedi").press("ArrowLeft");
    await expect(can).toBeFocused();

    await can.fill("88");
    await placeCaret(can, "start");
    await can.press("ArrowLeft");
    await expect(can).toBeFocused();
    await can.press("Enter");
    await expect(page.getByLabel("Öğrenci 01 notu", { exact: true })).toBeFocused();
    await expect(page.getByTestId("grade-unsaved-summary")).toHaveText("1 değişiklik kaydedilmedi");
  });

  test("geçersiz not hücrenin altında söylenir, sayısı özetlenir ve kayıt gönderilmez", async ({ page }) => {
    const captured: Captured = { saves: [] };
    const panel = await openTeacher(page, captured);
    await panel.getByLabel("Değerlendirme").selectOption("ga-1");

    const can = page.getByLabel("Can Demir notu", { exact: true });
    await can.fill("120");
    await expect(can).not.toHaveAttribute("aria-invalid", "true");
    await can.blur();
    await expect(can).toHaveAttribute("aria-invalid", "true");
    await expect(can).toHaveAccessibleDescription("0 ile 100 arasında, en fazla iki ondalıklı olmalı.");
    await page.getByLabel("Öğrenci 01 notu", { exact: true }).fill("7,555");
    await expect(page.getByTestId("grade-unsaved-summary")).toHaveText("2 değişiklik kaydedilmedi · 1 notta hata var");

    const bar = page.getByRole("group", { name: "Not kaydetme" });
    await bar.getByRole("button", { name: "Taslağı kaydet" }).click();
    await expect(bar.getByRole("alert")).toHaveText("2 notta hata var. İşaretli hücreleri düzeltip tekrar kaydedin.");
    await expect(page.getByLabel("Öğrenci 01 notu", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(can).toBeFocused();
    expect(captured.saves).toHaveLength(0);
    const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);

    await can.fill("95");
    await page.getByLabel("Öğrenci 01 notu", { exact: true }).fill("7,5");
    await expect(can).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("grade-unsaved-summary")).toHaveText("2 değişiklik kaydedilmedi");
    await page.getByRole("button", { name: "Taslağı kaydet" }).click();
    await expect.poll(() => captured.saves.length).toBe(1);
    expect(JSON.parse(captured.saves[0]!)).toEqual({
      entries: [{ studentId: "student-c", score: 95, absent: false }, { studentId: "student-x0", score: 7.5, absent: false }],
    });
    await expect(page.getByTestId("grade-unsaved-summary")).toHaveText("Kaydedilmemiş değişiklik yok");
  });

  for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 700 }, { width: 768, height: 900 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`kaydet ve yayınla ${viewport.width}px görünümde uzun listenin altında kalmaz`, async ({ page }) => {
      const panel = await openTeacher(page, { saves: [] }, viewport);
      await panel.getByLabel("Değerlendirme").selectOption("ga-1");
      await page.getByLabel("Can Demir notu", { exact: true }).fill("90");

      const bar = page.getByRole("group", { name: "Not kaydetme" });
      await expect(bar).toContainText("1 değişiklik kaydedilmedi");
      await expectReachable(bar.getByRole("button", { name: "Taslağı kaydet" }));
      await expectReachable(bar.getByRole("button", { name: "Düzeltmeyi yayınla" }));
      // One primary action at a time: unsaved grades make saving primary and publishing secondary.
      await expect(bar.getByRole("button", { name: "Taslağı kaydet" })).toHaveClass(/uh-button--primary/);
      await expect(bar.getByRole("button", { name: "Düzeltmeyi yayınla" })).toHaveClass(/uh-button--secondary/);
      await expectNoHorizontalOverflow(page, `not girişi tablosu ${viewport.width}px`);
    });
  }

  test("kaydedilmemiş not varken sayfadan çıkış uyarır, değerlendirme değişimi onay ister", async ({ page }) => {
    const panel = await openTeacher(page, { saves: [] });
    const picker = panel.getByLabel("Değerlendirme");
    await expect(picker.locator("optgroup")).toHaveCount(2);
    await expect(picker.locator("optgroup").first()).toHaveAttribute("label", "8-A");
    await expect(picker.locator('optgroup[label="8-A"] option')).toHaveText(["1. Yazılı · Matematik · Yazılı", "2. Yazılı · Matematik · Yazılı"]);
    await expect(picker.locator('optgroup[label="8-B"] option')).toHaveText(["Proje · Matematik · Proje"]);

    await picker.selectOption("ga-1");
    await expect.poll(() => beforeUnloadBlocked(page)).toBe(false);
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
    await expect.poll(() => beforeUnloadBlocked(page)).toBe(true);

    // The publish confirm says unsaved grades are not part of the publication.
    await page.getByRole("button", { name: "Düzeltmeyi yayınla" }).click();
    const publishDialog = page.getByRole("dialog", { name: "Düzeltmeyi yayınla" });
    await expect(publishDialog).toContainText("1 değişiklik yayına dahil edilmez");
    await publishDialog.getByRole("button", { name: "Vazgeç" }).click();

    await picker.selectOption("ga-3");
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
    await expect(dialog).toContainText("1 değişiklik kaydedilmedi.");
    await dialog.getByRole("button", { name: "Notlara dön" }).click();
    await expect(picker).toHaveValue("ga-1");
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    await picker.selectOption("ga-3");
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(picker).toHaveValue("ga-3");
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("");
    await expect(page.getByTestId("grade-unsaved-summary")).toHaveText("Kaydedilmemiş değişiklik yok");
    await expect.poll(() => beforeUnloadBlocked(page)).toBe(false);

    // Without unsaved grades the switch needs no confirmation.
    await picker.selectOption("ga-1");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Ada Kaya notu", { exact: true })).toHaveValue("75");
  });

  test("yönetici ekranı aynı tabloyu kullanır: ok tuşları, alt çubuk ve değişim onayı", async ({ page }) => {
    await open(page, "admin", "/kurum/not-defteri", { saves: [] });
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    const ada = page.getByLabel("Ada Kaya notu", { exact: true });
    await ada.focus();
    await ada.press("ArrowDown");
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toBeFocused();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("101");
    await page.getByLabel("Can Demir notu", { exact: true }).press("Enter");
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveAttribute("aria-invalid", "true");

    const bar = page.getByRole("group", { name: "Not kaydetme" });
    await expect(bar).toContainText("1 değişiklik kaydedilmedi · 1 notta hata var");
    await expectReachable(bar.getByRole("button", { name: "Yayınla", exact: true }));
    await expect.poll(() => beforeUnloadBlocked(page)).toBe(true);

    await page.getByRole("button", { name: "2. Yazılı notlarını aç" }).click();
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
    await dialog.getByRole("button", { name: "Notlara dön" }).click();
    await expect(page.getByRole("region", { name: "Değerlendirme notları" })).toContainText("1. Yazılı");
    await page.getByRole("button", { name: "2. Yazılı notlarını aç" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page.getByRole("region", { name: "Değerlendirme notları" })).toContainText("2. Yazılı");
    await expect.poll(() => beforeUnloadBlocked(page)).toBe(false);
  });
});

/** In the viewport and not covered by another layer (the portal bottom tab bar is fixed below 1024 px). */
async function expectReachable(button: Locator) {
  await expect(button).toBeInViewport();
  await expect.poll(() => button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && element.contains(hit));
  })).toBe(true);
}

// Home/End do not move the caret in a macOS text field, so place it directly.
async function placeCaret(input: Locator, where: "start" | "end") {
  await input.evaluate((element, atEnd) => {
    const field = element as HTMLInputElement;
    const position = atEnd ? field.value.length : 0;
    field.setSelectionRange(position, position);
  }, where === "end");
}

/** Dispatches a cancelable beforeunload, the same check the browser runs before leaving the page. */
async function beforeUnloadBlocked(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function openTeacher(page: Page, captured: Captured, viewport = { width: 1280, height: 900 }) {
  await open(page, "teacher", "/ogretmen/not-defteri", captured, viewport);
  const panel = page.getByRole("region", { name: "Öğretmen not girişi" });
  await expect(panel).toBeVisible();
  return panel;
}

async function open(page: Page, persona: "admin" | "teacher", path: string, captured: Captured, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
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
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "");
  const entriesMatch = /^\/grade-assessments\/(ga-\d)\/entries$/.exec(path);
  if (entriesMatch && request.method() === "PUT") {
    captured.saves.push(request.postData() ?? "");
    await fulfill(route, []);
    return;
  }
  const detailMatch = /^\/grade-assessments\/(ga-\d)$/.exec(path);
  if (detailMatch) {
    await fulfill(route, details[detailMatch[1]!]);
    return;
  }
  const classId = url.searchParams.get("classId");
  const responses: Record<string, unknown> = {
    "/auth/refresh": auth(persona),
    "/me/tenant": { id: "tenant-gb", name: "Not Akademi", institutionType: "Özel okul", slug: "not-akademi" },
    "/me/notification-devices": [],
    "/me/feature-rollouts": { enabledFeatureKeys: [] },
    "/grade-assessments": assessments,
    "/grade-assessments/teacher-scopes": [{ classId: "class-8a", courseId: "course-math", termId: "term-1" }],
    "/classes": classes,
    "/courses": courses,
    "/academic-terms": terms,
    "/students": classId ? students.filter((record) => record.classId === classId) : students,
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
