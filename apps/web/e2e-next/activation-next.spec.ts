import { expect, test } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test("tek kullanımlık davet bağlantısı URL'den silinir ve hesabı etkinleştirir", async ({ page }) => {
  let acceptBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/identity-invitations/accept", async (route) => {
    acceptBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ data: { status: "ACCEPTED", acceptedAt: "2026-08-01T12:00:00.000Z" } }),
    });
  });

  await page.goto("/aktivasyon#token=activation-secret");
  await expect(page).toHaveURL(/\/aktivasyon$/);
  expect(page.url()).not.toContain("activation-secret");
  await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("YeniAb12");
  await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("YeniAb12");
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

  // UAT F-20: without a session the page still lands on the login page with the notice (no auto-login).
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Giriş" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Hesabınız etkinleştirildi. Yeni şifrenizle giriş yapın.");
  expect(acceptBody).toEqual({ token: "activation-secret", password: "YeniAb12" });
});

test("tek kullanımlık davet kabulü tarayıcıdaki başka kullanıcının oturumunu kapatır ve girişe yönlendirir (UAT F-20)", async ({ page }) => {
  const logoutCsrfHeaders: Array<string | undefined> = [];
  let accepted = false;
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-owner" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    if (path === "/auth/refresh") {
      await route.fulfill({
        body: JSON.stringify({ data: {
          accessToken: "owner-access-token",
          session: { id: "owner-session", membershipVersion: 1, roles: ["TENANT_OWNER"], status: "ACTIVE", tenantId: "tenant-a", userId: "owner-user", activePersona: "STAFF", membershipId: "owner-membership" },
        } }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }
    if (path === "/auth/logout") {
      logoutCsrfHeaders.push(request.headers()["x-csrf-token"]);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    if (path === "/identity-invitations/accept") {
      accepted = true;
      await route.fulfill({
        body: JSON.stringify({ data: { status: "ACCEPTED", acceptedAt: "2026-10-22T12:00:00.000Z" } }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
      });
      return;
    }
    await route.fulfill({ body: JSON.stringify({ data: [] }), contentType: "application/json", headers: corsHeaders, status: 200 });
  });

  await page.goto("/aktivasyon#token=activation-secret");
  await expect(page.getByRole("button", { name: "Hesabı etkinleştir" })).toBeEnabled();
  await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("YeniAb12");
  await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("YeniAb12");
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Giriş" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Hesabınız etkinleştirildi. Yeni şifrenizle giriş yapın.");
  expect(accepted).toBe(true);
  expect(logoutCsrfHeaders).toEqual(["csrf-owner"]);
  // The owner's session is not resumed: the login page does not forward into the app.
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/login$/);
});

test("tek kullanımlık davet kabulünden sonra önceki oturum kapatılamazsa girişe gitmez ve uyarır (UAT F-20)", async ({ page }) => {
  const logoutStatuses = [500, 204];
  let logoutCalls = 0;
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-owner" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    if (path === "/auth/refresh") {
      await route.fulfill({
        body: JSON.stringify({ data: {
          accessToken: "owner-access-token",
          session: { id: "owner-session", membershipVersion: 1, roles: ["TENANT_OWNER"], status: "ACTIVE", tenantId: "tenant-a", userId: "owner-user", activePersona: "STAFF", membershipId: "owner-membership" },
        } }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }
    if (path === "/auth/logout") {
      const status = logoutStatuses[logoutCalls] ?? 204;
      logoutCalls += 1;
      await route.fulfill({
        body: status === 204 ? undefined : JSON.stringify({ error: { code: "INTERNAL_SERVER_ERROR" } }),
        contentType: "application/json",
        headers: corsHeaders,
        status,
      });
      return;
    }
    if (path === "/identity-invitations/accept") {
      await route.fulfill({
        body: JSON.stringify({ data: { status: "ACCEPTED", acceptedAt: "2026-10-22T12:00:00.000Z" } }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
      });
      return;
    }
    await route.fulfill({ body: JSON.stringify({ data: [] }), contentType: "application/json", headers: corsHeaders, status: 200 });
  });

  await page.goto("/aktivasyon#token=activation-secret");
  await expect(page.getByRole("button", { name: "Hesabı etkinleştir" })).toBeEnabled();
  await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("YeniAb12");
  await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("YeniAb12");
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "önceki oturum kapatılamadı" }))
    .toHaveText(/Hesabınız etkinleştirildi, ancak bu tarayıcıdaki önceki oturum kapatılamadı\./u);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/aktivasyon$/);
  await expect(page.getByRole("link", { name: "Girişe dön" })).toHaveCount(0);
  expect(logoutCalls).toBe(1);

  // A confirmed retry continues to the login page.
  await page.getByRole("button", { name: "Önceki oturumu kapat" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status")).toHaveText("Hesabınız etkinleştirildi. Yeni şifrenizle giriş yapın.");
  expect(logoutCalls).toBe(2);
});

test("öğrenci aktivasyon kodu URL'den silinir ve öğrenci numarasıyla hesabı etkinleştirir", async ({ page }) => {
  let activationBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/auth/activate", async (route) => {
    activationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ data: { status: "ACCEPTED", acceptedAt: "2026-08-01T12:00:00.000Z", loginName: "101" } }),
    });
  });

  await page.goto("/aktivasyon#tenant=okul-a&student=101&code=ABCDEFGHJKL2");
  await expect(page).toHaveURL(/\/aktivasyon$/);
  expect(page.url()).not.toContain("ABCDEFGHJKL2");
  await expect(page.getByRole("textbox", { name: "Kurum kodu" })).toHaveValue("okul-a");
  await expect(page.getByRole("textbox", { name: "Öğrenci numarası" })).toHaveValue("101");
  await expect(page.getByRole("textbox", { name: "Aktivasyon kodu" })).toHaveValue("ABCDEFGHJKL2");
  await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("YeniAb12");
  await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("YeniAb12");
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status")).toHaveText("Hesabınız etkinleştirildi. Öğrenci numaranız ve yeni şifrenizle giriş yapın.");
  expect(activationBody).toEqual({
    tenantSlug: "okul-a",
    studentNo: "101",
    code: "ABCDEFGHJKL2",
    password: "YeniAb12",
  });
});

// UAT F-08: only an expiry error may say the link expired.
for (const { status, code, message } of [
  { status: 400, code: "IDENTITY_INVITATION_EXPIRED", message: "Davet bağlantısının süresi doldu." },
  { status: 400, code: "IDENTITY_INVITATION_NOT_PENDING", message: "daha önce kullanılmış" },
  // UAT F-20: a withdrawn link and employee-specific refusals name the reason.
  { status: 400, code: "IDENTITY_INVITATION_REVOKED", message: "Bu davet iptal edildi. Kurum yöneticinizden yeni davet isteyin." },
  { status: 400, code: "EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND", message: "Bu e-posta kurumda başka bir çalışanın hesabında kullanılıyor." },
  { status: 400, code: "EMPLOYEE_EMAIL_ACCOUNT_INCOMPATIBLE", message: "Bu e-posta çalışan hesabıyla birleştirilemeyen bir hesaba ait" },
  { status: 400, code: "EMPLOYEE_ALREADY_LINKED", message: "Bu çalışan kaydı zaten bir hesaba bağlı." },
  { status: 400, code: "EMPLOYEE_INVITATION_REQUIRES_ACTIVE_PROFILE", message: "Çalışan kaydınız aktif olmadığı için hesap açılamadı." },
  { status: 404, code: "IDENTITY_INVITATION_NOT_FOUND", message: "Davet bağlantısı geçersiz." },
  { status: 400, code: "SUBJECT_NATIONAL_ID_REQUIRED", message: "Kurum yöneticinizden yeni davet isteyin." },
  { status: 503, code: "TENANT_ACTIVITY_UNRESOLVED", message: "Kurum yöneticinizden yeni davet isteyin." },
  { status: 400, code: "PASSWORD_COMMON_REJECTED", message: "Şifre kabul edilmedi." },
  { status: 500, code: "INTERNAL_SERVER_ERROR", message: "Beklenmeyen bir hata oluştu." },
]) {
  test(`davet kabul hatası ${code} için doğru mesajı gösterir`, async ({ page }) => {
    await page.route("**/api/v1/identity-invitations/accept", (route) => route.fulfill({
      contentType: "application/json",
      status,
      body: JSON.stringify({ error: { code } }),
    }));

    await page.goto("/aktivasyon#token=activation-secret");
    await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("YeniAb12");
    await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("YeniAb12");
    await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

    const alert = page.locator(".next-form-error");
    await expect(alert).toContainText(message);
    if (code !== "IDENTITY_INVITATION_EXPIRED") await expect(alert).not.toContainText("süresi");
  });
}
