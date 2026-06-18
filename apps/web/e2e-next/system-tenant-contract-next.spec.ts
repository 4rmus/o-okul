import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

interface CapturedSystemRequests {
  forbiddenTenantScopedPaths: string[];
  tenantCreates: Array<{ authorization: string | undefined; body: unknown }>;
  tenantDeletes: Array<{ authorization: string | undefined; id: string }>;
  tenantLists: URLSearchParams[];
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
}

test.describe("Sistem tenant yönetimi sözleşmesi", () => {
  test("kurum operasyon özeti URL state ve tenant kapsamını korur", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar?page=2&limit=20&q=faz&sort=-name");

    const tenantsRegion = page.getByLabel("Kurum yönetimi");
    const summary = tenantsRegion.getByRole("region", { exact: true, name: "Sistem kurum operasyon özeti" });
    await expect(summary).toContainText("Kurum toplamı");
    await expect(summary).toContainText("Durum dağılımı");
    await expect(summary).toContainText("Lisans riski");
    await expect(summary).toContainText("Koltuk riski");
    await expect(summary).toContainText("SYSTEM_ADMIN kapsamı");
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

  test("ilk admin tokenını reveal dışında saklı tutar ve kurum silinince temizler", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/kurumlar");

    await page.getByRole("button", { name: "Kurum oluştur" }).click();
    const createDialog = page.getByRole("dialog", { name: "Kurum oluştur" });
    await createDialog.getByLabel("Kurum adı").fill("Davetli Kurum");
    await createDialog.getByLabel("Slug").fill("davetli-kurum");
    await createDialog.getByLabel("Plan").selectOption("PRO");
    await createDialog.getByLabel("İlk admin modu").selectOption("invitation");
    await createDialog.getByLabel("Admin ad soyad").fill("Davetli Yönetici");
    await createDialog.getByLabel("Admin e-posta").fill("invited.admin@example.test");
    await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();

    await expect.poll(() => captured.tenantCreates).toHaveLength(1);
    expect(captured.tenantCreates[0]).toMatchObject({
      authorization: "Bearer system-tenant-access-token",
      body: {
        firstAdmin: {
          email: "invited.admin@example.test",
          mode: "invitation",
          name: "Davetli Yönetici",
        },
        name: "Davetli Kurum",
        plan: "PRO",
        slug: "davetli-kurum",
      },
    });

    const tokenPanel = page.getByLabel("İlk admin aktivasyon tokenı");
    await expect(tokenPanel).toContainText("invited.admin@example.test");
    await expect(tokenPanel).toContainText("Token maskeli");
    await expect(tokenPanel.getByRole("button", { name: "Tokenı kapat" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("tenant-admin-activation-token");
    await tokenPanel.getByRole("button", { name: "Tokenı göster" }).click();
    await expect(tokenPanel).toContainText("Token açık");
    await expect(tokenPanel).toContainText("tenant-admin-activation-token");
    await tokenPanel.getByRole("button", { name: "Tokenı gizle" }).click();
    await expect(page.locator("body")).not.toContainText("tenant-admin-activation-token");

    await page.getByRole("row", { name: /Davetli Kurum/ }).getByRole("button", { name: "Sil" }).click();
    const confirmDialog = page.getByRole("dialog", { name: "Kurumu sil" });
    await expect(confirmDialog).toContainText("Davetli Kurum kurumunu silmek istiyor musun?");
    await confirmDialog.getByRole("button", { name: "Sil" }).click();
    await expect.poll(() => captured.tenantDeletes).toEqual([
      { authorization: "Bearer system-tenant-access-token", id: "tenant-created-invited" },
    ]);
    await expect(page.getByLabel("İlk admin aktivasyon tokenı")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("tenant-admin-activation-token");
    expect(captured.forbiddenTenantScopedPaths).toEqual([]);
  });

  test("sistem referans ekranları statik kanıtı kontrol listesi olarak gösterir", async ({ page }) => {
    const captured = createCapturedSystemRequests();
    await openWithSystemTenantMocks(page, captured, "/sistem/sistem-sagligi");

    for (const referencePage of [
      {
        items: ["API health", "Readiness", "Queue", "Postgres", "Redis"],
        path: "/sistem/sistem-sagligi",
        title: "Sistem Sağlığı",
      },
      {
        items: ["Prometheus scrape", "Grafana dashboard", "Loki log panel", "Alert webhook"],
        path: "/sistem/gozlemlenebilirlik",
        title: "Gözlemlenebilirlik",
      },
      {
        items: ["tenant.created", "tenant.updated", "user.membership_created", "user.roles_updated"],
        path: "/sistem/denetim",
        title: "Denetim",
      },
    ]) {
      await page.goto(referencePage.path);
      await expect(page.getByRole("heading", { level: 1, name: referencePage.title })).toBeVisible();
      await expect(page.getByLabel(`${referencePage.title} güven durumu`)).toContainText("Sistem Referans Kanıtı");
      const referenceList = page.getByLabel(`${referencePage.title} referans kontrol listesi`);
      await expect(referenceList).toContainText("Operasyon referansı");
      await expect(referenceList).toContainText(`${referencePage.items.length} salt-okuma kontrol başlığı`);
      await expect(referenceList.locator("li")).toHaveCount(referencePage.items.length);
      for (const item of referencePage.items) {
        await expect(referenceList.getByText(item)).toBeVisible();
      }
      await expect(referenceList.getByText("Statik kanıt")).toHaveCount(referencePage.items.length);
    }

    expect(captured.forbiddenTenantScopedPaths).toEqual([]);
  });
});

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
    forbiddenTenantScopedPaths: [],
    tenantCreates: [],
    tenantDeletes: [],
    tenantLists: [],
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
      });
      const tenant = {
        activeSeatCount: 1,
        id: "tenant-created-invited",
        licenseEndsAt: body.licenseEndsAt || undefined,
        licenseStartsAt: body.licenseStartsAt || undefined,
        name: body.name,
        plan: body.plan,
        seatLimit: body.seatLimit ? Number(body.seatLimit) : undefined,
        slug: body.slug,
        status: body.status,
      };
      tenants = [tenant, ...tenants];
      await fulfillData(route, {
        admin: {
          email: String(body.firstAdmin.email).toLowerCase(),
          id: "tenant-created-admin",
          name: body.firstAdmin.name,
          roles: ["TENANT_ADMIN"],
          tenantId: tenant.id,
          ...(body.firstAdmin.mode === "invitation" ? { activationToken: "tenant-admin-activation-token" } : {}),
        },
        tenant,
      });
      return;
    }
    if (pathName.startsWith("/tenants/") && method === "DELETE") {
      const id = decodeURIComponent(pathName.replace("/tenants/", ""));
      captured.tenantDeletes.push({
        authorization: route.request().headers().authorization,
        id,
      });
      const deleted = tenants.find((tenant) => tenant.id === id) ?? tenants[0];
      tenants = tenants.filter((tenant) => tenant.id !== id);
      await fulfillData(route, { ...deleted, status: "DELETED" });
      return;
    }
    if (pathName.startsWith("/tenants/") && method === "GET") {
      const id = decodeURIComponent(pathName.replace("/tenants/", ""));
      await fulfillData(route, tenants.find((tenant) => tenant.id === id) ?? null);
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
      status: "TRIAL",
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

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}
