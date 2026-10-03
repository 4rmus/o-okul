import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
};
const dayMs = 24 * 60 * 60 * 1000;

type Persona = "tenantAdmin" | "systemAdmin";

test.describe("Kartsız deneme (DEC-20261004-01)", () => {
  test("süren denemede kurum panosu kalan günü ve verinin silinmeyeceğini söyler", async ({ page }) => {
    await open(page, "tenantAdmin", "/kurum", { plan: "TRIAL", licenseEndsAt: new Date(Date.now() + 2.5 * dayMs).toISOString() });
    const banner = page.getByRole("status").filter({ hasText: "Deneme sürümü" });
    await expect(banner).toContainText("Deneme sürümü: 3 gün kaldı");
    await expect(banner).toContainText("verileriniz silinmez");
  });

  test("biten denemede veri silinmediğini ve salt okunur olduğunu açıklar", async ({ page }) => {
    await open(page, "tenantAdmin", "/kurum/lisans-donemleri", { plan: "TRIAL", licenseEndsAt: new Date(Date.now() - dayMs).toISOString() });
    const banner = page.getByRole("status").filter({ hasText: "Deneme süresi doldu" });
    await expect(banner).toContainText("Verileriniz silinmedi");
  });

  test("ücretli planda deneme uyarısı görünmez", async ({ page }) => {
    await open(page, "tenantAdmin", "/kurum", { plan: "PRO", licenseEndsAt: new Date(Date.now() + 300 * dayMs).toISOString() });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/Deneme sürümü|Deneme süresi doldu/)).toHaveCount(0);
  });

  test("sistem paneli Deneme aç ile 7 gün ve 100 öğrenciyi doldurur, sınırı aşan denemeyi göndermez", async ({ page }) => {
    const posts: string[] = [];
    await open(page, "systemAdmin", "/sistem/kurumlar", undefined, posts);
    await page.getByRole("button", { name: "Deneme aç" }).click();
    const dialog = page.getByRole("dialog");
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    await expect(dialog.getByLabel("Plan")).toHaveValue("TRIAL");
    await expect(dialog.getByLabel("Lisans başlangıç")).toHaveValue(localDate(today));
    await expect(dialog.getByLabel("Lisans bitiş")).toHaveValue(localDate(end));
    await expect(dialog.getByLabel("Aktif öğrenci limiti")).toHaveValue("100");

    await dialog.getByLabel("Kurum adı").fill("Deneme Okulu");
    await dialog.getByLabel("Kurum kodu").fill("deneme-okulu");
    await dialog.getByLabel("İlk kampüs adı").fill("Merkez");
    await dialog.getByLabel("İlk kurum sahibi ad soyad").fill("Ayşe Yılmaz");
    await dialog.getByLabel("İlk kurum sahibi e-posta").fill("ayse@example.test");
    await dialog.getByLabel("Aktif öğrenci limiti").fill("150");
    await dialog.getByRole("button", { name: "Oluştur", exact: true }).click();
    await expect(dialog).toContainText("Denemede en fazla 100 aktif öğrenci olabilir.");
    expect(posts).toEqual([]);
  });
});

async function open(page: Page, persona: Persona, path: string, tenant?: { plan: string; licenseEndsAt: string }, posts: string[] = []) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/v1/**", (route) => handle(route, persona, tenant, posts));
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
}

async function handle(route: Route, persona: Persona, tenant: { plan: string; licenseEndsAt: string } | undefined, posts: string[]) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ headers: corsFor(route), status: 204 });
    return;
  }
  const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
  if (request.method() === "POST" && path.startsWith("/tenants")) posts.push(path);
  const responses: Record<string, unknown> = {
    "/auth/refresh": auth(persona),
    "/me/feature-rollouts": { enabledFeatureKeys: [] },
    "/me/notification-devices": [],
    "/me/tenant": {
      id: "tenant-trial", name: "Deneme Okulu", slug: "deneme-okulu", status: "ACTIVE", lifecycleVersion: 1,
      seatLimit: 100, activeSeatCount: 1, licenseStartsAt: "2026-10-01T00:00:00.000Z", ...tenant,
    },
    "/me/institution-dashboard": {
      generatedAt: new Date().toISOString(),
      institution: { name: "Deneme Okulu" },
      activeStudentCount: 0,
      attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
    },
  };
  await fulfill(route, path in responses ? responses[path] : []);
}

function auth(persona: Persona) {
  const profile = persona === "systemAdmin"
    ? { roles: ["SYSTEM_ADMIN"], userId: "user-system" }
    : { activePersona: "STAFF", roles: ["TENANT_ADMIN"], tenantId: "tenant-trial", userId: "user-admin" };
  return { accessToken: "trial-access-token", session: { id: `session-${persona}`, membershipVersion: 1, status: "ACTIVE", ...profile } };
}

async function fulfill(route: Route, data: unknown) {
  await route.fulfill({ body: JSON.stringify({ data }), headers: { ...corsFor(route), "content-type": "application/json" }, status: 200 });
}

function corsFor(route: Route) {
  return { ...corsHeaders, "access-control-allow-origin": route.request().headers().origin ?? appOrigin };
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
