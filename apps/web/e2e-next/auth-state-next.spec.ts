import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("auth state görsel sözleşmesi", () => {
  test("auth state MFA doğrulama yöntemlerini ve sabit form bağlamını gösterir", async ({ page }) => {
    await page.setViewportSize({ height: 812, width: 320 });
    let loginBody: Record<string, unknown> | undefined;
    await prepareAuthPage(page, {
      onLogin(body) {
        loginBody = body;
        return {
          challengeToken: "challenge-token",
          expiresAt: "2026-07-29T20:00:00.000Z",
          methods: ["totp", "recovery_code"],
          status: "MFA_REQUIRED",
        };
      },
    });

    await submitCredentials(page);

    await expect(page.getByRole("group", { name: "Doğrulama yöntemi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "TOTP" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Kurtarma" }).click();
    await expect(page.getByRole("button", { name: "Kurtarma" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Kurtarma kodu")).toBeVisible();
    await expect(page.getByRole("button", { name: "Doğrula" })).toBeVisible();
    await expect(page.getByLabel("Kullanıcı Adı")).toBeDisabled();
    await expect(page.getByLabel("Şifre", { exact: true })).toBeDisabled();
    await expectNoHorizontalOverflow(page, "mfa-challenge-320");
    expect(loginBody).toEqual({ nationalId: "10000000146", password: "password" });
  });

  test("auth state MFA kurulumunu recovery kodları ve tek ana aksiyonla gösterir", async ({ page }) => {
    await page.setViewportSize({ height: 896, width: 414 });
    await prepareAuthPage(page, {
      onLogin() {
        return {
          keyUri: "otpauth://totp/O-Okul:admin",
          recoveryCodes: ["recovery-a", "recovery-b"],
          secret: "SETUPSECRET",
          setupExpiresAt: "2026-07-29T20:00:00.000Z",
          setupToken: "setup-token",
          status: "MFA_ENROLLMENT_REQUIRED",
        };
      },
    });

    await submitCredentials(page);

    const enrollment = page.getByRole("status");
    await expect(enrollment).toContainText("iki adımlı doğrulamayı etkinleştirin");
    await expect(page.getByLabel("Kurulum anahtarı")).toHaveValue("SETUPSECRET");
    await expect(page.getByLabel("Doğrulama kodu")).toBeVisible();
    await expect(enrollment).toContainText("recovery-a recovery-b");
    await expect(page.getByRole("button", { name: "Etkinleştir ve giriş yap" })).toBeVisible();
    await expect(page.getByLabel("Kullanıcı Adı")).toBeDisabled();
    await expect(page.getByLabel("Şifre", { exact: true })).toBeDisabled();
    await expectNoHorizontalOverflow(page, "mfa-enrollment-414");
  });

  test("auth state kurum kilidinde MFA payloadını doğrular ve kurum alanına yönlendirir", async ({ page }) => {
    let loginBody: Record<string, unknown> | undefined;
    let verifyBody: Record<string, unknown> | undefined;
    await prepareAuthPage(page, {
      routePath: "/k/dna-egitim/giris",
      onLogin(body) {
        loginBody = body;
        return {
          challengeToken: "challenge-token",
          expiresAt: "2026-07-29T20:00:00.000Z",
          methods: ["totp", "recovery_code"],
          status: "MFA_REQUIRED",
        };
      },
    });
    await page.route("**/api/v1/auth/totp/verify", async (route) => {
      verifyBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        body: JSON.stringify({ data: createAuthResponse("TENANT_ADMIN") }),
        contentType: "application/json",
        headers: { ...corsHeaders, "set-cookie": "csrfToken=csrf-token; Path=/; SameSite=Strict" },
        status: 200,
      });
    });

    await submitCredentials(page);
    await page.getByLabel("Doğrulama kodu").fill("123456");
    await page.getByRole("button", { name: "Doğrula" }).click();

    await expect(page).toHaveURL(/\/kurum$/, { timeout: 15_000 });
    expect(loginBody).toEqual({ nationalId: "10000000146", password: "password", tenantSlug: "dna-egitim" });
    expect(verifyBody).toEqual({ challengeToken: "challenge-token", totpCode: "123456" });
  });

  test("auth state yanlış MFA kodunda güvenli hata gösterir ve kimlik alanlarını kilitli tutar", async ({ page }) => {
    let verifyBody: Record<string, unknown> | undefined;
    await prepareAuthPage(page, {
      onLogin() {
        return {
          challengeToken: "challenge-token",
          expiresAt: "2026-07-29T20:00:00.000Z",
          methods: ["totp"],
          status: "MFA_REQUIRED",
        };
      },
    });
    await page.route("**/api/v1/auth/totp/verify", async (route) => {
      verifyBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ headers: corsHeaders, status: 401 });
    });

    await submitCredentials(page);
    await page.getByLabel("Doğrulama kodu").fill("000000");
    await page.getByRole("button", { name: "Doğrula" }).click();

    await expect(page.getByRole("form", { name: "Giriş formu" }).getByRole("alert")).toHaveText(
      "Doğrulama kodu geçersiz.",
    );
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Kullanıcı Adı")).toBeDisabled();
    await expect(page.getByLabel("Şifre", { exact: true })).toBeDisabled();
    expect(verifyBody).toEqual({ challengeToken: "challenge-token", totpCode: "000000" });
  });

  test("auth state sistem girişinde MFA kurulum payloadını doğrular ve sistem alanına yönlendirir", async ({ page }) => {
    let loginBody: Record<string, unknown> | undefined;
    let enrollmentBody: Record<string, unknown> | undefined;
    await prepareAuthPage(page, {
      routePath: "/sistem/giris",
      onLogin(body) {
        loginBody = body;
        return {
          keyUri: "otpauth://totp/O-Okul:system-admin",
          recoveryCodes: ["recovery-a", "recovery-b"],
          secret: "SETUPSECRET",
          setupExpiresAt: "2026-07-29T20:00:00.000Z",
          setupToken: "setup-token",
          status: "MFA_ENROLLMENT_REQUIRED",
        };
      },
    });
    await page.route("**/api/v1/auth/totp/enrollment/confirm", async (route) => {
      enrollmentBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        body: JSON.stringify({ data: createAuthResponse("SYSTEM_ADMIN") }),
        contentType: "application/json",
        headers: { ...corsHeaders, "set-cookie": "csrfToken=csrf-token; Path=/; SameSite=Strict" },
        status: 200,
      });
    });

    await submitCredentials(page);
    await page.getByLabel("Doğrulama kodu").fill("654321");
    await page.getByRole("button", { name: "Etkinleştir ve giriş yap" }).click();

    await expect(page).toHaveURL(/\/sistem$/, { timeout: 15_000 });
    expect(loginBody).toEqual({ nationalId: "10000000146", password: "password", tenantSlug: "system" });
    expect(enrollmentBody).toEqual({ setupToken: "setup-token", totpCode: "654321" });
  });
});

async function prepareAuthPage(
  page: Page,
  options: {
    onLogin(body: Record<string, unknown>): Record<string, unknown>;
    routePath?: "/login" | "/k/dna-egitim/giris" | "/sistem/giris";
  },
) {
  await page.route("**/api/v1/auth/login", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      body: JSON.stringify({ data: options.onLogin(body) }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
  });

  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({ headers: corsHeaders, status: 401 });
  });

  await page.goto(options.routePath ?? "/login");
  await expect(page.getByRole("form", { name: "Giriş formu" })).toBeVisible();
}

async function submitCredentials(page: Page) {
  await page.getByLabel("Kullanıcı Adı").fill("10000000146");
  await page.getByLabel("Şifre", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

function createAuthResponse(role: "SYSTEM_ADMIN" | "TENANT_ADMIN") {
  return {
    accessToken: "access-token",
    session: {
      id: "session-auth-state",
      membershipVersion: 1,
      roles: [role],
      status: "ACTIVE",
      tenantId: role === "SYSTEM_ADMIN" ? null : "tenant-a",
      userId: "user-auth-state",
    },
  };
}
