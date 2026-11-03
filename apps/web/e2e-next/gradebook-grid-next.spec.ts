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
// The grid sorts by surname (UAT U8), so the surnames keep Ada, Bora (skipped by the arrow keys), Can, then the
// 30 "Sıra NN" students in this order.
const details: Record<string, unknown> = {
  "ga-1": { assessment: assessments[0], entries: [entry("student-a", 1, 72.3, true), entry("student-a", 2, 75, false), entry("student-b", 1, 60, true)] },
  "ga-2": { assessment: assessments[1], entries: [] },
  "ga-3": { assessment: assessments[2], entries: [] },
};
const student = (id: string, firstName: string, lastName: string, classId = "class-8a") => ({ id, tenantId: "tenant-gb", firstName, lastName, classId, status: "ACTIVE" });
const students = [
  student("student-a", "Ada", "Acar"),
  student("student-b", "Bora", "Bal"),
  student("student-c", "Can", "Demir"),
  ...Array.from({ length: 30 }, (_, index) => student(`student-x${index}`, "Öğrenci", `Sıra ${String(index + 1).padStart(2, "0")}`)),
  student("student-d", "Deniz", "Ak", "class-8b"),
];
const classes = [
  { id: "class-8b", tenantId: "tenant-gb", name: "8-B", campusId: "campus-main", gradeLevelId: "grade-8" },
  { id: "class-8a", tenantId: "tenant-gb", name: "8-A", campusId: "campus-main", gradeLevelId: "grade-8" },
];
const courses = [{ id: "course-math", tenantId: "tenant-gb", name: "Matematik", code: "MAT" }];
const terms = [{ id: "term-1", tenantId: "tenant-gb", academicYearId: "year-1", name: "2. Dönem", startsAt: "2026-02-01", endsAt: "2026-06-30", isActive: true }];

// Back/forward guard tests; ux-rc runs them in Chromium and WebKit (apps/web/package.json, playwright.rc.config.ts).
const backForwardTag = { tag: "@geri-koruma" };

interface Captured {
  saves: string[];
  /** Delays the logout and persona switch responses (milliseconds). */
  slowAuthMs?: number;
  /**
   * Offers a STAFF → TEACHER persona switch whose request succeeds, fails, or succeeds with a session that keeps
   * institution access (TENANT_ADMIN plus TEACHER), so /kurum/not-defteri stays.
   */
  personaSwitch?: "ok" | "fail" | "keep";
  loggedOut?: boolean;
}

test.describe("Not girişi tablosu", () => {
  test("öğretmen ok tuşlarıyla satır ve alan arasında geçer; yayınlanmış satır atlanır, Enter alta iner", async ({ page }) => {
    const panel = await openTeacher(page, { saves: [] });
    await panel.getByLabel("Değerlendirme").selectOption("ga-1");

    const ada = page.getByLabel("Ada Acar notu", { exact: true });
    const can = page.getByLabel("Can Demir notu", { exact: true });
    await ada.focus();
    await ada.press("ArrowDown");
    await expect(can).toBeFocused();
    await can.press("ArrowUp");
    await expect(ada).toBeFocused();

    // Right leaves the text only from its end; left only from its start.
    await placeCaret(ada, "end");
    await ada.press("ArrowRight");
    await expect(page.getByLabel("Ada Acar sınava girmedi")).toBeFocused();
    await page.getByLabel("Ada Acar sınava girmedi").press("ArrowDown");
    await expect(page.getByLabel("Can Demir sınava girmedi")).toBeFocused();
    await page.getByLabel("Can Demir sınava girmedi").press("ArrowLeft");
    await expect(can).toBeFocused();

    await can.fill("88");
    await placeCaret(can, "start");
    await can.press("ArrowLeft");
    await expect(can).toBeFocused();
    await can.press("Enter");
    await expect(page.getByLabel("Öğrenci Sıra 01 notu", { exact: true })).toBeFocused();
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
    await page.getByLabel("Öğrenci Sıra 01 notu", { exact: true }).fill("7,555");
    await expect(page.getByTestId("grade-unsaved-summary")).toHaveText("2 değişiklik kaydedilmedi · 1 notta hata var");

    const bar = page.getByRole("group", { name: "Not kaydetme" });
    await bar.getByRole("button", { name: "Taslağı kaydet" }).click();
    await expect(bar.getByRole("alert")).toHaveText("2 notta hata var. İşaretli hücreleri düzeltip tekrar kaydedin.");
    await expect(page.getByLabel("Öğrenci Sıra 01 notu", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(can).toBeFocused();
    expect(captured.saves).toHaveLength(0);
    const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);

    await can.fill("95");
    await page.getByLabel("Öğrenci Sıra 01 notu", { exact: true }).fill("7,5");
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
    await expect(page.getByLabel("Ada Acar notu", { exact: true })).toHaveValue("75");
  });

  test("yönetici ekranı aynı tabloyu kullanır: ok tuşları, alt çubuk ve değişim onayı", async ({ page }) => {
    await open(page, "admin", "/kurum/not-defteri", { saves: [] });
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    const ada = page.getByLabel("Ada Acar notu", { exact: true });
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

  test("kaydedilmemiş not varken menü, gezinme yolu ve komut paleti bağlantıları onay ister", backForwardTag, async ({ page }) => {
    await open(page, "admin", "/kurum/not-defteri", { saves: [] });
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    const sessionsLink = page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Oturumlar" });

    // Nothing typed yet: the link leaves without a confirm.
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toBeVisible();
    await sessionsLink.click();
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Oturumlar" })).toBeVisible();

    await page.goto("/kurum/not-defteri");
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");

    await sessionsLink.click();
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
    await expect(dialog).toContainText("1 değişiklik kaydedilmedi.");
    await dialog.getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    await page.getByRole("navigation", { name: "Gezinme yolu" }).getByRole("link", { name: "Kurum Özeti" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Komut paleti" });
    await palette.getByRole("combobox", { name: "Komut ara" }).fill("Öğrenciler");
    await palette.getByRole("combobox", { name: "Komut ara" }).press("Enter");
    await expect(palette).toHaveCount(0);
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    await sessionsLink.click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
  });

  test("öğretmen alt gezinmesi kaydedilmemiş notta onay ister", async ({ page }) => {
    const panel = await openTeacher(page, { saves: [] }, { width: 375, height: 812 });
    await panel.getByLabel("Değerlendirme").selectOption("ga-1");
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");

    await page.getByRole("navigation", { name: "Portal kısayolları" }).getByRole("link", { name: "Ödevler" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/ogretmen\/not-defteri$/);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");
  });

  test("kaydedilmemiş not varken tarayıcı geri tuşu onay ister; vazgeçince adres ve not yerinde kalır", backForwardTag, async ({ page }) => {
    await open(page, "admin", "/hesap/oturumlar", { saves: [] });
    // WebKit interrupts a second goto that starts while the first page is still bootstrapping its session.
    await expect(page.getByRole("heading", { level: 1, name: "Oturumlar" })).toBeVisible();
    await page.goto("/kurum/not-defteri");
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    const historyLength = await page.evaluate(() => window.history.length);

    await page.evaluate(() => window.history.back());
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
    await expect(dialog).toContainText("1 değişiklik kaydedilmedi.");
    await dialog.getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");
    await expect(page.getByRole("region", { name: "Değerlendirme notları" })).toContainText("1. Yazılı");
    // Cancel puts the guard entry back in place: no history entries pile up.
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength);

    // Confirm goes exactly one page back (here a full page load); the page's beforeunload does not ask again.
    await page.evaluate(() => window.history.back());
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("uygulama içi geçmişte geri onay ister; not temizlenince koruma kaydı geçmişten kalkar", backForwardTag, async ({ page }) => {
    await open(page, "admin", "/hesap/oturumlar", { saves: [] });
    const palette = page.getByRole("dialog", { name: "Komut paleti" });
    // The shortcut listener attaches on hydration; retry until the palette opens.
    await expect(async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(palette).toBeVisible({ timeout: 1000 });
    }).toPass();
    await palette.getByRole("combobox", { name: "Komut ara" }).fill("Not Defteri");
    await palette.getByRole("combobox", { name: "Komut ara" }).press("Enter");
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
    await expect.poll(() => onGuardSentinel(page)).toBe(true);

    await page.evaluate(() => window.history.back());
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    // Discarding the unsaved grades on the page drops the guard entry, and new typing arms it again.
    await page.getByRole("button", { name: "2. Yazılı notlarını aç" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page.getByRole("region", { name: "Değerlendirme notları" })).toContainText("2. Yazılı");
    await expect.poll(() => onGuardSentinel(page)).toBe(false);
    await page.getByLabel("Can Demir notu", { exact: true }).fill("80");
    await expect.poll(() => onGuardSentinel(page)).toBe(true);

    // One back press, one confirm: the router lands on the page before the gradebook, not on a leftover copy.
    await page.evaluate(() => window.history.back());
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("kaydedilmemiş not varken çıkış onay ister; vazgeçince oturum ve not yerinde kalır", backForwardTag, async ({ page }) => {
    const logoutRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/api/v1/auth/logout") && request.method() !== "OPTIONS") logoutRequests.push(request.method());
    });
    await open(page, "admin", "/kurum/not-defteri", { saves: [] });
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");

    const logoutButton = page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış" });
    await logoutButton.click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");
    expect(logoutRequests).toEqual([]);

    await logoutButton.click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page).not.toHaveURL(/\/kurum\/not-defteri/);
    expect(logoutRequests).toEqual(["POST"]);
  });

  test("iki adım geri sonra vazgeçince adres sayfayla aynı kalır; kayıt koruma kaydını adresi değiştirmeden kaldırır", backForwardTag, async ({ page }) => {
    const captured: Captured = { saves: [] };
    await openGradebookFromSessions(page, captured);
    const historyLength = await page.evaluate(() => window.history.length);

    // Long-press history menu: two entries at once, past the gradebook's own entry.
    await page.evaluate(() => window.history.go(-2));
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
    await dialog.getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    // With the Navigation API the guard steps forward to its entry; nothing is dropped or added.
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength);

    await page.getByRole("button", { name: "Taslağı kaydet" }).click();
    await expect.poll(() => captured.saves.length).toBe(1);
    await expect.poll(() => onGuardSentinel(page)).toBe(false);
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect(page.getByRole("region", { name: "Değerlendirme notları" })).toContainText("1. Yazılı");

    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Navigation API yokken iki adım geri ve vazgeç adresi sayfada tutar", backForwardTag, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "navigation", { configurable: true, value: undefined });
    });
    const captured: Captured = { saves: [] };
    await openGradebookFromSessions(page, captured);

    await page.evaluate(() => window.history.go(-2));
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    await page.getByRole("button", { name: "Taslağı kaydet" }).click();
    await expect.poll(() => captured.saves.length).toBe(1);
    await expect.poll(() => onGuardSentinel(page)).toBe(false);
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect(page.getByRole("region", { name: "Değerlendirme notları" })).toContainText("1. Yazılı");
  });

  test("soru açıkken ikinci geri basışı vazgeçle geri alınır; sonraki onay bir önceki sayfaya iner", backForwardTag, async ({ page }) => {
    await openGradebookFromSessions(page, { saves: [] });

    await page.evaluate(() => window.history.back());
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
    await dialog.getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    await page.evaluate(() => window.history.back());
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("ilk geçmiş kaydında onaylanan geri bir yere gitmezse koruma yeniden kurulur", backForwardTag, async ({ page }) => {
    await open(page, "admin", "/kurum/not-defteri", { saves: [] });
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
    await expect.poll(() => onGuardSentinel(page)).toBe(true);

    await page.evaluate(() => window.history.back());
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
    await expect(dialog).toBeVisible();
    // On a tab's first entry the confirmed step back goes nowhere; Playwright's tab keeps about:blank below, so the
    // no-op is simulated.
    await page.evaluate(() => {
      window.history.back = () => undefined;
    });
    await dialog.getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect.poll(() => onGuardSentinel(page), { timeout: 5000 }).toBe(true);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    await page.evaluate(() => window.history.go(-1));
    await expect(page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" })).toBeVisible();
  });

  test("çalışma alanı değişimi başarısız olursa koruma hemen geri gelir", backForwardTag, async ({ page }) => {
    await open(page, "admin", "/kurum/not-defteri", { saves: [], personaSwitch: "fail" });
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
    await expect.poll(() => onGuardSentinel(page)).toBe(true);

    await page.getByLabel("Üst gezinme").getByRole("button", { name: "Öğretmen alanına geç" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Çalışma alanı değiştirilemedi" }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    await page.evaluate(() => window.history.back());
    await expect(page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" })).toBeVisible();
  });

  test("sayfayı koruyan çalışma alanı değişimi korumayı hemen geri kurar; not defteri yeni oturumda taslağı bırakınca koruma kalkar", backForwardTag, async ({ page }) => {
    await openGradebookFromSessions(page, { saves: [], personaSwitch: "keep" });
    // Records the guard mark of every history write from here on (Next.js has patched history by now).
    await page.evaluate(() => {
      const writes: string[] = [];
      (window as unknown as { __historyWrites: string[] }).__historyWrites = writes;
      const mark = (data: unknown) => {
        const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
        return "__ookulGuardSentinel" in record ? "sentinel" : "__ookulGuardBase" in record ? "base" : "__ookulGuardReleased" in record ? "released" : "page";
      };
      const replace = window.history.replaceState.bind(window.history);
      const push = window.history.pushState.bind(window.history);
      window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
        writes.push(`replace:${mark(data)}`);
        replace(data, unused, url);
      };
      window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
        writes.push(`push:${mark(data)}`);
        push(data, unused, url);
      };
    });

    await page.getByLabel("Üst gezinme").getByRole("button", { name: "Öğretmen alanına geç" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    // The new persona may still open the page: right after the switch the released entry becomes the sentinel again,
    // without a new entry.
    await expect.poll(() => historyWrites(page)).toContain("replace:sentinel");
    const writes = await historyWrites(page);
    expect(writes.indexOf("replace:released")).toBeGreaterThanOrEqual(0);
    expect(writes.indexOf("replace:released")).toBeLessThan(writes.indexOf("replace:sentinel"));
    expect(writes.filter((write) => write.startsWith("push:"))).toEqual([]);
    // The switch clears the query cache, the gradebook reloads without the typed grade, and the guard leaves cleanly.
    await expect(page.getByTestId("grade-unsaved-summary")).toHaveText("Kaydedilmemiş değişiklik yok");
    await expect.poll(() => onGuardSentinel(page)).toBe(false);
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);

    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("komut paletinden aynı sayfaya onaylı geçiş sayfayı bırakmazsa koruma geri gelir", backForwardTag, async ({ page }) => {
    await openGradebookFromSessions(page, { saves: [] });
    const historyLength = await page.evaluate(() => window.history.length);

    await openCommandPalette(page);
    const palette = page.getByRole("dialog", { name: "Komut paleti" });
    await palette.getByRole("combobox", { name: "Komut ara" }).fill("Not Defteri");
    await palette.getByRole("combobox", { name: "Komut ara" }).press("Enter");
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    // The navigation's transition settles with the page still mounted on its address: the guard comes back.
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength);

    await page.evaluate(() => window.history.back());
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");
  });

  test("onaylanan çalışma alanı değişimi ve çıkış not defterine ileri kaydı bırakmaz", backForwardTag, async ({ page }) => {
    await openGradebookFromSessions(page, { saves: [], personaSwitch: "ok" });
    await page.getByLabel("Üst gezinme").getByRole("button", { name: "Öğretmen alanına geç" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(page).toHaveURL(/\/ogretmen$/);
    expect(await canGoForward(page)).toBe(false);

    const second = await page.context().newPage();
    await openGradebookFromSessions(second, { saves: [] });
    await second.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış" }).click();
    await second.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await expect(second).toHaveURL(/\/login/);
    expect(await canGoForward(second)).toBe(false);
  });

  test("yavaş çalışma alanı değişimi ve çıkış korumayı erken kurmaz; adres görünen sayfayla aynı kalır", backForwardTag, async ({ page }) => {
    // Both requests take longer than the old fixed re-arm delay (2 s).
    await openGradebookFromSessions(page, { saves: [], personaSwitch: "ok", slowAuthMs: 3200 });
    await page.getByLabel("Üst gezinme").getByRole("button", { name: "Öğretmen alanına geç" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    // Still on its way after 2.4 s: the guard entry carries only the released mark, no sentinel came back.
    await page.waitForTimeout(2400);
    expect(await guardMarker(page)).toEqual({ path: "/kurum/not-defteri", marker: "released" });
    await expect(page).toHaveURL(/\/ogretmen$/, { timeout: 10_000 });
    await expect(page.getByRole("region", { name: "Değerlendirme notları" })).toHaveCount(0);
    expect(await canGoForward(page)).toBe(false);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/ogretmen$/);
    expect(await canGoForward(page)).toBe(false);

    const second = await page.context().newPage();
    await openGradebookFromSessions(second, { saves: [], slowAuthMs: 3200 });
    await second.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış" }).click();
    await second.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    await second.waitForTimeout(2400);
    expect(await guardMarker(second)).toEqual({ path: "/kurum/not-defteri", marker: "released" });
    await expect(second).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(second.getByRole("region", { name: "Değerlendirme notları" })).toHaveCount(0);
    expect(await canGoForward(second)).toBe(false);
    await second.waitForTimeout(500);
    await expect(second).toHaveURL(/\/login/);
    expect(await canGoForward(second)).toBe(false);
  });

  test("yavaş bağlantı geçişinde koruma yeniden kurulmaz; geçmişte not defterinin tek kaydı kalır", backForwardTag, async ({ page }) => {
    // Route payloads: prefetches fail, so the navigation itself fetches, and that takes longer than the old fixed
    // re-arm delay (2 s).
    await page.route(/[?&]_rsc=/, async (route) => {
      const headers = route.request().headers();
      if (headers["next-router-prefetch"] || headers["next-router-segment-prefetch"]) {
        await route.abort().catch(() => undefined);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue().catch(() => undefined);
    });
    await open(page, "admin", "/kurum/not-defteri", { saves: [] });
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    const historyLength = await page.evaluate(() => window.history.length);
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
    await expect.poll(() => onGuardSentinel(page)).toBe(true);

    await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Oturumlar" }).click();
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    // Still on its way after 2.4 s: the guard stays released instead of pushing a new entry under the navigation.
    await page.waitForTimeout(2400);
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    expect(await onGuardSentinel(page)).toBe(false);
    await expect(page).toHaveURL(/\/hesap\/oturumlar$/, { timeout: 10_000 });
    await expect(page.getByRole("region", { name: "Değerlendirme notları" })).toHaveCount(0);
    // The guard entry left before the push, and no new one came while the navigation was pending.
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength + 1);
    expect(await onGuardSentinel(page)).toBe(false);
  });

  test("içeriğe geç bağlantısı geçmiş kaydı eklemez; sayfa içi kayıttan geri soru açmaz, koruma sürer ve vazgeç kaydırmayı korur", backForwardTag, async ({ page }) => {
    await openGradebookFromSessions(page, { saves: [] });
    await page.setViewportSize({ width: 1280, height: 600 });
    const historyLength = await page.evaluate(() => window.history.length);
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });

    const skipLink = page.getByRole("link", { name: "İçeriğe geç" });
    await skipLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#next-content")).toBeFocused();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
    expect(await onGuardSentinel(page)).toBe(true);

    // A plain in-page anchor still adds a fragment entry above the guard entry; stepping back off it stays here.
    await page.evaluate(() => {
      window.location.hash = "next-content";
    });
    await expect(page).toHaveURL(/\/kurum\/not-defteri#next-content$/);
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    // A false question would open within a frame or two of the popstate.
    await page.waitForTimeout(500);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    // The guard still protects, and cancel puts back the scroll position the user had when pressing back.
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(scrollable).toBeGreaterThan(300);
    const armedAt = await page.evaluate(() => window.scrollY);
    const target = armedAt > 150 ? 0 : Math.min(armedAt + 300, scrollable);
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(target);
    await page.evaluate(() => window.history.back());
    await dialog.getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(target);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");
  });

  test("adresle eklenen sayfa içi kayıtta kurulan koruma, kayıtlar arasında geri adımda sayfayı yenilemez", backForwardTag, async ({ page }) => {
    const browserDialogs: string[] = [];
    page.on("dialog", (dialog) => {
      browserDialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await openGradebookFromSessions(page, { saves: [] }, { typeGrade: false });
    // A fragment entry made outside the router carries a null history state; the guard arms on it.
    await page.evaluate(() => {
      (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
      window.location.hash = "notlar";
    });
    await expect(page).toHaveURL(/\/kurum\/not-defteri#notlar$/);
    expect(await page.evaluate(() => window.history.state as unknown)).toBeNull();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    // The guard's entries copy the null state, so they start without Next.js's `__NA`; the router's restore after the
    // guard's history write adds it to the sentinel a frame later (probe: Chromium 148). A step onto the sentinel
    // inside that frame meets it without `__NA`; the unpatched History.prototype.replaceState takes it off again to
    // land in that frame deterministically.
    await page.evaluate(() => {
      const { __NA: _routerMark, __PRIVATE_NEXTJS_INTERNALS_TREE: _routerTree, ...guardOnly } = window.history.state as Record<string, unknown>;
      History.prototype.replaceState.call(window.history, guardOnly, "");
    });
    expect(await page.evaluate(() => Object.keys(window.history.state as object))).toEqual(["__ookulGuardSentinel"]);

    await page.evaluate(() => {
      window.location.hash = "ozet";
    });
    await expect(page).toHaveURL(/\/kurum\/not-defteri#ozet$/);
    // Back onto the sentinel stays on the page: no reload, so no beforeunload prompt and the typed grade stays.
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/\/kurum\/not-defteri#notlar$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    await page.waitForTimeout(500);
    expect(browserDialogs).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    // One more step back still asks, and cancel keeps everything in place.
    await page.evaluate(() => window.history.back());
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect(page).toHaveURL(/\/kurum\/not-defteri#notlar$/);
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");
    expect(browserDialogs).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
  });

  test("vazgeç, odak ekran dışındaki not hücresine dönse de kaydırma konumunu korur", backForwardTag, async ({ page }) => {
    await openGradebookFromSessions(page, { saves: [] });
    await page.setViewportSize({ width: 1280, height: 600 });
    // WebKit keeps a focused field visible when the viewport resizes, so the resize settles before the focus.
    await page.waitForFunction(() => window.innerHeight === 600);
    await page.waitForTimeout(200);
    const ada = page.getByLabel("Ada Acar notu", { exact: true });
    await ada.focus();
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(scrollable).toBeGreaterThan(300);
    // WebKit reveals the newly focused field in a later rendering update, which can undo an early scroll; retry it.
    await expect(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(ada).not.toBeInViewport({ timeout: 500 });
    }).toPass();
    await page.waitForTimeout(200);
    await expect(ada).not.toBeInViewport();
    const target = await page.evaluate(() => Math.round(window.scrollY));
    expect(target).toBeGreaterThan(300);
    await expect(ada).toBeFocused();

    await page.evaluate(() => window.history.back());
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }).click();
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    // The Dialog gives focus back to the grade field; the scroll position the user had stays.
    await expect(ada).toBeFocused();
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThanOrEqual(target - 2);
    await page.waitForTimeout(300);
    expect(Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - target)).toBeLessThanOrEqual(2);
    await expect(ada).toBeFocused();
    await expect(ada).not.toBeInViewport();
  });

  test("önceki belgeden kalan koruma kaydı temizlenir; onaylanan geri sayfayı yerinde yenilemez", backForwardTag, async ({ page }) => {
    await openGradebookFromSessions(page, { saves: [] });
    // A reload while armed: the new document starts on the old guard entry, which no guard owns any more. The page's
    // own beforeunload asks first; the reload is confirmed.
    page.on("dialog", (dialog) => void dialog.accept());
    await page.reload();
    await expect(page.getByRole("button", { name: "1. Yazılı notlarını aç" })).toBeVisible();
    expect(await onGuardSentinel(page)).toBe(false);

    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
    await expect.poll(() => onGuardSentinel(page)).toBe(true);
    await page.evaluate(() => window.history.back());
    await page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Kaydetmeden devam et" }).click();
    const hasNavigationEntries = await page.evaluate(() => typeof (window as unknown as { navigation?: { entries?: unknown } }).navigation?.entries === "function");
    if (hasNavigationEntries) {
      // The earlier document's copies of the page right below the base are stepped over.
      await expect(page).toHaveURL(/\/hesap\/oturumlar$/);
    } else {
      // Without entries() the step lands on that copy: it shows the page again, not a mismatched address.
      await expect(page).toHaveURL(/\/(hesap\/oturumlar|kurum\/not-defteri)$/);
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("390 px çekmeceden çıkışta onay penceresi çekmecenin altında kalmaz", async ({ page }) => {
    await open(page, "admin", "/kurum/not-defteri", { saves: [] }, { width: 390, height: 844 });
    await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
    await page.getByLabel("Can Demir notu", { exact: true }).fill("70");

    const menuButton = page.getByRole("button", { name: "Ana menüyü aç" });
    await menuButton.click();
    await page.getByRole("navigation", { name: "Ana menü" }).getByRole("button", { name: "Çıkış" }).click();
    const dialog = page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" });
    await expect(dialog).toBeVisible();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main#next-content")).not.toHaveAttribute("aria-hidden", "true");
    await expectReachable(dialog.getByRole("button", { name: "Notlara dön" }));
    await dialog.getByRole("button", { name: "Notlara dön" }).click();
    await expect(menuButton).toBeFocused();
    await expect(page.getByLabel("Can Demir notu", { exact: true })).toHaveValue("70");

    // A drawer link asks the same way: the drawer closes before the question appears.
    await menuButton.click();
    await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Oturumlar" }).click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expectReachable(page.getByRole("dialog", { name: "Kaydedilmemiş notlar var" }).getByRole("button", { name: "Notlara dön" }));
  });
});

/** Sessions page, then the gradebook through the command palette (same document), with one unsaved grade. */
async function openGradebookFromSessions(page: Page, captured: Captured, options: { typeGrade?: boolean } = {}) {
  await open(page, "admin", "/hesap/oturumlar", captured);
  await openCommandPalette(page);
  const palette = page.getByRole("dialog", { name: "Komut paleti" });
  await palette.getByRole("combobox", { name: "Komut ara" }).fill("Not Defteri");
  await palette.getByRole("combobox", { name: "Komut ara" }).press("Enter");
  await expect(page).toHaveURL(/\/kurum\/not-defteri$/);
  await page.getByRole("button", { name: "1. Yazılı notlarını aç" }).click();
  if (options.typeGrade === false) return;
  await page.getByLabel("Can Demir notu", { exact: true }).fill("70");
  await expect.poll(() => onGuardSentinel(page)).toBe(true);
}

/** The shortcut listener attaches on hydration; retry until the palette opens. */
async function openCommandPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Komut paleti" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** The path and the guard mark of the current history entry (see navigation-guard.ts). */
async function guardMarker(page: Page) {
  return page.evaluate(() => {
    const state: unknown = window.history.state;
    const record = typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
    const marker = "__ookulGuardSentinel" in record ? "sentinel" : "__ookulGuardBase" in record ? "base" : "__ookulGuardReleased" in record ? "released" : null;
    return { path: window.location.pathname, marker };
  });
}

async function historyWrites(page: Page) {
  return page.evaluate(() => (window as unknown as { __historyWrites?: string[] }).__historyWrites ?? []);
}

/** Chromium's Navigation API: whether a forward entry exists. */
async function canGoForward(page: Page) {
  return page.evaluate(() => (window as unknown as { navigation: { canGoForward: boolean } }).navigation.canGoForward);
}

/** True while the navigation guard's history entry is the current one (see navigation-guard.ts). */
async function onGuardSentinel(page: Page) {
  return page.evaluate(() => {
    const state: unknown = window.history.state;
    return typeof state === "object" && state !== null && "__ookulGuardSentinel" in state;
  });
}

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
  if (captured.slowAuthMs && (path === "/auth/logout" || path === "/auth/persona/switch")) {
    await new Promise((resolve) => setTimeout(resolve, captured.slowAuthMs));
  }
  if (path === "/auth/logout") captured.loggedOut = true;
  if (path === "/auth/refresh" && captured.loggedOut) {
    await route.fulfill({ headers: corsFor(route), status: 401 });
    return;
  }
  if (path === "/auth/persona/switch" && captured.personaSwitch === "fail") {
    await route.fulfill({ body: JSON.stringify({ message: "unavailable" }), headers: { ...corsFor(route), "content-type": "application/json" }, status: 503 });
    return;
  }
  if (path === "/auth/persona/switch" && captured.personaSwitch === "keep") {
    const keep = auth("admin");
    await fulfill(route, { ...keep, session: { ...keep.session, activePersona: "TEACHER", roles: ["TENANT_ADMIN", "TEACHER"], subjectId: "teacher-math", subjectType: "TEACHER" } });
    return;
  }
  if (path === "/auth/persona/switch") {
    await fulfill(route, auth("teacher"));
    return;
  }
  if (path === "/me/profile" && captured.personaSwitch) {
    await fulfill(route, { userId: "user-admin", tenantId: "tenant-gb", activePersona: "STAFF", availablePersonas: ["STAFF", "TEACHER"], capabilities: [], roles: ["TENANT_ADMIN"] });
    return;
  }
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
