import { expect, test } from "@playwright/test";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": "http://localhost:3001",
};

function envelope<T>(data: T) {
  if (Array.isArray(data)) return { data, meta: {} };
  return { data };
}

test("Next csrf cookie yokken açılışta refresh çağrısı yapmaz", async ({ page }) => {
  let refreshCount = 0;

  await page.route("**/auth/refresh", async (route) => {
    refreshCount += 1;
    await route.fulfill({ headers: corsHeaders, status: 403 });
  });

  await page.goto("/login");

  await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
  expect(refreshCount).toBe(0);
});

test("Next eşzamanlı 401 yanıtlarında tek refresh çağrısı yapar", async ({ page }) => {
  let didLogin = false;
  let refreshCount = 0;
  const expiredOnce = new Set<string>();
  const expiringPaths = new Set(["/classes", "/teachers", "/students"]);

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.continue();
  });

  await page.route("**/auth/refresh", async (route) => {
    if (!didLogin) {
      await route.fulfill({ headers: corsHeaders, status: 401 });
      return;
    }

    refreshCount += 1;
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse("fresh-access-token"))),
    });
  });

  await page.route("**/auth/login", async (route) => {
    didLogin = true;
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse("expired-access-token"))),
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }

    if (request.method() === "GET" && expiringPaths.has(path)) {
      if (request.headers().authorization === "Bearer expired-access-token" && !expiredOnce.has(path)) {
        expiredOnce.add(path);
        await route.fulfill({ headers: corsHeaders, status: 401 });
        return;
      }

      expect(request.headers().authorization).toBe("Bearer fresh-access-token");
    }

    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(readFixture(path))),
    });
  });

  await page.goto("/kurum");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Kullanıcı Adı").fill("10000000146");
  await page.locator('input[name="password"]').fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/kurum$/);
  await expect(page.getByRole("heading", { name: "Kurum Paneli" })).toBeVisible();
  await expect(page.getByLabel("Kurum özeti").getByRole("strong")).toHaveText(["1", "1", "1"]);
  expect(refreshCount).toBe(1);
  expect(expiredOnce).toEqual(expiringPaths);
});

function createAuthResponse(accessToken: string) {
  return {
    accessToken,
    session: {
      id: "session-a",
      userId: "user-tenant-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
      status: "ACTIVE",
    },
  };
}

function readFixture(path: string) {
  if (path === "/classes") {
    return [{ id: "class-a", tenantId: "tenant-a", name: "8-A" }];
  }

  if (path === "/teachers") {
    return [{ id: "teacher-a", tenantId: "tenant-a", firstName: "Ayse", lastName: "Ogretmen", branch: "Matematik" }];
  }

  if (path === "/students") {
    return [{ id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A" }];
  }

  if (path === "/exams/exam-demo/reports/snapshots") {
    return [];
  }

  return [];
}
