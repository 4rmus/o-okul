import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

// DEC-20261102-05: öğretmen gelişim değerlendirmesi yazar (INTERNAL varsayılan, özel nitelikli veri uyarısı, not sınırı);
// kurum gelişim kriterlerini tanımlar. Kayıtlar yalnız eklenir.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
};

const criteria = [
  { id: "criterion-focus", tenantId: "tenant-dev", name: "Odaklanma", scaleMin: 1, scaleMax: 5, sortOrder: 1 },
  { id: "criterion-duty", tenantId: "tenant-dev", name: "Sorumluluk", scaleMin: 1, scaleMax: 3, sortOrder: 2 },
];
const students = [
  { id: "student-a", tenantId: "tenant-dev", firstName: "Ada", lastName: "Kaya", classId: "class-8a", status: "ACTIVE" },
  { id: "student-b", tenantId: "tenant-dev", firstName: "Bora", lastName: "Demir", classId: "class-8b", status: "ACTIVE" },
];
const history = [
  {
    id: "assessment-old",
    tenantId: "tenant-dev",
    studentId: "student-a",
    teacherId: "teacher-dev",
    periodLabel: "2026 Ekim",
    visibility: "INTERNAL",
    createdAt: "2026-10-15T09:00:00.000Z",
    mentorNote: "Ders içi katılımı arttı.",
    // The API lists scores by criterion id; the page must show them in the form order (sortOrder).
    scores: [
      { id: "score-old-duty", tenantId: "tenant-dev", assessmentId: "assessment-old", criterionId: "criterion-duty", score: 2 },
      { id: "score-old", tenantId: "tenant-dev", assessmentId: "assessment-old", criterionId: "criterion-focus", score: 3 },
    ],
  },
];

interface Captured {
  creates: Array<{ body: unknown; idempotencyKey: string }>;
  criterionCreates: unknown[];
}

interface Options {
  writableStudentIds?: string[];
  createStatus?: number;
}

test.describe("Öğretmen gelişim değerlendirmesi (DEC-20261102-05)", () => {
  test("görünürlük varsayılanı okul içidir; uyarı, not sayacı ve yalnız seçilen puanlar gönderilir", async ({ page }) => {
    const captured: Captured = { creates: [], criterionCreates: [] };
    await open(page, "teacher", "/ogretmen/gelisim", captured);

    const panel = page.getByRole("region", { exact: true, name: "Gelişim değerlendirmesi yaz" });
    const form = panel.getByRole("form", { name: "Gelişim değerlendirmesi formu" });
    await expect(form).toBeVisible();
    await expect(panel.getByText("Sağlık veya diğer özel nitelikli kişisel verileri yazmayın.")).toBeVisible();

    const studentSelect = form.getByRole("combobox", { name: /^Öğrenci/ });
    await expect(studentSelect.locator("option")).toHaveText(["Seçin", "Ada Kaya"]);
    await expect(form.getByLabel("Görünürlük")).toHaveValue("INTERNAL");
    await expect(form).toContainText("Yalnız siz, rehber öğretmen ve kurum yöneticileri görür.");

    await studentSelect.selectOption("student-a");
    const historyPanel = page.getByRole("region", { exact: true, name: "Önceki gelişim değerlendirmeleri" });
    await expect(historyPanel).toContainText("2026 Ekim");
    await expect(historyPanel).toContainText("Odaklanma: 3/5 · Sorumluluk: 2/3");
    await expect(historyPanel).toContainText("Yalnız okul içi");

    await form.getByLabel("Dönem").fill("2026 Kasım");
    await form.getByLabel("Odaklanma (1–5)").selectOption("4");
    const note = form.getByLabel("Mentör notu");
    await note.fill("Ödev düzeni iyileşti.");
    await expect(form).toContainText("21/1000 karakter");
    await expect(note).toHaveAttribute("maxlength", "1000");

    await form.getByRole("button", { name: "Değerlendirmeyi kaydet" }).click();
    await expect.poll(() => captured.creates.length).toBe(1);
    expect(captured.creates[0]!.body).toEqual({
      studentId: "student-a",
      periodLabel: "2026 Kasım",
      scores: [{ criterionId: "criterion-focus", score: 4 }],
      visibility: "INTERNAL",
      mentorNote: "Ödev düzeni iyileşti.",
    });
    expect(captured.creates[0]!.idempotencyKey).not.toBe("");
    await expect(form.getByRole("status").filter({ hasText: "Değerlendirme kaydedildi." })).toBeVisible();
    await expect(note).toHaveValue("");
    await expect(form.getByLabel("Görünürlük")).toHaveValue("INTERNAL");
    await expect(form.getByRole("button", { name: /Düzenle|Sil/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "teacher-development-write");
  });

  test("veli görünürlüğü yalnız açıkça seçilince gönderilir", async ({ page }) => {
    const captured: Captured = { creates: [], criterionCreates: [] };
    await open(page, "teacher", "/ogretmen/gelisim", captured);
    const form = page.getByRole("form", { name: "Gelişim değerlendirmesi formu" });

    await form.getByRole("combobox", { name: /^Öğrenci/ }).selectOption("student-a");
    await form.getByLabel("Dönem").fill("2026 Kasım");
    await form.getByLabel("Sorumluluk (1–3)").selectOption("2");
    await form.getByLabel("Görünürlük").selectOption("GUARDIAN");
    await expect(form).toContainText("Veli ve öğrenci portalında da görünür.");
    await form.getByRole("button", { name: "Değerlendirmeyi kaydet" }).click();

    await expect.poll(() => captured.creates.length).toBe(1);
    expect(captured.creates[0]!.body).toEqual({
      studentId: "student-a",
      periodLabel: "2026 Kasım",
      scores: [{ criterionId: "criterion-duty", score: 2 }],
      visibility: "GUARDIAN",
    });
  });

  test("puan seçilmeden kaydetmez; yetkisiz yazma açık bir hata gösterir", async ({ page }) => {
    const captured: Captured = { creates: [], criterionCreates: [] };
    await open(page, "teacher", "/ogretmen/gelisim", captured, { createStatus: 403 });
    const form = page.getByRole("form", { name: "Gelişim değerlendirmesi formu" });

    await form.getByRole("combobox", { name: /^Öğrenci/ }).selectOption("student-a");
    await form.getByLabel("Dönem").fill("2026 Kasım");
    await form.getByRole("button", { name: "Değerlendirmeyi kaydet" }).click();
    await expect(form.getByRole("alert")).toContainText("En az bir kriter için puan seçin.");
    expect(captured.creates).toHaveLength(0);

    await form.getByLabel("Odaklanma (1–5)").selectOption("2");
    await form.getByRole("button", { name: "Değerlendirmeyi kaydet" }).click();
    await expect(form.getByRole("alert")).toContainText("Bu öğrenci için değerlendirme yazamazsınız. Yalnız sınıf öğretmeni ve rehber öğretmen yazar.");
  });

  test("yazabileceği öğrenci olmayan öğretmene nedeni söylenir", async ({ page }) => {
    const captured: Captured = { creates: [], criterionCreates: [] };
    await open(page, "teacher", "/ogretmen/gelisim", captured, { writableStudentIds: [] });

    const panel = page.getByRole("region", { exact: true, name: "Gelişim değerlendirmesi yaz" });
    await expect(panel).toContainText("Değerlendirme yazabileceğiniz öğrenci yok");
    await expect(panel.getByRole("form")).toHaveCount(0);
  });
});

test.describe("Kurum gelişim kriterleri (DEC-20261102-05)", () => {
  test("kriterleri sırayla listeler ve yeni kriter ekler; düzenleme ya da silme yoktur", async ({ page }) => {
    const captured: Captured = { creates: [], criterionCreates: [] };
    await open(page, "admin", "/kurum/gelisim-kriterleri", captured);

    const region = page.getByRole("region", { exact: true, name: "Gelişim kriteri yönetimi" });
    const table = region.getByRole("table", { name: "Gelişim kriterleri" });
    await expect(table).toContainText("Odaklanma");
    await expect(table).toContainText("1–5");
    await expect(table).toContainText("Sorumluluk");
    await expect(region.getByRole("button", { name: /düzenle|\bsil\b/i })).toHaveCount(0);

    await region.getByRole("button", { name: "Kriter ekle" }).click();
    const dialog = page.getByRole("dialog", { name: "Gelişim kriteri ekle" });
    await dialog.getByLabel("Kriter adı").fill("Sosyal katılım");
    await dialog.getByLabel("En düşük puan").fill("3");
    await dialog.getByLabel("En yüksek puan").fill("2");
    await dialog.getByRole("button", { name: "Ekle" }).click();
    await expect(dialog).toContainText("en düşük puan en yüksek puandan küçük olmalı");
    expect(captured.criterionCreates).toHaveLength(0);

    await dialog.getByLabel("En düşük puan").fill("1");
    await dialog.getByLabel("En yüksek puan").fill("4");
    await dialog.getByLabel("Sıra").fill("3");
    await dialog.getByRole("button", { name: "Ekle" }).click();
    await expect.poll(() => captured.criterionCreates.length).toBe(1);
    expect(captured.criterionCreates[0]).toEqual({ name: "Sosyal katılım", scaleMin: 1, scaleMax: 4, sortOrder: 3 });
    await expect(dialog).toHaveCount(0);
    await expect(table).toContainText("Sosyal katılım");
    await expectNoHorizontalOverflow(page, "development-criteria");
  });
});

async function open(page: Page, persona: "admin" | "teacher", path: string, captured: Captured, options: Options = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/v1/**", (route) => handle(route, persona, captured, options));
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
}

async function handle(route: Route, persona: "admin" | "teacher", captured: Captured, options: Options) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ headers: corsFor(route), status: 204 });
    return;
  }
  const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
  if (path === "/development/assessments" && request.method() === "POST") {
    captured.creates.push({ body: request.postDataJSON(), idempotencyKey: request.headers()["idempotency-key"] ?? "" });
    if (options.createStatus && options.createStatus >= 400) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE" } }),
        headers: { ...corsFor(route), "content-type": "application/json" },
        status: options.createStatus,
      });
      return;
    }
    await fulfill(route, { ...history[0], id: "assessment-new", periodLabel: "2026 Kasım" });
    return;
  }
  if (path === "/development/criteria" && request.method() === "POST") {
    const body = request.postDataJSON() as Record<string, unknown>;
    captured.criterionCreates.push(body);
    await fulfill(route, { id: "criterion-new", tenantId: "tenant-dev", ...body });
    return;
  }
  const createdCriteria = captured.criterionCreates.map((body, index) => ({ id: `criterion-new-${index}`, tenantId: "tenant-dev", ...(body as object) }));
  const responses: Record<string, unknown> = {
    "/auth/refresh": auth(persona),
    "/me/tenant": { id: "tenant-dev", name: "Gelişim Koleji", institutionType: "Özel okul", slug: "gelisim-koleji" },
    "/me/notification-devices": [],
    "/me/feature-rollouts": { enabledFeatureKeys: [] },
    "/development/authoring-scope": { studentIds: options.writableStudentIds ?? ["student-a"] },
    "/development/criteria": [...criteria, ...createdCriteria],
    "/development/assessments": history,
    "/me/teacher/students": students,
  };
  await fulfill(route, path in responses ? responses[path] : []);
}

function auth(persona: "admin" | "teacher") {
  const profile = persona === "admin"
    ? { activePersona: "STAFF", roles: ["ASSISTANT_ADMIN"], userId: "user-admin" }
    : { roles: ["TEACHER"], subjectId: "teacher-dev", subjectType: "TEACHER", userId: "user-teacher" };
  return { accessToken: "development-access-token", session: { id: `session-${persona}`, membershipVersion: 1, status: "ACTIVE", tenantId: "tenant-dev", ...profile } };
}

async function fulfill(route: Route, data: unknown) {
  await route.fulfill({ body: JSON.stringify({ data }), headers: { ...corsFor(route), "content-type": "application/json" }, status: 200 });
}

function corsFor(route: Route) {
  return { ...corsHeaders, "access-control-allow-origin": route.request().headers().origin ?? appOrigin };
}
