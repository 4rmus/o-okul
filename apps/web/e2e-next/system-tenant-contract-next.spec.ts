import { AxeBuilder } from "@axe-core/playwright";
import { resetCategoryLabels } from "../app/(app)/sistem/_shared/system-api.js";
import { expect, test, type Page, type Route } from "@playwright/test";
import { NextRequest } from "next/server.js";
import { proxy } from "../proxy.js";
import { legacyLoginAllowed, tenantLoginOrigin, webHostContext } from "../src/tenant-host.js";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

test("Gate5 doğrulanmış oturum yokken eski token ile kritik istek göndermez", async () => {
  const { authenticatedFetchOnce } = await import("../src/api-client.js");
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return new Response("{}"); };
  try {
    expect(() => authenticatedFetchOnce("stale-token", { userId: "previous-user", sessionId: "previous-session", membershipVersion: 1 }, "/api/v1/auth/step-up", { method: "POST" })).toThrow("AUTH_CONTEXT_CHANGED");
    expect(requests).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token,idempotency-key,x-step-up-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

interface CapturedSystemRequests {
  failNextTenantCreate: boolean;
  failNextStatus?: "network" | "conflict";
  failNextMfa?: boolean;
  stepUps: unknown[];
  tenantReads: number;
  forbiddenTenantScopedPaths: string[];
  tenantCreates: Array<{ authorization: string | undefined; body: unknown; idempotencyKey: string | undefined }>;
  tenantLists: URLSearchParams[];
  tenantStatusUpdates: Array<{ body: unknown; id: string; idempotencyKey?: string; stepUpToken?: string }>;
  tenantUpdates: Array<{ authorization: string | undefined; body: unknown; id: string }>;
}

interface SystemTenantFixture {
  activeSeatCount: number;
  id: string;
  licenseEndsAt?: string;
  licenseStartsAt?: string;
  name: string;
  plan: string;
  seatLimit?: number;
  slug: string;
  status: string;
  lifecycleVersion: number;
}

test.describe("Sistem tenant yönetimi sözleşmesi", () => {
  test("punycode kurum kodunu web trust boundary'sinde reddeder", () => {
    expect(webHostContext("xn--niversite-p9a.o-okul.com", "o-okul.com")).toEqual({ kind: "invalid" });
    expect(() => tenantLoginOrigin("xn--niversite-p9a", "o-okul.com")).toThrow("TENANT_SLUG_INVALID");
  });

  test("legacy tenant giriş süresini cutoff öncesi açar, sonrasında kapatır", () => {
    const now = Date.parse("2026-08-23T00:00:00.000Z");
    expect(legacyLoginAllowed("2026-09-22T00:00:00.000Z", now)).toBe(true);
    expect(legacyLoginAllowed("2026-09-22T00:00:00.001Z", now)).toBe(false);
    expect(legacyLoginAllowed("2026-08-24T00:00:00.000Z", Date.parse("2026-08-24T00:00:00.000Z"))).toBe(false);
    expect(legacyLoginAllowed("invalid", Date.parse("2026-08-23T00:00:00.000Z"))).toBe(false);
    expect(legacyLoginAllowed(undefined, now)).toBe(false);
  });

  test("legacy tenant girişini gerçek alan adında yönlendirir, cutoff sonrasında kapatır", async () => {
    const previousDomain = process.env.DOMAIN;
    const previousCutoff = process.env.LEGACY_TENANT_LOGIN_CUTOFF_AT;
    const request = new NextRequest("https://o-okul.com/k/dna-egitim/giris", {
      headers: { host: "o-okul.com" },
    });

    try {
      process.env.DOMAIN = "o-okul.com";
      process.env.LEGACY_TENANT_LOGIN_CUTOFF_AT = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString();
      const redirect = proxy(request);
      expect(redirect.status).toBe(307);
      expect(redirect.headers.get("location")).toBe("https://dna-egitim.o-okul.com/giris");

      process.env.LEGACY_TENANT_LOGIN_CUTOFF_AT = "2000-01-01T00:00:00.000Z";
      const retired = proxy(request);
      expect(retired.status).toBe(410);
      expect(await retired.text()).toBe("LEGACY_TENANT_LOGIN_RETIRED");
    } finally {
      restoreEnvironment("DOMAIN", previousDomain);
      restoreEnvironment("LEGACY_TENANT_LOGIN_CUTOFF_AT", previousCutoff);
    }
  });

  test("kurum operasyon özeti URL state ve tenant kapsamını korur", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar?page=2&limit=20&q=faz&sort=-name");

    const tenantsRegion = page.getByLabel("Kurum yönetimi");
    const summary = tenantsRegion.getByRole("region", { exact: true, name: "Kurum listesi özeti" });
    await expect(summary).toContainText("Kurum toplamı");
    await expect(summary).toContainText("Durum dağılımı");
    await expect(summary).toContainText("Yaklaşan lisans bitişi");
    await expect(summary).toContainText("Kullanıcı sınırı");
    await expect(summary).toContainText("Sistem yöneticisi görünümü");
    await expect(tenantsRegion.getByLabel("Ara")).toHaveValue("faz");
    await expect(tenantsRegion.getByLabel("Sırala")).toHaveValue("-name");
    await expect(tenantsRegion.getByLabel("Göster")).toHaveValue("20");
    await expect.poll(() => captured.tenantLists.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.tenantLists.at(-1)?.get("q")).toBe("faz");
    expect(captured.forbiddenTenantScopedPaths).toEqual([]);

    await tenantsRegion.getByLabel("Ara").fill("deneme");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("deneme");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");
  });

  test("ilk kurum sahibini telefonsuz oluşturur ve aynı gövdeli retry anahtarını korur", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    captured.failNextTenantCreate = true;
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar");

    await page.getByRole("button", { name: "Kurum oluştur" }).click();
    const createDialog = page.getByRole("dialog", { name: "Kurum oluştur" });
    await createDialog.getByLabel("Kurum adı").fill("Davetli Kurum");
    await createDialog.getByLabel("Kurum kodu").fill("davetli-kurum");
    await createDialog.getByLabel("Plan").selectOption("PRO");
    await createDialog.getByLabel("Lisans başlangıç").fill("2026-08-01");
    await createDialog.getByLabel("Lisans bitiş").fill("2027-08-01");
    await createDialog.getByLabel("Aktif öğrenci limiti").fill("100");
    await expect(createDialog.getByLabel("Durum")).toHaveCount(0);
    await expect(createDialog.getByLabel("Sözleşme referansı")).toHaveCount(0);
    await createDialog.getByLabel("İlk kampüs adı").fill("Davetli Kampüs");
    await createDialog.getByLabel("İlk kurum sahibi ad soyad").fill("Davetli Yönetici");
    await createDialog.getByLabel("İlk kurum sahibi e-posta").fill("phone.admin@example.test");
    await expect(createDialog).toContainText("24 saat geçerli parola kurulum bağlantısı");
    await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();
    await expect(createDialog.getByText("Kurum oluşturulamadı.")).toBeVisible();
    await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();

    await expect.poll(() => captured.tenantCreates).toHaveLength(2);
    expect(captured.tenantCreates[0]).toMatchObject({
      authorization: "Bearer system-tenant-access-token",
      body: {
        campuses: [{ code: "MRK", name: "Davetli Kampüs", unitType: "SCHOOL" }],
        firstOwner: {
          email: "phone.admin@example.test",
          name: "Davetli Yönetici",
        },
        licenseTerm: {
          activeStudentLimit: 100,
          endsAt: "2027-08-01T00:00:00.000Z",
          planCode: "PRO",
          startsAt: "2026-08-01T00:00:00.000Z",
        },
        name: "Davetli Kurum",
        slug: "davetli-kurum",
      },
      idempotencyKey: expect.any(String),
    });
    expect(captured.tenantCreates[1]).toEqual(captured.tenantCreates[0]);

    await expect(page.getByLabel("İlk admin aktivasyon tokenı")).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Davetli Kurum/ }).getByRole("button", { name: "Sil" })).toHaveCount(0);
    await expect(page.getByLabel("İlk admin aktivasyon tokenı")).toHaveCount(0);
    expect(captured.forbiddenTenantScopedPaths).toEqual([]);
  });

  test("kurum adı ve erişim durumunu ayrı strict PATCH çağrılarıyla günceller", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar/tenant-faz9");

    await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
    await page.getByRole("button", { name: "Adı düzenle" }).click();
    const dialog = page.getByRole("dialog", { name: "Kurum düzenle" });
    await expect(dialog.getByLabel("Kurum kodu")).toHaveCount(0);
    await expect(dialog.getByLabel("Durum")).toHaveCount(0);
    await dialog.getByLabel("Kurum adı").fill("Güncel Faz 9 Akademi");
    await dialog.getByRole("button", { name: "Kaydet", exact: true }).click();

    await expect.poll(() => captured.tenantUpdates).toEqual([{
      authorization: "Bearer system-tenant-access-token",
      body: {
        name: "Güncel Faz 9 Akademi",
      },
      id: "tenant-faz9",
    }]);
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Askıya al" }).click();
    const confirmation = page.getByRole("dialog", { name: "Kurum erişimini askıya al" });
    await expect(confirmation).toContainText("Tüm açık oturumlar kapatılır");
    await confirmation.getByLabel("Kurum kodu onayı").fill("faz9-akademi");
    await confirmation.getByLabel("Doğrulama kodu").fill("123456");
    await confirmation.getByRole("button", { name: "Askıya al" }).click();
    await expect.poll(() => captured.tenantStatusUpdates).toEqual([{ body: { status: "SUSPENDED", expectedLifecycleVersion: 0, reason: "SECURITY_REVIEW", confirmationText: "faz9-akademi" }, id: "tenant-faz9", idempotencyKey: expect.any(String), stepUpToken: "lifecycle-proof" }]);
    await expect(page.getByText("2 açık oturum kapatıldı.")).toBeVisible();
  });

  test("lifecycle arka plan yenilemesinde buton sabit kalır ve onay sessizce kaybolmaz", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar/tenant-faz9");
    await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
    const button = page.getByRole("button", { name: "Askıya al", exact: true });
    await expect(button).toBeVisible();
    let release!: () => void, blocked = 0, hold = true;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/v1/tenants/tenant-faz9", async route => {
      if (route.request().method() === "GET" && hold) { blocked++; await gate; }
      await route.fallback();
    });
    try {
      await page.getByRole("button", { name: "Durumu kontrol et", exact: true }).click();
      await expect.poll(() => blocked).toBe(1);
      await expect(button).toBeVisible();
      await button.click();
      const dialog = page.getByRole("dialog", { name: "Kurum erişimini askıya al" });
      await dialog.getByLabel("Kurum kodu onayı").fill("faz9-akademi");
      await dialog.getByLabel("Doğrulama kodu").fill("123456");
      await expect(dialog.getByRole("button", { name: "Askıya al", exact: true })).toBeEnabled();
      await dialog.getByRole("button", { name: "Askıya al", exact: true }).click();
      await expect.poll(() => blocked).toBe(2);
      expect(captured.stepUps).toEqual([]);
      expect(captured.tenantStatusUpdates).toEqual([]);
      hold = false; release();
      await expect(dialog).toBeHidden();
      expect(captured.tenantStatusUpdates).toHaveLength(1);
      await expect(page.getByText("2 açık oturum kapatıldı.")).toBeVisible();
    } finally { hold = false; release(); }
  });

  test("lifecycle onayından önce değişmiş işlem yetkisini MFA göndermeden reddeder", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar/tenant-faz9");
    await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
    await page.getByRole("button", { name: "Askıya al", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Kurum erişimini askıya al" });
    await dialog.getByLabel("Kurum kodu onayı").fill("faz9-akademi");
    await dialog.getByLabel("Doğrulama kodu").fill("123456");
    await page.route("**/api/v1/tenants/tenant-faz9", route => fulfillData(route, { ...createSystemTenants()[0], management: { verified: true, allowedActions: { suspend: false, reactivate: false, cleanReset: false }, currentReset: null } }));
    await dialog.getByRole("button", { name: "Askıya al", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Kurum bilgisi değişmiş.", { exact: false })).toBeVisible();
    expect(captured.stepUps).toEqual([]);
    expect(captured.tenantStatusUpdates).toEqual([]);
  });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    test(`lifecycle exact onay ve belirsiz retry klavye akışı ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const captured = createCapturedSystemRequests(); captured.failNextStatus = "network";
      await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar/tenant-faz9");
      await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
      await page.getByRole("button", { name: "Askıya al", exact: true }).focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Kurum erişimini askıya al" });
      await expect(dialog.getByLabel("Kurum kodu onayı")).toBeFocused();
      await dialog.getByLabel("Kurum kodu onayı").fill("FAZ9-AKADEMI");
      await dialog.getByLabel("Doğrulama kodu").fill("123456");
      await expect(dialog.getByRole("button", { name: "Askıya al", exact: true })).toBeDisabled();
      await expect(dialog.getByText("Kurum kodu eşleşmiyor. Beklenen: faz9-akademi")).toBeVisible();
      await dialog.getByLabel("Kurum kodu onayı").fill("faz9-akademi");
      await dialog.getByLabel("İşlem gerekçesi").selectOption("INSTITUTION_REQUEST");
      await dialog.getByRole("button", { name: "Askıya al", exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(dialog).toContainText("İşlem sonucu doğrulanamadı");
      await expect(dialog.getByLabel("Kurum kodu onayı")).toBeDisabled();
      await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
      await page.getByRole("button", { name: "İşlemi sonuçlandır", exact: true }).click();
      await dialog.getByRole("button", { name: "Aynı işlemi tekrar dene" }).click();
      await expect(dialog).toBeHidden();
      expect(captured.tenantStatusUpdates).toHaveLength(2);
      expect(captured.tenantStatusUpdates[1]).toEqual(captured.tenantStatusUpdates[0]);
      expect(captured.stepUps).toEqual([{ purpose: "TENANT_LIFECYCLE_CHANGE", target: { tenantId: "tenant-faz9", status: "SUSPENDED", expectedLifecycleVersion: 0 }, totpCode: "123456" }]);
      expect(captured.tenantReads).toBeGreaterThanOrEqual(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("MFA hatasında PATCH yapmaz, conflict sonrası güncel sürümle yeniden onay ister", async ({ page }) => {
    const captured = createCapturedSystemRequests(); captured.failNextMfa = true; captured.failNextStatus = "conflict";
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar/tenant-faz9");
    await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
    await page.getByRole("button", { name: "Askıya al", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Kurum erişimini askıya al" });
    await dialog.getByLabel("Kurum kodu onayı").fill("faz9-akademi");
    await dialog.getByLabel("Doğrulama kodu").fill("000000");
    await dialog.getByRole("button", { name: "Askıya al", exact: true }).click();
    await expect(dialog).toContainText("İkinci doğrulama başarısız"); expect(captured.tenantStatusUpdates).toEqual([]);
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "İşlemi sonuçlandır", exact: true }).click();
    await dialog.getByLabel("Doğrulama yöntemi").selectOption("recovery");
    await dialog.getByLabel("Yedek kod", { exact: true }).fill("recovery-code");
    await dialog.getByRole("button", { name: "Aynı işlemi tekrar dene" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Kurum bilgisi değişmiş.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Askıya al", exact: true }).click();
    await dialog.getByLabel("Kurum kodu onayı").fill("faz9-akademi");
    await dialog.getByLabel("Yedek kod", { exact: true }).fill("fresh-recovery");
    await dialog.getByRole("button", { name: "Askıya al", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(captured.tenantStatusUpdates).toHaveLength(2);
    expect(captured.tenantStatusUpdates[1]?.body).toMatchObject({ expectedLifecycleVersion: 1 });
    expect(captured.tenantStatusUpdates[1]?.idempotencyKey).not.toBe(captured.tenantStatusUpdates[0]?.idempotencyKey);
  });

  test("geçersiz ilk kurum sahibi TC kimliğini API'ye göndermeden gösterir", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar");

    await page.getByRole("button", { name: "Kurum oluştur" }).click();
    const createDialog = page.getByRole("dialog", { name: "Kurum oluştur" });
    await createDialog.getByLabel("Kurum adı").fill("Geçersiz Admin Kurumu");
    await createDialog.getByLabel("Kurum kodu").fill("gecersiz-admin-kurumu");
    await createDialog.getByLabel("Lisans başlangıç").fill("2026-08-01");
    await createDialog.getByLabel("Lisans bitiş").fill("2027-08-01");
    await createDialog.getByLabel("Aktif öğrenci limiti").fill("100");
    await createDialog.getByLabel("İlk kampüs adı").fill("Geçersiz Kampüs");
    await createDialog.getByLabel("İlk kurum sahibi ad soyad").fill("Geçersiz Yönetici");
    await createDialog.getByLabel("İlk kurum sahibi e-posta").fill("invalid-admin@example.test");
    await createDialog.getByLabel("Kurum sahibi TC kimlik no").fill("1111111111");
    await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();

    await expect(createDialog.getByText("TC Kimlik No 11 rakam olmalıdır.")).toBeVisible();
    await expect.poll(() => captured.tenantCreates).toHaveLength(0);

    await createDialog.getByLabel("Kurum sahibi TC kimlik no").fill("10000001372");
    await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();
    await expect.poll(() => captured.tenantCreates).toHaveLength(1);
    expect(captured.forbiddenTenantScopedPaths).toEqual([]);
  });

  test("bilinmeyen erişim durumunda lifecycle işlemi sunmaz", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar/tenant-faz9");
    await page.route("**/api/v1/tenants/tenant-faz9", async (route) => {
      await fulfillData(route, { ...createSystemTenants()[0], id: "tenant-faz9", status: "TRIAL" });
    });
    await page.goto("/sistem/kurumlar/tenant-faz9");

    await expect(page.getByText("Durum bilgisi alınamadı", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
    await expect(page.getByRole("button", { name: /Askıya al|Yeniden aç/ })).toHaveCount(0);
    expect(captured.tenantStatusUpdates).toEqual([]);
  });

  test("sistem referans ekranları statik kanıtı kontrol listesi olarak gösterir", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/sistem-sagligi");

    for (const referencePage of [
      {
        items: ["Uygulama", "Bağlantı durumu", "Arka plan işleri", "Veritabanı", "Hızlı erişim hizmeti"],
        path: "/sistem/sistem-sagligi",
        title: "Sistem Sağlığı",
      },
      {
        items: ["Sistem ölçümleri", "İzleme panosu", "Uygulama kayıtları", "Uyarı bildirimleri"],
        path: "/sistem/gozlemlenebilirlik",
        title: "Sistem İzleme",
      },
      {
        items: ["Kurum oluşturuldu.", "Kurum bilgileri güncellendi.", "Kullanıcı kuruma eklendi.", "Kullanıcı yetkileri güncellendi."],
        path: "/sistem/denetim",
        title: "Denetim",
      },
    ]) {
      await page.goto(referencePage.path);
      await expect(page.getByRole("heading", { level: 1, name: referencePage.title })).toBeVisible();
      await expect(page.getByLabel(`${referencePage.title} güven durumu`)).toContainText("Sistem Kontrol Listesi");
      const referenceList = page.getByLabel(`${referencePage.title} referans kontrol listesi`);
      await expect(referenceList).toContainText("Kontrol Başlıkları");
      await expect(referenceList).toContainText(`${referencePage.items.length} kontrol başlığı`);
      await expect(referenceList.locator("li")).toHaveCount(referencePage.items.length);
      for (const item of referencePage.items) {
        await expect(referenceList.getByText(item)).toBeVisible();
      }
      await expect(referenceList.getByText("Ön kontrol")).toHaveCount(referencePage.items.length);
    }

    expect(captured.forbiddenTenantScopedPaths).toEqual([]);
  });
});

function restoreEnvironment(name: "DOMAIN" | "LEGACY_TENANT_LOGIN_CUTOFF_AT", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function openWithSystemTenantMocks(page: Page, captured: CapturedSystemRequests, pathName: string) {
  await installSystemTenantApiMocks(page, captured);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(pathName);
}

function createCapturedSystemRequests(): CapturedSystemRequests {
  return {
    failNextTenantCreate: false,
    forbiddenTenantScopedPaths: [],
    stepUps: [],
    tenantReads: 0,
    tenantCreates: [],
    tenantLists: [],
    tenantStatusUpdates: [],
    tenantUpdates: [],
  };
}

async function installSystemTenantApiMocks(page: Page, captured: CapturedSystemRequests) {
  let tenants = createSystemTenants();

  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    const method = route.request().method();
    if (isTenantScopedPath(pathName)) {
      captured.forbiddenTenantScopedPaths.push(pathName);
    }

    if (pathName === "/auth/refresh") {
      await fulfillData(route, createSystemAuthResponse());
      return;
    }
    if (pathName === "/auth/step-up") {
      captured.stepUps.push(route.request().postDataJSON());
      if (captured.failNextMfa) { captured.failNextMfa = false; await fulfillError(route, "MFA_CODE_INVALID", 403); return; }
      await fulfillData(route, { purpose: "TENANT_LIFECYCLE_CHANGE", stepUpToken: "lifecycle-proof", expiresAt: new Date(Date.now() + 300000).toISOString() });
      return;
    }
    if (pathName === "/me/notification-devices") {
      await fulfillData(route, []);
      return;
    }
    if (pathName === "/tenants" && method === "GET") {
      captured.tenantLists.push(new URLSearchParams(url.search));
      await fulfillData(route, tenants, listMeta(url.searchParams, tenants.length));
      return;
    }
    if (pathName === "/tenants" && method === "POST") {
      const body = route.request().postDataJSON();
      captured.tenantCreates.push({
        authorization: route.request().headers().authorization,
        body,
        idempotencyKey: route.request().headers()["idempotency-key"],
      });
      if (captured.failNextTenantCreate) {
        captured.failNextTenantCreate = false;
        await fulfillError(route, "TEMPORARY_UNAVAILABLE", 503);
        return;
      }
      const tenant = {
        activeSeatCount: 1,
        id: "tenant-created-invited",
        licenseEndsAt: body.licenseTerm.endsAt,
        licenseStartsAt: body.licenseTerm.startsAt,
        name: body.name,
        plan: body.licenseTerm.planCode,
        seatLimit: body.licenseTerm.activeStudentLimit,
        slug: body.slug,
        status: "ACTIVE",
        lifecycleVersion: 0,
      };
      tenants = [tenant, ...tenants];
      await fulfillData(route, {
        campuses: body.campuses.map((campus: { code?: string; name: string; unitType?: string }, index: number) => ({
          ...campus,
          id: `tenant-created-campus-${index + 1}`,
          tenantId: tenant.id,
        })),
        licenseTerm: { ...body.licenseTerm, id: "tenant-created-license", tenantId: tenant.id },
        owner: { id: "tenant-created-owner", employeeId: "tenant-created-employee", roles: ["TENANT_OWNER"], tenantId: tenant.id },
        tenant,
      });
      return;
    }
    if (pathName.startsWith("/tenants/") && method === "GET") {
      captured.tenantReads += 1;
      const id = decodeURIComponent(pathName.replace("/tenants/", ""));
      const detail = tenants.find((tenant) => tenant.id === id);
      await fulfillData(route, detail ? { ...detail, management: { verified: true, currentReset: null, allowedActions: { suspend: detail.status === "ACTIVE", reactivate: detail.status === "SUSPENDED", cleanReset: false } } } : null);
      return;
    }
    if (/^\/tenants\/[^/]+\/status$/.test(pathName) && method === "PATCH") {
      const id = decodeURIComponent(pathName.split("/")[2] ?? "");
      const body = route.request().postDataJSON() as { status: SystemTenantFixture["status"] };
      captured.tenantStatusUpdates.push({ body, id, idempotencyKey: route.request().headers()["idempotency-key"], stepUpToken: route.request().headers()["x-step-up-token"] });
      if (captured.failNextStatus) {
        const failure = captured.failNextStatus; captured.failNextStatus = undefined;
        if (failure === "network") await route.abort("failed");
        else { const changed = tenants.find((item) => item.id === id); if (changed) changed.lifecycleVersion += 1; await fulfillError(route, "TENANT_LIFECYCLE_VERSION_CONFLICT", 409); }
        return;
      }
      const tenant = tenants.find((item) => item.id === id);
      if (tenant) { tenant.status = body.status; tenant.lifecycleVersion += 1; }
      await fulfillData(route, { tenant: tenant ?? null, sessionsRevoked: 2 });
      return;
    }
    if (pathName.startsWith("/tenants/") && method === "PATCH") {
      const id = decodeURIComponent(pathName.replace("/tenants/", ""));
      const body = route.request().postDataJSON() as Partial<SystemTenantFixture>;
      captured.tenantUpdates.push({
        authorization: route.request().headers().authorization,
        body,
        id,
      });
      const tenant = tenants.find((item) => item.id === id);
      if (tenant) Object.assign(tenant, body);
      await fulfillData(route, tenant ?? null);
      return;
    }

    await fulfillData(route, []);
  });
}

function createSystemAuthResponse() {
  return {
    accessToken: "system-tenant-access-token",
    session: {
      id: "session-system-tenant",
      membershipVersion: 1,
      roles: ["SYSTEM_ADMIN"],
      status: "ACTIVE",
      userId: "user-system-admin",
    },
  };
}

function createSystemTenants(): SystemTenantFixture[] {
  return [
    {
      activeSeatCount: 42,
      id: "tenant-faz9",
      licenseEndsAt: "2027-06-17T00:00:00.000Z",
      licenseStartsAt: "2026-06-17T00:00:00.000Z",
      name: "Faz 9 Akademi",
      plan: "ENTERPRISE",
      seatLimit: 120,
      slug: "faz9-akademi",
      status: "ACTIVE",
      lifecycleVersion: 0,
    },
    {
      activeSeatCount: 8,
      id: "tenant-deneme",
      licenseEndsAt: "2026-09-01T00:00:00.000Z",
      licenseStartsAt: "2026-06-01T00:00:00.000Z",
      name: "Deneme Koleji",
      plan: "TRIAL",
      seatLimit: 25,
      slug: "deneme-koleji",
      status: "ACTIVE",
      lifecycleVersion: 0,
    },
  ];
}

function isTenantScopedPath(pathName: string) {
  return [
    "/me/tenant",
    "/students",
    "/guardians",
    "/teachers",
    "/classes",
    "/courses",
    "/payment-plans",
    "/support-tickets",
  ].some((path) => pathName === path || pathName.startsWith(`${path}/`));
}

function listMeta(searchParams: URLSearchParams, total: number) {
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "10");
  return {
    limit,
    page,
    total,
    totalPages: Math.ceil(total / limit),
  };
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

async function fulfillError(route: Route, code: string, status: number) {
  await route.fulfill({
    body: JSON.stringify({ error: { code } }),
    headers: {
      ...corsHeadersFor(route),
      "content-type": "application/json",
    },
    status,
  });
}

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}


const resetDigestFixture = "a".repeat(64);
const resetOperationFixture = { operationId: "b".repeat(32), status: "RUNNING", phase: "BACKUP", errorCode: null, result: null };
function resetPreviewFixture() {
  return { institutionRequest: { id: "b".repeat(32), tenantId: "tenant-faz9", requestedBy: "tenant-admin", requestedAt: "2026-09-07T00:00:00.000Z", lifecycleVersion: 2, status: "PENDING", operationId: null }, preset: "CLEAN_SETUP_V1", lifecycleVersion: 3, preservedOwnerCount: 2, categories: Object.keys(resetCategoryLabels).map((category) => ({ category, preserved: 0, deleted: 0, blocked: 0 })), objectCount: 4, objectBytes: 400, blockers: [], blockerCounts: [], allowed: true, preflightDigest: resetDigestFixture };
}
async function installResetMocks(page: Page, options: { preview?: unknown; lost?: boolean; malformedPost?: boolean; previous?: boolean; mfaWait?: Promise<void>; mfaFailure?: boolean } = {}) {
  const captured = createCapturedSystemRequests();
  await installSystemTenantApiMocks(page, captured);
  const state = { posts: [] as Array<{ body: unknown; key?: string; proof?: string }>, gets: [] as Array<{ path: string; key?: string }>, tenantReads: 0, previewReads: 0, operation: null as null | typeof resetOperationFixture, complete: false };
  await page.route("**/api/v1/tenants/tenant-faz9**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/clean-reset-preview")) { state.previewReads++; await fulfillData(route, options.preview ?? resetPreviewFixture()); return; }
    if (path.includes("/clean-reset-jobs")) {
      if (route.request().method() === "POST") {
        state.posts.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"], proof: route.request().headers()["x-step-up-token"] });
        state.operation = { ...resetOperationFixture };
        if (options.lost) await route.abort("failed"); else await fulfillData(route, options.malformedPost ? { status: "private-unknown" } : state.operation);
      } else {
        state.gets.push({ path, key: route.request().headers()["idempotency-key"] });
        if (path.endsWith("/" + "c".repeat(32))) { await fulfillData(route, { ...resetOperationFixture, operationId: "c".repeat(32), status: "COMPLETED", phase: "DONE", result: { preservedOwnerCount: 2, deletedObjectCount: 1 } }); return; }
        if (!state.operation) { await fulfillError(route, "RESET_OPERATION_NOT_FOUND", 404); return; }
        await fulfillData(route, state.complete ? { ...state.operation, status: "COMPLETED", phase: "DONE", result: { preservedOwnerCount: 2, deletedObjectCount: 4 } } : state.operation);
      }
      return;
    }
    state.tenantReads++;
    await fulfillData(route, { ...createSystemTenants()[0], lifecycleVersion: 3, status: state.complete ? "ACTIVE" : "SUSPENDED", management: { verified: true, allowedActions: { suspend: state.complete, reactivate: !state.operation, cleanReset: !state.operation }, currentReset: state.operation ?? (options.previous ? { ...resetOperationFixture, operationId: "c".repeat(32), status: "COMPLETED", phase: "DONE", result: { preservedOwnerCount: 2, deletedObjectCount: 1 } } : null) } });
  });
  await page.route("**/api/v1/auth/step-up", async (route) => {
    captured.stepUps.push(route.request().postDataJSON());
    if (options.mfaWait) await options.mfaWait;
    if (options.mfaFailure) await fulfillError(route, "MFA_CODE_INVALID", 401);
    else await fulfillData(route, { purpose: "TENANT_CLEAN_RESET", stepUpToken: "reset-proof", expiresAt: new Date(Date.now() + 300000).toISOString() });
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/sistem/kurumlar/tenant-faz9");
  await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
  return { captured, state };
}
async function confirmReset(page: Page) {
  await page.getByRole("button", { name: "Temizlemeyi başlat", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Kurum temizliğini onayla" });
  await expect(dialog.getByLabel("Kurum kodu onayı")).toBeFocused();
  await dialog.getByLabel("Kurum kodu onayı").fill("FAZ9-AKADEMI");
  await dialog.getByLabel("Doğrulama kodu").fill("123456");
  await expect(dialog.getByRole("button", { name: "Temizlemeyi onayla" })).toBeDisabled();
  await dialog.getByLabel("Kurum kodu onayı").fill("faz9-akademi");
  await dialog.getByRole("button", { name: "Temizlemeyi onayla" }).click();
}
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`Gate5 reset tek POST ve GET uzlaştırma ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { state, captured } = await installResetMocks(page, { lost: true });
    await expect(page.getByRole("button", { name: "Temizlemeyi başlat" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await confirmReset(page);
    await expect.poll(() => state.posts.length).toBe(1);
    await expect(page.getByText("Temizleme: Çalışıyor", { exact: true })).toBeVisible();
    expect(state.gets.some((get) => get.path.endsWith("/clean-reset-jobs") && get.key === state.posts[0]?.key)).toBe(true);
    expect(captured.stepUps).toEqual([{ purpose: "TENANT_CLEAN_RESET", target: { tenantId: "tenant-faz9", preset: "CLEAN_SETUP_V1", expectedLifecycleVersion: 3, preflightDigest: resetDigestFixture }, totpCode: "123456" }]);
    expect(state.posts[0]).toMatchObject({ proof: "reset-proof", body: { reason: "INSTITUTION_REQUEST", confirmationText: "faz9-akademi", expectedLifecycleVersion: 3, preflightDigest: resetDigestFixture, preset: "CLEAN_SETUP_V1" } });
    await expect(page.getByRole("button", { name: "Yeniden aç", exact: true })).toHaveCount(0);
    await page.reload(); await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
    await expect(page.getByText("Temizleme: Çalışıyor", { exact: true })).toBeVisible();
    const reads = state.tenantReads, previews = state.previewReads;
    state.complete = true;
    await page.getByRole("button", { name: "Durumu kontrol et" }).click();
    await expect(page.getByText(/Kurum sahipleri sonraki girişte parolalarını değiştirmelidir/)).toBeVisible();
    await expect.poll(() => state.tenantReads).toBeGreaterThan(reads);
    await expect.poll(() => state.previewReads).toBeGreaterThan(previews);
    expect(state.posts).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
for (const [invalidIndex, invalid] of [
  { ...resetPreviewFixture(), blockers: ["LEGAL_HOLD_UNVERIFIED"], blockerCounts: [{ code: "LEGAL_HOLD_UNVERIFIED", count: null }], allowed: false },
  { ...resetPreviewFixture(), institutionRequest: null },
  { ...resetPreviewFixture(), institutionRequest: { ...resetPreviewFixture().institutionRequest, tenantId: "other-tenant" } },
  { ...resetPreviewFixture(), categories: [] },
  { ...resetPreviewFixture(), lifecycleVersion: 2 },
  { ...resetPreviewFixture(), categories: [{ category: "private-object-key", preserved: 0, deleted: 1, blocked: 0 }] },
  { ...resetPreviewFixture(), objectCount: -1 },
].entries()) test(`Gate5 hatalı veya bloklu önizleme başlatılamaz ${invalidIndex}`, async ({ page }) => {
  const { state } = await installResetMocks(page, { preview: invalid });
  await expect(page.getByRole("button", { name: "Durumu kontrol et" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Temizlemeyi başlat" })).toHaveCount(0);
  await expect(page.getByText("private-object-key")).toHaveCount(0);
  expect(state.posts).toEqual([]);
});
test("Gate5 MFA beklerken Escape sonrası POST göndermez", async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const { state, captured } = await installResetMocks(page, { mfaWait: wait });
  await confirmReset(page);
  await expect.poll(() => captured.stepUps.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  release();
  await page.getByRole("button", { name: "Durumu kontrol et" }).click();
  expect(state.posts).toEqual([]);
});
test("Gate5 eski tamamlanan iş yeni kayıp POST sonucunu gölgelemez", async ({ page }) => {
  const { state } = await installResetMocks(page, { lost: true, previous: true });
  await expect(page.getByText("Temizleme: Tamamlandı", { exact: true })).toBeVisible();
  await confirmReset(page);
  await expect(page.getByText("Temizleme: Çalışıyor", { exact: true })).toBeVisible();
  expect(state.gets.some((get) => get.path.endsWith("/clean-reset-jobs") && get.key === state.posts[0]?.key)).toBe(true);
  expect(state.posts).toHaveLength(1);
});
test("Gate5 hatalı başarılı POST yalnız GET ile uzlaştırılır", async ({ page }) => {
  const { state } = await installResetMocks(page, { malformedPost: true });
  await confirmReset(page);
  await expect(page.getByText("Temizleme: Çalışıyor", { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  await expect(page.getByText("private-unknown")).toHaveCount(0);
});

for (const changeActor of [false, true]) test(`Gate5 yenilenen oturum aynı aktöre bağlı kalır ${changeActor}`, async ({ page }) => {
  const { state, captured } = await installResetMocks(page);
  let refreshes = 0;
  await page.route("**/api/v1/auth/refresh", async (route) => {
    refreshes++;
    const original = createSystemAuthResponse();
    await fulfillData(route, { ...original, accessToken: "rotated-system-token", session: { ...original.session, ...(changeActor ? { userId: "other-admin", id: "other-session" } : {}) } });
  });
  let failedRead = false;
  await page.route("**/api/v1/tenants/tenant-faz9/clean-reset-preview", async (route) => {
    if (!failedRead) { failedRead = true; await fulfillError(route, "TOKEN_EXPIRED", 401); }
    else await fulfillData(route, resetPreviewFixture());
  });
  let mfaAuthorization = "", resetAuthorization = "";
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/step-up")) mfaAuthorization = request.headers().authorization ?? "";
    if (request.url().endsWith("/clean-reset-jobs") && request.method() === "POST") resetAuthorization = request.headers().authorization ?? "";
  });
  await confirmReset(page);
  await expect.poll(() => refreshes).toBe(1);
  if (changeActor) {
    await expect(page.getByRole("dialog")).toContainText("Ön kontrol veya ikinci doğrulama tamamlanamadı");
    expect(captured.stepUps).toEqual([]); expect(state.posts).toEqual([]);
  } else {
    await expect(page.getByText("Temizleme: Çalışıyor", { exact: true })).toBeVisible();
    expect(mfaAuthorization).toBe("Bearer rotated-system-token"); expect(resetAuthorization).toBe("Bearer rotated-system-token"); expect(state.posts).toHaveLength(1);
  }
});
test("Gate5 belirsiz POST sonrası GET 404 yeni işlem açmaz", async ({ page }) => {
  const { state } = await installResetMocks(page, { lost: true });
  await page.route("**/api/v1/tenants/tenant-faz9/clean-reset-jobs", async (route) => {
    if (route.request().method() === "GET") await fulfillError(route, "RESET_OPERATION_NOT_FOUND", 404); else await route.fallback();
  });
  await confirmReset(page);
  await expect(page.getByText("İşlem kaydı doğrulanamadı", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Durumu kontrol et" }).click();
  await expect(page.getByRole("button", { name: "Temizlemeyi başlat" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Yeniden aç", exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
});
for (const metadata of [undefined, { verified: true, allowedActions: { suspend: false, reactivate: true, cleanReset: true }, currentReset: { ...resetOperationFixture, status: "PRIVATE_UNKNOWN" } }]) test(`Gate5 eksik veya bilinmeyen yönetim bilgisi ${metadata ? "unknown" : "missing"}`, async ({ page }) => {
  const { state } = await installResetMocks(page);
  await page.route("**/api/v1/tenants/tenant-faz9", async (route) => fulfillData(route, { ...createSystemTenants()[0], status: "SUSPENDED", lifecycleVersion: 3, management: metadata }));
  await page.reload(); await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
  await expect(page.getByRole("button", { name: "Temizlemeyi başlat" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Yeniden aç", exact: true })).toHaveCount(0);
  await expect(page.getByText("PRIVATE_UNKNOWN")).toHaveCount(0); expect(state.posts).toEqual([]);
});
for (const rejection of [{ status: 409, code: "TENANT_LIFECYCLE_VERSION_CONFLICT" }, { status: 401, code: "MFA_STEP_UP_INVALID" }]) test(`Gate5 kesin ret yeni açık onay ister ${rejection.status}`, async ({ page }) => {
  const { state } = await installResetMocks(page);
  let rejectedPosts = 0;
  await page.route("**/api/v1/tenants/tenant-faz9/clean-reset-jobs", async (route) => {
    if (route.request().method() === "POST" && rejectedPosts === 0) { rejectedPosts++; await fulfillError(route, rejection.code, rejection.status); }
    else await route.fallback();
  });
  await confirmReset(page);
  await expect(page.getByText("İstek kabul edilmedi.", { exact: false })).toBeVisible();
  expect(rejectedPosts).toBe(1); expect(state.posts).toEqual([]);
  await confirmReset(page);
  await expect(page.getByText("Temizleme: Çalışıyor", { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
});
for (const terminal of ["BLOCKED", "FAILED"]) test(`Gate5 ${terminal} durumunda yeniden açma yok`, async ({ page }) => {
  const { state } = await installResetMocks(page);
  state.operation = { ...resetOperationFixture, status: terminal };
  await page.reload(); await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
  await expect(page.getByText("Kurum askıda kalır.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeniden aç", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Temizlemeyi başlat" })).toHaveCount(0);
  expect(state.posts).toEqual([]);
});
test("Gate5 önizleme yüklenirken ve okumada hata varken başlatma yok", async ({ page }) => {
  await installResetMocks(page);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/tenants/tenant-faz9/clean-reset-preview", async (route) => { await wait; await fulfillError(route, "RESET_PREVIEW_UNVERIFIED", 503); });
  await page.reload(); await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
  await expect(page.getByText("Temizleme önizlemesi yükleniyor…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Temizlemeyi başlat" })).toHaveCount(0);
  release();
  await expect(page.getByText("Önizleme doğrulanamadı", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Temizlemeyi başlat" })).toHaveCount(0);
});
test("Gate5 MFA beklerken başka kuruma geçiş eski hedefe POST göndermez", async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const { state, captured } = await installResetMocks(page, { mfaWait: wait });
  await confirmReset(page); await expect.poll(() => captured.stepUps.length).toBe(1);
  await page.goto("/sistem/kurumlar/tenant-deneme");
  release();
  await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deneme Koleji" })).toBeVisible();
  expect(state.posts).toEqual([]);
});
