import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

// UAT F-27 (push/e-posta gönderimi ekrandan) and F-28 (duyuru hedef kitle ve kapsam seçimi).
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
};

type Persona = "tenantAdmin" | "teacher";

interface CapturedRequest {
  body: Record<string, unknown>;
  idempotencyKey?: string;
  path: string;
}

const existingAnnouncement = {
  id: "announcement-a",
  tenantId: "tenant-a",
  title: "Veli toplantısı",
  body: "Cuma 17.00'de veli toplantısı yapılacaktır.",
  audience: "GUARDIANS",
  classId: "class-8a",
  publishedAt: "2026-10-27T09:00:00.000Z",
};

test.describe("Duyuru gönderimi ve kapsamı (UAT F-27, F-28)", () => {
  test("yönetici onaydan sonra push gönderimini kuyruğa alır ve teslim raporunu görür", async ({ page }) => {
    const posts: CapturedRequest[] = [];
    await open(page, "tenantAdmin", posts);
    await page.getByRole("row", { name: /Veli toplantısı/ }).getByRole("button", { name: "Alıcılar" }).click();

    const deliveryPanel = page.getByLabel("Duyuru bildirim gönderimi");
    await expect(deliveryPanel.getByText("Bu duyuru için henüz push veya e-posta gönderimi yok.")).toBeVisible();

    await deliveryPanel.getByRole("button", { name: "Push gönder" }).click();
    const dialog = page.getByRole("dialog", { name: "Push gönderimini onayla" });
    await expect(dialog).toContainText("Veliler · 8-A");
    await expect(dialog).toContainText("geri alınamaz");
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    expect(deliveryPosts(posts)).toEqual([]);

    await deliveryPanel.getByRole("button", { name: "Push gönder" }).click();
    await page.getByRole("dialog", { name: "Push gönderimini onayla" }).getByRole("button", { name: "Push gönder" }).click();

    await expect.poll(() => deliveryPosts(posts).length).toBe(1);
    const [delivery] = deliveryPosts(posts);
    expect(delivery?.path).toBe("/announcements/announcement-a/deliveries");
    expect(delivery?.body).toEqual({ channel: "PUSH" });
    expect(delivery?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    await expect(deliveryPanel.getByRole("status")).toContainText("Push gönderimi kuyruğa alındı (2 hedef)");
    await expect(deliveryPanel).not.toContainText(/gönderildi\b/i);
    const reportRow = deliveryPanel.getByRole("row", { name: /Push/ });
    await expect(reportRow.getByText("Kuyrukta", { exact: true })).toBeVisible();
  });

  test("e-posta gönderimi kanal EMAIL ile ve ayrı idempotency anahtarıyla gider", async ({ page }) => {
    const posts: CapturedRequest[] = [];
    await open(page, "tenantAdmin", posts);
    await page.getByRole("row", { name: /Veli toplantısı/ }).getByRole("button", { name: "Alıcılar" }).click();

    const deliveryPanel = page.getByLabel("Duyuru bildirim gönderimi");
    await deliveryPanel.getByRole("button", { name: "E-posta gönder" }).click();
    await page.getByRole("dialog", { name: "E-posta gönderimini onayla" }).getByRole("button", { name: "E-posta gönder" }).click();
    await expect.poll(() => deliveryPosts(posts).length).toBe(1);
    expect(deliveryPosts(posts)[0]?.body).toEqual({ channel: "EMAIL" });
    expect(deliveryPosts(posts)[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await expect(deliveryPanel.getByRole("status")).toContainText("E-posta gönderimi kuyruğa alındı");
  });

  test("varsayılan duyuru formu kurum geneli (SCHOOL) gövdesini değiştirmeden yayınlar", async ({ page }) => {
    const posts: CapturedRequest[] = [];
    await open(page, "tenantAdmin", posts);
    await page.getByRole("button", { name: "Duyuru ekle" }).first().click();
    const form = page.getByRole("dialog", { name: "Duyuru ekle" });
    await expect(form.getByLabel("Hedef kitle")).toHaveValue("SCHOOL");
    await form.getByLabel("Başlık", { exact: true }).fill("Okul gezisi");
    await form.getByLabel(/^Duyuru metni/).fill("Gezi formları cuma gününe kadar teslim edilmelidir.");
    await form.getByRole("button", { name: "Yayınla", exact: true }).click();
    const confirmDialog = page.getByRole("dialog", { name: "Duyuruyu yayınla" });
    await expect(confirmDialog).toContainText("Tüm okul · Tüm kapsam");
    await confirmDialog.getByRole("button", { name: "Yayınla" }).click();

    await expect.poll(() => createPosts(posts).length).toBe(1);
    expect(createPosts(posts)[0]?.body).toEqual({
      title: "Okul gezisi",
      body: "Gezi formları cuma gününe kadar teslim edilmelidir.",
      audience: "SCHOOL",
      campusId: "",
      gradeLevelId: "",
      classId: "",
      courseId: "",
      termId: "",
    });
  });

  test("duyuru formu veli hedefini ve sınıf/kampüs/dönem kapsamını gönderir", async ({ page }) => {
    const posts: CapturedRequest[] = [];
    await open(page, "tenantAdmin", posts);
    await page.getByRole("button", { name: "Duyuru ekle" }).first().click();
    const form = page.getByRole("dialog", { name: "Duyuru ekle" });
    await form.getByLabel("Başlık", { exact: true }).fill("8-A veli bilgilendirmesi");
    await form.getByLabel(/^Duyuru metni/).fill("Deneme sınavı sonuçları açıklandı.");
    await form.getByLabel("Hedef kitle").selectOption("GUARDIANS");
    await form.getByLabel("Kampüs").selectOption("campus-merkez");
    // Classes are filtered by the chosen campus: the other campus's class must not be offered.
    const classSelect = form.getByRole("combobox", { name: /^Sınıf/ });
    await expect(classSelect.locator("option", { hasText: "8-A" })).toHaveCount(1);
    await expect(classSelect.locator("option", { hasText: "9-B" })).toHaveCount(0);
    await classSelect.selectOption("class-8a");
    await form.getByLabel("Dönem").selectOption("term-1");
    await expect(form.getByLabel("Duyuru önizleme")).toContainText("Veliler · Merkez / 8-A / 1. Dönem");
    await form.getByRole("button", { name: "Yayınla", exact: true }).click();
    const confirmDialog = page.getByRole("dialog", { name: "Duyuruyu yayınla" });
    await expect(confirmDialog).toContainText("Veliler · Merkez / 8-A / 1. Dönem");
    await confirmDialog.getByRole("button", { name: "Yayınla" }).click();

    await expect.poll(() => createPosts(posts).length).toBe(1);
    expect(createPosts(posts)[0]?.body).toMatchObject({
      audience: "GUARDIANS",
      campusId: "campus-merkez",
      classId: "class-8a",
      termId: "term-1",
      gradeLevelId: "",
    });
    expect(createPosts(posts)[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`gönderim paneli ve kapsam formu ${width}px genişlikte taşmaz ve gönderim düğmeleri 44px kalır`, async ({ page }) => {
      const posts: CapturedRequest[] = [];
      await open(page, "tenantAdmin", posts, { width, height: 900 });
      await page.getByRole("row", { name: /Veli toplantısı/ }).getByRole("button", { name: "Alıcılar" }).click();
      const deliveryPanel = page.getByLabel("Duyuru bildirim gönderimi");
      for (const name of ["Push gönder", "E-posta gönder"]) {
        const box = await deliveryPanel.getByRole("button", { name }).boundingBox();
        expect(box?.height ?? 0, `${name} yüksekliği`).toBeGreaterThanOrEqual(44);
      }
      await expectNoHorizontalOverflow(page, `duyuru gönderim paneli ${width}px`);

      await page.getByRole("button", { name: "Duyuru ekle" }).first().click();
      const form = page.getByRole("dialog", { name: "Duyuru ekle" });
      for (const name of [/^Hedef kitle/, /^Kampüs/, /^Seviye/, /^Sınıf/, /^Dönem/]) {
        await expect(form.getByRole("combobox", { name })).toBeVisible();
      }
      await expectNoHorizontalOverflow(page, `duyuru kapsam formu ${width}px`);
    });
  }

  // R2-WEB: kampüs kapsamlı kullanıcı kampüsü dışındaki duyurunun alıcı ve teslim bilgisine 403 alır; genel hata yerine kapsam mesajı görür.
  test("kampüs dışı duyuruda alıcı raporu kapsam mesajı gösterir ve gönderim eylemleri açılmaz", async ({ page }) => {
    const posts: CapturedRequest[] = [];
    await open(page, "tenantAdmin", posts);
    await forbidCampusScope(page, (method, path) => method === "GET" && /^\/announcements\/announcement-a\/(recipients|delivery-reports)$/.test(path));
    await page.getByRole("row", { name: /Veli toplantısı/ }).getByRole("button", { name: "Alıcılar" }).click();

    const report = page.getByLabel("Duyuru alıcı raporu");
    await expect(report.getByText("Kampüs kapsamı dışında")).toBeVisible();
    await expect(report).toContainText("Bu duyuru çalışma kampüsünüzün dışında.");
    await expect(report).not.toContainText("Alıcı raporu alınamadı");
    await expect(report).not.toContainText("Bu işlem için yetkiniz yok.");
    await expect(page.getByLabel("Duyuru bildirim gönderimi")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Push gönder" })).toHaveCount(0);
    expect(deliveryPosts(posts)).toEqual([]);
    await expectNoHorizontalOverflow(page, "duyuru kampüs kapsamı mesajı");
  });

  test("kampüs dışı gönderim reddinde kapsam mesajı gösterilir", async ({ page }) => {
    const posts: CapturedRequest[] = [];
    await open(page, "tenantAdmin", posts);
    await forbidCampusScope(page, (method, path) => method === "POST" && path === "/announcements/announcement-a/deliveries");
    await page.getByRole("row", { name: /Veli toplantısı/ }).getByRole("button", { name: "Alıcılar" }).click();

    const deliveryPanel = page.getByLabel("Duyuru bildirim gönderimi");
    await deliveryPanel.getByRole("button", { name: "Push gönder" }).click();
    await page.getByRole("dialog", { name: "Push gönderimini onayla" }).getByRole("button", { name: "Push gönder" }).click();
    await expect(deliveryPanel.getByRole("alert")).toContainText("Bu duyuru çalışma kampüsünüzün dışında.");
  });

  test("kampüs dışı hedefle yayın reddinde formda kapsam mesajı gösterilir", async ({ page }) => {
    const posts: CapturedRequest[] = [];
    await open(page, "tenantAdmin", posts);
    await forbidCampusScope(page, (method, path) => method === "POST" && path === "/announcements");
    await page.getByRole("button", { name: "Duyuru ekle" }).first().click();
    const form = page.getByRole("dialog", { name: "Duyuru ekle" });
    await form.getByLabel("Başlık", { exact: true }).fill("Şube duyurusu");
    await form.getByLabel(/^Duyuru metni/).fill("Şube için bilgilendirme.");
    await form.getByLabel("Kampüs").selectOption("campus-sube");
    await form.getByRole("button", { name: "Yayınla", exact: true }).click();
    await page.getByRole("dialog", { name: "Duyuruyu yayınla" }).getByRole("button", { name: "Yayınla" }).click();

    await expect(form).toContainText("Seçilen hedef çalışma kampüsünüzün dışında.");
    await expect(form).not.toContainText("Duyuru yayınlanamadı.");
  });

  test("announcement:manage yetkisi olmayan kullanıcı gönderim eylemini görmez", async ({ page }) => {
    const posts: CapturedRequest[] = [];
    const requestedPaths: string[] = [];
    page.on("request", (request) => requestedPaths.push(new URL(request.url()).pathname));
    await open(page, "teacher", posts);
    await expect(page).not.toHaveURL(/\/kurum\/duyurular/);
    await expect(page.getByRole("button", { name: "Push gönder" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "E-posta gönder" })).toHaveCount(0);
    expect(requestedPaths.filter((path) => /\/announcements\/[^/]+\/(deliveries|delivery-reports)$/.test(path))).toEqual([]);
    expect(deliveryPosts(posts)).toEqual([]);
  });
});

// Sonra eklenen route önce çalışır: eşleşen istek API'nin kampüs kapsamı 403'ünü alır, diğerleri ana mock'a düşer.
async function forbidCampusScope(page: Page, matches: (method: string, path: string) => boolean) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    if (request.method() === "OPTIONS" || !matches(request.method(), path)) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ error: { code: "ANNOUNCEMENT_CAMPUS_SCOPE_FORBIDDEN", message: "Forbidden" } }),
      headers: { ...corsFor(route), "content-type": "application/json" },
      status: 403,
    });
  });
}

function deliveryPosts(posts: CapturedRequest[]) {
  return posts.filter((post) => post.path.endsWith("/deliveries"));
}

function createPosts(posts: CapturedRequest[]) {
  return posts.filter((post) => post.path === "/announcements");
}

async function open(page: Page, persona: Persona, posts: CapturedRequest[], viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  const state = { deliveryReports: [] as Array<Record<string, unknown>> };
  await page.route("**/api/v1/**", (route) => handle(route, persona, posts, state));
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/kurum/duyurular");
}

async function handle(
  route: Route,
  persona: Persona,
  posts: CapturedRequest[],
  state: { deliveryReports: Array<Record<string, unknown>> },
) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ headers: corsFor(route), status: 204 });
    return;
  }
  const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

  if (request.method() === "POST" && path.startsWith("/announcements")) {
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    posts.push({ body, idempotencyKey: request.headers()["idempotency-key"], path });
    if (path === "/announcements") {
      await fulfill(route, { ...body, id: "announcement-created", tenantId: "tenant-a", publishedAt: new Date().toISOString() });
      return;
    }
    if (path.endsWith("/deliveries")) {
      const channel = body.channel as string;
      state.deliveryReports.push({
        id: `report-${channel}`, tenantId: "tenant-a", announcementId: "announcement-a", channel,
        recipientCount: 2, deliveredCount: 0, failedCount: 0, status: "queued", createdAt: new Date().toISOString(),
      });
      await fulfill(route, {
        tenantId: "tenant-a", announcementId: "announcement-a", channel, recipientCount: 2, deliveredCount: 0, failedCount: 0,
        queueName: "announcement-delivery", jobId: `job-${channel}`, status: "queued",
      }, 201);
      return;
    }
  }

  if (path === "/announcements/announcement-a/delivery-reports") {
    await fulfill(route, state.deliveryReports);
    return;
  }

  const responses: Record<string, unknown> = {
    "/auth/refresh": auth(persona),
    "/me/feature-rollouts": { enabledFeatureKeys: [] },
    "/me/notification-devices": [],
    "/me/tenant": {
      id: "tenant-a", name: "Deneme Okulu", slug: "deneme-okulu", status: "ACTIVE", lifecycleVersion: 1,
      seatLimit: 500, activeSeatCount: 1, plan: "PRO",
      licenseStartsAt: "2026-09-01T00:00:00.000Z", licenseEndsAt: "2027-08-31T00:00:00.000Z",
    },
    "/announcements": [existingAnnouncement],
    "/announcements/announcement-a/recipients": {
      announcementId: "announcement-a", total: 2, read: 0, unread: 2,
      recipients: [
        { announcementId: "announcement-a", recipientType: "GUARDIAN", subjectId: "guardian-a", userId: "user-guardian-a", displayName: "Ayşe Veli", relatedStudentId: "student-a", relatedStudentName: "Ada A" },
        { announcementId: "announcement-a", recipientType: "GUARDIAN", subjectId: "guardian-b", userId: "user-guardian-b", displayName: "Mehmet Veli", relatedStudentId: "student-b", relatedStudentName: "Bora B" },
      ],
    },
    "/campuses": [
      { id: "campus-merkez", tenantId: "tenant-a", name: "Merkez" },
      { id: "campus-sube", tenantId: "tenant-a", name: "Şube" },
    ],
    "/grade-levels": [{ id: "grade-8", tenantId: "tenant-a", name: "8. Sınıf" }],
    "/classes": [
      { id: "class-8a", tenantId: "tenant-a", name: "8-A", campusId: "campus-merkez", gradeLevelId: "grade-8" },
      { id: "class-9b", tenantId: "tenant-a", name: "9-B", campusId: "campus-sube" },
    ],
    "/academic-terms": [
      { id: "term-1", tenantId: "tenant-a", academicYearId: "year-1", name: "1. Dönem", startsAt: "2026-09-01", endsAt: "2027-01-22", isActive: true },
    ],
  };
  await fulfill(route, path in responses ? responses[path] : []);
}

function auth(persona: Persona) {
  const profile = persona === "teacher"
    ? { activePersona: "TEACHER", roles: ["TEACHER"], subjectType: "TEACHER", subjectId: "teacher-a", tenantId: "tenant-a", userId: "user-teacher" }
    : { activePersona: "STAFF", roles: ["TENANT_ADMIN"], tenantId: "tenant-a", userId: "user-admin" };
  return { accessToken: "announcement-access-token", session: { id: `session-${persona}`, membershipVersion: 1, status: "ACTIVE", ...profile } };
}

async function fulfill(route: Route, data: unknown, status = 200) {
  const body = Array.isArray(data) ? { data, meta: { total: data.length, page: 1, limit: 25 } } : { data };
  await route.fulfill({ body: JSON.stringify(body), headers: { ...corsFor(route), "content-type": "application/json" }, status });
}

function corsFor(route: Route) {
  return { ...corsHeaders, "access-control-allow-origin": route.request().headers().origin ?? appOrigin };
}
