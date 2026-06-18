import { expect, test } from "@playwright/test";

const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": webOrigin,
};

test("KVKK PII temizleme onay olmadan POST etmez", async ({ page }) => {
  let activeEmail = "";
  let purgePostCount = 0;
  let students = [
    {
      id: "student-a",
      tenantId: "tenant-a",
      firstName: "Ada",
      lastName: "A",
      status: "ACTIVE",
    },
  ];

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.continue();
  });

  await page.route("**/auth/refresh", async (route) => {
    if (!activeEmail) {
      await route.fulfill({ headers: corsHeaders, status: 401 });
      return;
    }

    await route.fulfill({
      body: JSON.stringify(envelope(createAuthResponse(activeEmail))),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
  });

  await page.route("**/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { email?: string };
    activeEmail = body.email ?? "";
    await route.fulfill({
      body: JSON.stringify(envelope(createAuthResponse(activeEmail))),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }

    expect(request.headers().authorization).toBe("Bearer next-access-token");

    if (path === "/me/notification-devices") {
      await route.fulfill({
        body: JSON.stringify(envelope([])),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/me/tenant") {
      await route.fulfill({
        body: JSON.stringify(envelope(createTenantResponse())),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/students" && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(envelope(students)),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if ((path === "/teachers" || path === "/guardians") && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(envelope([])),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (path === "/students/student-a/purge-pii" && request.method() === "POST") {
      purgePostCount += 1;
      students = students.map((student) =>
        student.id === "student-a" ? { ...student, firstName: "Anonim", lastName: "Ogrenci" } : student,
      );
      await route.fulfill({
        body: JSON.stringify(envelope(students[0])),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify(envelope([])),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
  });

  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: webOrigin, value: "csrf-token" }]);
  activeEmail = "admin-a@example.test";
  await page.goto("/kurum/kvkk");
  await expect(page).toHaveURL(/\/kurum\/kvkk$/);
  await expect(page.getByRole("region", { exact: true, name: "KVKK operasyon özeti" })).toContainText("Purge onayı");
  await expect(page.getByLabel("KVKK güven durumu").getByText("PII İşlem Güvencesi")).toBeVisible();
  await expect(page.getByLabel("KVKK yönetimi").getByRole("table", { name: "KVKK PII temizleme kayıtları" }).getByRole("cell", { name: "Ada A" })).toBeVisible();

  await page.getByLabel("Ada PII temizle").click();
  await expect(page.getByRole("dialog", { name: "PII temizlemeyi onayla" })).toBeVisible();
  expect(purgePostCount).toBe(0);
  await page.getByRole("button", { name: "Vazgeç" }).click();
  expect(purgePostCount).toBe(0);

  await page.getByLabel("Ada PII temizle").click();
  await page.getByRole("dialog", { name: "PII temizlemeyi onayla" }).getByRole("button", { name: "PII temizle" }).click();
  await expect(page.getByLabel("KVKK yönetimi").getByRole("table", { name: "KVKK PII temizleme kayıtları" }).getByRole("cell", { name: "Anonim Ogrenci" })).toBeVisible();
  expect(purgePostCount).toBe(1);
});

function envelope<T>(data: T) {
  return { data };
}

function createTenantResponse() {
  return {
    contactEmail: "kvkk@example.test",
    id: "tenant-a",
    institutionType: "Dershane",
    name: "KVKK Akademi",
  };
}

function createAuthResponse(email: string) {
  return {
    accessToken: "next-access-token",
    session: {
      id: "session-a",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-a",
      userId: email === "admin-a@example.test" ? "user-tenant-a" : "user-other",
    },
  };
}
